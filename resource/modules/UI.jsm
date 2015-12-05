// VERSION 1.0.13

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
	_reorderTabsOnHide: [],

	// Keeps track of which xul:tab we are currently on. Used to facilitate zooming down from a previous tab.
	_currentTab: null,

	// Keeps track of event listeners added to the AllTabs object.
	_eventListeners: {},

	// If the UI is in the middle of an operation, this is the max amount of milliseconds to wait between input events before we no longer consider the operation interactive.
	_maxInteractiveWait: 250,

	// Tells whether the storage is currently busy or not.
	_storageBusy: false,

	// Tells wether the parent window is about to close
	isDOMWindowClosing: false,

	// Used to keep track of allowed browser keys.
	_browserKeys: null,

	// Used to keep track of allowed browser keys with Shift key combination.
	_browserKeysWithShift: null,

	// Used to prevent keypress being handled after quitting search mode.
	ignoreKeypressForSearch: false,

	// Used to keep track of the last opened tab.
	_lastOpenedTab: null,

	// Used to keep track of the tab strip smooth scroll value.
	_originalSmoothScroll: null,

	get sessionRestoreNotice() { return $('sessionRestoreNotice'); },
	get sessionRestoreAutoChanged() { return $('sessionRestoreAutoChanged'); },
	get sessionRestorePrivate() { return $('sessionRestorePrivate'); },

	// Called when a web page is about to show a modal dialog.
	receiveMessage: function(m) {
		if(!this.isTabViewVisible()) { return; }

		let index = gBrowser.browsers.indexOf(m.target);
		if(index == -1) { return; }

		let tab = gBrowser.tabs[index];

		// When TabView is visible, we need to call onTabSelect to make sure that TabView is hidden and that the correct group is activated.
		// When a modal dialog is shown for currently selected tab the onTabSelect event handler is not called, so we need to do it.
		if(tab.selected && this._currentTab == tab) {
			this.onTabSelect(tab);
		}
	},

	handleEvent: function(e) {
		switch(e.type) {
			// ___ setup event listener to save canvas images
			case 'SSWindowClosing':
				Listeners.remove(gWindow, "SSWindowClosing", this);

				// XXX bug #635975 - don't unlink the tab if the dom window is closing.
				this.isDOMWindowClosing = true;

				if(this.isTabViewVisible()) {
					GroupItems.removeHiddenGroups();
				}

				TabItems.saveAll();
				this._save();
				break;

			case 'SSWindowStateBusy':
				this.storageBusy();
				break;

			case 'SSWindowStateReady':
				this.storageReady();
				break;

			// clicking the #sessionRestoreNotice banner
			case 'mousedown':
				this.goToPreferences({ jumpto: 'sessionRestore' });
				break;
		}
	},

	observe: function(aSubject, aTopic, aData) {
		switch(aTopic) {
			case 'nsPref:changed':
				this.checkSessionRestore();
				break;
		}
	},

	// Must be called after the object is created.
	init: function() {
		try {
			// initialize the direction of the page
			this._initPageDirection();

			if(Storage.readWindowBusyState(gWindow)) {
				this.storageBusy();
			}

			let data = Storage.readUIData(gWindow);
			this.storageSanity(data);
			this._pageBounds = data.pageBounds;

			// ___ search
			Search.init();

			// ___ currentTab
			this._currentTab = gBrowser.selectedTab;

			// ___ exit button
			iQ("#exit-button").click(() => {
				this.exit();
				this.blurAll();
			});

			iQ("#optionsbutton").mousedown(() => {
				this.goToPreferences();
			});

			iQ("#helpbutton").mousedown(() => {
				this.goToPreferences({ pane: 'paneHowTo' });
			});

			// When you click on the background/empty part of TabView, we create a new groupItem.
			iQ(gTabViewFrame.contentDocument).mousedown((e) => {
				if(iQ(":focus").length > 0) {
					iQ(":focus").each(function(element) {
						// don't fire blur event if the same input element is clicked.
						if(e.target != element && element.nodeName == "input") {
							element.blur();
						}
					});
				}
				if(e.originalTarget.id == "content" && e.button == 0 && e.detail == 1) {
					this._createGroupItemOnDrag(e);
				}
			});

			iQ(gTabViewFrame.contentDocument).dblclick(function(e) {
				if(e.originalTarget.id != "content") { return; }

				// Create a group with one tab on double click
				let box = new Rect(e.clientX - Math.floor(TabItems.tabWidth/2), e.clientY - Math.floor(TabItems.tabHeight/2), TabItems.tabWidth, TabItems.tabHeight);
				box.inset(-30, -30);

				let opts = { immediately: true, bounds: box };
				let groupItem = new GroupItem([], opts);
				groupItem.newTab();
			});

			Messenger.listenWindow(gWindow, "DOMWillOpenModalDialog", this);

			// ___ setup key handlers
			this._setTabViewFrameKeyHandlers();

			// ___ add tab action handlers
			this._addTabActionHandlers();

			// ___ groups
			GroupItems.init();
			GroupItems.pauseArrange();
			let hasGroupItemsData = GroupItems.load();

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
				this._pageBounds = Items.getPageBounds();
			}

			iQ(window).resize(() => {
				this._resize();
			});

			Listeners.add(gWindow, "SSWindowClosing", this);

			// ___ load frame script
			Messenger.loadInWindow(gWindow, 'TabView');

			Prefs.listen('page', this);
			Listeners.add(this.sessionRestoreNotice, 'mousedown', this);

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
			GroupItems.resumeArrange();
		}
	},

	// Should be called when window is unloaded.
	uninit: function() {
		Listeners.remove(gWindow, "SSWindowClosing", this);
		Listeners.remove(gWindow, "SSWindowStateBusy", this);
		Listeners.remove(gWindow, "SSWindowStateReady", this);
		Listeners.remove(this.sessionRestoreNotice, 'mousedown', this);

		Prefs.unlisten('page', this);

		Messenger.unlistenWindow(gWindow, "DOMWillOpenModalDialog", this);
		Messenger.unloadFromWindow(gWindow, 'TabView');

		// additional clean up
		TabItems.uninit();
		GroupItems.uninit();

		this._removeTabActionHandlers();
		this._currentTab = null;
		this._pageBounds = null;
		this._reorderTabItemsOnShow = null;
		this._reorderTabsOnHide = null;
		this._frameInitialized = false;
	},

	goToPreferences: function(aOptions) {
		PrefPanes.open(gWindow, aOptions);

		// we can't very well see the preferences if we're still in tabview
		this.hideTabView();
	},

	// Returns true if we are in RTL mode, false otherwise
	rtl: false,

	// Resets the Panorama view to have just one group with all tabs
	reset: function() {
		let padding = Trenches.defaultRadius;
		let welcomeWidth = 300;
		let pageBounds = Items.getPageBounds();
		pageBounds.inset(padding, padding);

		let $actions = iQ("#actions");
		if($actions) {
			pageBounds.width -= $actions.width();
			if(UI.rtl) {
				pageBounds.left += $actions.width() - padding;
			}
		}

		// ___ make a fresh groupItem
		let box = new Rect(pageBounds);
		box.width = Math.min(box.width * 0.667,
		pageBounds.width - (welcomeWidth + padding));
		box.height = box.height * 0.667;
		if(UI.rtl) {
			box.left = pageBounds.left + welcomeWidth + 2 * padding;
		}

		GroupItems.groupItems.forEach(function(group) {
			group.close();
		});

		let options = {
			bounds: box,
			immediately: true
		};
		let groupItem = new GroupItem([], options);
		let items = TabItems.getItems();
		items.forEach(function(item) {
			if(item.parent) {
				item.parent.remove(item);
			}
			groupItem.add(item, { immediately: true });
		});
		this.setActive(groupItem);
	},

	// Blurs any currently focused element
	blurAll: function() {
		iQ(":focus").each(function(element) {
			element.blur();
		});
	},

	// Returns true if the last interaction was long enough ago to consider the UI idle.
	// Used to determine whether interactivity would be sacrificed if the CPU was to become busy.
	isIdle: function() {
		let time = Date.now();
		let maxEvent = Math.max(drag.lastMoveTime, resize.lastMoveTime);
		return (time - maxEvent) > this._maxInteractiveWait;
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
		}
	},

	// Handles when the currently active tab gets closed.
	// Parameters:
	//  - the <TabItem> that is closed
	_onActiveTabClosed: function(tabItem){
		if(UI._activeTab == tabItem) {
			UI._setActiveTab(null);
		}
	},

	// Sets the active tab item or group item
	// Parameters:
	// options
	//  dontSetActiveTabInGroup bool for not setting active tab in group
	setActive: function(item, options) {
		if(item.isATabItem) {
			if(item.parent) {
				GroupItems.setActiveGroupItem(item.parent);
			}
			if(!options || !options.dontSetActiveTabInGroup) {
				this._setActiveTab(item);
			}
		} else {
			GroupItems.setActiveGroupItem(item);
			if(!options || !options.dontSetActiveTabInGroup) {
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

	// Initializes the page base direction
	_initPageDirection: function() {
		let chromeReg = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIXULChromeRegistry);
		let dir = chromeReg.isLocaleRTL("global");
		document.documentElement.setAttribute("dir", dir ? "rtl" : "ltr");
		this.rtl = dir;
	},

	// Shows TabView and hides the main browser UI.
	// Parameters:
	//   zoomOut - true for zoom out animation, false for nothing.
	showTabView: function(zoomOut) {
		if(this.isTabViewVisible() || this._isChangingVisibility) { return; }
		this._isChangingVisibility = true;

		// store tab strip smooth scroll value and disable it.
		let tabStrip = gBrowser.tabContainer.mTabstrip;
		this._originalSmoothScroll = tabStrip.smoothScroll;
		tabStrip.smoothScroll = false;

		// initialize the direction of the page
		this._initPageDirection();

		let currentTab = this._currentTab;

		this._reorderTabItemsOnShow.forEach(function(groupItem) {
			groupItem.reorderTabItemsBasedOnTabOrder();
		});
		this._reorderTabItemsOnShow = [];

		gTabViewDeck.selectedPanel = gTabViewFrame;
		gWindow.TabsInTitlebar.allowedBy("tabview-open", false);
		gTabViewFrame.contentWindow.focus();

		gBrowser.updateTitlebar();
		if(DARWIN) {
			this.setTitlebarColors(true);
		}

		if(zoomOut && currentTab && currentTab._tabViewTabItem) {
			let item = currentTab._tabViewTabItem;
			// If there was a previous currentTab we want to animate its thumbnail (canvas) for the zoom out.
			// Note that we start the animation on the chrome thread.

			// Zoom out!
			item.zoomOut(() => {
				// if the tab's been destroyed
				if(!currentTab._tabViewTabItem) {
					item = null;
				}

				this.setActive(item);

				this._resize(true);
				this._isChangingVisibility = false;
				dispatch(window, { type: "tabviewshown", cancelable: false });

				// Flush pending updates
				GroupItems.flushAppTabUpdates();

				TabItems.resumePainting();
			});
		} else {
			if(!currentTab || !currentTab._tabViewTabItem) {
				this.clearActiveTab();
			}
			this._isChangingVisibility = false;
			dispatch(window, { type: "tabviewshown", cancelable: false });

			// Flush pending updates
			GroupItems.flushAppTabUpdates();

			TabItems.resumePainting();
		}

		this.checkSessionRestore();
	},

	// Hides TabView and shows the main browser UI.
	hideTabView: function() {
		if(!this.isTabViewVisible() || this._isChangingVisibility) { return; }

		// another tab might be select if user decides to stay on a page when a onclose confirmation prompts.
		GroupItems.removeHiddenGroups();

		// We need to set this after removing the hidden groups because doing so might show prompts which will cause us to be called again,
		// and we'd get stuck if we prevent re-entrancy before doing that.
		this._isChangingVisibility = true;

		TabItems.pausePainting();

		this._reorderTabsOnHide.forEach(function(groupItem) {
			groupItem.reorderTabsBasedOnTabItemOrder();
		});
		this._reorderTabsOnHide = [];

		gTabViewDeck.selectedPanel = gBrowserPanel;
		gWindow.TabsInTitlebar.allowedBy("tabview-open", true);
		gBrowser.selectedBrowser.focus();

		gBrowser.updateTitlebar();
		gBrowser.tabContainer.mTabstrip.smoothScroll = this._originalSmoothScroll;
		if(DARWIN) {
			this.setTitlebarColors(false);
		}

		this._isChangingVisibility = false;

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

	// Adds handlers to handle tab actions.
	_addTabActionHandlers: function() {
		// session restore events
		this.handleSSWindowStateBusy = () => {
			this.storageBusy();
		}

		this.handleSSWindowStateReady = () => {
			this.storageReady();
		}

		Listeners.add(gWindow, "SSWindowStateBusy", this);
		Listeners.add(gWindow, "SSWindowStateReady", this);

		// TabOpen
		this._eventListeners.open = (e) => {
			let tab = e.target;

			// if it's an app tab, add it to all the group items
			if(tab.pinned) {
				GroupItems.addAppTab(tab);
			} else if(this.isTabViewVisible() && !this._storageBusyCount) {
				this._lastOpenedTab = tab;
			}
		};

		// TabClose
		this._eventListeners.close = (e) => {
			let tab = e.target;

			// if it's an app tab, remove it from all the group items
			if(tab.pinned) {
				GroupItems.removeAppTab(tab);
			}

			if(this.isTabViewVisible()) {
				// just closed the selected tab in the TabView interface.
				if(this._currentTab == tab) {
					this._closedSelectedTabInTabView = true;
				}
			} else {
				// If we're currently in the process of session store update, we don't want to go to the Tab View UI.
				if(this._storageBusy) { return; }

				// if not closing the last tab
				if(gBrowser.tabs.length > 1) {
					// Don't return to TabView if there are any app tabs
					for(let a = 0; a < gBrowser._numPinnedTabs; a++) {
						if(Utils.isValidXULTab(gBrowser.tabs[a])) { return; }
					}

					let groupItem = GroupItems.getActiveGroupItem();

					// 1) Only go back to the TabView tab when there you close the last tab of a groupItem.
					let closingLastOfGroup = (groupItem && groupItem._children.length == 1 && groupItem._children[0].tab == tab);

					// 2) When a blank tab is active while restoring a closed tab the blank tab gets removed.
					// The active group is not closed as this is where the restored tab goes. So do not show the TabView.
					let tabItem = tab && tab._tabViewTabItem;
					let closingBlankTabAfterRestore = (tabItem && tabItem.isRemovedAfterRestore);

					if(closingLastOfGroup && !closingBlankTabAfterRestore) {
						// for the tab focus event to pick up.
						this._closedLastVisibleTab = true;
						this.showTabView();
					}
				}
			}
		};

		// TabMove
		this._eventListeners.move = (e) => {
			let tab = e.target;

			if(GroupItems.groupItems.length > 0) {
				if(tab.pinned) {
					if(gBrowser._numPinnedTabs > 1) {
						GroupItems.arrangeAppTab(tab);
					}
				} else {
					let activeGroupItem = GroupItems.getActiveGroupItem();
					if(activeGroupItem) {
						this.setReorderTabItemsOnShow(activeGroupItem);
					}
				}
			}
		};

		// TabSelect
		this._eventListeners.select = (e) => {
			this.onTabSelect(e.target);
		};

		// TabPinned
		this._eventListeners.pinned = function(e) {
			let tab = e.target;

			TabItems.handleTabPin(tab);
			GroupItems.addAppTab(tab);
		};

		// TabUnpinned
		this._eventListeners.unpinned = (e) => {
			let tab = e.target;

			TabItems.handleTabUnpin(tab);
			GroupItems.removeAppTab(tab);

			let groupItem = tab._tabViewTabItem.parent;
			if(groupItem) {
				this.setReorderTabItemsOnShow(groupItem);
			}
		};

		// Actually register the above handlers
		for(let name in this._eventListeners) {
			AllTabs.register(name, this._eventListeners[name]);
		}
	},

	// Removes handlers to handle tab actions.
	_removeTabActionHandlers: function() {
		for(let name in this._eventListeners) {
			AllTabs.unregister(name, this._eventListeners[name]);
		}
	},

	// Selects the given xul:tab in the browser.
	goToTab: function(xulTab) {
		// If it's not focused, the onFocus listener would handle it.
		if(xulTab.selected) {
			this.onTabSelect(xulTab);
		} else {
			gBrowser.selectedTab = xulTab;
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

			this.hideTabView();
		}

		// another tab might be selected when hideTabView() is invoked so a validation is needed.
		if(this._currentTab != tab) { return; }

		let newItem = null;

		// update the tab bar for the new tab's group
		if(tab && tab._tabViewTabItem) {
			if(!TabItems.reconnectingPaused()) {
				newItem = tab._tabViewTabItem;
				GroupItems.updateActiveGroupItemAndTabBar(newItem);
			}
		} else {
			// No tabItem; must be an app tab. Base the tab bar on the current group.
			// If no current group, figure it out based on what's already in the tab bar.
			if(!GroupItems.getActiveGroupItem()) {
				for(let a = 0; a < gBrowser.tabs.length; a++) {
					let theTab = gBrowser.tabs[a];
					if(!theTab.pinned) {
						let tabItem = theTab._tabViewTabItem;
						this.setActive(tabItem.parent);
						break;
					}
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
			let index = this._reorderTabsOnHide.indexOf(groupItem);
			if(index == -1) {
				this._reorderTabsOnHide.push(groupItem);
			}
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
		let exitButton = $("exit-button");
		let numberOfGroups = GroupItems.groupItems.length;

		setAttribute(exitButton, "groups", numberOfGroups);
		gTabView.updateGroupNumberBroadcaster(numberOfGroups);
	},

	// Convenience function to get the next tab closest to the entered position
	getClosestTab: function(tabCenter) {
		let cl = null;
		let clDist;
		TabItems.getItems().forEach(function(item) {
			if(!item.parent || item.parent.hidden) { return; }

			let testDist = tabCenter.distance(item.bounds.center());
			if(cl==null || testDist < clDist) {
				cl = item;
				clDist = testDist;
			}
		});
		return cl;
	},

	// Sets up the allowed browser keys using key elements.
	_setupBrowserKeys: function() {
		let keys = {};

		let keyArray = [ "newNavigator", "newNavigatorTab", "undo", "cut", "copy", "paste", "selectAll", "find" ];
		if(DARWIN) {
			keyArray.push("preferencesCmdMac", "minimizeWindow", "hideThisAppCmdMac");
		}
		if(!WINNT) {
			keyArray.push("quitApplication");
		} else {
			keyArray.push("redo");
		}
		keyArray.forEach(function(key) {
			let element = gWindow.document.getElementById("key_" + key);
			let code = element.getAttribute("key").toLocaleLowerCase().charCodeAt(0);
			keys[code] = key;
		});
		this._browserKeys = keys;

		keys = {};
		// The lower case letters are passed to processBrowserKeys() even with shift key when stimulating a key press using EventUtils.synthesizeKey()
		// so need to handle both upper and lower cases here.
		keyArray = [ "closeWindow", "undoCloseTab", "undoCloseWindow" ];
		if(!WINNT) {
			keyArray.push("redo");
			if(DARWIN) {
				keyArray.push("fullScreen");
			}
		}
		keyArray.forEach(function(key) {
			let element = gWindow.document.getElementById("key_" + key);
			let code = element.getAttribute("key").toLocaleLowerCase().charCodeAt(0);
			keys[code] = key;
		});
		this._browserKeysWithShift = keys;
	},

	// Sets up the key handlers for navigating between tabs within the TabView UI.
	_setTabViewFrameKeyHandlers: function() {
		this._setupBrowserKeys();

		iQ(window).keyup(function(e) {
			if(!e.metaKey) {
				Keys.meta = false;
			}
		});

		iQ(window).keypress((e) => {
			if(e.metaKey) {
				Keys.meta = true;
			}

			let processBrowserKeys = (e) => {
				// let any keys with alt to pass through
				if(e.altKey) { return; }

				// make sure our keyboard shortcut also works to toggle out of tab view
				if(Keysets.isRegistered(tabViewKey)) {
					let keycode = Keysets.translateToConstantCode(tabViewKey.keycode);
					if(e[keycode] && e[keycode] == e.which
					&& tabViewKey.shift == e.shiftKey
					&& tabViewKey.alt == e.altKey
					&& tabViewKey.accel == (DARWIN ? e.metaKey : e.ctrlKey)) {
						return;
					}
				}

				if((DARWIN && e.metaKey) || (!DARWIN && e.ctrlKey)) {
					let preventDefault = true;
					if(e.shiftKey) {
						// when a user presses ctrl+shift+key, upper case letter charCode is passed to processBrowserKeys() so converting back to lower
						// case charCode before doing the check
						let lowercaseCharCode = String.fromCharCode(e.charCode).toLocaleLowerCase().charCodeAt(0);
						if(this._browserKeysWithShift.lowercaseCharCode !== undefined) {
							let key = this._browserKeysWithShift[lowercaseCharCode];
							if(key == "tabview") {
								this.exit();
							} else {
								preventDefault = false;
							}
						}
					} else if(e.charCode in this._browserKeys) {
						let key = this._browserKeys[e.charCode];
						if(key == "find") {
							this.enableSearch();
						} else {
							preventDefault = false;
						}
					}
					if(preventDefault) {
						e.stopPropagation();
						e.preventDefault();
					}
				}
			};

			let focused = iQ(":focus");
			if((focused.length && focused[0].nodeName == "input") || Search.isEnabled() || this.ignoreKeypressForSearch) {
				this.ignoreKeypressForSearch = false;
				processBrowserKeys(e);
				return;
			}

			let getClosestTabBy = (norm) => {
				if(!this.getActiveTab()) {
					return null;
				}

				let activeTab = this.getActiveTab();
				let activeTabGroup = activeTab.parent;
				let myCenter = activeTab.bounds.center();
				let match;

				TabItems.getItems().forEach(function(item) {
					if(!item.parent.hidden && (!activeTabGroup.expanded || activeTabGroup.id == item.parent.id)) {
						let itemCenter = item.bounds.center();

						if(norm(itemCenter, myCenter)) {
							let itemDist = myCenter.distance(itemCenter);
							if(!match || match[0] > itemDist) {
								match = [itemDist, item];
							}
						}
					}
				});

				return match && match[1];
			};

			let preventDefault = true;
			let activeTab;
			let activeGroupItem;
			let norm = null;
			switch(e.keyCode) {
				case e.DOM_VK_RIGHT:
					norm = function(a, me) { return a.x > me.x };
					break;

				case e.DOM_VK_LEFT:
					norm = function(a, me) { return a.x < me.x };
					break;

				case e.DOM_VK_DOWN:
					norm = function(a, me) { return a.y > me.y };
					break;

				case e.DOM_VK_UP:
					norm = function(a, me) { return a.y < me.y }
					break;
			}

			if(norm != null) {
				let nextTab = getClosestTabBy(norm);
				if(nextTab) {
					if(nextTab.isStacked && !nextTab.parent.expanded) {
						nextTab = nextTab.parent.getChild(0);
					}
					this.setActive(nextTab);
				}
			} else {
				switch(e.keyCode) {
					case e.DOM_VK_ESCAPE:
						activeGroupItem = GroupItems.getActiveGroupItem();
						if(activeGroupItem && activeGroupItem.expanded) {
							activeGroupItem.collapse();
						} else {
							this.exit();
						}
						break;

					case e.DOM_VK_RETURN:
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

					case e.DOM_VK_TAB:
						// tab/shift + tab to go to the next tab.
						activeTab = this.getActiveTab();
						if(activeTab) {
							let tabItems = (activeTab.parent ? activeTab.parent.getChildren() : [activeTab]);
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
			}
		});
	},

	// Enables the search feature.
	enableSearch: function() {
		if(!Search.isEnabled()) {
			Search.ensureShown();
			Search.switchToInMode();
		}
	},

	// Called in response to a mousedown in empty space in the TabView UI; creates a new groupItem based on the user's drag.
	_createGroupItemOnDrag: function(e) {
		let minSize = 60;
		let minMinSize = 15;

		let lastActiveGroupItem = GroupItems.getActiveGroupItem();

		let startPos = { x: e.clientX, y: e.clientY };
		let phantom = iQ("<div>")
			.addClass("groupItem phantom activeGroupItem dragRegion")
			.css({
				position: "absolute",
				zIndex: -1,
				cursor: "default"
			})
			.appendTo("body");

		// a faux-Item
		let item = {
			container: phantom,
			isAFauxItem: true,
			bounds: {},
			getBounds: function() {
				return this.container.bounds();
			},
			setBounds: function(bounds) {
				this.container.css(bounds);
			},
			setZ: function(z) {
				// don't set a z-index because we want to force it to be low.
			},
			setOpacity: function(opacity) {
				this.container.css("opacity", opacity);
			},
			// we don't need to pushAway the phantom item at the end, because when we create a new GroupItem, it'll do the actual pushAway.
			pushAway: function() {},
		};
		item.setBounds(new Rect(startPos.y, startPos.x, 0, 0));

		let dragOutInfo = new Drag(item, e);

		let updateSize = function(e) {
			let box = new Rect();
			box.left = Math.min(startPos.x, e.clientX);
			box.right = Math.max(startPos.x, e.clientX);
			box.top = Math.min(startPos.y, e.clientY);
			box.bottom = Math.max(startPos.y, e.clientY);
			item.setBounds(box);

			// compute the stationaryCorner
			let stationaryCorner = "";

			if(startPos.y == box.top) {
				stationaryCorner += "top";
			} else {
				stationaryCorner += "bottom";
			}

			if(startPos.x == box.left) {
				stationaryCorner += "left";
			} else {
				stationaryCorner += "right";
			}

			dragOutInfo.snap(stationaryCorner, false, false); // null for ui, which we don't use anyway.

			box = item.getBounds();
			if(box.width > minMinSize && box.height > minMinSize && (box.width > minSize || box.height > minSize)) {
				item.setOpacity(1);
			} else {
				item.setOpacity(0.7);
			}

			e.preventDefault();
		};

		let collapse = () => {
			let center = phantom.bounds().center();
			phantom.animate({
				width: 0,
				height: 0,
				top: center.y,
				left: center.x
			}, {
				duration: 300,
				complete: function() {
					phantom.remove();
				}
			});
			this.setActive(lastActiveGroupItem);
		};

		let finalize = (e) => {
			iQ(window).unbind("mousemove", updateSize);
			item.container.removeClass("dragRegion");
			dragOutInfo.stop();
			let box = item.getBounds();
			if(box.width > minMinSize && box.height > minMinSize && (box.width > minSize || box.height > minSize)) {
				let opts = { bounds: item.getBounds(), focusTitle: true };
				let groupItem = new GroupItem([], opts);
				this.setActive(groupItem);
				phantom.remove();
				dragOutInfo = null;
			} else {
				collapse();
			}
		}

		iQ(window).mousemove(updateSize)
		iQ(gWindow).one("mouseup", finalize);
		e.preventDefault();
		return false;
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
		let newPageBounds = Items.getPageBounds();
		if(newPageBounds.equals(oldPageBounds)) { return; }

		if(!this.shouldResizeItems()) { return; }

		let items = Items.getTopLevelItems();

		// compute itemBounds: the union of all the top-level items' bounds.
		let itemBounds = new Rect(this._pageBounds);
		// We start with pageBounds so that we respect the empty space the user has left on the page.
		itemBounds.width = 1;
		itemBounds.height = 1;
		items.forEach(function(item) {
			let bounds = item.getBounds();
			itemBounds = (itemBounds ? itemBounds.union(bounds) : new Rect(bounds));
		});

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
		items.forEach((item) => {
			let bounds = item.getBounds();
			bounds.left += (UI.rtl ? -1 : 1) * (newPageBounds.left - this._pageBounds.left);
			bounds.left *= scale;
			bounds.width *= scale;

			bounds.top += newPageBounds.top - this._pageBounds.top;
			bounds.top *= scale;
			bounds.height *= scale;

			pairs.push({
				item: item,
				bounds: bounds
			});
		});

		Items.unsquish(pairs);

		pairs.forEach(function(pair) {
			pair.item.setBounds(pair.bounds, true);
			pair.item.snap();
		});

		this._pageBounds = Items.getPageBounds();
		this._save();
	},

	// Returns whether we should resize the items on the screen, based on whether the top-level items fit in the screen or not and whether they feel "cramped" or not.
	// These computations may be done using cached values. The cache can be cleared with UI.clearShouldResizeItems().
	shouldResizeItems: function() {
		let newPageBounds = Items.getPageBounds();

		// If we don't have cached cached values...
		if(this._minimalRect === undefined || this._feelsCramped === undefined) {
			// Loop through every top-level Item for two operations:
			// 1. check if it is feeling "cramped" due to squishing (a technical term),
			// 2. union its bounds with the minimalRect
			let feelsCramped = false;
			let minimalRect = new Rect(0, 0, 1, 1);

			Items.getTopLevelItems().forEach(function(item) {
				let bounds = new Rect(item.getBounds());
				feelsCramped = feelsCramped || (item.userSize && (item.userSize.x > bounds.width || item.userSize.y > bounds.height));
				bounds.inset(-Trenches.defaultRadius, -Trenches.defaultRadius);
				minimalRect = minimalRect.union(bounds);
			});

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

		if(Search.isEnabled()) {
			let matcher = Search.createSearchTabMatcher();
			let matches = matcher.matched();

			if(matches.length > 0) {
				matches[0].zoomIn();
				zoomedIn = true;
			}
			Search.hide();
		}

		if(zoomedIn) { return; }

		let unhiddenGroups = GroupItems.groupItems.filter(function(groupItem) {
			return (!groupItem.hidden && groupItem.getChildren().length > 0);
		});

		// no pinned tabs and no visible groups: open a new group. open a blank tab and return
		if(!unhiddenGroups.length) {
			let emptyGroups = GroupItems.groupItems.filter(function(groupItem) {
				return (!groupItem.hidden && !groupItem.getChildren().length);
			});
			let group = (emptyGroups.length ? emptyGroups[0] : GroupItems.newGroup());
			if(!gBrowser._numPinnedTabs) {
				group.newTab(null, { closedLastTab: true });
				return;
			}
		}

		// If there's an active TabItem, zoom into it. If not (for instance when the selected tab is an app tab), just go there.
		let activeTabItem = this.getActiveTab();
		if(!activeTabItem) {
			let tabItem = gBrowser.selectedTab._tabViewTabItem;
			if(tabItem) {
				if(!tabItem.parent || !tabItem.parent.hidden) {
					activeTabItem = tabItem;
				} else {
					// set active tab item if there is at least one unhidden group
					if(unhiddenGroups.length) {
						activeTabItem = unhiddenGroups[0].getActiveTab();
					}
				}
			}
		}

		if(activeTabItem) {
			activeTabItem.zoomIn();
		} else {
			if(gBrowser._numPinnedTabs > 0) {
				if(gBrowser.selectedTab.pinned) {
					this.goToTab(gBrowser.selectedTab);
				} else {
					Array.some(gBrowser.tabs, (tab) => {
						if(tab.pinned) {
							this.goToTab(tab);
							return true;
						}
						return false
					});
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
			this.sessionRestoreNotice.hidden = (Prefs.page == 3);
			this.sessionRestorePrivate.hidden = true;
		}
		else {
			// In private windows it's expected of the groups to be gone after closing it, so the warning is really more of a notice.
			this.tempShowBanner(this.sessionRestorePrivate);
			this.sessionRestoreNotice.hidden = true;
		}
	},

	// Enables automatic session restore when the browser is started. Does nothing if we already did that once in the past.
	enableSessionRestore: function() {
		if(Prefs.pageAutoChanged) { return; }
		Prefs.pageAutoChanged = true;

		// enable session restore if necessary
		if(Prefs.page != 3) {
			pageWatch.enableSessionRestore();

			// Notify the user that session restore has been automatically enabled by showing a banner that expects no user interaction. It fades out after some seconds.
			this.tempShowBanner(this.sessionRestoreAutoChanged);
		}
	},

	tempShowBanner: function(banner, duration) {
		if(!duration) {
			duration = 5000;
		}

		let ontransitionend = function() {
			if(trueAttribute(banner, 'show')) {
				Timers.init("tempShowBanner", function() {
					removeAttribute(banner, 'show');
				}, duration);
			} else {
				banner.hidden = true;
				Listeners.remove(banner, 'transitionend', ontransitionend);
			}
		};

		Listeners.add(banner, 'transitionend', ontransitionend);
		banner.hidden = false;

		// force reflow before setting the show attribute, so it animates
		banner.clientTop;

		setAttribute(banner, 'show', 'true');
	}
};

Modules.LOADMODULE = function() {
	UI.init();
};

Modules.UNLOADMODULE = function() {
	UI.uninit();
};
