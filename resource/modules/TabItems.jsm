// VERSION 1.1.12

XPCOMUtils.defineLazyModuleGetter(this, "gPageThumbnails", "resource://gre/modules/PageThumbs.jsm", "PageThumbs");

// Class: TabItem - An <Item> that represents a tab.
// Parameters:
//   tab - a xul:tab
this.TabItem = function(tab, options = {}) {
	Subscribable(this);

	this.tab = tab;
	// register this as the tab's tabItem
	this.tab._tabViewTabItem = this;

	// ___ set up div
	this.container = TabItems.fragment().cloneNode(true);
	this.container._item = this;
	this.$container = iQ(this.container);

	this._showsCachedData = false;
	this.thumb = $$('.thumb', this.container)[0];
	this.fav = $$('.favicon', this.container)[0];
	this.tabTitle = $$('.tab-title', this.container)[0];
	this.canvas = $$('.thumb canvas', this.container)[0];
	this.$canvas = iQ(this.canvas);
	this.cachedThumb = $$('img.cached-thumb', this.container)[0];
	this.closeBtn = $$('.close', this.container)[0];

	this.tabCanvas = new TabCanvas(this.tab, this.canvas);
	this.tabCanvas.addSubscriber("painted", this);

	this.isATabItem = true;
	this._hidden = false;
	this._reconnected = false;
	this.isStacked = false;
	this._inVisibleStack = null;
	this._draggable = true;
	this.lastMouseDownTarget = null;

	this._lastTabUpdateTime = Date.now();

	Listeners.add(this.container, 'mousedown', this);
	Listeners.add(this.container, 'mouseup', this);
	Listeners.add(this.container, 'dragstart', this, true);
	Listeners.add(this.container, 'dragover', this);
	Listeners.add(this.container, 'dragenter', this);

	TabItems.register(this);

	// ___ reconnect to data from Storage
	if(!TabItems.reconnectingPaused) {
		this._reconnect(options);
	}
};

