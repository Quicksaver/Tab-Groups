/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.3.12

XPCOMUtils.defineLazyModuleGetter(this, "PageThumbs", "resource://gre/modules/PageThumbs.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PageThumbsStorage", "resource://gre/modules/PageThumbs.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PageThumbUtils", "resource://gre/modules/PageThumbUtils.jsm");
Cu.importGlobalProperties(['FileReader']);
this.__defineGetter__('URL', function() { return window.URL; });

// Class: TabItem - An <Item> that represents a tab.
// Parameters:
//   tab - a xul:tab
this.TabItem = function(tab, options = {}) {
	Subscribable(this);

	this.tab = tab;
	// register this as the tab's tabItem
	this.tab._tabViewTabItem = this;

	// ___ set up div
	let dom = TabItems.fragment();
	for(let x in dom) {
		this[x] = dom[x];
	}

	this.container._item = this;
	this.$container = iQ(this.container);

	this.isATabItem = true;
	this._hidden = false;
	this._reconnected = false;
	this._showsCachedData = false;
	this._cachedThumbURL = '';
	this._tempCanvasBlobURL = '';
	this.isStacked = false;
	this._inVisibleStack = null;
	this.order = 1;
	this._draggable = true;
	this.lastMouseDownTarget = null;
	this._thumbNeedsUpdate = false;
	this._hasHadThumb = false;
	this._soundplaying = false;
	this._iconUrl = null;

	this.container.addEventListener('mousedown', this);
	this.container.addEventListener('mouseup', this);
	this.container.addEventListener('dragstart', this, true);
	this.container.addEventListener('dragover', this);
	this.container.addEventListener('dragenter', this);
	Watchers.addAttributeWatcher(this.tab, [
		"busy", "progress", "soundplaying", "muted", "pending", "tabmix_pending", "tabmix_tabState", "protected"
	], this, false, false);

	TabItems.register(this);

	// ___ reconnect to data from Storage
	if(!TabItems.reconnectingPaused) {
		this._reconnect(options);
	}
};

