// VERSION 1.2.13

// Used to scroll groups automatically, for instance when dragging a tab over a group's overflown edges.
this.Synthesizer = {
	_utils: null,
	get utils() {
		if(!this._utils) {
			this._utils = window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
		}
		return this._utils;
	},

	scroll: function(mouse, delta) {
		try {
			this.utils.sendWheelEvent(mouse.x, mouse.y, 0, delta, 0, window.WheelEvent.DOM_DELTA_LINE, 0, 0, delta, 0);
		}
		// We really only care about not blocking anything else that is supposed to run.
		catch(ex) { Cu.reportError(ex); }
	}
};

this.Keys = { meta: false };

// Class: UI - Singleton top-level UI manager.
this.UI = {
	// True if the Tab View UI frame has been initialized.
	_frameInitialized: false,

	// Stores the page bounds.
	_pageBounds: null,

	// If true, the last visible tab has just been closed in the tab strip.
	_closedLastVisibleTab: false,

	// If true, a select tab has just been closed in TabView.
	_closedSelectedTabInTabView: false,

	// If true, a closed tab has just been restored.
	restoredClosedTab: false,

	// Tracks whether we're currently in the process of showing/hiding the tabview.
	_isChangingVisibility: false,

	// Keeps track of the <GroupItem>s which their tab items' tabs have been moved and re-orders the tab items when switching to TabView.
	_reorderTabItemsOnShow: [],

	// Keeps track of the <GroupItem>s which their tab items have been moved in TabView UI and re-orders the tabs when switcing back to main browser.
	_reorderTabsOnHide: new Set(),

	// Keeps track of which xul:tab we are currently on. Used to facilitate zooming down from a previous tab.
	_currentTab: null,

	// If the UI is in the middle of an operation, this is the max amount of milliseconds to wait between input events before we no longer consider the operation interactive.
	_maxInteractiveWait: 250,
	lastMoveTime: 0,

	// Tells whether the storage is currently busy or not.
	_storageBusy: false,

	// Tells wether the parent window is about to close
	isDOMWindowClosing: false,

	// Used to keep track of allowed browser keys.
	_browserKeys: null,

	// Used to prevent keypress being handled after quitting search mode.
	ignoreKeypressForSearch: false,

	// Used to keep track of the last opened tab.
	_lastOpenedTab: null,

	// Used to keep track of the tab strip smooth scroll value.
	_originalSmoothScroll: null,

	// Sensitivity in pixels of the area reactive to dragging a tab that will cause the group to scroll.
	scrollAreaSize: 15,

	// has the user clicked the close button in the notice in this window already
	_noticeDismissed: false,

	get classic() { return Prefs.displayMode == 'classic'; },
	get grid() { return Prefs.displayMode == 'grid'; },

	get sessionRestoreNotice() { return $('sessionRestoreNotice'); },
	get sessionRestoreNoticeClose() { return $('sessionRestoreNoticeClose'); },
	get sessionRestoreAutoChanged() { return $('sessionRestoreAutoChanged'); },
	get sessionRestorePrivate() { return $('sessionRestorePrivate'); },

	get exitBtn() { return $("exit-button"); },
	get optionsBtn() { return $("optionsbutton"); },
	get helpBtn() { return $("helpbutton"); },
	get gridBtn() { return $("gridbutton"); },
	get classicBtn() { return $("classicbutton"); },
	get gridNewGroupBtn() { return $("gridNewGroup"); },

	_els: Cc["@mozilla.org/eventlistenerservice;1"].getService(Ci.nsIEventListenerService),

	// Called when a web page is about to show a modal dialog.
	receiveMessage: function(m) {
		if(!this.isTabViewVisible()) { return; }

		let tab = gBrowser.getTabForBrowser(m.target);
		if(!tab) { return; }

		// When TabView is visible, we need to call onTabSelect to make sure that TabView is hidden and that the correct group is activated.
		// When a modal dialog is shown for currently selected tab the onTabSelect event handler is not called, so we need to do it.
		if(tab.selected && this._currentTab == tab) {
			this.onTabSelect(tab);
		}
	},

	handleEvent: function(e) {
		let tab = e.target;

		switch(e.type) {
			// ___ setup event listener to save canvas images
			case 'SSWindowClosing':
				this.storageClosing();
				break;

			case 'SSWindowStateBusy':
				this.storageBusy();
				break;

			case 'SSWindowStateReady':
				this.storageReady();
				break;

			case 'resize':
				this._resize();
				break;

			case 'keyup':
				if(!e.metaKey) {
					Keys.meta = false;
				}
				break;

			case 'keypress':
				if(e.metaKey) {
					Keys.meta = true;
				}
				this._onKeypress(e);
				break;

			case 'mousedown': {
				// target == GroupItems.workSpace
				let focused = $$(":focus");
				if(focused.length > 0) {
					for(let element of focused) {
						// don't fire blur event if the same input element is clicked.
						if(e.target != element && element.nodeName == "input") {
							element.blur();
						}
					}
				}
				if(this.classic && e.originalTarget == GroupItems.workSpace && e.button == 0 && e.detail == 1) {
					this._createGroupItemOnDrag(e);
				}
				break;
			}

			case 'dblclick': {
				if(e.originalTarget != GroupItems.workSpace) { return; }

				// Create a group with one tab on double click
				let w = TabItems.tabWidth;
				let h = TabItems.tabHeight;
				let y = e.clientY - Math.floor(h/2);
				let x = e.clientX - Math.floor(w/2);
				let box = new Rect(x, y, w, h);
				box.inset(-30, -30);

				let opts = { immediately: true, bounds: box };
				let groupItem = new GroupItem([], opts);
				groupItem.newTab();
				break;
			}

			case 'click':
				switch(e.target) {
					case this.sessionRestoreNoticeClose:
						this.sessionRestoreNotice.hidden = true;
						this._noticeDismissed = true;
						break;

					case this.sessionRestoreNotice:
						this.goToPreferences({ jumpto: 'sessionRestore' });
						break;

					case this.exitBtn:
						this.exit();
						this.blurAll();
						break;

					case this.optionsBtn:
						this.goToPreferences();
						break;

					case this.helpBtn:
						this.goToPreferences({ pane: 'paneHowTo' });
						break;

					case this.classicBtn:
						Prefs.displayMode = 'classic';
						break;

					case this.gridBtn:
						Prefs.displayMode = 'grid';
						break;

					case this.gridNewGroupBtn:
						GroupItems.newGroup();
						break;
				}
				break;

			case 'dragover':
				if(DraggingTab && (e.target == GroupItems.workSpace || e.target == this.gridNewGroupBtn)) {
					DraggingTab.canDrop(e, e.target);
				}
				else if(DraggingGroup && this.grid && GroupItems.workSpace.classList.contains('overflowing')) {
					UI.scrollAreaWhileDragging(e, GroupItems.workSpace);
				}
				break;

			case 'TabOpen':
				if(!tab.pinned && this.isTabViewVisible() && !this._storageBusyCount) {
					this._lastOpenedTab = tab;
				}
				break;

			case 'TabClose': {
				if(this.isTabViewVisible()) {
					// just closed the selected tab in the TabView interface.
					if(this._currentTab == tab) {
						this._closedSelectedTabInTabView = true;
					}
					break;
				}

				// If we're currently in the process of session store update, we don't want to go to the Tab View UI.
				if(this._storageBusy) { return; }

				// do this only if not closing the last tab
				if(Tabs.length <= 1) { return; }

				// Don't return to TabView if there are any app tabs
				if(Tabs.numPinned) { return; }

				let groupItem = GroupItems.getActiveGroupItem();

				// 1) Only go back to the TabView tab when there you close the last tab of a groupItem.
				let closingLastOfGroup = (groupItem && groupItem.children.length == 1 && groupItem.children[0].tab == tab);

				// 2) When a blank tab is active while restoring a closed tab the blank tab gets removed.
				// The active group is not closed as this is where the restored tab goes. So do not show the TabView.
				let tabItem = tab && tab._tabViewTabItem;
				let closingBlankTabAfterRestore = (tabItem && tabItem.isRemovedAfterRestore);

				if(closingLastOfGroup && !closingBlankTabAfterRestore) {
					// for the tab focus event to pick up.
					this._closedLastVisibleTab = true;
					this.showTabView();
				}
				break;
			}
			case 'TabMove':
				if(!tab.pinned && GroupItems.size) {
					let activeGroupItem = GroupItems.getActiveGroupItem();
					if(activeGroupItem) {
						if(!this.isTabViewVisible() || this._isChangingVisibility) {
							this.setReorderTabItemsOnShow(activeGroupItem);
						} else {
							activeGroupItem.reorderTabItemsBasedOnTabOrder();
						}
					}
				}
				break;

			case 'TabSelect':
				this.onTabSelect(tab);
				break;

			case 'TabPinned':
				TabItems.handleTabPin(tab);
				break;

			case 'TabUnpinned': {
				TabItems.handleTabUnpin(tab);

				let groupItem = tab._tabViewTabItem.parent;
				if(groupItem) {
					this.setReorderTabItemsOnShow(groupItem);
				}
				break;
			}
		}
	},

	observe: function(aSubject, aTopic, aData) {
		switch(aSubject) {
			case 'showTabOnUpdates':
				this._noticeDismissed = false;
				this.checkSessionRestore();
				break;

			case 'displayMode':
				this.toggleMode();
				break;

			case 'stackTabs':
				for(let groupItem of GroupItems) {
					if(groupItem.isStacked || groupItem.overflowing) {
						groupItem.arrange();
					}
				}
				break;
		}
	},

	// Must be called after the object is created.
	init: function() {
		try {
			if(Storage.readWindowBusyState(gWindow)) {
				this.storageBusy();
			}

			let data = Storage.readUIData(gWindow);
			this.storageSanity(data);
			this._pageBounds = data.pageBounds;

			// ___ search
			Search.init();

			// ___ currentTab
			this._currentTab = Tabs.selected;

			Listeners.add(this.exitBtn, 'click', this);
			Listeners.add(this.optionsBtn, 'click', this);
			Listeners.add(this.helpBtn, 'click', this);
			Listeners.add(this.gridBtn, 'click', this);
			Listeners.add(this.classicBtn, 'click', this);
			Listeners.add(this.gridNewGroupBtn, 'click', this);
			Listeners.add(GroupItems.workSpace, 'dragover', this);

			// When you click on the background/empty part of TabView, we create a new groupItem.
			Listeners.add(GroupItems.workSpace, 'mousedown', this);
			Listeners.add(GroupItems.workSpace, 'dblclick', this);

			Messenger.listenWindow(gWindow, "DOMWillOpenModalDialog", this);

			// Initialize the UI with the correct mode from the start, the groups will take care of themselves as they're added.
			Prefs.listen('stackTabs', this);
			Prefs.listen('displayMode', this);
			document.body.classList.add(Prefs.displayMode);

			// ___ setup key handlers
			this._setupBrowserKeys();
			Listeners.add(window, 'keyup', this);
			Listeners.add(window, 'keypress', this, true);

			Listeners.add(gWindow, "SSWindowStateBusy", this);
			Listeners.add(gWindow, "SSWindowStateReady", this);
			Listeners.add(gWindow, "SSWindowClosing", this);

			// ___ add tab action handlers
			Tabs.listen("TabOpen", this);
			Tabs.listen("TabClose", this);
			Tabs.listen("TabMove", this);
			Tabs.listen("TabSelect", this);
			Tabs.listen("TabPinned", this);
			Tabs.listen("TabUnpinned", this);

			// ___ groups
			GroupItems.init();
			GroupItems.pauseArrange();
			let hasGroupItemsData = GroupItems.load();
			PinnedItems.init();

			// ___ tabs
			TabItems.init();
			TabItems.pausePainting();

			// ___ favicons
			FavIcons.init();

			if(!hasGroupItemsData) {
				this.reset();
			}

			// ___ resizing
			if(this._pageBounds) {
				this._resize(true);
			} else {
				this._pageBounds = this.getPageBounds();
			}
			Listeners.add(window, 'resize', this);

			// ___ load frame script
			Messenger.loadInWindow(gWindow, 'TabView');

			pageWatch.register(this);
			Listeners.add(this.sessionRestoreNotice, 'click', this);

			// ___ Done
			this._frameInitialized = true;
			this._save();

			// fire an iframe initialized event so everyone knows tab view is initialized.
			dispatch(window, { type: "tabviewframeinitialized", cancelable: false });
		}
		catch(ex) {
			Cu.reportError(ex);
		}
		finally {
			// There's no point in having ridiculously large slots. We only need to maintain the relative slot differences between the groups.
			GroupItems.normalizeSlots();
		}
	},

	// Should be called when window is unloaded.
	uninit: function() {
		Listeners.remove(window, 'keyup', this);
		Listeners.remove(window, 'keypress', this, true);
		Listeners.remove(window, 'resize', this);
		Listeners.remove(gWindow, "SSWindowClosing", this);
		Listeners.remove(gWindow, "SSWindowStateBusy", this);
		Listeners.remove(gWindow, "SSWindowStateReady", this);
		Listeners.remove(this.sessionRestoreNotice, 'click', this);

		Listeners.remove(GroupItems.workSpace, 'mousedown', this);
		Listeners.remove(GroupItems.workSpace, 'dblclick', this);

		Listeners.remove(this.exitBtn, 'click', this);
		Listeners.remove(this.optionsBtn, 'click', this);
		Listeners.remove(this.helpBtn, 'click', this);
		Listeners.remove(this.gridBtn, 'click', this);
		Listeners.remove(this.classicBtn, 'click', this);
		Listeners.remove(this.gridNewGroupBtn, 'click', this);
		Listeners.remove(GroupItems.workSpace, 'dragover', this);

		pageWatch.unregister(this);

		Messenger.unlistenWindow(gWindow, "DOMWillOpenModalDialog", this);
		Messenger.unloadFromWindow(gWindow, 'TabView');

		// additional clean up
		TabItems.uninit();
		PinnedItems.uninit();
		GroupItems.uninit();
		Search.uninit();

		Tabs.unlisten("TabOpen", this);
		Tabs.unlisten("TabClose", this);
		Tabs.unlisten("TabMove", this);
		Tabs.unlisten("TabSelect", this);
		Tabs.unlisten("TabPinned", this);
		Tabs.unlisten("TabUnpinned", this);

		Prefs.unlisten('stackTabs', this);
		Prefs.unlisten('displayMode', this);

		this._currentTab = null;
		this._pageBounds = null;
		this._reorderTabItemsOnShow = null;
		this._reorderTabsOnHide = new Set();
		this._frameInitialized = false;
	},

	goToPreferences: function(aOptions) {
		PrefPanes.open(gWindow, aOptions);

		// we can't very well see the preferences if we're still in tabview
		this.hideTabView();
	},

	// Resets the Panorama view to have just one group with all tabs
	reset: function() {
		// (TMP) Reconnect tabs could have been disconnected in GroupItems.reconstitute.
		TabItems.resumeReconnecting();

		let padding = Trenches.defaultRadius;
		let welcomeWidth = 300;
		let pageBounds = GroupItems.getSafeWindowBounds();

		// ___ make a fresh groupItem
		let box = new Rect(pageBounds);
		box.width = Math.min(box.width * 0.667, pageBounds.width - (welcomeWidth + padding));
		box.height = box.height * 0.667;
		if(RTL) {
			box.left = pageBounds.left + welcomeWidth + 2 * padding;
		}

		for(let group of GroupItems) {
			group.close();
		}

		let options = {
			bounds: box,
			immediately: true
		};
		let groupItem = new GroupItem([], options);
		for(let tab of Tabs.notPinned) {
			if(!tab._tabViewTabItem) { continue; }

			let item = tab._tabViewTabItem;
			// To keep in sync with TMP's session manager requirements.
			if(gWindow.Tabmix) {
				item._reconnected = true;
			}
			groupItem.add(item);
		}
		this.setActive(groupItem);
	},

	// Blurs any currently focused element
	blurAll: function() {
		for(let element of $$(":focus")) {
			element.blur();
		}
	},

	// toggle between the various workspace modes available
	toggleMode: function() {
		if(document.body.classList.contains(Prefs.displayMode)) { return; }

		document.body.classList.remove('classic');
		document.body.classList.remove('grid');

		document.body.classList.add(Prefs.displayMode);

		try {
			GroupItems.pauseArrange();

			// Any hidden (closed) groups are removed from view when toggling between modes.
			GroupItems.removeHiddenGroups();

			// Re-build necessary groups info (sizes, positions and stuff)
			GroupItems.load();

			// Make sure groups that were never positioned (created in grid mode) don't overlap others.
			if(UI.classic) {
				GroupItems.resnap();
			}
		}
		catch(ex) {
			Cu.reportError(ex);
		}
		finally {
			GroupItems.resumeArrange();
		}
	},

	// Returns true if the last interaction was long enough ago to consider the UI idle.
	// Used to determine whether interactivity would be sacrificed if the CPU was to become busy.
	isIdle: function() {
		let time = Date.now();
		return (time - this.lastMoveTime) > this._maxInteractiveWait;
	},

	// Returns the currently active tab as a <TabItem>
	getActiveTab: function() {
		return this._activeTab;
	},

	// Sets the currently active tab. The idea of a focused tab is useful for keyboard navigation and returning to the last zoomed-in tab.
	// Hitting return/esc brings you to the focused tab, and using the arrow keys lets you navigate between open tabs.
	// Parameters:
	//  - Takes a <TabItem>
	_setActiveTab: function(tabItem) {
		if(tabItem == this._activeTab) { return; }

		if(this._activeTab) {
			this._activeTab.makeDeactive();
			this._activeTab.removeSubscriber("close", this._onActiveTabClosed);
		}

		this._activeTab = tabItem;

		if(this._activeTab) {
			this._activeTab.addSubscriber("close", this._onActiveTabClosed);
			this._activeTab.makeActive();

			// When setting a new active tab (i.e. when closing the previous active tab) TabView loses focus, probably because the physical tab gets it when it's "selected".
			// This prevents the keyboard from working correctly unless we refocus our TabView.
			Timers.init('focusTabView', () => {
				if(this.isTabViewVisible() && !this._isChangingVisibility) {
					window.focus();
				}
			}, 0);
		}
	},

	// Handles when the currently active tab gets closed.
	// Parameters:
	//  - the <TabItem> that is closed
	_onActiveTabClosed: function(tabItem) {
		if(UI._activeTab == tabItem) {
			UI._setActiveTab(null);
		}
	},

	// Sets the active tab item or group item
	// Parameters:
	// options
	//  dontSetActiveTabInGroup bool for not setting active tab in group
	setActive: function(item, options = {}) {
		if(item.isATabItem) {
			if(item.parent) {
				GroupItems.setActiveGroupItem(item.parent);
			}
			if(!options.dontSetActiveTabInGroup) {
				this._setActiveTab(item);
			}
		} else {
			GroupItems.setActiveGroupItem(item);
			if(!options.dontSetActiveTabInGroup) {
				let activeTab = item.getActiveTab();
				if(activeTab) {
					this._setActiveTab(activeTab);
				}
			}
		}
	},

	// Sets the active tab to 'null'.
	clearActiveTab: function() {
		this._setActiveTab(null);
	},

	// Returns true if the TabView UI is currently shown.
	isTabViewVisible: function() {
		return gTabViewDeck.selectedPanel == gTabViewFrame;
	},

	// To close the current tab, as commanded by the keyboard shortcut.
	closeActiveTab: function() {
		if(this._activeTab) {
			this._activeTab.closedManually = true;
			this._activeTab.close();
		}
	},

	// The following is adapted from the equivalent gBrowser.moveActiveTab* methods.
	moveActiveTab: function(aWhere) {
		if(!this._activeTab) { return; }

		switch(aWhere) {
			case "forward":
			case "backward": {
				let sibling = this._activeTab.tab;
				let x = (aWhere == "forward") ? "next" : "previous";
				while(sibling && sibling[x+"Sibling"]) {
					sibling = sibling[x+"Sibling"];
					if(!sibling.hidden) {
						this._moveActiveTab(sibling._tPos);
						break;
					}
				}
				break;
			}
			case "tostart":
				if(this._activeTab.tab._tPos > 0) {
					this._moveActiveTab(0);
				}
				break;

			case "toend": {
				let last = Tabs.length -1;
				if(this._activeTab.tab._tPos < last) {
					this._moveActiveTab(last);
				}
				break;
			}
		}
	},

	_moveActiveTab: function(pos) {
		gBrowser.moveTabTo(this._activeTab.tab, pos);
		this._activeTab.parent.reorderTabItemsBasedOnTabOrder();
	},

	// If the active tab's group is overflowing, scroll it until the tab is visible.
	showActiveTab: function() {
		let tabItem = this.getActiveTab();
		if(!tabItem) { return; }

		// There's no need to do anything, the active tab item is already visible for sure.
		if(!tabItem.parent.overflowing) { return; }

		tabItem.container.scrollIntoView();
	},

	// Returns a <Rect> defining the area of the page <Item>s should stay within.
	getPageBounds: function() {
		let box = GroupItems.workSpace.getBoundingClientRect();
		let width = Math.max(100, Math.floor(box.width));
		let height = Math.max(100, Math.floor(box.height));
		return new Rect(0, 0, width, height);
	},

	// See if the provided element should be scrolled while dragging the mouse over to its top or bottom edge.
	scrollAreaWhileDragging: function(e, element) {
		let mouse = new Point(e.clientX, e.clientY);
		let rect = element.getBoundingClientRect();
		let topArea = new Rect(rect.left, rect.top, rect.width, this.scrollAreaSize);
		let bottomArea = new Rect(rect.left, rect.top + rect.height - this.scrollAreaSize, rect.width, this.scrollAreaSize);

		let delta;
		if(topArea.contains(mouse)) {
			delta = -1;
		} else if(bottomArea.contains(mouse)) {
			delta = 1;
		}

		if(delta) {
			Synthesizer.scroll(mouse, delta);
		}
	},

	// Shows TabView and hides the main browser UI.
	// Parameters:
	//   zoomOut - true for zoom out animation, false for nothing.
	showTabView: function(zoomOut) {
		if(this.isTabViewVisible() || this._isChangingVisibility) { return; }
		this._isChangingVisibility = true;

		try {
			dispatch(window, { type: "willshowtabview", cancelable: false });

			// store tab strip smooth scroll value and disable it.
			let tabStrip = gBrowser.tabContainer.mTabstrip;
			this._originalSmoothScroll = tabStrip.smoothScroll;
			tabStrip.smoothScroll = false;

			let currentTab = this._currentTab;

			for(let groupItem of this._reorderTabItemsOnShow) {
				groupItem.reorderTabItemsBasedOnTabOrder();
			}
			this._reorderTabItemsOnShow = [];

			gTabViewDeck.selectedPanel = gTabViewFrame;
			gWindow.TabsInTitlebar.allowedBy("tabview-open", false);
			gTabViewFrame.contentWindow.focus();

			gBrowser.updateTitlebar();
			if(DARWIN) {
				this.setTitlebarColors(true);
			}

			// Trick to make Ctrl+F4 and Ctrl+Shift+PageUp/PageDown shortcuts behave as expected in TabView,
			// we need to remove the gBrowser as a listener for these, otherwise it would consume these events and they would never reach our handler.
			this._els.removeSystemEventListener(gWindow.document, "keydown", gBrowser, false);

			if(zoomOut && currentTab && currentTab._tabViewTabItem) {
				let item = currentTab._tabViewTabItem;

				// Zoom out!
				item.zoomOut();

				// if the tab's been destroyed
				if(!currentTab._tabViewTabItem) {
					item = null;
				}

				this.setActive(item);

				this._resize(true);
			}
			else if(!currentTab || !currentTab._tabViewTabItem) {
				this.clearActiveTab();
			}
		}
		catch(ex) {
			Cu.reportError(ex);
		}
		finally {
			this._isChangingVisibility = false;
			if(!this.isTabViewVisible()) { return; }
		}

		dispatch(window, { type: "tabviewshown", cancelable: false });

		// Flush pending updates
		PinnedItems.flushUpdates();
		GroupItems.resumeArrange();
		TabItems.resumePainting();

		this.showActiveTab();
		this.checkSessionRestore();
	},

	// Hides TabView and shows the main browser UI.
	// Parameters:
	//   fullfill - a callback-like method to be called when we're sure to exit tabview but *before* that actually happens
	hideTabView: function(fulfill) {
		if(!this.isTabViewVisible() || this._isChangingVisibility) { return; }

		Timers.cancel('focusTabView');

		dispatch(window, { type: "willhidetabview", cancelable: false });

		// another tab might be select if user decides to stay on a page when a onclose confirmation prompts.
		GroupItems.removeHiddenGroups();

		// We need to set this after removing the hidden groups because doing so might show prompts which will cause us to be called again,
		// and we'd get stuck if we prevent re-entrancy before doing that.
		this._isChangingVisibility = true;

		try {
			GroupItems.pauseArrange();
			TabItems.pausePainting();

			for(let groupItem of this._reorderTabsOnHide) {
				if(!groupItem.hidden && groupItem.container.parentNode) {
					groupItem.reorderTabsBasedOnTabItemOrder();
				}
			}
			this._reorderTabsOnHide = new Set();

			if(fulfill) {
				fulfill();
			}

			gTabViewDeck.selectedPanel = gBrowserPanel;
			gWindow.TabsInTitlebar.allowedBy("tabview-open", true);
			gBrowser.selectedBrowser.focus();

			gBrowser.updateTitlebar();
			gBrowser.tabContainer.mTabstrip.smoothScroll = this._originalSmoothScroll;
			if(DARWIN) {
				this.setTitlebarColors(false);
			}

			this._els.addSystemEventListener(gWindow.document, "keydown", gBrowser, false);
		}
		catch(ex) {
			Cu.reportError(ex);
		}
		finally {
			this._isChangingVisibility = false;
			if(this.isTabViewVisible()) { return; }
		}

		dispatch(window, { type: "tabviewhidden", cancelable: false });
	},

	// Used on the Mac to make the title bar match the gradient in the rest of the TabView UI.
	// Parameters:
	//   colors - (bool or object) true for the special TabView color, false for the normal color, and an object with "active" and "inactive" properties to specify directly.
	setTitlebarColors: function(colors) {
		// Mac Only
		if(!DARWIN) { return; }

		let mainWindow = gWindow.document.getElementById("main-window");
		if(colors === true) {
			mainWindow.setAttribute("activetitlebarcolor", "#C4C4C4");
			mainWindow.setAttribute("inactivetitlebarcolor", "#EDEDED");
		} else if(colors && "active" in colors && "inactive" in colors) {
			mainWindow.setAttribute("activetitlebarcolor", colors.active);
			mainWindow.setAttribute("inactivetitlebarcolor", colors.inactive);
		} else {
			mainWindow.removeAttribute("activetitlebarcolor");
			mainWindow.removeAttribute("inactivetitlebarcolor");
		}
	},

	storageClosing: function() {
		Listeners.remove(gWindow, "SSWindowClosing", this);

		// XXX bug #635975 - don't unlink the tab if the dom window is closing.
		this.isDOMWindowClosing = true;

		if(this.isTabViewVisible()) {
			GroupItems.removeHiddenGroups();
		}

		TabItems.saveAll();
		this._save();
	},

	// Pauses the storage activity that conflicts with sessionstore updates. Calls can be nested.
	storageBusy: function() {
		if(this._storageBusy) { return; }
		this._storageBusy = true;

		TabItems.pauseReconnecting();
		GroupItems.pauseAutoclose();
	},

	// Resumes the activity paused by storageBusy, and updates for any new group information in sessionstore. Calls can be nested.
	storageReady: function() {
		if(!this._storageBusy) { return; }
		this._storageBusy = false;

		let hasGroupItemsData = GroupItems.load();
		if(!hasGroupItemsData) {
			this.reset();
		}

		TabItems.resumeReconnecting();
		GroupItems._updateTabBar();
		GroupItems.resumeAutoclose();
	},

	// Selects the given xul:tab in the browser.
	goToTab: function(xulTab) {
		// If it's not focused, the onFocus listener would handle it.
		if(xulTab.selected) {
			this.onTabSelect(xulTab);
		} else {
			Tabs.selected = xulTab;
		}
	},

	// Called when the user switches from one tab to another outside of the TabView UI.
	onTabSelect: function(tab) {
		this._currentTab = tab;

		if(this.isTabViewVisible()) {
			// We want to zoom in if:
			// 1) we didn't just restore a tab via Ctrl+Shift+T
			// 2) the currently selected tab is the last created tab and has a tabItem
			if(!this.restoredClosedTab && this._lastOpenedTab == tab && tab._tabViewTabItem) {
				tab._tabViewTabItem.zoomIn(true);
				this._lastOpenedTab = null;
				return;
			}
			if(this._closedLastVisibleTab || (this._closedSelectedTabInTabView && !this.closedLastTabInTabView) || this.restoredClosedTab) {
				if(this.restoredClosedTab) {
					// when the tab view UI is being displayed, update the thumb for the restored closed tab after the page load
					let receiver = function() {
						Messenger.unlistenBrowser(tab.linkedBrowser, "documentLoaded", receiver);
						TabItems._update(tab);
					};
					Messenger.listenBrowser(tab.linkedBrowser, "documentLoaded", receiver);
					Messenger.messageBrowser(tab.linkedBrowser, "waitForDocumentLoad");
				}
				this._closedLastVisibleTab = false;
				this._closedSelectedTabInTabView = false;
				this.closedLastTabInTabView = false;
				this.restoredClosedTab = false;

				// when closing the active tab, the new active tab should correspond to the actual newly selected tab
				if(tab._tabViewTabItem) {
					this._setActiveTab(tab._tabViewTabItem);
				}
				return;
			}
		}

		// reset these vars, just in case.
		this._closedLastVisibleTab = false;
		this._closedSelectedTabInTabView = false;
		this.closedLastTabInTabView = false;
		this.restoredClosedTab = false;
		this._lastOpenedTab = null;

		// if TabView is visible but we didn't just close the last tab or selected tab, show chrome.
		if(this.isTabViewVisible()) {
			// Unhide the group of the tab the user is activating.
			if(tab && tab._tabViewTabItem && tab._tabViewTabItem.parent && tab._tabViewTabItem.parent.hidden) {
				tab._tabViewTabItem.parent._unhide({ immediately: true });
			}

			this.hideTabView(() => {
				// another tab might be selected when hideTabView() is invoked so a validation is needed.
				if(this._currentTab != tab) { return; }

				this.updateShownTabs(tab);
			});
		}
		else {
			this.updateShownTabs(tab);
		}
	},

	updateShownTabs: function(tab) {
		// update the tab bar for the new tab's group
		if(tab && tab._tabViewTabItem) {
			if(!TabItems.reconnectingPaused) {
				GroupItems.updateActiveGroupItemAndTabBar(tab._tabViewTabItem);
			}
		} else {
			// No tabItem; must be an app tab. Base the tab bar on the current group.
			// If no current group, figure it out based on what's already in the tab bar.
			if(!GroupItems.getActiveGroupItem()) {
				let theTab = Tabs.notPinned[0];
				if(theTab) {
					let tabItem = theTab._tabViewTabItem;
					this.setActive(tabItem.parent);
				}
			}

			if(GroupItems.getActiveGroupItem()) {
				GroupItems._updateTabBar();
			}
		}
	},

	// Sets the groupItem which the tab items' tabs should be re-ordered when switching to the main browser UI.
	// Parameters:
	//   groupItem - the groupItem which would be used for re-ordering tabs.
	setReorderTabsOnHide: function(groupItem) {
		if(this.isTabViewVisible()) {
			this._reorderTabsOnHide.add(groupItem);
		}
	},

	// Sets the groupItem which the tab items should be re-ordered when switching to the tab view UI.
	// Parameters:
	//   groupItem - the groupItem which would be used for re-ordering tab items.
	setReorderTabItemsOnShow: function(groupItem) {
		if(!this.isTabViewVisible()) {
			let index = this._reorderTabItemsOnShow.indexOf(groupItem);
			if(index == -1) {
				this._reorderTabItemsOnShow.push(groupItem);
			}
		}
	},

	updateTabButton: function() {
		let numberOfGroups = GroupItems.size;

		setAttribute(this.exitBtn, "groups", numberOfGroups);
		gTabView.updateGroupNumberBroadcaster(numberOfGroups);
	},

	// Sets up the allowed browser keys using key elements.
	_setupBrowserKeys: function() {
		this._browserKeys = [];
		let keyArray = [
			"newNavigator", "closeWindow", "undoCloseWindow",
			"newNavigatorTab", "close", "undoCloseTab",
			"undo", "redo", "cut", "copy", "paste",
			"selectAll", "find", "browserConsole"
		];
		if(!WINNT) {
			keyArray.push("quitApplication");
			if(DARWIN) {
				keyArray.push("preferencesCmdMac", "minimizeWindow", "hideThisAppCmdMac", "fullScreen");
			}
		}
		for(let name of keyArray) {
			let element = gWindow.document.getElementById("key_" + name);
			let key = element.getAttribute('keycode') || element.getAttribute("key");
			let modifiers = element.getAttribute('modifiers') || "";
			this._browserKeys.push({
				name: name,
				key: Keysets.translateFromConstantCode(key),
				accel: modifiers.includes('accel'),
				alt: modifiers.includes('alt'),
				shift: modifiers.includes('shift')
			});
		}

		// The following are handled by gBrowser._handleKeyDownEvent(): http://mxr.mozilla.org/mozilla-central/source/browser/base/content/tabbrowser.xml
		this._browserKeys.push(
			{
				name: "moveTabBackward",
				key: Keysets.translateFromConstantCode("PageUp"),
				accel: true,
				alt: false,
				shift: true
			},
			{
				name: "moveTabForward",
				key: Keysets.translateFromConstantCode("PageDown"),
				accel: true,
				alt: false,
				shift: true
			}
		);
		if(!DARWIN) {
			this._browserKeys.push({
				name: "closeNotMac",
				key: Keysets.translateFromConstantCode("F4"),
				accel: true,
				alt: false,
				shift: false
			});
		}

		// The following are handled by each tab's keydown event handler
		this._browserKeys.push(
			{
				name: "moveTabBackward",
				key: Keysets.translateFromConstantCode("ArrowUp"),
				accel: true,
				alt: false,
				shift: false
			},
			{
				name: "moveTabForward",
				key: Keysets.translateFromConstantCode("ArrowDown"),
				accel: true,
				alt: false,
				shift: false
			},
			{
				name: "moveTabBackward",
				key: Keysets.translateFromConstantCode(LTR ? "ArrowLeft" : "ArrowRight"),
				accel: true,
				alt: false,
				shift: false
			},
			{
				name: "moveTabForward",
				key: Keysets.translateFromConstantCode(RTL ? "ArrowLeft" : "ArrowRight"),
				accel: true,
				alt: false,
				shift: false
			},
			{
				name: "moveTabToStart",
				key: Keysets.translateFromConstantCode("Home"),
				accel: true,
				alt: false,
				shift: false
			},
			{
				name: "moveTabToEnd",
				key: Keysets.translateFromConstantCode("End"),
				accel: true,
				alt: false,
				shift: false
			}
		);
	},

	_onKeypress: function(e) {
		let processBrowserKeys = (e, input) => {
			// let any keys with alt to pass through
			if(e.altKey) { return; }

			// make sure our keyboard shortcuts also work, such as to toggle out of tab view
			for(let key of keysets) {
				if(Keysets.isRegistered(key) && Keysets.compareWithEvent(key, e)) { return; }
			}

			let accel = (DARWIN && e.metaKey) || (!DARWIN && e.ctrlKey);
			if(accel) {
				let alt = e.altKey;
				let shift = e.shiftKey;
				let key = Keysets.translateFromConstantCode(e.key); // mostly to capitalize single char keys

				// let ctrl+edit keys work while typing in a text field (group name or search box)
				if(input) {
					switch(key) {
						case 'ArrowLeft':
						case 'ArrowRight':
						case 'Backspace':
						case 'Delete':
							return;
					}
				}
				else {
					for(let k of this._browserKeys) {
						if(k.key == key && k.accel == accel && k.alt == alt && k.shift == shift) {
							switch(k.name) {
								case "find":
									this.enableSearch();
									break;

								case "close":
								case "closeNotMac":
									this.closeActiveTab();
									break;

								case "moveTabForward":
									this.moveActiveTab("forward");
									break;

								case "moveTabBackward":
									this.moveActiveTab("backward");
									break;

								case "moveTabToStart":
									this.moveActiveTab("tostart");
									break;

								case "moveTabToEnd":
									this.moveActiveTab("toend");
									break;

								default: return;
							}
							break;
						}
					}
				}

				// We cancel most shortcuts that shouldn't take place while TabView is shown.
				e.preventDefault();
				e.stopPropagation();
			}
		};

		let focused = $$(":focus");
		if((focused.length && focused[0].nodeName == "input") || Search.inSearch || this.ignoreKeypressForSearch) {
			this.ignoreKeypressForSearch = false;
			processBrowserKeys(e, true);
			return;
		}

		let getClosestTabBy = (norm) => {
			if(!this.getActiveTab()) {
				return null;
			}

			let activeTab = this.getActiveTab();
			let activeTabGroup = activeTab.parent;
			let myCenter = activeTab.getBounds().center();
			let match;

			for(let item of TabItems) {
				if(!item.parent.hidden && (!activeTabGroup.expanded || activeTabGroup.id == item.parent.id)) {
					let itemCenter = item.getBounds().center();

					if(norm(itemCenter, myCenter)) {
						let itemDist = myCenter.distance(itemCenter);
						if(!match || match[0] > itemDist) {
							match = [itemDist, item];
						}
					}
				}
			}

			return match && match[1];
		};

		let activeTab;
		let activeGroupItem;
		let norm = null;
		let accel = (DARWIN && e.metaKey) || (!DARWIN && e.ctrlKey);
		if(!accel) {
			switch(e.key) {
				case "ArrowRight":
					norm = function(a, me) { return a.x > me.x };
					break;

				case "ArrowLeft":
					norm = function(a, me) { return a.x < me.x };
					break;

				case "ArrowDown":
					norm = function(a, me) { return a.y > me.y };
					break;

				case "ArrowUp":
					norm = function(a, me) { return a.y < me.y }
					break;
			}
		}

		if(norm != null) {
			let nextTab = getClosestTabBy(norm);
			if(nextTab) {
				if(nextTab.isStacked && !nextTab.parent.expanded) {
					nextTab = nextTab.parent.children[0];
				}
				this.setActive(nextTab);
			}
			return;
		}

		let preventDefault = true;
		switch(e.key) {
			case "Escape":
				activeGroupItem = GroupItems.getActiveGroupItem();
				if(activeGroupItem && activeGroupItem.expanded) {
					activeGroupItem.collapse();
				} else {
					this.exit();
				}
				break;

			case "Enter":
				activeGroupItem = GroupItems.getActiveGroupItem();
				if(activeGroupItem) {
					activeTab = this.getActiveTab();

					if(!activeTab || activeTab.parent != activeGroupItem) {
						activeTab = activeGroupItem.getActiveTab();
					}

					if(activeTab) {
						activeTab.zoomIn();
					} else {
						activeGroupItem.newTab();
					}
				}
				break;

			case "Tab":
				// tab/shift + tab to go to the next tab.
				activeTab = this.getActiveTab();
				if(activeTab) {
					let tabItems = (activeTab.parent ? activeTab.parent.children : [activeTab]);
					let length = tabItems.length;
					let currentIndex = tabItems.indexOf(activeTab);

					if(length > 1) {
						let newIndex;
						if(e.shiftKey) {
							if(currentIndex == 0) {
								newIndex = (length - 1);
							} else {
								newIndex = (currentIndex - 1);
							}
						} else {
							if(currentIndex == (length - 1)) {
								newIndex = 0;
							} else {
								newIndex = (currentIndex + 1);
							}
						}
						this.setActive(tabItems[newIndex]);
					}
				}
				break;

			default:
				processBrowserKeys(e);
				preventDefault = false;
				break;
		}

		if(preventDefault) {
			e.stopPropagation();
			e.preventDefault();
		}
	},

	// Enables the search feature.
	enableSearch: function() {
		if(!Search.inSearch) {
			Search.ensureShown();
		}
	},

	// Called in response to a mousedown in empty space in the TabView UI; creates a new groupItem based on the user's drag.
	_createGroupItemOnDrag: function(e) {
		let lastActiveGroupItem = GroupItems.getActiveGroupItem();

		let phantom = document.createElement("div");
		phantom.classList.add("groupItem");
		phantom.classList.add("phantom");
		phantom.classList.add("activeGroupItem");
		GroupItems.workSpace.appendChild(phantom);

		// a faux-Item
		let item = {
			container: phantom,
			$container: iQ(phantom),
			isAFauxItem: true,
			bounds: {},
			getBounds: function() {
				return this.$container.bounds();
			},
			setBounds: function(bounds) {
				this.$container.css(bounds);
			},
			// we don't need to pushAway the phantom item at the end, because when we create a new GroupItem, it'll do the actual pushAway.
			pushAway: function() {},
		};

		let finalize = () => {
			let bounds = item.getBounds();
			if(bounds.width > GroupItems.minGroupWidth && bounds.height > GroupItems.minGroupHeight) {
				let groupItem = new GroupItem([], { bounds, focusTitle: true });
				this.setActive(groupItem);
				phantom.remove();
			} else {
				let center = bounds.center();
				item.$container.animate({
					width: 0,
					height: 0,
					top: center.y,
					left: center.x
				}, {
					duration: 300,
					complete: function() {
						item.container.remove();
					}
				});
				this.setActive(lastActiveGroupItem);
			}
		}

		new GroupDrag(item, e, false, finalize);
		DraggingGroup.start();
	},

	// Update the TabView UI contents in response to a window size change. Won't do anything if it doesn't deem the resize necessary.
	// Parameters:
	//   force - true to update even when "unnecessary"; default false
	_resize: function(force) {
		if(!this._pageBounds) { return; }

		// Here are reasons why we *won't* resize:
		// 1. Panorama isn't visible (in which case we will resize when we do display)
		// 2. the screen dimensions haven't changed
		// 3. everything on the screen fits and nothing feels cramped
		if(!force && !this.isTabViewVisible()) { return; }

		let oldPageBounds = new Rect(this._pageBounds);
		let newPageBounds = this.getPageBounds();
		if(newPageBounds.equals(oldPageBounds)) { return; }

		if(UI.grid) {
			// I can't do this on a delay (so it won't resize on every mousemove),
			// it becomes very jaggy, and... weird. Sometimes it won't even resize at all after stopping the mouse
			// for a while until moving it again.
			GroupItems.arrange(true);

			this._pageBounds = newPageBounds;
			this._save();
			return;
		}

		// Classic mode...

		if(!this.shouldResizeItems()) { return; }

		// compute itemBounds: the union of all the top-level items' bounds.
		let itemBounds = new Rect(this._pageBounds);
		// We start with pageBounds so that we respect the empty space the user has left on the page.
		itemBounds.width = 1;
		itemBounds.height = 1;
		for(let item of GroupItems) {
			let bounds = item.getBounds();
			itemBounds = (itemBounds ? itemBounds.union(bounds) : new Rect(bounds));
		}

		if(newPageBounds.width < this._pageBounds.width && newPageBounds.width > itemBounds.width) {
			newPageBounds.width = this._pageBounds.width;
		}
		if(newPageBounds.height < this._pageBounds.height && newPageBounds.height > itemBounds.height) {
			newPageBounds.height = this._pageBounds.height;
		}

		let wScale;
		let hScale;
		if(Math.abs(newPageBounds.width - this._pageBounds.width) > Math.abs(newPageBounds.height - this._pageBounds.height)) {
			wScale = newPageBounds.width / this._pageBounds.width;
			hScale = newPageBounds.height / itemBounds.height;
		} else {
			wScale = newPageBounds.width / itemBounds.width;
			hScale = newPageBounds.height / this._pageBounds.height;
		}

		let scale = Math.min(hScale, wScale);
		let pairs = [];
		for(let item of GroupItems) {
			let bounds = item.getBounds();
			bounds.left += (RTL ? -1 : 1) * (newPageBounds.left - this._pageBounds.left);
			bounds.left *= scale;
			bounds.width *= scale;

			bounds.top += newPageBounds.top - this._pageBounds.top;
			bounds.top *= scale;
			bounds.height *= scale;

			pairs.push({
				item: item,
				bounds: bounds
			});
		}

		GroupItems.unsquish(pairs);

		for(let pair of pairs) {
			pair.item.setBounds(pair.bounds, true);
			pair.item.snap();
		}

		this._pageBounds = newPageBounds;
		this._save();
	},

	// Returns whether we should resize the items on the screen, based on whether the top-level items fit in the screen or not and whether they feel "cramped" or not.
	// These computations may be done using cached values. The cache can be cleared with UI.clearShouldResizeItems().
	shouldResizeItems: function() {
		let newPageBounds = this.getPageBounds();

		// If we don't have cached cached values...
		if(this._minimalRect === undefined || this._feelsCramped === undefined) {
			// Loop through every top-level Item for two operations:
			// 1. check if it is feeling "cramped" due to squishing (a technical term),
			// 2. union its bounds with the minimalRect
			let feelsCramped = false;
			let minimalRect = new Rect(0, 0, 1, 1);

			for(let item of GroupItems) {
				let bounds = new Rect(item.getBounds());
				feelsCramped = feelsCramped || (item.userSize && (item.userSize.x > bounds.width || item.userSize.y > bounds.height));
				bounds.inset(-Trenches.defaultRadius, -Trenches.defaultRadius);
				minimalRect = minimalRect.union(bounds);
			}

			// ensure the minimalRect extends to, but not beyond, the origin
			minimalRect.left = 0;
			minimalRect.top  = 0;

			this._minimalRect = minimalRect;
			this._feelsCramped = feelsCramped;
		}

		return this._minimalRect.width > newPageBounds.width || this._minimalRect.height > newPageBounds.height || this._feelsCramped;
	},

	// Clear the cache of whether we should resize the items on the Panorama screen, forcing a recomputation on the next UI.shouldResizeItems() call.
	clearShouldResizeItems: function() {
		delete this._minimalRect;
		delete this._feelsCramped;
	},

	// Exits TabView UI.
	exit: function() {
		let zoomedIn = false;

		if(Search.inSearch) {
			let matcher = Search.createSearchTabMatcher();
			let matches = matcher.matched();

			if(matches.length > 0) {
				matches[0].zoomIn();
				zoomedIn = true;
			}
			Search.hide();
		}

		if(zoomedIn) { return; }

		let unhiddenGroup = null;
		for(let groupItem of GroupItems) {
			if(!groupItem.hidden && groupItem.children.length > 0) {
				unhiddenGroup = groupItem;
				break;
			}
		}

		// no pinned tabs and no visible groups: open a new group. open a blank tab and return
		if(!unhiddenGroup && !Tabs.numPinned) {
			let group;
			for(let groupItem of GroupItems) {
				if(!groupItem.hidden && !groupItem.children.length) {
					group = groupItem;
					break;
				}
			}
			if(!group) {
				group = GroupItems.newGroup();
			}

			group.newTab(null, { closedLastTab: true });
			return;
		}

		// If there's an active TabItem, zoom into it. If not (for instance when the selected tab is an app tab), just go there.
		let activeTabItem = this.getActiveTab();
		if(!activeTabItem) {
			let tabItem = Tabs.selected._tabViewTabItem;
			if(tabItem) {
				if(!tabItem.parent || !tabItem.parent.hidden) {
					activeTabItem = tabItem;
				} else {
					// set active tab item if there is at least one unhidden group
					if(unhiddenGroup) {
						activeTabItem = unhiddenGroup.getActiveTab();
					}
				}
			}
		}

		if(activeTabItem) {
			activeTabItem.zoomIn();
		} else {
			if(Tabs.numPinned > 0) {
				if(Tabs.selected.pinned) {
					this.goToTab(Tabs.selected);
				} else {
					let tab = Tabs.pinned[0];
					if(tab) {
						this.goToTab(tab);
					}
				}
			}
		}
	},

	// Given storage data for this object, returns true if it looks valid.
	storageSanity: function(data) {
		if(Utils.isEmptyObject(data)) {
			return true;
		}

		if(!Utils.isRect(data.pageBounds)) {
			data.pageBounds = null;
			return false;
		}

		return true;
	},

	// Saves the data for this object to persistent storage
	_save: function() {
		if(!this._frameInitialized) { return; }

		let data = {
			pageBounds: this._pageBounds
		};

		if(this.storageSanity(data)) {
			Storage.saveUIData(gWindow, data);
		}
	},

	// Saves all data associated with TabView.
	_saveAll: function() {
		this._save();
		GroupItems.saveAll();
		TabItems.saveAll();
	},

	checkSessionRestore: function() {
		// first see if we should automaticlaly change this preference, this will happen only on the very first time the add-on is installed AND used,
		// so that it "just works" right from the start
		this.enableSessionRestore();

		if(!PrivateBrowsing.isPrivate(gWindow)) {
			// Notify the user if necessary that session restore needs to be enabled by showing a banner at the bottom.
			this.sessionRestoreNotice.hidden = Prefs.noWarningsAboutSession || this._noticeDismissed || pageWatch.sessionRestoreEnabled;
			this.sessionRestorePrivate.hidden = true;
		}
		else {
			// In private windows it's expected of the groups to be gone after closing it, so the warning is really more of a notice.
			// We "dismiss" it immediately, in the sense that it really should only be shown once per window.
			if(!Prefs.noWarningsAboutSession && !this._noticeDismissed) {
				this.tempShowBanner(this.sessionRestorePrivate);
				this._noticeDismissed = true;
			} else {
				this.sessionRestorePrivate.hidden = true;
			}
			this.sessionRestoreNotice.hidden = true;
		}
	},

	// Enables automatic session restore when the browser is started. Does nothing if we already did that once in the past.
	enableSessionRestore: function() {
		if(Prefs.pageAutoChanged) { return; }
		Prefs.pageAutoChanged = true;

		// enable session restore if necessary
		if(!pageWatch.sessionRestoreEnabled) {
			pageWatch.enableSessionRestore();

			// Notify the user that session restore has been automatically enabled by showing a banner that expects no user interaction. It fades out after some seconds.
			this.tempShowBanner(this.sessionRestoreAutoChanged);
		}
	},

	tempShowBanner: function(banner, duration = 5000) {
		banner.handleEvent = function(e) {
			if(trueAttribute(this, 'show')) {
				this._tempShowBanner = aSync(() => {
					removeAttribute(this, 'show');
				}, duration);
			} else {
				this.hidden = true;
				Listeners.remove(this, 'transitionend', this);
				delete this._tempShowBanner;
			}
		};

		Listeners.add(banner, 'transitionend', banner);
		banner.hidden = false;

		// force reflow before setting the show attribute, so it animates
		banner.clientTop;

		setAttribute(banner, 'show', 'true');
	}
};