this.TabItem.prototype = {
	// Returns a boolean indicates whether the cached data is being displayed or not.
	isShowingCachedData: function() {
		return this._showsCachedData;
	},

	// Shows the cached data i.e. image and title.  Note: this method should only be called at browser startup with the cached data avaliable.
	showCachedData: function() {
		let { title, url } = this.getTabState();
		let thumbnailURL = gPageThumbnails.getThumbnailURL(url);

		// This method is only called when the tab item is first created during initialization.
		// We should update the group's thumb when the tab's cached thumb loads, otherwise we end up with a bunch of white squares in there.
		// Further updates to the tab's thumb will surely come through its canvas, which will also update the group's thumb accordingly.
		this.cachedThumb.addEventListener('load', this);

		setAttribute(this.cachedThumb, "src", thumbnailURL);
		this.container.classList.add("cached-data");

		let tooltip = (title && title != url ? title + "\n" + url : url);
		this.tabTitle.textContent = title;
		setAttribute(this.tabTitle, "title", tooltip);
		this._showsCachedData = true;
	},

	// Hides the cached data i.e. image and title and show the canvas.
	hideCachedData: function() {
		setAttribute(this.cachedThumb, "src", "");
		this.container.classList.remove("cached-data");
		this._showsCachedData = false;
	},

	// Get data to be used for persistent storage of this object.
	getStorageData: function() {
		let data = {
			groupID: (this.parent ? this.parent.id : 0)
		};
		if(this.parent && this.parent.getActiveTab() == this) {
			data.active = true;
		}

		return data;
	},

	// Store persistent for this object.
	save: function() {
		try {
			// too soon/late to save
			if(!this.tab || !Utils.isValidXULTab(this.tab) || !this._reconnected) { return; }

			let data = this.getStorageData();
			Storage.saveTab(this.tab, data);
		}
		catch(ex) {
			Cu.reportError(ex);
		}
	},

	// Returns the current tab state's active history entry.
	_getCurrentTabStateEntry: function() {
		let tabState = Storage.getTabState(this.tab);

		if(tabState) {
			let index = (tabState.index || tabState.entries.length) - 1;
			if(index in tabState.entries) {
				return tabState.entries[index];
			}
		}

		return null;
	},

	// Returns the current tab state, i.e. the title and URL of the active history entry.
	getTabState: function() {
		let entry = this._getCurrentTabStateEntry();
		let title = "";
		let url = "";

		if(entry) {
			if(entry.title) {
				title = entry.title;
			}

			url = entry.url;
		} else {
			url = this.tab.linkedBrowser.currentURI.spec;
		}

		return { title, url };
	},

	handleEvent: function(e) {
		switch(e.type) {
			case 'mousedown':
				if(e.button != 2) {
					this.lastMouseDownTarget = e.target;
					if(!this.isStacked || this.draggable || e.button == 1) {
						this.parent.childHandling = true;
					}
				}
				break;

			case 'mouseup':
				let same = (e.target == this.lastMouseDownTarget);
				this.lastMouseDownTarget = null;
				if(same) {
					this.parent.childHandling = true;

					// press close button or middle mouse click
					if(e.target == this.closeBtn || e.button == 1) {
						this.closedManually = true;
						this.close();
					} else if(!this.parent.isDragging) {
						this.zoomIn();
					}
				}
				break;

			case 'dragstart':
				if(this.lastMouseDownTarget == this.closeBtn) {
					e.preventDefault();
					e.stopPropagation();
				} else {
					this.lastMouseDownTarget = null;
					new TabDrag(e, this);
				}
				break;

			case 'dragenter':
				if(DraggingTab && !this.isStacked) {
					DraggingTab.dropHere(this);
				}
				break;

			case 'dragover':
				if(DraggingTab) {
					DraggingTab.canDrop(e, this.parent);
				}
				break;

			case 'load':
				// It's not necessary to keep the listener, this will surely only be called once per tab item.
				this.cachedThumb.removeEventListener('load', this);
				this.parent._updateThumb(true, true);
				break;
		}
	},

	handleSubscription: function(name, info) {
		switch(name) {
			case 'painted':
				this.parent._updateThumb(true);
				break;
		}
	},

	// Load the reciever's persistent data from storage. If there is none, treats it as a new tab.
	// Parameters:
	//   options - an object with additional parameters, see below
	// Possible options:
	//   groupItemId - if the tab doesn't have any data associated with it and groupItemId is available, add the tab to that group.
	_reconnect: function(options = {}) {
		let tabData = Storage.getTabData(this.tab);
		let groupItem;

		if(TabItems.storageSanity(tabData)) {
			// Show the cached data while we're waiting for the tabItem to be updated.
			// If the tab isn't restored yet this acts as a placeholder until it is.
			this.showCachedData();

			if(this.parent) {
				this.parent.remove(this);
			}

			if(tabData.groupID) {
				groupItem = GroupItems.groupItem(tabData.groupID);
			} else {
				groupItem = new GroupItem([], { immediately: true });
			}

			if(groupItem) {
				groupItem.add(this);

				// restore the active tab for each group between browser sessions
				if(tabData.active) {
					groupItem.setActiveTab(this);
				}

				// if it matches the selected tab or no active tab and the browser tab is hidden, the active group item would be set.
				if(this.tab.selected || (!GroupItems.getActiveGroupItem() && !this.tab.hidden)) {
					UI.setActive(this.parent);
				}
			}
		}
		else {
			if(options.groupItemId) {
				groupItem = GroupItems.groupItem(options.groupItemId);
			}

			if(groupItem) {
				groupItem.add(this);
			} else {
				// create tab group by double click is handled in UI_init().
				GroupItems.newTab(this);
			}
		}

		this._reconnected = true;
		this.save();
		this._sendToSubscribers("reconnected");
	},

	destroy: function() {
		Listeners.remove(this.container, 'mousedown', this);
		Listeners.remove(this.container, 'mouseup', this);
		Listeners.remove(this.container, 'dragstart', this, true);
		Listeners.remove(this.container, 'dragover', this);
		Listeners.remove(this.container, 'dragenter', this);
		this.container.remove();
	},

	getBounds: function() {
		return this.$container.bounds();
	},

	// Sets the receiver's parent to the given <GroupItem>.
	setParent: function(parent) {
		if(!parent) {
			this.container.remove();
		} else {
			parent.tabContainer.appendChild(this.container);
		}
		this.parent = parent;
		this.save();
	},

	get hidden() {
		return this._hidden;
	},

	set hidden(v) {
		if(this._hidden != v) {
			this.container.classList[v ? 'add' : 'remove']('tabHidden');
			this._hidden = v;
		}
		return this._hidden;
	},

	get draggable() {
		return this._draggable;
	},

	set draggable(v) {
		if(this._draggable != v) {
			toggleAttribute(this.container, 'draggable', v);
			this._draggable = v;
		}
		return this._draggable;
	},

	inVisibleStack: function(visible, rotation, zIndex) {
		let stacked = visible !== undefined;
		this.isStacked = stacked;

		if(!visible) {
			this.hidden = stacked;
			this.draggable = true;
			if(!this._inVisibleStack) { return; }
			this._inVisibleStack = null;

			this.removeClass("stacked");
			this.removeClass("behind");
			this.setRotation(0);
			return;
		}

		if(this._inVisibleStack && this._inVisibleStack.rotation == rotation && this._inVisibleStack.zIndex == zIndex) { return; }
		this._inVisibleStack = { rotation, zIndex };

		this.addClass("stacked");
		if(rotation != 0) {
			this.draggable = false;
			this.addClass('behind');
		} else {
			this.draggable = true;
			this.removeClass('behind');
		}

		this.container.style.zIndex = zIndex;
		this.setRotation(rotation);
		this.hidden = false;
	},

	// Rotates the object to the given number of degrees.
	setRotation: function(degrees) {
		let value = degrees ? "rotate("+degrees+"deg)" : null;
		this.$container.css({ "transform": value });
	},

	// Closes this item (actually closes the tab associated with it, which automatically closes the item).
	// Parameters:
	//   groupClose - true if this method is called by group close action.
	// Returns true if this tab is removed.
	close: function(groupClose) {
		// When the last tab is closed, put a new tab into closing tab's group.
		// If closing tab doesn't belong to a group and no empty group, create a new one for the new tab.
		if(!groupClose && Tabs.length == 1) {
			let group = this.tab._tabViewTabItem.parent;
			group.newTab(null, { closedLastTab: true });
		}

		gBrowser.removeTab(this.tab);
		let tabClosed = !this.tab;

		if(tabClosed) {
			this._sendToSubscribers("tabRemoved");
		}

		// No need to explicitly delete the tab data, becasue sessionstore data associated with the tab will automatically go away
		return tabClosed;
	},

	// Adds the specified CSS class to this item's container DOM element.
	addClass: function(className) {
		this.container.classList.add(className);
	},

	// Removes the specified CSS class from this item's container DOM element.
	removeClass: function(className) {
		this.container.classList.remove(className);
	},

	// Updates this item to visually indicate that it's active.
	makeActive: function() {
		this.container.classList.add("focus");

		if(this.parent) {
			this.parent.setActiveTab(this);
		}
	},

	// Updates this item to visually indicate that it's not active.
	makeDeactive: function() {
		this.container.classList.remove("focus");
	},

	// Allows you to select the tab and zoom in on it, thereby bringing you to the tab in Firefox to interact with.
	// Parameters:
	//   isNewBlankTab - boolean indicates whether it is a newly opened blank tab.
	zoomIn: function(isNewBlankTab) {
		// don't allow zoom in if its group is hidden
		if(this.parent && this.parent.hidden) { return; }

		Search.hide();

		UI.setActive(this);

		// Zoom in!
		aSync(() => {
			UI.goToTab(this.tab);

			// tab might not be selected because hideTabView() is invoked after
			// UI.goToTab() so we need to setup everything for the gBrowser.selectedTab
			if(!this.tab.selected) {
				UI.onTabSelect(Tabs.selected);
			} else if(isNewBlankTab) {
				gWindow.gURLBar.focus();
			}
			if(this.parent && this.parent.expanded) {
				this.parent.collapse();
			}

			this._sendToSubscribers("zoomedIn");
		}, 0);
	},

	// Handles the zoom down animation after returning to TabView. It is expected that this routine will be called from the chrome thread
	zoomOut: function() {
		UI.setActive(this);
	},

	// Updates the tabitem's canvas.
	updateCanvas: function() {
		// ___ thumbnail
		let w = this.$canvas.width() - UICache.tabCanvasOffset;
		let h = this.$canvas.height() - UICache.tabCanvasOffset;
		let dimsChanged = w != this.canvas.width || h != this.canvas.height;

		TabItems._lastUpdateTime = Date.now();
		this._lastTabUpdateTime = TabItems._lastUpdateTime;

		if(this.tabCanvas) {
			if(dimsChanged) {
				// more tasking as it involves the creation of a temp canvas.
				this.tabCanvas.update(w, h);
			} else {
				this.tabCanvas.paint();
			}
		}

		// ___ cache
		if(this.isShowingCachedData()) {
			this.hideCachedData();
		}

		this._sendToSubscribers("updated");
	}
};