this.TabItem.prototype = {
	// Shows the cached data i.e. image and title.  Note: this method should only be called at browser startup with the cached data avaliable.
	showCachedData: function() {
		let { title, url } = this.getTabState();
		this.updateLabel(title, url);
		this._cachedThumbURL = PageThumbs.getThumbnailURL(url);
	},

	showCachedThumb: function(immediately) {
		let thumbnailURL = this._tempCanvasBlobURL || this._cachedThumbURL;

		// If we're in a group where thumbs are not showing, we don't really need to show the cached thumb either.
		if(this.parent && this.parent.stale) {
			if(this.tabCanvas && this.tabCanvas.destroying) {
				this.tabCanvas.destroying.resolve();
			}
			this.hideCachedThumb();
			return;
		}

		// We create the cached thumb dynamically, and append it to the DOM only if there's a thumb to show.
		if(!this.cachedThumb) {
			this.cachedThumb = TabItems.cachedThumbFragment();
			this.cachedThumb._src = "";
		}

		if(this.cachedThumb._src != thumbnailURL) {
			if(!immediately) {
				TabItems.queueCachedThumb(this, thumbnailURL);
			} else {
				this._showCachedThumb(thumbnailURL);
			}
		}
	},

	_showCachedThumb: function(thumbnailURL) {
		// We should update the group's thumb when the tab's cached thumb loads, otherwise we end up with a bunch of white squares in there.
		// Further updates to the tab's thumb will surely come through its canvas, which will also update the group's thumb accordingly.
		this.cachedThumb.addEventListener('load', this);
		this.cachedThumb.addEventListener('error', this);
		this.cachedThumb.addEventListener('abort', this);

		this.cachedThumb._src = thumbnailURL;
		this.cachedThumb.setAttribute("src", thumbnailURL);
	},

	// Removes the cached data i.e. image and title and show the canvas.
	hideCachedThumb: function() {
		if(this.tabCanvas && this.tabCanvas.destroying) {
			this.tabCanvas.destroying.reject();
		}

		if(this.cachedThumb) {
			this.cachedThumb.removeEventListener('load', this);
			this.cachedThumb.removeEventListener('error', this);
			this.cachedThumb.removeEventListener('abort', this);
			this.cachedThumb.setAttribute("src", "");
			this.cachedThumb._src = "";
			this.cachedThumb.remove();
			this.cachedThumb = null;
		}

		if(this._showsCachedData) {
			this.container.classList.remove("cached-data");
			this._showsCachedData = false;
		}

		if(this._tempCanvasBlobURL) {
			URL.revokeObjectURL(this._tempCanvasBlobURL);
			this._tempCanvasBlobURL = '';
		}
	},

	// Note: only call this when a thumb should be shown!
	checkUpdatedThumb: function() {
		if(this._thumbNeedsUpdate) {
			TabItems.update(this.tab);
		} else if(!this.tabCanvas) {
			this.showCachedThumb();
		}
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
					} else if(e.target == this.audioBtn) {
						this.tab.toggleMuteAudio();
					} else if(!this.parent.isDragging) {
						this.zoomIn();
					}
				}
				break;

			case 'dragstart':
				switch(this.lastMoudeDownTarget) {
					case this.closeBtn:
					case this.audioBtn:
						e.preventDefault();
						e.stopPropagation();
						break;

					default:
						this.lastMouseDownTarget = null;
						new TabDrag(e, this);
						break;
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
				this.cachedThumb.removeEventListener('error', this);
				this.cachedThumb.removeEventListener('abort', this);

				if(!this.cachedThumb.parentNode) {
					this.thumb.appendChild(this.cachedThumb);
				}
				this.container.classList.add("cached-data");
				this._showsCachedData = true;

				// Warn the canvas if it's waiting for the "cached" thumb to show to be destroyed.
				if(this.tabCanvas && this.tabCanvas.destroying) {
					this.tabCanvas.destroying.resolve();
				}

				this.parent.updateThumb(true);
				break;

			case 'error':
			case 'abort':
				this.hideCachedThumb();
				// If we fail to load a cached thumb, we should make sure we have at least a canvas, so that the thumb isn't just a blank square.
				// e.g. I'm having trouble loading a cached thumb for about:home...
				if(!this.tabCanvas && !TabItems._isPending(this.tab)) {
					TabItems.update(this.tab);
				}
				break;
		}
	},

	// Watching several attributes in tabs, at least "progress" doesn't fire TabAttrModified events, and "busy" seems a bit unreliable.
	attrWatcher: function(tab, attr) {
		switch(attr) {
			case "busy":
			case "progress":
				this.updateThrobber();
				break;

			case "soundplaying":
			case "muted":
				this.updateAudio();
				break;

			case "pending":
			case "tabmix_pending":
			case "tabmix_tabState":
			case "protected":
				this.updateAttributes();
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
				// Show the cached thumb before adding the tabitem to the group (before activating its canvas).
				if(!groupItem.stale && groupItem.showThumbs) {
					this.showCachedThumb();
				}
				groupItem.add(this);

				// Mark this tab as active if it's currently selected.
				if(!Tabs.selected.pinned && groupItem == GroupItems.getActiveGroupItem()) {
					if(this.tab == Tabs.selected) {
						groupItem.setActiveTab(this);
					}
				}
				// restore the active tab for each group between browser sessions
				else if(tabData.active) {
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

		this.updateThrobber();
		this.updateAudio();
		this.updateAttributes();

		this._reconnected = true;
		this.save();
		this._sendToSubscribers("reconnected");
	},

	destroy: function() {
		this.container.removeEventListener('mousedown', this);
		this.container.removeEventListener('mouseup', this);
		this.container.removeEventListener('dragstart', this, true);
		this.container.removeEventListener('dragover', this);
		this.container.removeEventListener('dragenter', this);
		Watchers.removeAttributeWatcher(this.tab, [ "busy", "progress", "soundplaying", "muted", "pending", "tabmix_pending", "tabmix_tabState" ], this, false, false);
		this.container.remove();

		delete this.tab._tabViewTabItem;
		this.tab = null;
		if(this.tabCanvas) {
			this.tabCanvas.tab = null;
			this.tabCanvas.canvas.remove();
			this.tabCanvas = null;
		}
	},

	getBounds: function() {
		return this.$container.bounds();
	},

	// Sets the receiver's parent to the given <GroupItem>.
	setParent: function(parent) {
		if(this.parent && this._soundplaying) {
			this.parent.soundplaying(this, false);
		}

		if(!parent) {
			this.container.remove();
		} else {
			parent.tabContainer.appendChild(this.container);
		}
		this.parent = parent;
		this.save();

		if(parent) {
			if(!parent.stale && parent.showThumbs) {
				this.checkUpdatedThumb();
			}

			if(this._soundplaying) {
				parent.soundplaying(this, true);
			}
		}
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
		let value = degrees ? "translate(-50%, -50%) rotate("+degrees+"deg)" : null;
		this.$container.css({ "transform": value });
	},

	// Set the slot, relative to other tabs, where this tab item should be placed.
	setOrder: function(order) {
		if(this.order == order) { return; }
		this.order = order;
		this.container.style.order = this.order;
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
			group.newTab(true);
		}

		gBrowser.removeTab(this.tab);
		let tabClosed = !this.tab;

		if(tabClosed) {
			this._sendToSubscribers("tabRemoved", this);
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
			// Tab View has been deinitialized. We can't proceed.
			if(typeof(UI) == 'undefined') { return; }

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

	updateLabels: Task.async(function* () {
		if(TabItems._tabsNeedingLabelsUpdate.has(this)) {
			yield this._updateLabels();
		}
	}),

	_updateLabels: function() {
		TabItems._tabsNeedingLabelsUpdate.delete(this);

		return new Promise((resolve, reject) => {
			// Tab could have been closed in the meantime.
			if(!this.tab) {
				resolve(false);
				return;
			}

			FavIcons.getFavIconUrlForTab(this.tab, (iconUrl) => {
				// Add-on disabled or window/tab closed in the meantime.
				if(typeof(TabItems) == 'undefined' || !this.tab) {
					resolve(false);
					return;
				}

				// Get the dominant color for this favicon, it will only be used if this tab's group tiles icons instead of thumbs.,
				// but we should still have it hand.
				// This also sets the _iconUrl property in the tabItem.
				FavIcons.getDominantColor(iconUrl || FavIcons.defaultFavicon, this).then((color) => {
					// We don't actually need the color here (for now), it's all done in FavIcons dynamic stylesheet.
				});

				setAttribute(this.fav.parentNode, 'iconUrl', this._iconUrl);
				this.fav.style.backgroundImage = 'url("'+this._iconUrl+'")';

				if(iconUrl) {
					this.fav._iconUrl = iconUrl;
					this.removeClass('noFavicon');
				} else {
					this.fav._iconUrl = '';
					this.addClass('noFavicon');
				}

				this._sendToSubscribers("iconUpdated");
				resolve(true);
			});

			let label = this.tab.label;
			let tabUrl = this.tab.linkedBrowser.currentURI.spec;
			this.updateLabel(label, tabUrl);
		});
	},

	updateLabel: function(title, url) {
		title = title || url;
		let tooltip = title;
		if(title != url) {
			tooltip += "\n" + url;
			this.removeClass('onlyUrl');
		} else {
			this.addClass('onlyUrl');
		}

		if(this.tabTitle.textContent != title) {
			this.tabTitle.textContent = title;
		}
		if(this.tabUrl.textContent != url) {
			this.tabUrl.textContent = url;
		}
		setAttribute(this.container, "title", tooltip);
	},

	updateThrobber: function() {
		toggleAttribute(this.container, "busy", this.tab.hasAttribute("busy"));
		toggleAttribute(this.container, "progress", this.tab.hasAttribute("progress"));
	},

	updateAudio: function() {
		this._soundplaying = false;
		if(this.tab.hasAttribute("muted")) {
			this.container.setAttribute("muted", "true");
			this.audioBtn.setAttribute("title", Strings.get("TabView", "unmuteTab"));
		} else {
			this.container.removeAttribute("muted");
			if(this.tab.hasAttribute("soundplaying")) {
				this.container.setAttribute("soundplaying", "true");
				this.audioBtn.setAttribute("title", Strings.get("TabView", "muteTab"));
				this._soundplaying = true;
			} else {
				this.container.removeAttribute("soundplaying");
			}
		}

		if(this.parent) {
			this.parent.soundplaying(this, this._soundplaying);
		}
	},

	updateAttributes: function() {
		toggleAttribute(this.container, "pending", this.tab.hasAttribute("pending") || this.tab.hasAttribute("tabmix_pending"));
		toggleAttribute(this.container, "unread", this.tab.getAttribute("tabmix_tabState") == "unread");
		toggleAttribute(this.container, "protected", this.tab.hasAttribute("protected"));
	},

	// Updates the tabitem's canvas.
	updateCanvas: Task.async(function* () {
		TabItems.tabUpdated(this);

		// The canvas is only created when it is needed.
		if(!this.tabCanvas) {
			new TabCanvas(this);
		}

		let painted = yield this.tabCanvas.update();
		if(painted) {
			this._sendToSubscribers("painted");
			this.hideCachedThumb();
		}
	}),

	getCanvasSize: function() {
		let size = this.parent._lastTabSize;
		let width = size.tabWidth - UICache.tabCanvasOffset;
		let height = size.tabHeight - size.lineHeight - UICache.tabCanvasOffset;
		return new Point(width, height);
	},

	// Turns the canvas into an image and shows that instead.
	destroyCanvas: Task.async(function* () {
		if(this.tabCanvas) {
			yield this.tabCanvas.toImage();
			this.tabCanvas.destroy();
		}
	})
};

// Singleton for managing <TabItem>s
this.TabItems = {
	minTabWidth: 90,
	minTabWidthIcons: 50,
	tabWidth: 160,
	fontSizeRange: new Range(8,15),
	tabPaddingRange: new Range(3,10),
	faviconSizeRange: new Range(24,32),
	faviconOffsetRange: new Range(3,5.5),
	labelTopMarginRange: new Range(3,1),
	_fragment: null,
	_cachedThumbFragment: null,
	_canvasFragment: null,
	items: new Set(),
	paintingPaused: 0,
	_heartbeatHiddenTiming: 20000, // milliseconds between calls when TabView is hidden (for discarding canvases)
	_heartbeatTiming: 200, // milliseconds between calls
	_maxTimeForUpdating: 200, // milliseconds that consecutive updates can take
	_maxTimeForCachedThumbs: 25,
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
		this._tabsNeedingLabelsUpdate = new Set();
		this._queuedCachedThumbs = new Map();
		this._staleTabs = new MRUList();
		this._tabsWaitingForUpdate = new PriorityQueue(function(tab) {
			let item = tab._tabViewTabItem;
			let parent = item.parent;

			// This doesn't really happen, but if the tab isn't in any group, it won't be shown.
			if(!parent) {
				return false;
			}

			// In single view, we should give higher priority to tabs in the active group.
			if(UI.single) {
				return (parent == GroupItems.getActiveGroupItem());
			}

			// Otherwise, it's only low priority if it's in a stack, and isn't the top, and the stack isn't expanded.
			return (!parent.isStacked || parent.isTopOfStack(item) || parent.expanded);
		});

		// Call this once just so that no errors are thrown during startup. It will be called again once UI initializes to fill this with proper values.
		this._updateRatios();

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
		}
	},

	uninit: function() {
		Messenger.unlistenWindow(gWindow, "MozAfterPaint", this);

		Tabs.unlisten("TabOpen", this);
		Tabs.unlisten("TabAttrModified", this);
		Tabs.unlisten("TabClose", this);

		for(let tabItem of this) {
			tabItem.destroy();
		}

		this.items = new Set();
		this._lastUpdateTime = Date.now();
		this._tabsWaitingForUpdate.clear();
		this._staleTabs.clear();
	},

	cachedThumbFragment: function() {
		if(!this._cachedThumbFragment) {
			let img = document.createElement('img');
			img.classList.add('tab-thumb');
			img.classList.add('cached-thumb');
			this._cachedThumbFragment = img;
		}
		return this._cachedThumbFragment.cloneNode(true);
	},

	canvasFragment: function() {
		if(!this._canvasFragment) {
			let canvas = document.createElement('canvas');
			canvas.classList.add('tab-thumb');
			canvas.mozOpaque = true;
			this._canvasFragment = canvas;
		}
		return this._canvasFragment.cloneNode(true);
	},

	// Return a DocumentFragment which has a single <div> child. This child node will act as a template for all TabItem containers.
	// The first call of this function caches the DocumentFragment in _fragment.
	fragment: function() {
		if(!this._fragment) {
			let div = document.createElement("div");
			div.classList.add("tab");
			div.setAttribute('draggable', 'true');

			let thumb = document.createElement("div");
			thumb.classList.add('thumb');
			div.appendChild(thumb);

			let thumbContainer = document.createElement("div");
			thumbContainer.classList.add('tab-thumb-container');
			thumb.appendChild(thumbContainer);

			let faviconContainer = document.createElement('div');
			faviconContainer.classList.add('favicon-container');
			thumb.appendChild(faviconContainer);

			let favicon = document.createElement('div');
			favicon.classList.add('favicon');
			faviconContainer.appendChild(favicon);

			let throbber = document.createElement('div');
			throbber.classList.add('favicon');
			throbber.classList.add('throbber');
			faviconContainer.appendChild(throbber);

			let label = document.createElement('span');
			label.classList.add('tab-label');
			div.appendChild(label);

			let title = document.createElement('span');
			title.classList.add('tab-title');
			title.textContent = ' ';
			label.appendChild(title);

			let separator = document.createElement('span');
			separator.classList.add('tab-label-separator');
			separator.textContent = ' - ';
			label.appendChild(separator);

			let url = document.createElement('span');
			url.classList.add('tab-url');
			label.appendChild(url);

			let tabControls = document.createElement('div');
			tabControls.classList.add('tab-controls');
			div.appendChild(tabControls);

			let audioBtn = document.createElement('div');
			audioBtn.classList.add('tab-audio');
			tabControls.appendChild(audioBtn);

			let close = document.createElement('div');
			close.classList.add('close');
			setAttribute(close, "title", Strings.get("TabView", "closeTab"));
			tabControls.appendChild(close);

			this._fragment = div;
		}

		let container = this._fragment.cloneNode(true);
		let thumb = container.firstChild.firstChild;
		let fav = thumb.nextSibling.firstChild;
		let tabTitle = container.firstChild.nextSibling.firstChild;
		let tabUrl = tabTitle.nextSibling.nextSibling;
		let audioBtn = container.lastChild.firstChild;
		let closeBtn = audioBtn.nextSibling;

		return { container, thumb, fav, tabTitle, tabUrl, audioBtn, closeBtn };
	},

	// Checks wheteher a tab is pending.
	_isPending: function(tab) {
		return tab.hasAttribute("pending") || tab.hasAttribute("tabmix_pending");
	},

	// Checks whether the xul:tab has fully loaded and resolves a promise with a boolean that indicates whether the tab is loaded or not.
	_isComplete: function(tab) {
		return new Promise(function(resolve, reject) {
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
			let tabItem = tab._tabViewTabItem;
			if(!tabItem) { return; }

			this._tabsNeedingLabelsUpdate.add(tabItem);

			if(this.shouldDeferPainting()) {
				this._tabsWaitingForUpdate.push(tab);
				if(!this.isPaintingPaused()) {
					tabItem._updateLabels();
					this.startHeartbeat();
				}
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
	_update: Task.async(function* (tab) {
		try {
			// ___ remove from waiting list now that we have no other early returns
			this._tabsWaitingForUpdate.remove(tab);

			// ___ get the TabItem
			let tabItem = tab._tabViewTabItem;

			// Even if the page hasn't loaded, display the favicon and title
			tabItem.updateLabels();

			// If we're not taking thumbnails for this tab's group, we don't need to fetch it in the first place.
			// This will be re-called if and when its thumb becomes necessary.
			if(!tabItem.parent || tabItem.parent.stale) {
				tabItem._thumbNeedsUpdate = true;
				return;
			}
			tabItem._thumbNeedsUpdate = false;

			// ___ Make sure the tab is complete and ready for updating.
			if(!Utils.isValidXULTab(tab) || tab.pinned) { return; }

			// A pending tab can't be complete, yet. We'll get back to it once it's been loaded.
			if(this._isPending(tab)) {
				// If a loaded tab becomes unloaded (through other add-ons), assume the next time it is loaded it may lead to a black canvas again.
				// See notes about this in TabCanvas.update() below.
				if(tab._tabViewTabItem) {
					tab._tabViewTabItem._hasHadThumb = false;
				}
				return;
			}

			let isComplete = yield this._isComplete(tab);
			if(isComplete) {
				yield tabItem.updateCanvas();
			} else {
				this._tabsWaitingForUpdate.push(tab);
			}
		}
		catch(ex) {
			Cu.reportError(ex);
		}
	}),

	shouldDeferPainting: function() {
		return	this.isPaintingPaused()
				|| this._tabsWaitingForUpdate.hasItems()
				|| FavIcons._iconsNeedingColor.length
				|| Date.now() - this._lastUpdateTime < this._heartbeatTiming;
	},

	paintingNow: function() {
		this._lastUpdateTime = Date.now();
	},

	// Takes in a xul:tab, creates a TabItem for it and adds it to the scene.
	link: function(tab, options) {
		try {
			// Don't add an item for temporary tabs created by us.
			if(gTabView._closedLastVisibleTab === tab || gTabView._closedLastVisibleTab === true) { return; }

			new TabItem(tab, options); // sets tab._tabViewTabItem to itself
		}
		catch(ex) {
			Cu.reportError(ex);
		}
	},

	// Takes in a xul:tab and destroys the TabItem associated with it.
	unlink: function(tab) {
		try {
			let tabItem = tab._tabViewTabItem;
			if(!tabItem) { return; }

			// If we just closed the active and last visible tab in the tab-bar.
			// create and select a placeholder tab to prevent other tabs from being loaded unnecessarily.
			if(UI._frameInitialized && !Tabs.visible.length) {
				gTabView.onCloseLastTab();
			}

			this.unregister(tabItem);
			tabItem._sendToSubscribers("close", tabItem);
			tabItem.destroy();
			Storage.saveTab(tab, null);
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
	},

	tabSelected: function(tab) {
		let tabItem = tab && tab._tabViewTabItem;
		if(tabItem && (tabItem.tabCanvas || tabItem.cachedThumb)) {
			this._staleTabs.append(tabItem, true);
		}
	},

	tabUpdated: function(tabItem) {
		this.paintingNow();
		this.tabStaled(tabItem);
	},

	tabStaled: function(tabItem) {
		this._staleTabs.append(tabItem);
	},

	// Start a new heartbeat if there isn't one already started. The heartbeat is a chain of aSync calls that allows us to spread
	// out update calls over a period of time. We make sure not to add multiple aSync chains.
	startHeartbeat: function(timing) {
		if(timing || !Timers.heartbeat) {
			Timers.init('heartbeat', () => {
				this._checkHeartbeat();
			}, timing || this._heartbeatTiming);
		}
	},

	startHeartbeatHidden: function() {
		this.startHeartbeat(this._heartbeatHiddenTiming);
	},

	// This periodically checks for tabs waiting to be updated, and calls _update on them.
	// Should only be called by startHeartbeat and resumePainting.
	_checkHeartbeat: Task.async(function* () {
		if(this.isPaintingPaused()) {
			// With tab view hidden, the heartbeat instead turns stale tabs canvas into images, and discards the canvas.
			if(!UI.isTabViewVisible()) {
				let accumTime = 0;
				let now = Date.now();
				while(accumTime < this._maxTimeForUpdating && !this._staleTabs.isEmpty()) {
					let updateBegin = Date.now();

					let tabItem = this._staleTabs.peek();
					this._staleTabs.remove(tabItem);
					yield tabItem.destroyCanvas();
					if(tabItem.parent && tabItem.parent.stale) {
						// It's likely it could have had a cached thumbnail (hidden leftover from disabling thumbs in a group).
						tabItem.hideCachedThumb();
					}

					let updateEnd = Date.now();
					let deltaTime = updateEnd - updateBegin;
					accumTime += deltaTime;
				}

				// If there are possibly still stale tabs, recheck in a while.
				if(!this._staleTabs.isEmpty()) {
					this.startHeartbeatHidden();
				}
				// Otherwise we finish by removing unused icon colors from FavIcons, to free up a little extra memory.
				else {
					FavIcons.cleanupStaleColors();
				}
			}
			return;
		}

		// restart the heartbeat to update all waiting tabs once the UI becomes idle
		if(!UI.isIdle()) {
			this.startHeartbeat();
			return;
		}

		// Do as many updates as we can fit into a "perceived" amount of time, which is tunable.
		let accumTime = 0;
		let now = Date.now();
		let then;

		let items = this._tabsWaitingForUpdate.getItems();
		while(accumTime < this._maxTimeForUpdating && items.length) {
			then = now;

			yield this._update(items.shift());

			// Maintain a simple average of time for each tabitem update
			// We can use this as a base by which to delay things like tab zooming, so there aren't any hitches.
			now = Date.now();
			let deltaTime = now - then;
			accumTime += deltaTime;
		}

		// Find the dominant colors here, so both processes don't stack over one another
		// and there's no need for the overhead of a second heartbeat.
		let newColors = false;
		items = FavIcons._iconsNeedingColor;
		while(accumTime < this._maxTimeForUpdating && items.length) {
			then = now;

			yield FavIcons._findDominantColor(items.shift());
			newColors = true;

			// Maintain a simple average of time for each favicon update
			// We can use this as a base by which to delay things like tab zooming, so there aren't any hitches.
			now = Date.now();
			let deltaTime = now - then;
			accumTime += deltaTime;
		}

		// Make sure new colors are applied.
		if(newColors) {
			FavIcons._loadColorsStylesheet();
		}

		if(this._tabsWaitingForUpdate.hasItems() || FavIcons._iconsNeedingColor.length) {
			this.startHeartbeat();
		}
	}),

	// Cached thumbs are created asynchronously, in a similar way to how canvases are painted above
	// as to avoid locking up the browser during the first initialize of TabView where a lot of images would be loaded sequentially.
	queueCachedThumb: function(tabItem, thumbnailURL) {
		let shouldStart = !this._queuedCachedThumbs.size;
		this._queuedCachedThumbs.set(tabItem, thumbnailURL);
		if(shouldStart) {
			this.startCachedThumbsHeartbeat();
		}
	},

	startCachedThumbsHeartbeat: function() {
		if(!Timers.cachedThumbsHeartbeat) {
			Timers.init('cachedThumbsHeartbeat', () => {
				this._checkCachedThumbsHeartbeat();
			}, this._heartbeatTiming);
		}
	},

	_checkCachedThumbsHeartbeat: function() {
		let accumTime = 0;
		for(let [ tabItem, thumbnailURL ] of this._queuedCachedThumbs) {
			this._queuedCachedThumbs.delete(tabItem);

			// The canvas could have painted in the meantime, in which case we don't need to show the cached thumb anymore.
			if(!tabItem.cachedThumb) { continue; }

			let updateBegin = Date.now();

			tabItem._showCachedThumb(thumbnailURL);

			// Do as many updates as we can fit into a "perceived" amount of time, which is tunable.
			let updateEnd = Date.now();
			let deltaTime = updateEnd - updateBegin;
			accumTime += deltaTime;
			if(accumTime >= this._maxTimeForCachedThumbs) { break; }
		}

		if(this._queuedCachedThumbs.size) {
			this.startCachedThumbsHeartbeat();
		}
	},

	// Tells TabItems to stop updating thumbnails (so you can do animations without thumbnail paints causing stutters).
	// pausePainting can be called multiple times, but every call to pausePainting needs to be mirrored with a call to <resumePainting>.
	pausePainting: function() {
		this.paintingPaused++;
	},

	// Undoes a call to <pausePainting>. For instance, if you called pausePainting three times in a row, you'll need to call resumePainting
	// three times before TabItems will start updating thumbnails again.
	resumePainting: function() {
		this.paintingPaused--;
		if(!this.isPaintingPaused()) {
			// Start by fetching the updated labels immediately for each tab, so that those are always up-to-date.
			this.flushLabelsUpdates();

			// Ensure we override the heartbeat for staled tabs.
			this.startHeartbeat(this._heartbeatTiming);
			GroupItems.startHeartbeat();
		}
	},

	// Returns a boolean indicating whether painting is paused or not.
	isPaintingPaused: function() {
		return this.paintingPaused > 0;
	},

	flushLabelsUpdates: function() {
		let promises = [];

		for(let tabItem of this._tabsNeedingLabelsUpdate) {
			promises.push(tabItem._updateLabels());
		}

		return Promise.all(promises);
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
		this._tabsNeedingLabelsUpdate.add(item);
		if(!item.tab.hasAttribute('pending') && !item.tab.hasAttribute("tabmix_pending")) {
			this.update(item.tab);
		}
	},

	// Removes the given <TabItem> from the master list.
	unregister: function(item) {
		this.items.delete(item);
		this._tabsWaitingForUpdate.remove(item.tab);
		this._tabsNeedingLabelsUpdate.delete(item);
		this._staleTabs.remove(item);
		this._queuedCachedThumbs.delete(item);
		FavIcons.forgetItem(item);

		// The Search module needs a little help with this.
		if(Search._activeTab == item) {
			Search._activeTab = null;
		}
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

	// Called each time the viewport ratio is changed, so that tab thumbs (and items) always represent the actual screen dimensions.
	_updateRatios: function() {
		this.widthFontRange = new Range(this.minTabWidthIcons +10, Math.round(this.tabWidth *1.5));
		this.widthPaddingRange = new Range(this.minTabWidthIcons +10, Math.round(this.tabWidth *1.5));
		this.widthFaviconSizeRange = new Range(this.minTabWidthIcons +8, this.minTabWidth -8);
		this.widthFaviconOffsetRange = new Range(this.minTabWidth +10, Math.round(this.tabWidth *1.5));
		this.widthLabelTopMarginRange = new Range(this.minTabWidthIcons +8, this.minTabWidth -8);

		this.tabHeight = this._getHeightForWidth(this.tabWidth);
		this.minTabHeight = this._getHeightForWidth(this.minTabWidth);
		this.minTabHeightIcons = this._getHeightForWidth(this.minTabWidthIcons);
		this.tabAspect = this.tabWidth / this.tabHeight;
		this.invTabAspect = 1 / this.tabAspect;

		this.heightPaddingRange = new Range(this.minTabHeightIcons +10, this.tabHeight -10);
	},

	// Private method that returns the fontsize to use given the tab's width
	getFontSizeFromWidth: function(width) {
		let proportion = this.widthFontRange.proportion(width, true);
		return this.fontSizeRange.scale(proportion);
	},

	// Private method that returns the favicon size to use given the tab's width if it's meant to tile icons only.
	getFaviconSizeFromWidth: function(width) {
		let proportion = this.widthFaviconSizeRange.proportion(width, true);
		return this.faviconSizeRange.scale(proportion);
	},

	// Returns the tab label's top margin to be used when the tab is tiling icons only.
	getLabelTopMarginFromWidth: function(width) {
		let proportion = this.widthLabelTopMarginRange.proportion(width, true);
		return this.labelTopMarginRange.scale(proportion);
	},

	getTabPaddingFromWidth: function(width) {
		let proportion = this.widthPaddingRange.proportion(width, true);
		return Math.ceil(this.tabPaddingRange.scale(proportion));
	},

	getTabPaddingFromHeight: function(height) {
		let proportion = this.heightPaddingRange.proportion(height, true);
		return Math.ceil(this.tabPaddingRange.scale(proportion));
	},

	// Private method that returns the tabitem width given a height.
	_getWidthForHeight: function(height, stacked) {
		let padding = this.getTabPaddingFromHeight(height) *2;
		let thumbHeight = height - padding;
		if(!stacked) {
			thumbHeight -= this.fontSizeRange.max +2; // +2 comes from max line height calculated in GroupItem._gridArrange()
		}
		let thumbWidth = thumbHeight * UI._viewportRatio;
		return Math.floor(thumbWidth + padding);
	},

	// Private method that returns the tabitem height given a width.
	_getHeightForWidth: function(width, stacked) {
		let padding = this.getTabPaddingFromWidth(width) *2;
		let thumbWidth = width - padding;
		let thumbHeight = thumbWidth / UI._viewportRatio;
		if(!stacked) {
			thumbHeight += this.fontSizeRange.max +2; // +2 comes from max line height calculated in GroupItem._gridArrange()
		}
		return Math.floor(thumbHeight + padding);
	},

	getControlsOffsetForPadding: function(padding) {
		return padding -2;
	},

	getFavIconOffsetForWidth: function(width) {
		let proportion = this.widthFaviconOffsetRange.proportion(width, true);
		return Math.ceil(this.faviconOffsetRange.scale(proportion));
	},

	// Arranges the given items in a grid within the given bounds, maximizing item size but maintaining standard tab aspect ratio for each
	// Parameters:
	//   count - number of items to be arranged within bounds.
	//   bounds - a <Rect> defining the space to arrange within
	//   tileIcons - (bool) whether tabs can be shrinked down enough to tile only favicons, or if they should be kept large enough for thumbnails
	//   columns - pass an initial value for the number of columns to assume the items will be displayed in, if not set the loop will start at 1
	// Returns:
	//   an object with the width value of the child items (`tabWIdth` and `tabHeight`) and the number of columns (`columns`) and rows (`rows`).
	arrange: function(count, bounds, tileIcons, columns) {
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
			let point = new Point(bounds.width / columns, -1);
			let validSize = this.calcValidSize(point, tileIcons);
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

		if(rows == 1 || overflowing) {
			let point = new Point(tabWidth, Math.floor(bounds.height / rows));
			let validSize = this.calcValidSize(point, tileIcons);
			totalWidth = validSize.x * columns;
			totalHeight = validSize.y * rows;
			overflowing = (totalWidth > bounds.width || totalHeight > bounds.height);
			if(!overflowing) {
				tabWidth = validSize.x;
				tabHeight = validSize.y;
			}
		}

		let onlyIcons = tileIcons && (tabWidth < TabItems.minTabWidth || tabHeight < TabItems.minTabHeight);
		let favIconSize = (onlyIcons) ? this.getFaviconSizeFromWidth(tabWidth) : 0;
		let tabPadding = this.getTabPaddingFromWidth(tabWidth);
		let controlsOffset = this.getControlsOffsetForPadding(tabPadding);
		let favIconOffset = (!onlyIcons) ? this.getFavIconOffsetForWidth(tabWidth) : 0;
		let fontSize = this.getFontSizeFromWidth(tabWidth);
		let labelTopMargin = (onlyIcons) ? this.getLabelTopMarginFromWidth(tabWidth) : 0;

		tabWidth -= tabPadding *2;
		tabHeight -= tabPadding *2;

		return { tabWidth, tabHeight, tabPadding, controlsOffset, fontSize, labelTopMargin, favIconSize, favIconOffset, columns, rows, overflowing };
	},

	// Pass in a desired size, and receive a size based on proper title size and aspect ratio.
	calcValidSize: function(size, tileIcons) {
		let minWidth = (tileIcons) ? this.minTabWidthIcons : this.minTabWidth;
		let minHeight = (tileIcons) ? this.minTabHeightIcons : this.minTabHeight;
		let width = size.x;
		let height = size.y;
		if(!size.stacked) {
			width = Math.max(minWidth, width);
			height = Math.max(minHeight, height);
		}

		let w = width;
		let h = height;
		if(size.x > -1) {
			height = this._getHeightForWidth(w, size.stacked);
		}
		if(size.y > -1) {
			width = this._getWidthForHeight(h, size.stacked);
		}

		if(size.x > -1 && size.y > -1) {
			if(width < size.x) {
				height = h;
			} else {
				width = w;
			}
		}

		return new Point(Math.floor(width), Math.floor(height));
	}
};

// Class: TabCanvas - Takes care of the actual canvas for the tab thumbnail
this.TabCanvas = function(tabItem) {
	this.tabItem = tabItem;
	this.tab = tabItem.tab;
	tabItem.tabCanvas = this;

	this.destroying = null;

	this.canvas = TabItems.canvasFragment();
};

this.TabCanvas.prototype = {
	getSize: function() {
		return this.tabItem.getCanvasSize();
	},

	getContentSize: function() {
		return new Promise((resolve, reject) => {
			let receiver = (m) => {
				Messenger.unlistenBrowser(this.tab.linkedBrowser, 'contentSize', receiver);
				resolve(m.data);
			};
			Messenger.listenBrowser(this.tab.linkedBrowser, 'contentSize', receiver);
			Messenger.messageBrowser(this.tab.linkedBrowser, 'getContentSize');
		});
	},

	persist(aBrowser, forceStale) {
		// capture to file, thumbnail service does not persist automatically when rendering to canvas.
		PageThumbs.shouldStoreThumbnail(aBrowser, (storeAllowed) => {
			if(!storeAllowed) { return; }

			// bails out early if there already is an existing thumbnail less than 2 days old
			// so this shouldn't cause excessive IO when a thumbnail is updated frequently
			let url = aBrowser.currentURI.spec;
			PageThumbsStorage.isFileRecentForURL(url).then((recent) => {
				// Careful, the call to PageThumbsStorage is async, so the browser may have navigated away from the URL or even closed.
				if((!recent || forceStale) && aBrowser.currentURI && aBrowser.currentURI.spec == url) {
					// We used to use PageThumbs.captureAndStoreIfStale, but we're bypassing it because it only stored a portion (top-left) of the thumb,
					// by mimicking its behavior here but sending the full blob of our canvas, we can store the whole thing.
					// It's not pretty, but it works, and has the added bonus of not having to recapture the webpage onto a new canvas.
					if(!PageThumbs._prefEnabled()) { return; }

					let originalURL = url;
					let channelError = false;
					let canvas = this.canvas;

					Task.spawn(function* () {
						try {
							if(Services.vc.compare(Services.appinfo.version, "51.0a1") < 0) {
								if(!aBrowser.isRemoteBrowser) {
									let channel = aBrowser.docShell.currentDocumentChannel;
									originalURL = channel.originalURI.spec;
									// see if this was an error response.
									channelError = PageThumbs._isChannelErrorResponse(channel);
								}
							}
							else {
								if(!aBrowser.isRemoteBrowser) {
									let channel = aBrowser.docShell.currentDocumentChannel;
									originalURL = channel.originalURI.spec;
									// see if this was an error response.
									channelError = PageThumbUtils.isChannelErrorResponse(channel);
								} else {
									let resp = yield new Promise(resolve => {
										let mm = aBrowser.messageManager;
										let respName = "Browser:Thumbnail:GetOriginalURL:Response";
										mm.addMessageListener(respName, function onResp(msg) {
											mm.removeMessageListener(respName, onResp);
											resolve(msg.data);
										});
										mm.sendAsyncMessage("Browser:Thumbnail:GetOriginalURL");
									});
									originalURL = resp.originalURL || url;
									channelError = resp.channelError;
								}
							}

							canvas.toBlob((blob) => {
								let reader = new FileReader();
								reader.onloadend = function() {
									if(reader.readyState == FileReader.DONE) {
										let buffer = reader.result;
										PageThumbs._store(originalURL, url, buffer, channelError);
									}
								};
								reader.readAsArrayBuffer(blob);
							});
						}
						catch(ex) {
							Cu.reportError("Tab Groups: exception thrown during thumbnail capture.");
							Cu.reportError(ex);
						}
					});
				}
			});
		});
	},

	update: Task.async(function* () {
		// If this canvas has started to be destroyed, stop it, it's better to update it than to create a new one.
		if(this.destroying) {
			this.destroying.reject();
		}

		let canvas = this.canvas;
		let browser = this.tab.linkedBrowser;

		// Changing the dims of a canvas will clear it, so we don't want to do do this to a canvas we're currently displaying.
		// So grab a new thumbnail at the new dims and then copy it over to the displayed canvas.
		let size = this.getSize();
		let dimsChanged = !this.canvas.parentNode || this.canvas.width != size.x || this.canvas.height != size.y;
		if(dimsChanged) {
			canvas = TabItems.canvasFragment();
			canvas.width = size.x;
			canvas.height = size.y;
		}
		let ctx = canvas.getContext('2d');

		// We need to account for the size of the actual page when drawing its thumb, if it's smaller than the canvas we end up with black borders.
		let contentSize = yield this.getContentSize();
		let scaleX = 1;
		let scaleY = 1;
		if(size.x > contentSize.width && contentSize.width > 0) {
			scaleX = Math.ceil(size.x / contentSize.width *1000) /1000;
		}
		if(size.y > contentSize.height && contentSize.height > 0) {
			scaleY = Math.ceil(size.y / contentSize.height *1000) /1000;
		}
		if(scaleX != 1 || scaleY != 1) {
			ctx.scale(scaleX, scaleY);
		}

		return new Promise((resolve, reject) => {
			PageThumbs.captureToCanvas(browser, canvas, () => {
				let ctx = this.canvas.getContext('2d');
				let hasHadThumb = this.tabItem._hasHadThumb;
				let painted = !dimsChanged;

				if(dimsChanged) {
					// In non-e10s, many times the first canvas returned is completely black, probably because it tries to paint it too soon.
					// I haven't been able to figure out if this a problem with how soon we are trying to paint, or a problem with PageThumbs itself,
					// although it seems like snapshotCanvas in PageThumbUtils.createSnapshotThumbnail() is black already.
					// This doesn't seem to happen in e10s with remote browsers.
					// (This is not about local pages, but remote pages on non-remote browsers.)
					// The toDataURL() call is a little expensive, so lets try to only use it when it can actually make a difference;
					let isBlack =	!browser.isRemoteBrowser
							&& !this.canvas.parentNode
							&& !hasHadThumb
							&& canvas.toDataURL() == UICache.blackCanvas(canvas);
					if(!isBlack) {
						// We only append the canvas to the DOM once we paint it, to avoid showing a black/blank canvas while it's being painted.
						if(!this.canvas.parentNode) {
							this.tabItem.thumb.appendChild(this.canvas);
							this.tabItem._hasHadThumb = true;
						}
						this.canvas.width = size.x;
						this.canvas.height = size.y;
						try {
							ctx.drawImage(canvas, 0, 0);
							painted = true;
						}
						catch(ex) {
							// Can't draw if the canvas created by page thumbs isn't valid. This can happen during shutdown.
						}
					}
				}

				// Make sure we reset the canvas scale factor, in case we had to change it above to consider the page's zoom.
				if(scaleX != 1 || scaleY != 1) {
					ctx.setTransform(1, 0, 0, 1, 0, 0);
				}

				if(painted) {
					// Force persist the first thumb we get, to avoid showing stored black thumbs.
					// Even though we don't actually persist those, browser-ctrlTab.js always persists the first thumb of a tab when it is first restored,
					// which, lucky us, can be black if it happens while we're in TabView.
					// See https://dxr.mozilla.org/mozilla-central/source/browser/base/content/browser-ctrlTab.js#51.
					let forceStale = !hasHadThumb;
					this.persist(browser, forceStale);
				}

				resolve(painted);
			});
		});
	}),

	toImage: function() {
		// This is the basis of this deferred object, with accessor methods for resolving and rejecting its promise.
		this.destroying = {
			resolve: function() {
				this._resolve();
				this.finish();
			},

			reject: function(r) {
				this._reject(r);
				this.finish();
			},

			finish: () => {
				this.destroying = null;
			}
		};

		// Init the actual promise.
		this.destroying.promise = new Promise((resolve, reject) => {
			// Store the resolve and reject methods in the deferred object.
			this.destroying._resolve = resolve;
			this.destroying._reject = reject;

			try {
				this.canvas.toBlob((blob) => {
					try {
						if(this.tabItem._tempCanvasBlobURL) {
							URL.revokeObjectURL(this.tabItem._tempCanvasBlobURL);
						}
						this.tabItem._tempCanvasBlobURL = URL.createObjectURL(blob);
						this.tabItem.showCachedThumb(true);
					}
					catch(ex) {
						Cu.reportError(ex);
						this.destroying.reject(ex);
					}
				});
			}
			catch(ex) {
				Cu.reportError(ex);
				this.destroying.reject(ex);
			}
		});

		return this.destroying.promise;
	},

	destroy: function() {
		this.canvas.remove();
		this.tabItem.tabCanvas = null;
	}
};