// Keep a few values cached, to avoid constant reflows.
this.UICache = {
	ghost: function(aName, aLambda) {
		this.__defineGetter__(aName, () => {
			delete this[aName];
			return this[aName] = aLambda();
		});
	},

	init: function() {
		let style = getComputedStyle(document.documentElement);

		this.ghost('tabItemPadding', function() {
			return parseInt(style.getPropertyValue('--thumbs-tab-padding')) *2;
		});

		this.ghost('tabCanvasOffset', function() {
			return parseInt(style.getPropertyValue('--canvas-border-width')) *2;
		});

		this.ghost('groupTitlebarHeight', function() {
			return parseInt(style.getPropertyValue('--group-titlebar-height'));
		});

		this.ghost('minGroupHeight', function() {
			return parseInt(style.getPropertyValue('--group-min-height'));
		});

		this.ghost('minGroupWidth', function() {
			return parseInt(style.getPropertyValue('--group-min-width'));
		});

		this.ghost('groupBorderWidth', function() {
			return parseInt(style.getPropertyValue('--group-border-width')) *2;
		});

		this.ghost('stackExpanderHeight', function() {
			return	parseInt(style.getPropertyValue('--stack-expander-size'))
				+ parseInt(style.getPropertyValue('--stack-expander-top-margin'))
				+ parseInt(style.getPropertyValue('--stack-expander-bottom-margin'));
		});

		this.ghost('groupContentsMargin', function() {
			return {
				x: parseInt(style.getPropertyValue('--group-contents-margin')) *2,
				y: parseInt(style.getPropertyValue('--group-contents-margin')) + parseInt(style.getPropertyValue('--group-contents-top-margin'))
			};
		});

		this.ghost('scrollbarWidth', function() {
			return parseInt(style.getPropertyValue('--scrollbar-width'));
		});
	}
};

this.UIStarter = function() {
	try {
		let links = $$('link[rel="stylesheet"]');
		for(let link of links) {
			// Wait for the stylesheet to fully load in the window, otherwise UICache wouldn't have correct values and the layout would go nuts.
			if(!link.sheet || !link.sheet.cssRules || !link.sheet.cssRules.length) {
				Timers.init('UIStarter', () => { UIStarter(); }, 100);
				return;
			}
		}
	}
	catch(ex) {
		// Called too early?
		Timers.init('UIStarter', () => { UIStarter(); }, 100);
		return;
	}

	UICache.init();
	UI.init();
};

Modules.LOADMODULE = function() {
	UIStarter();
};

Modules.UNLOADMODULE = function() {
	UI.uninit();
};