// Singleton for managing <TabItem>s
this.TabItems = {
	minTabWidth: 90,
	tabWidth: 160,
	tabHeight: 160,
	tabAspect: 0, // set in init
	invTabAspect: 0, // set in init
	fontSizeRange: new Range(8,15),
	_fragment: null,
	items: new Set(),
	paintingPaused: 0,
	_tabsWaitingForUpdate: null,
	_heartbeatTiming: 200, // milliseconds between calls
	_maxTimeForUpdating: 200, // milliseconds that consecutive updates can take
	_lastUpdateTime: Date.now(),
	reconnectingPaused: false,

	get size() { return this.items.size; },
	[Symbol.iterator]: function* () {
		for(let item of this.items) {
			yield item;
		}
	},
	get [0]() {
		for(let item of this) {
			return item;
		}
	},

	// Called when a web page is painted.
	receiveMessage: function(m) {
		let tab = gBrowser.getTabForBrowser(m.target);
		if(!tab) { return; }

		if(!tab.pinned) {
			this.update(tab);
		}
	},

	handleEvent: function(e) {
		let tab = e.target;

		// We don't care about pinned tabs here
		if(tab.pinned) { return; }

		switch(e.type) {
			// When a tab is opened, create the TabItem
			case "TabOpen":
				this.link(tab);
				break;

			// When a tab's content is loaded, show the canvas and hide the cached data if necessary.
			case "TabAttrModified":
				this.update(tab);
				break;

			// When a tab is closed, unlink.
			case "TabClose":
				// XXX bug #635975 - don't unlink the tab if the dom window is closing.
				if(!UI.isDOMWindowClosing) {
					this.unlink(tab);
				}
				break;
		}
	},

	// Set up the necessary tracking to maintain the <TabItems>s.
	init: function() {
		// Set up tab priority queue
		this._tabsWaitingForUpdate = new TabPriorityQueue();
		this.minTabHeight = Math.floor(this.minTabWidth * this.tabHeight / this.tabWidth);
		this.tabAspect = this.tabHeight / this.tabWidth;
		this.invTabAspect = 1 / this.tabAspect;

		Messenger.listenWindow(gWindow, "MozAfterPaint", this);

		Tabs.listen("TabOpen", this);
		Tabs.listen("TabAttrModified", this);
		Tabs.listen("TabClose", this);

		let activeGroupItem = GroupItems.getActiveGroupItem();
		let activeGroupItemId = activeGroupItem ? activeGroupItem.id : null;
		// For each tab, create the link.
		for(let tab of Tabs.notPinned) {
			let options = { immediately: true };
			// if tab is visible in the tabstrip and doesn't have any data stored in the session store (see TabItem__reconnect),
			// it implies that it is a new tab which is created before Panorama is initialized.
			// Therefore, passing the active group id to the link() method for setting it up.
			if(!tab.hidden && activeGroupItemId) {
				options.groupItemId = activeGroupItemId;
			}
			this.link(tab, options);
			this.update(tab);
		}
	},

	uninit: function() {
		Messenger.unlistenWindow(gWindow, "MozAfterPaint", this);

		Tabs.unlisten("TabOpen", this);
		Tabs.unlisten("TabAttrModified", this);
		Tabs.unlisten("TabClose", this);

		for(let tabItem of this) {
			delete tabItem.tab._tabViewTabItem;
		}

		this.items = new Set();
		this._lastUpdateTime = Date.now();
		this._tabsWaitingForUpdate.clear();
	},

	// Return a DocumentFragment which has a single <div> child. This child node will act as a template for all TabItem containers.
	// The first call of this function caches the DocumentFragment in _fragment.
	fragment: function() {
		if(this._fragment) {
			return this._fragment;
		}

		let div = document.createElement("div");
		div.classList.add("tab");
		div.setAttribute('draggable', 'true');

		let thumb = document.createElement("div");
		thumb.classList.add('thumb');
		div.appendChild(thumb);

		let img = document.createElement('img');
		img.classList.add('cached-thumb');
		thumb.appendChild(img);

		let canvas = document.createElement('canvas');
		canvas.setAttribute('moz-opaque', '');
		thumb.appendChild(canvas);

		let faviconContainer = document.createElement('div');
		faviconContainer.classList.add('favicon-container');
		thumb.appendChild(faviconContainer);

		let favicon = document.createElement('div');
		favicon.classList.add('favicon');
		faviconContainer.appendChild(favicon);

		let span = document.createElement('span');
		span.classList.add('tab-title');
		span.textContent = ' ';
		div.appendChild(span);

		let close = document.createElement('div');
		close.classList.add('close');
		setAttribute(close, "title", Strings.get("TabView", "closeTab"));
		thumb.appendChild(close);

		this._fragment = div;

		return this._fragment;
	},

	// Checks whether the xul:tab has fully loaded and calls a callback with a boolean indicates whether the tab is loaded or not.
	_isComplete: function(tab, callback) {
		return new Promise(function(resolve, reject) {
			// A pending tab can't be complete, yet.
			if(tab.hasAttribute("pending")) {
				aSync(() => resolve(false));
				return;
			}

			let receiver = function(m) {
				Messenger.unlistenBrowser(tab.linkedBrowser, "isDocumentLoaded", receiver);
				resolve(m.data);
			};

			Messenger.listenBrowser(tab.linkedBrowser, "isDocumentLoaded", receiver);
			Messenger.messageBrowser(tab.linkedBrowser, "isDocumentLoaded");
		});
	},

	// Takes in a xul:tab.
	update: function(tab) {
		try {
			// It could have been closed in the meantime, in which case there's no point
			// (not that we could "update" it even if we wanted to anyway).
			if(!tab._tabViewTabItem) { return; }

			let shouldDefer =	this.isPaintingPaused()
						|| this._tabsWaitingForUpdate.hasItems()
						|| Date.now() - this._lastUpdateTime < this._heartbeatTiming;

			if(shouldDefer) {
				this._tabsWaitingForUpdate.push(tab);
				this.startHeartbeat();
			} else {
				this._update(tab);
			}
		}
		catch(ex) {
			Cu.reportError(ex);
		}
	},

	// Takes in a xul:tab.
	// Parameters:
	//   tab - a xul tab to update
	//   options - an object with additional parameters, see below
	// Possible options:
	//   force - true to always update the tab item even if it's incomplete
	_update: function(tab, options = {}) {
		try {
			// ___ remove from waiting list now that we have no other early returns
			this._tabsWaitingForUpdate.remove(tab);

			// ___ get the TabItem
			let tabItem = tab._tabViewTabItem;

			// Even if the page hasn't loaded, display the favicon and title
			FavIcons.getFavIconUrlForTab(tab, function(iconUrl) {
				if(iconUrl) {
					tabItem.fav._iconUrl = iconUrl;
					tabItem.fav.style.backgroundImage = 'url("'+iconUrl+'")';
					tabItem.removeClass('noFavicon');
				} else {
					tabItem.fav._iconUrl = '';
					tabItem.fav.style.backgroundImage = '';
					tabItem.addClass('noFavicon');
				}
				tabItem._sendToSubscribers("iconUpdated");
			});

			// ___ label
			let label = tab.label;
			if(tabItem.tabTitle.textContent != label) {
				tabItem.tabTitle.textContent = label;
			}

			// ___ URL
			let tabUrl = tab.linkedBrowser.currentURI.spec;
			let tooltip = (label == tabUrl ? label : label + "\n" + tabUrl);
			setAttribute(tabItem.container, "title", tooltip);

			// ___ Make sure the tab is complete and ready for updating.
			if(options.force) {
				tabItem.updateCanvas();
			} else {
				this._isComplete(tab).then((isComplete) => {
					if(!Utils.isValidXULTab(tab) || tab.pinned) { return; }

					if(isComplete) {
						tabItem.updateCanvas();
					} else {
						this._tabsWaitingForUpdate.push(tab);
					}
				});
			}
		}
		catch(ex) {
			Cu.reportError(ex);
		}
	},

	// Takes in a xul:tab, creates a TabItem for it and adds it to the scene.
	link: function(tab, options) {
		try {
			new TabItem(tab, options); // sets tab._tabViewTabItem to itself
		}
		catch(ex) {
			Cu.reportError(ex);
		}
	},

	// Takes in a xul:tab and destroys the TabItem associated with it.
	unlink: function(tab) {
		try {
			tab._tabViewTabItem.destroy();
			this.unregister(tab._tabViewTabItem);
			tab._tabViewTabItem._sendToSubscribers("close", tab._tabViewTabItem);

			tab._tabViewTabItem.tab = null;
			tab._tabViewTabItem.tabCanvas.tab = null;
			tab._tabViewTabItem.tabCanvas = null;
			tab._tabViewTabItem = null;
			Storage.saveTab(tab, null);

			this._tabsWaitingForUpdate.remove(tab);
		}
		catch(ex) {
			Cu.reportError(ex);
		}
	},

	// when a tab becomes pinned, destroy its TabItem
	handleTabPin: function(xulTab) {
		this.unlink(xulTab);
	},

	// when a tab becomes unpinned, create a TabItem for it
	handleTabUnpin: function(xulTab) {
		this.link(xulTab);
		this.update(xulTab);
	},

	// Start a new heartbeat if there isn't one already started. The heartbeat is a chain of aSync calls that allows us to spread
	// out update calls over a period of time. We make sure not to add multiple aSync chains.
	startHeartbeat: function() {
		if(!Timers.heartbeat) {
			Timers.init('heartbeat', () => {
				this._checkHeartbeat();
			}, this._heartbeatTiming);
		}
	},

	// This periodically checks for tabs waiting to be updated, and calls _update on them.
	// Should only be called by startHeartbeat and resumePainting.
	_checkHeartbeat: function() {
		if(this.isPaintingPaused()) { return; }

		// restart the heartbeat to update all waiting tabs once the UI becomes idle
		if(!UI.isIdle()) {
			this.startHeartbeat();
			return;
		}

		let accumTime = 0;
		let items = this._tabsWaitingForUpdate.getItems();
		// Do as many updates as we can fit into a "perceived" amount of time, which is tunable.
		while(accumTime < this._maxTimeForUpdating && items.length) {
			let updateBegin = Date.now();
			this._update(items.pop());
			let updateEnd = Date.now();

			// Maintain a simple average of time for each tabitem update
			// We can use this as a base by which to delay things like tab zooming, so there aren't any hitches.
			let deltaTime = updateEnd - updateBegin;
			accumTime += deltaTime;
		}

		if(this._tabsWaitingForUpdate.hasItems()) {
			this.startHeartbeat();
		}
	},

	// Tells TabItems to stop updating thumbnails (so you can do animations without thumbnail paints causing stutters).
	// pausePainting can be called multiple times, but every call to pausePainting needs to be mirrored with a call to <resumePainting>.
	pausePainting: function() {
		this.paintingPaused++;
		if(Timers.heartbeat) {
			Timers.cancel('heartbeat');
		}
	},

	// Undoes a call to <pausePainting>. For instance, if you called pausePainting three times in a row, you'll need to call resumePainting
	// three times before TabItems will start updating thumbnails again.
	resumePainting: function() {
		this.paintingPaused--;
		if(!this.isPaintingPaused()) {
			this.startHeartbeat();
		}
	},

	// Returns a boolean indicating whether painting is paused or not.
	isPaintingPaused: function() {
		return this.paintingPaused > 0;
	},

	// Don't reconnect any new tabs until resume is called.
	pauseReconnecting: function() {
		this.reconnectingPaused = true;
	},

	// Reconnect all of the tabs that were created since we paused.
	resumeReconnecting: function() {
		this.reconnectingPaused = false;
		for(let item of this) {
			if(!item._reconnected) {
				item._reconnect();
			}
		}
	},

	// Adds the given <TabItem> to the master list.
	register: function(item) {
		this.items.add(item);
	},

	// Removes the given <TabItem> from the master list.
	unregister: function(item) {
		this.items.delete(item);
	},

	// Saves all open <TabItem>s.
	saveAll: function() {
		for(let tabItem of this) {
			tabItem.save();
		}
	},

	// Checks the specified data (as returned by TabItem.getStorageData) and returns true if it looks valid.
	storageSanity: function(data) {
		return data && typeof(data) == 'object' && typeof(data.groupID) == 'number';
	},

	// Private method that returns the fontsize to use given the tab's width
	getFontSizeFromWidth: function(width) {
		let widthRange = new Range(0, this.tabWidth);
		let proportion = widthRange.proportion(width - UICache.tabItemPadding, true);
		// proportion is in [0,1]
		return Math.max(this.fontSizeRange.scale(proportion), this.fontSizeRange.min);
	},

	// Private method that returns the tabitem width given a height.
	_getWidthForHeight: function(height) {
		return height * this.invTabAspect;
	},

	// Private method that returns the tabitem height given a width.
	_getHeightForWidth: function(width) {
		return width * this.tabAspect;
	},

	// Arranges the given items in a grid within the given bounds, maximizing item size but maintaining standard tab aspect ratio for each
	// Parameters:
	//   count - number of items to be arranged within bounds.
	//   bounds - a <Rect> defining the space to arrange within
	//   columns - pass an initial value for the number of columns to assume the items will be displayed in, if not set the loop will start at 1
	// Returns:
	//   an object with the width value of the child items (`tabWIdth` and `tabHeight`) and the number of columns (`columns`) and rows (`rows`).
	arrange: function(count, bounds, columns) {
		columns = columns || 1;
		// We'll assume that all the items have the same styling and that the margin is the same width around.
		let rows;
		let tabWidth;
		let tabHeight;
		let totalHeight;
		let totalWidth;
		let overflowing;
		let firstCycle = false;

		let figure = () => {
			let specRows = Math.ceil(count / columns);
			let validSize = this.calcValidSize(new Point(bounds.width / columns, -1));
			totalWidth = validSize.x * columns;
			overflowing = totalWidth > bounds.width;

			if(firstCycle && overflowing) {
				columns--;
				return;
			}
			firstCycle = true;

			rows = specRows;
			tabWidth = validSize.x;
			tabHeight = validSize.y;

			totalHeight = tabHeight * rows;
		}

		figure();
		while(!overflowing && rows > 1 && totalHeight > bounds.height) {
			columns++;
			figure();
		}

		if(rows == 1) {
			let validSize = this.calcValidSize(new Point(tabWidth, bounds.height));
			tabWidth = validSize.x;
			tabHeight = validSize.y;
			totalHeight = tabHeight;
		}

		tabWidth = Math.floor(tabWidth) -UICache.tabItemPadding;
		tabHeight = Math.floor(tabHeight) -UICache.tabItemPadding;

		return { tabWidth, tabHeight, columns, rows, overflowing };
	},

	// Pass in a desired size, and receive a size based on proper title size and aspect ratio.
	calcValidSize: function(size) {
		let width = Math.max(this.minTabWidth, size.x);
		let height = Math.max(this.minTabHeight, size.y);
		let retSize = new Point(width, height);

		if(size.x > -1) {
			retSize.y = this._getHeightForWidth(width);
		}
		if(size.y > -1) {
			retSize.x = this._getWidthForHeight(height);
		}

		if(size.x > -1 && size.y > -1) {
			if(retSize.x < size.x) {
				retSize.y = this._getHeightForWidth(retSize.x);
			} else {
				retSize.x = this._getWidthForHeight(retSize.y);
			}
		}

		return retSize;
	}
};

// Class: TabPriorityQueue - Container that returns tab items in a priority order
// Current implementation assigns tab to either a high priority or low priority queue, and toggles which queue items are popped from.
// This guarantees that high priority items which are constantly being added will not eclipse changes for lower priority items.
this.TabPriorityQueue = function() {};

this.TabPriorityQueue.prototype = {
	_low: [], // low priority queue
	_high: [], // high priority queue

	// Empty the update queue
	clear: function() {
		this._low = [];
		this._high = [];
	},

	// Return whether pending items exist
	hasItems: function() {
		return (this._low.length > 0) || (this._high.length > 0);
	},

	// Returns all queued items, ordered from low to high priority
	getItems: function() {
		return this._low.concat(this._high);
	},

	// Add an item to be prioritized
	push: function(tab) {
		// Push onto correct priority queue.
		// It's only low priority if it's in a stack, and isn't the top, and the stack isn't expanded.
		// If it already exists in the destination queue, leave it.
		// If it exists in a different queue, remove it first and push onto new queue.
		let item = tab._tabViewTabItem;
		if(item.parent && (item.parent.isStacked && !item.parent.isTopOfStack(item) && !item.parent.expanded)) {
			let idx = this._high.indexOf(tab);
			if(idx != -1) {
				this._high.splice(idx, 1);
				this._low.unshift(tab);
			} else if(this._low.indexOf(tab) == -1) {
				this._low.unshift(tab);
			}
		}
		else {
			let idx = this._low.indexOf(tab);
			if(idx != -1) {
				this._low.splice(idx, 1);
				this._high.unshift(tab);
			} else if(this._high.indexOf(tab) == -1) {
				this._high.unshift(tab);
			}
		}
	},

	// Remove and return the next item in priority order
	pop: function() {
		if(this._high.length) {
			return this._high.pop();
		}
		if(this._low.length) {
			return this._low.pop();
		}
		return null;
	},

	// Return the next item in priority order, without removing it
	peek: function() {
		if(this._high.length) {
			return this._high[this._high.length-1];
		}
		if(this._low.length) {
			return this._low[this._low.length-1];
		}
		return null;
	},

	// Remove the passed item
	remove: function(tab) {
		let index = this._high.indexOf(tab);
		if(index != -1) {
			this._high.splice(index, 1);
		} else {
			index = this._low.indexOf(tab);
			if(index != -1) {
				this._low.splice(index, 1);
			}
		}
	}
};

// Class: TabCanvas - Takes care of the actual canvas for the tab thumbnail
this.TabCanvas = function(tab, canvas) {
	Subscribable(this);

	this.tab = tab;
	this.canvas = canvas;
};

this.TabCanvas.prototype = {
	paint: function(evt) {
		let w = this.canvas.width;
		let h = this.canvas.height;
		if(!w || !h) { return; }

		let browser = this.tab.linkedBrowser;

		gPageThumbnails.captureToCanvas(browser, this.canvas, () => {
			this._sendToSubscribers("painted");
		});

		this.persist(browser);
	},

	persist(browser) {
		// capture to file, thumbnail service does not persist automatically when rendering to canvas
		gPageThumbnails.shouldStoreThumbnail(browser, (storeAllowed) => {
			if(storeAllowed) {
				// ifStale bails out early if there already is an existing thumbnail less than 2 days old
				// so this shouldn't cause excessive IO when a thumbnail is updated frequently
				gPageThumbnails.captureAndStoreIfStale(browser, () => {})
			}
		});
	},

	// Changing the dims of a canvas will clear it, so we don't want to do do this to a canvas we're currently displaying.
	// This method grabs a new thumbnail at the new dims and then copies it over to the displayed canvas.
	update: function(aWidth, aHeight) {
		let temp = gPageThumbnails.createCanvas(window);
		temp.width = aWidth;
		temp.height = aHeight;

		let browser = this.tab.linkedBrowser;

		gPageThumbnails.captureToCanvas(browser, temp, () => {
			let ctx = this.canvas.getContext('2d');
			this.canvas.width = aWidth;
			this.canvas.height = aHeight;
			try {
				ctx.drawImage(temp, 0, 0);
			}
			catch(ex if ex.name == "InvalidStateError") {
				// Can't draw if the canvas created by page thumbs isn't valid. This can happen during shutdown.
				return;
			}
			this._sendToSubscribers("painted");
		});

		this.persist(browser);
	},

	toImageData: function() {
		return this.canvas.toDataURL("image/png");
	}
};
