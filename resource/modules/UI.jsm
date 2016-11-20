/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.3.58

// Used to scroll groups automatically, for instance when dragging a tab over a group's overflown edges.
this.Synthesizer = {
	_utils: null,
	get utils() {
		if(!this._utils) {
			this._utils = window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
		}
		return this._utils;
	},

	flipWheel: function(e) {
		try {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();

			// This doesn't work a lot of time, I don't fully understand why, it seems like it's because the synthesized event
			// fires before our cancelled event has finished, which interferes with the synthesized event actually acting;
			// it does fire and is caught by the handlers though, it just doesn't scroll the element.
			//this.utils.sendWheelEvent(e.clientX, e.clientY, e.deltaY, e.deltaX, e.deltaZ, window.WheelEvent.DOM_DELTA_LINE, 0, e.deltaY, e.deltaX, 0);

			// So instead we're "scrolling manually"... Ugh...

			// Which direction are we scrolling?
			let delta = e.deltaY;
			if(!delta) { return; }
			delta = (delta < 0) ? -1 : 1;

			let el = UI.groupSelector;

			// If the group at the edge is already fully visible, show the next one.
			let shift = UICache.groupSelectorSize;

			// What's visible at the edge of the box? If it's only a partial group, show it fully.
			if(LTR) {
				if(delta > 0) {
					if(el.scrollLeft == el.scrollLeftMax) { return; }
					let fullWidth = (el.clientWidth + el.scrollLeft);
					let partial = fullWidth % UICache.groupSelectorSize;
					shift = UICache.groupSelectorSize - partial;
				}
				else {
					if(el.scrollLeft == el.scrollLeftMin) { return; }
					let fullWidth = el.scrollLeft;
					let partial = fullWidth % UICache.groupSelectorSize;
					if(partial) {
						shift = partial;
					}
				}
			}
			else {
				if(delta > 0) {
					if(el.scrollLeft == el.scrollLeftMin) { return; }
					let fullWidth = (el.clientWidth - el.scrollLeft);
					let partial = fullWidth % UICache.groupSelectorSize;
					shift = UICache.groupSelectorSize - partial;
				}
				else {
					if(el.scrollLeft == el.scrollLeftMax) { return; }
					let fullWidth = 0 - el.scrollLeft;
					let partial = fullWidth % UICache.groupSelectorSize;
					if(partial) {
						shift = partial;
					}
				}
				delta = 0 - delta;
			}

			shift *= delta;
			el.scrollLeft += shift;
		}
		// We really only care about not blocking anything else that is supposed to run.
		catch(ex) { Cu.reportError(ex); }
	},

	scroll: function(mouse, deltaX, deltaY) {
		try {
			this.utils.sendWheelEvent(mouse.x, mouse.y, deltaX, deltaY, 0, window.WheelEvent.DOM_DELTA_LINE, 0, deltaX, deltaY, 0);
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

	// Set when selecting a pinned tab from search, but without leaving tab view.
	_dontHideTabView: false,

	// If true, a select tab has just been closed in TabView.
	_closedSelectedTabInTabView: false,

	// If true, a closed tab has just been restored.
	restoredClosedTab: false,

	// Tracks whether we're currently in the process of showing/hiding the tabview.
	_isChangingVisibility: false,

	// Keeps track of the <GroupItem>s which their tab items' tabs have been moved and re-orders the tab items when switching to TabView.
	_reorderTabItemsOnShow: new Set(),

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

	// Browser keys that shouldn't follow through when user is typing anywhere.
	_browserKeysNotInInput: null,

	// Used to keep track of the last opened tab.
	_lastOpenedTab: null,

	// Used to keep track of the tab strip smooth scroll value.
	_originalSmoothScroll: null,

	// Sensitivity in pixels of the area reactive to dragging a tab that will cause the group to scroll.
	scrollAreaSize: 15,

	// has the user clicked the close button in the notice in this window already
	_noticeDismissed: false,

	// To enable context menus on a delay when entering tab view, so it doesn't conflict with FireGestures.
	_contextMenusEnabled: false,

	// For the thumbnails ratio, set every time we enter tab view and the window is resized while in tab view.
	_viewportRatio: 1,

	get classic() { return Prefs.displayMode == 'classic'; },
	get grid() { return Prefs.displayMode == 'grid'; },
	get single() { return Prefs.displayMode == 'single'; },

	get groupSelector() { return $('groupSelector'); },

	get sessionRestoreNotice() { return $('sessionRestoreNotice'); },
	get sessionRestoreNoticeClose() { return $('sessionRestoreNoticeClose'); },
	get sessionRestoreAutoChanged() { return $('sessionRestoreAutoChanged'); },
	get sessionRestorePrivate() { return $('sessionRestorePrivate'); },

	get exitBtn() { return $("exit-button"); },
	get optionsBtn() { return $("optionsbutton"); },
	get helpBtn() { return $("helpbutton"); },
	get singleBtn() { return $("singlebutton"); },
	get gridBtn() { return $("gridbutton"); },
	get classicBtn() { return $("classicbutton"); },
	get gridNewGroupBtn() { return $("gridNewGroup"); },
	get singleNewGroupBtn() { return $("singleNewGroup"); },

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
						if(e.target != element && this.isTextField(element)) {
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
						// If Session Manager is enabled, we don't dare mess with its preferences.
						// Changing its settings is better done through SM's own options window.
						if(pageWatch.SM) {
							gSessionManager.openOptions();
							break;
						}

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

					case this.singleBtn:
						Prefs.displayMode = 'single';
						break;

					case this.singleNewGroupBtn:
						this.setActive(GroupItems.newGroup());

						// When creating a new group through the top plus button, it should stay visible.
						this.scrollSelectorsToEnd();
						break;

					case this.gridNewGroupBtn:
						this.setActive(GroupItems.newGroup());
						break;
				}
				break;

			case 'dragover':
				if(DraggingTab) {
					if(e.target == GroupItems.workSpace || e.target == this.gridNewGroupBtn) {
						DraggingTab.canDrop(e, e.target);
					}
					else if(e.target == this.groupSelector || e.target.parentNode == this.groupSelector) {
						if(e.target.parentNode == this.groupSelector) {
							DraggingTab.canDrop(e, e.target);
						}
						UI.scrollAreaWhileDragging(e, this.groupSelector);
					}
				}
				else if(DraggingGroup && this.grid && document.body.classList.contains('groups-overflowing')) {
					UI.scrollAreaWhileDragging(e, GroupItems.workSpace);
				}
				else if(DraggingGroupSelector && (e.target == this.groupSelector || e.target.parentNode == this.groupSelector)) {
					DraggingGroupSelector.canDrop(e);
					UI.scrollAreaWhileDragging(e, this.groupSelector);
				}
				break;

			case 'wheel':
				// When scrolling the group selector area, we want it to always go sideways.
				if(!e.deltaX) {
					// Sometimes this works, sometimes it doesn't... I don't know...
					Synthesizer.flipWheel(e);
				}
				break;

			case 'contextmenu':
				if(!this._contextMenusEnabled) { break; }

				// When right-clicking a group title, we're actually right-clicking its shield if the cursor isn't already there.
				// So we focus it now and pretend like it was already focused.
				if(e.target.classList.contains('title-shield')) {
					e.target._item.focusTitle();
					gTabView.openInputContextMenu(e);
				}
				// On input fields we should show the input context menu (duh).
				else if(this.isTextField(e.target)) {
					gTabView.openInputContextMenu(e);
				}
				else {
					// There's nothing to do if we're not in main groups view.
					if(Search.inSearch || GroupOptionsUI.activeOptions) { break; }

					let tab = null;
					let group = null;
					let node = null;

					// User could have pressed the context menu button in the keyboard, in which case the tab should be the currently active tab or group.
					if(!e.button) {
						let item = this.getActiveTab() || PinnedItems._activeItem || GroupItems.getActiveGroupItem();
						if(item) {
							if(!item.isAGroupItem) {
								tab = item.tab;
							} else {
								group = item;
							}
							node = item.container;
						}
					}
					else {
						node = e.target;
						while(node) {
							if(node.isAnAppItem) {
								tab = node.tab;
								break;
							}
							else if(node._item) {
								if(node._item.isATabItem) {
									tab = node._item.tab;
									break;
								}
								else if(node._item.isAGroupItem) {
									group = node._item;
									break;
								}
							}
							else if(node.classList && node.classList.contains('expandedTray')) {
								group = node._groupItem;
								break;
							}
							node = node.parentNode;
						}
					}

					if(tab) {
						// Pause rendering of thumbs until the menu is shown, to speed things up.
						TabItems.pausePainting();

						// Make this the active group item and update the tab bar accordingly immediately,
						// since some of the context menu's items will need to act on an updated tab bar.
						this.updateShownTabs(tab);
						this.reorderTabsBasedOnTabItemOrder();
						gTabView.openTabContextMenu(e, tab, node);

						// We can continue painting thumbs once this is all done.
						TabItems.resumePainting();
					}
					// We right-clicked a group.
					else if(group) {
						gTabView.openGroupContextMenu(e, group);
					}
				}
				break;

			case 'command':
				switch(e.target) {
					case gTabView.groupContextNewTab:
						gTabView.groupContextMenu._anchorItem.newTab();
						break;
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

				let groupItem = GroupItems.getActiveGroupItem();
				if(!groupItem) { return; } // This shouldn't happen under normal circumstances though.

				// We could have closed the last pinned tab as well.
				if(Tabs.numPinned) {
					// Open a new tab in the current group if closing the last pinned (and visible) tab.
					if(tab.pinned && Tabs.numPinned == 1 && !groupItem.children.length) {
						gTabView.onCloseLastTab(tab);
					}

					// Otherwise do nothing, at the very least the next pinned tab will be selected.
					return;
				}

				// Only open a new tab there when you close the last tab of a groupItem.
				if(groupItem.children.length == 1 && groupItem.children[0].tab == tab) {
					// When a blank tab is active while restoring a closed tab the blank tab gets removed.
					// The active group is not closed as this is where the restored tab goes. So do not open another new tab.
					if(!tab._tabViewTabItem || !tab._tabViewTabItem.isRemovedAfterRestore) {
						gTabView.onCloseLastTab(tab);
					}
				}
				break;
			}
			case 'TabMove':
				if(!tab.pinned && GroupItems.size) {
					let groupItem = tab._tabViewTabItem && tab._tabViewTabItem.parent;
					if(!groupItem) {
						groupItem = GroupItems.getActiveGroupItem();
					}
					if(groupItem) {
						if(!this.isTabViewVisible() || this._isChangingVisibility) {
							this.setReorderTabItemsOnShow(groupItem);
						} else {
							groupItem.reorderTabItemsBasedOnTabOrder();
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
		switch(aTopic) {
			case 'nsPref:changed':
				switch(aSubject) {
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

					case 'showGroupThumbs':
						this.toggleGroupThumbs();

						// When toggling this preference, we want to reaarange the groups, and ensure the group selector shows the placholder title if necessary.
						if(this.single) {
							this._resize(true);
							for(let groupItem of GroupItems) {
								groupItem.setTitle(groupItem.getTitle());
								groupItem.updateThumb();
							}
						}
						break;

					case 'gridDynamicSize':
						if(this.grid) {
							GroupItems.arrange();
						}
						break;

					case 'showTabCounter':
						document.body.classList[(Prefs.showTabCounter) ? 'add' : 'remove']('showTabCounter');
						break;

					case 'forceBrightText':
						this.attrWatcher();
						break;
				}
				break;

			case objName+'-darktheme-changed':
				this.useDarkTheme();
				break;

			case 'pageWatch-change':
				this.checkSessionRestore();
				break;
		}
	},

	handleSubscription: function(name, info) {
		switch(name) {
			case 'close':
				// info == tabItem
				this._onActiveTabClosed(info);
				break;
		}
	},

	attrWatcher(obj, attr) {
		let lwtheme = !Prefs.forceBrightText && (!gWindow.DevEdition || !gWindow.DevEdition.isThemeCurrentlyApplied) && trueAttribute(gWindow.document.documentElement, 'lwtheme');
		toggleAttribute(document.body, 'lwtheme', lwtheme);
		toggleAttribute(this.groupSelector, 'brighttext', lwtheme && trueAttribute(gWindow[objName].$('nav-bar'), 'brighttext'));
	},

	// Must be called after the object is created.
	init: function() {
		try {
			if(Storage.readWindowBusyState(gWindow)) {
				this.storageBusy();
			}

			let data = Storage.readUIData(gWindow) || {};
			this.storageSanity(data);
			this._pageBounds = data.pageBounds;

			// In case we end up saving UI data before a Search is run, we shouldn't just lose the save search position.
			Search._position = data.searchPosition;

			// Some things depend on the different FF versions.
			toggleAttribute(document.body, 'FF48', Services.vc.compare(Services.appinfo.version, "48.0a1") >= 0);
			toggleAttribute(document.body, 'FF50', Services.vc.compare(Services.appinfo.version, "50.0a1") >= 0);

			// Try to adapt to different lwthemes.
			Watchers.addAttributeWatcher(gWindow.document.documentElement, 'lwtheme', this, false, false);
			Watchers.addAttributeWatcher(gWindow[objName].$('nav-bar'), 'brighttext', this, false, false);
			Prefs.listen('forceBrightText', this);
			this.attrWatcher();

			Observers.add(this, objName+'-darktheme-changed');
			this.useDarkTheme();

			// ___ search
			Search.init();

			// ___ currentTab
			let selectedTab = Tabs.selected;
			this._currentTab = (selectedTab != gTabView._closedLastVisibleTab) ? selectedTab : null;

			Listeners.add(this.exitBtn, 'click', this);
			Listeners.add(this.optionsBtn, 'click', this);
			Listeners.add(this.helpBtn, 'click', this);
			Listeners.add(this.singleBtn, 'click', this);
			Listeners.add(this.gridBtn, 'click', this);
			Listeners.add(this.classicBtn, 'click', this);
			Listeners.add(this.gridNewGroupBtn, 'click', this);
			Listeners.add(this.singleNewGroupBtn, 'click', this);
			Listeners.add(gTabView.groupContextNewTab, 'command', this);

			// When you click on the background/empty part of TabView, we create a new groupItem.
			Listeners.add(GroupItems.workSpace, 'mousedown', this);
			Listeners.add(GroupItems.workSpace, 'dblclick', this);
			Listeners.add(GroupItems.workSpace, 'dragover', this);
			Listeners.add(this.groupSelector, 'wheel', this, true);
			Listeners.add(this.groupSelector, 'dragover', this);

			Messenger.listenWindow(gWindow, "DOMWillOpenModalDialog", this);

			// Initialize the UI with the correct mode from the start, the groups will take care of themselves as they're added.
			Prefs.listen('stackTabs', this);
			Prefs.listen('displayMode', this);
			Prefs.listen('showGroupThumbs', this);
			Prefs.listen('gridDynamicSize', this);
			Prefs.listen('showTabCounter', this);
			document.body.classList.add(Prefs.displayMode);
			if(Prefs.showGroupThumbs) {
				document.body.classList.add('showGroupThumbs');
			}
			if(Prefs.showTabCounter) {
				document.body.classList.add('showTabCounter');
			}

			// ___ setup key handlers
			this._setupBrowserKeys();
			Listeners.add(window, 'keyup', this);
			Listeners.add(window, 'keypress', this, true);
			Listeners.add(window, 'contextmenu', this);

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

			FavIcons.init();
			GroupItems.init();
			GroupItems.pauseArrange();
			let hasGroupItemsData = GroupItems.load();
			PinnedItems.init();
			TabItems.pausePainting();
			TabItems.init();

			if(!hasGroupItemsData) {
				this.reset();
			}

			// This is only here to avoid trouble if anything tries to use this var before it's been set with a real value.
			// (i.e. initialize it to '0' above and then something tries to use it as a divisor)
			this._viewportRatio = 0;

			// ___ resizing
			if(this._pageBounds) {
				this._resize(true);
			} else {
				this._pageBounds = this.getPageBounds(true);
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
		Listeners.remove(window, 'contextmenu', this);
		Listeners.remove(window, 'resize', this);
		Listeners.remove(gWindow, "SSWindowClosing", this);
		Listeners.remove(gWindow, "SSWindowStateBusy", this);
		Listeners.remove(gWindow, "SSWindowStateReady", this);
		Listeners.remove(this.sessionRestoreNotice, 'click', this);

		Listeners.remove(GroupItems.workSpace, 'mousedown', this);
		Listeners.remove(GroupItems.workSpace, 'dblclick', this);
		Listeners.remove(GroupItems.workSpace, 'dragover', this);
		Listeners.remove(this.groupSelector, 'wheel', this, true);
		Listeners.remove(this.groupSelector, 'dragover', this);

		Listeners.remove(this.exitBtn, 'click', this);
		Listeners.remove(this.optionsBtn, 'click', this);
		Listeners.remove(this.helpBtn, 'click', this);
		Listeners.remove(this.singleBtn, 'click', this);
		Listeners.remove(this.gridBtn, 'click', this);
		Listeners.remove(this.classicBtn, 'click', this);
		Listeners.remove(this.gridNewGroupBtn, 'click', this);
		Listeners.remove(this.singleNewGroupBtn, 'click', this);
		Listeners.remove(gTabView.groupContextNewTab, 'command', this);

		pageWatch.unregister(this);

		Messenger.unlistenWindow(gWindow, "DOMWillOpenModalDialog", this);
		Messenger.unloadFromWindow(gWindow, 'TabView');

		Watchers.removeAttributeWatcher(gWindow.document.documentElement, 'lwtheme', this, false, false);
		Watchers.removeAttributeWatcher(gWindow[objName].$('nav-bar'), 'brighttext', this, false, false);
		Prefs.unlisten('forceBrightText', this);

		Observers.remove(this, objName+'-darktheme-changed');

		// additional clean up
		GroupOptionsUI.hide();
		TabItems.uninit();
		PinnedItems.uninit();
		GroupItems.uninit();
		Search.uninit();
		FavIcons.uninit();

		Tabs.unlisten("TabOpen", this);
		Tabs.unlisten("TabClose", this);
		Tabs.unlisten("TabMove", this);
		Tabs.unlisten("TabSelect", this);
		Tabs.unlisten("TabPinned", this);
		Tabs.unlisten("TabUnpinned", this);

		Prefs.unlisten('stackTabs', this);
		Prefs.unlisten('displayMode', this);
		Prefs.unlisten('showGroupThumbs', this);
		Prefs.unlisten('gridDynamicSize', this);
		Prefs.unlisten('showTabCounter', this);

		this._currentTab = null;
		this._pageBounds = null;
		this._reorderTabItemsOnShow = new Set();
		this._reorderTabsOnHide = new Set();
		this._frameInitialized = false;
	},

	useDarkTheme: function() {
		toggleAttribute(document.body, 'darktheme', brightText.useDarkTheme());
	},

	goToPreferences: function(aOptions) {
		gTabView.goToPreferences(aOptions);

		// we can't very well see the preferences if we're still in tabview
		this.goToTab(Tabs.selected);
	},

	// Resets the Panorama view to have just one group with all tabs
	reset: function() {
		// (TMP) Reconnect tabs could have been disconnected in GroupItems.reconstitute.
		TabItems.resumeReconnecting();

		// Close any currently open groups to reset our main object.
		for(let group of GroupItems) {
			group.close();
		}
		GroupItems.nextID = 1;

		let padding = Trenches.defaultRadius;
		let welcomeWidth = 300;
		let pageBounds = GroupItems.getSafeWindowBounds();

		// ___ make a fresh groupItem
		let bounds = new Rect(pageBounds);
		bounds.width = Math.min(bounds.width * 0.667, pageBounds.width - (welcomeWidth + padding));
		bounds.height *= 0.667;
		if(RTL) {
			bounds.left = pageBounds.left + welcomeWidth + (2 * padding);
		}

		let options = { bounds, immediately: true };
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
		document.body.classList.remove('single');

		document.body.classList.add(Prefs.displayMode);
		this.toggleGroupThumbs();
		this._resize(true);

		try {
			GroupItems.pauseArrange();
			TabItems.pausePainting();

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
			TabItems.resumePainting();
		}
	},

	toggleGroupThumbs: function() {
		// don't bother
		if(!this.single) { return; }

		if(Prefs.showGroupThumbs) {
			document.body.classList.add('showGroupThumbs');
		} else {
			document.body.classList.remove('showGroupThumbs');
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
			this._activeTab.removeSubscriber("close", this);
		}

		this._activeTab = tabItem;

		if(this._activeTab) {
			this._activeTab.addSubscriber("close", this);
			this._activeTab.makeActive();

			// Make sure the pinned items reflect this change as well.
			// It won't actually select anything, rather it will unselect an item if it already is selected.
			PinnedItems.makeActive(tabItem.tab);

			// When setting a new active tab (i.e. when closing the previous active tab) TabView loses focus, probably because the physical tab gets it when it's "selected".
			// This prevents the keyboard from working correctly unless we refocus our TabView.
			this.focusTabView();
		}
	},

	// Handles when the currently active tab gets closed.
	// Parameters:
	//  - the <TabItem> that is closed
	_onActiveTabClosed: function(tabItem) {
		if(this._activeTab == tabItem) {
			this._setActiveTab(null);
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
				this._setActiveTab(activeTab);
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

	focusTabView: function() {
		Timers.init('focusTabView', () => {
			if(this.isTabViewVisible() && !this._isChangingVisibility) {
				window.focus();
			}
		}, 0);
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
		if(!tabItem.parent.overflowing && !tabItem.parent.noThumbs) { return; }

		tabItem.container.scrollIntoView();
	},

	// Returns a <Rect> defining the area of the page <Item>s should stay within.
	getPageBounds: function(real) {
		if(!real && this._pageBounds) {
			let rect = new Rect(this._pageBounds);
			rect.realTop = this._pageBounds.realTop;
			rect.realLeft = this._pageBounds.realLeft;
			return rect;
		}

		let top = 0;
		let left = 0;
		let width = window.innerWidth;
		let height = window.innerHeight;
		width -= UICache.actionsWidth;

		if(RTL) {
			left += UICache.actionsWidth;
		}

		if(UI.single) {
			let offset = UICache.groupSelectorSize + UICache.groupBorderWidth;
			height -= offset;
			top += offset;
		}
		width = Math.max(100, Math.floor(width));
		height = Math.max(100, Math.floor(height));

		let rect = new Rect(0, 0, width, height);
		rect.realTop = top;
		rect.realLeft = left;
		return rect;
	},

	// Screen ratio is unlikely to change -> significantly <- for the lifetime of this session.
	// However, it's best to try to have canvases always reflect the latest viewport ratio, so that thumbs are as accurate as possible;
	// otherwise they could only show a portion of the webpage.
	updateViewportRatio: function(arrangeGroups) {
		let viewportRatio;

		// If the user set a custom viewport ratio, use it.
		let override = Prefs.overrideViewportRatio;
		if(override) {
			try {
				let override = Prefs.overrideViewportRatio;
				if(override.indexOf("/") > -1) {
					let [ w, h ] = override.split("/").map(Number);
					viewportRatio = w / h;
				} else {
					viewportRatio = Number(override);
				}

				// The stored override value is not valid, so ignore it.
				if(!Utils.isNumber(viewportRatio)) {
					viewportRatio = 0;
				}
			}
			catch(ex) {
				// The stored override value is not valid, so ignore it.
				viewportRatio = 0;
			}
		}

		// Otherwise, find it from the web content area.
		if(!viewportRatio) {
			let wrongDims = false;
			let tab = Tabs.selected;

			// If we already have a valid previous ratio, don't update the ratio if the tab is in responsive mode or the devtools are open.
			// (Version restriction because the devtools were initialized differently before this,
			// and I don't feel adding backwards compatibility just for this is justified for ESR at this point.)
			if(Services.vc.compare(Services.appinfo.version, "47.0a1") >= 0) {
				wrongDims = gWindow.gDevToolsBrowser && gWindow.gDevToolsBrowser.hasToolboxOpened(gWindow);
				if(!wrongDims) {
					wrongDims = gWindow.ResponsiveUI && gWindow.ResponsiveUI.ResponsiveUIManager && gWindow.ResponsiveUI.ResponsiveUIManager.isActiveForTab(tab);
				}
			}

			if(wrongDims) {
				if(this._viewportRatio) { return; }

				// If we don't yet have a valid ratio, we "borrow" it from the dimensions of the browser panel, it's not perfect, but it'll do for now.
				let linkedPanel = gBrowser.getNotificationBox(tab.linkedBrowser);
				viewportRatio = linkedPanel.clientWidth / linkedPanel.clientHeight;
			}
			else {
				// Assume the dimensions of the currently active tab for the screen ratio. This is what thumbnails will represent after all.
				viewportRatio = gBrowser.mCurrentBrowser.clientWidth / gBrowser.mCurrentBrowser.clientHeight;
			}

			// Make sure the thumbnails don't become too stretched or too flat, they lose all their value if their contents can't be distinguished properly.
			// For example, in ultra wide screens, or with the devtools open, the thumbnails would be a very thin stretched image; hardly useful...
			// Don't use common screen ratios for comparison though, as we have to account for the space used by toolbars and stuff;
			// a 1:1 content ratio seems a good approximation for a 4:3 screen, and a 7:3 (21:9) content ratio seems a good approximation for a 16:9 screen;
			// but we should also account for vertical screens (i.e. tablets in portrait mode), a direct reverse 9:16 content ratio seems valid for a common 16:9 screen.
			// anything in between should adjust perfectly automatically.
			viewportRatio = Math.min(Math.max(9/16, viewportRatio), 7/3);
		}

		if(viewportRatio != this._viewportRatio) {
			this._viewportRatio = viewportRatio;

			// Update TabItems sizes and ratios.
			TabItems._updateRatios();

			if(arrangeGroups) {
				for(let groupItem of GroupItems) {
					groupItem.arrange();
				}
			}
		}
	},

	// See if the provided element should be scrolled while dragging the mouse over to its top or bottom edge.
	scrollAreaWhileDragging: function(e, element) {
		let mouse = new Point(e.clientX, e.clientY);
		let rect = element.getBoundingClientRect();
		let deltaX = 0;
		let deltaY = 0;

		if(element.scrollTopMax > 0) {
			let topArea = new Rect(rect.left, rect.top, rect.width, this.scrollAreaSize);
			let bottomArea = new Rect(rect.left, rect.top + rect.height - this.scrollAreaSize, rect.width, this.scrollAreaSize);

			if(topArea.contains(mouse)) {
				deltaY = -1;
			} else if(bottomArea.contains(mouse)) {
				deltaY = 1;
			}
		}

		if(element.scrollLeftMax > 0) {
			let leftArea = new Rect(rect.left, rect.top, this.scrollAreaSize, rect.height);
			let rightArea = new Rect(rect.left + rect.width - this.scrollAreaSize, rect.top, this.scrollAreaSize, rect.height);

			if(leftArea.contains(mouse)) {
				deltaX = -1;
			} else if(rightArea.contains(mouse)) {
				deltaX = 1;
			}
		}

		if(deltaX || deltaY) {
			Synthesizer.scroll(mouse, deltaX, deltaY);
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

			for(let groupItem of this._reorderTabItemsOnShow) {
				groupItem.reorderTabItemsBasedOnTabOrder();
			}

			gTabViewDeck.selectedPanel = gTabViewFrame;
			gWindow.TabsInTitlebar.allowedBy("tabview-open", false);
			window.focus();

			gBrowser.updateTitlebar();

			// Trick to make Ctrl+F4 and Ctrl+Shift+PageUp/PageDown shortcuts behave as expected in TabView,
			// we need to remove the gBrowser as a listener for these, otherwise it would consume these events and they would never reach our handler.
			this._els.removeSystemEventListener(gWindow.document, "keydown", gBrowser, false);

			let currentTab = this._currentTab;
			if(currentTab) {
				if(zoomOut && currentTab._tabViewTabItem) {
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
				else if(!currentTab._tabViewTabItem) {
					this.clearActiveTab();
				}
			}

			// Make sure tabs in all groups are rearranged as necessary (arranging is still paused, so this won't happen right away).
			// This won't repaint the canvases by itself though, only resizes the tabitems.
			// The canvases will be updated as they need to be as usual, so they may look distorted for a moment if the dimensions change.
			// (Canvases of background tabs can't be updated until those tabs send an actual repaint signal, because until then
			// the dimensions of those tabs won't reflect the actual viewport dimensions, and we end up with black/blank edges in the canvas.)
			this.updateViewportRatio(true);

			this._contextMenusEnabled = false;
			Timers.init('showTabView', () => {
				this._contextMenusEnabled = true;
			}, 50);
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

			this.reorderTabsBasedOnTabItemOrder();

			if(fulfill) {
				fulfill();
			}

			gTabViewDeck.selectedPanel = gBrowserPanel;
			gWindow.TabsInTitlebar.allowedBy("tabview-open", true);
			gBrowser.selectedBrowser.focus();

			gBrowser.updateTitlebar();
			gBrowser.tabContainer.mTabstrip.smoothScroll = this._originalSmoothScroll;

			this._els.addSystemEventListener(gWindow.document, "keydown", gBrowser, false);
		}
		catch(ex) {
			Cu.reportError(ex);
		}
		finally {
			this._isChangingVisibility = false;
			if(this.isTabViewVisible()) { return; }
		}

		// Ensure a heartbeat is started when leaving tabview, so that canvases from stale tabs are captured into imgs in the background, to save memory.
		TabItems.startHeartbeatHidden();

		dispatch(window, { type: "tabviewhidden", cancelable: false });
	},

	reorderTabsBasedOnTabItemOrder: function() {
		for(let groupItem of this._reorderTabsOnHide) {
			if(!groupItem.hidden && groupItem.container.parentNode) {
				groupItem.reorderTabsBasedOnTabItemOrder();
			}
		}
		this._reorderTabsOnHide = new Set();
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
		// Our placeholder tab (that opens when closing the last visible tab) was selected; ignore it.
		if(gTabView._closedLastVisibleTab === true || tab === gTabView._closedLastVisibleTab) {
			this._currentTab = null;

			// reset these vars as well, just in case.
			this._dontHideTabView = false;
			this._closedSelectedTabInTabView = false;
			this.closedLastTabInTabView = false;
			this.restoredClosedTab = false;
			this._lastOpenedTab = null;
			return;
		}

		this._currentTab = tab;
		TabItems.tabSelected(tab);

		if(this.isTabViewVisible()) {
			// We may want to select a pinned tab without leaving tab view.
			if(this._dontHideTabView) {
				this._dontHideTabView = false;
				if(tab.pinned) {
					this.clearActiveTab();
					PinnedItems.makeActive(tab);
				}

				// Sometimes keypresses stop working because focus goes who knows where...
				this.focusTabView();
				return;
			}

			// We want to zoom in if:
			// 1) we didn't just restore a tab via Ctrl+Shift+T
			// 2) the currently selected tab is the last created tab and has a tabItem
			if(!this.restoredClosedTab && this._lastOpenedTab == tab && tab._tabViewTabItem) {
				tab._tabViewTabItem.zoomIn(true);
				this._lastOpenedTab = null;
				return;
			}
			if((this._closedSelectedTabInTabView && !this.closedLastTabInTabView) || this.restoredClosedTab) {
				if(this.restoredClosedTab) {
					// when the tab view UI is being displayed, update the thumb for the restored closed tab after the page load
					let receiver = function() {
						Messenger.unlistenBrowser(tab.linkedBrowser, "documentLoaded", receiver);
						TabItems._update(tab);
					};
					Messenger.listenBrowser(tab.linkedBrowser, "documentLoaded", receiver);
					Messenger.messageBrowser(tab.linkedBrowser, "waitForDocumentLoad");
				}
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
		this._dontHideTabView = false;
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
				let theTab = Tabs.notPinned[Tabs.numPinned];
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
			this._reorderTabItemsOnShow.add(groupItem);
		}
	},

	updateTabButton: function() {
		// No need to do this every single time, as DOM operations can become expensive with multiple calls, especially dealing with broadcasters;
		// i.e. during startup when the groups are all created at once.
		if(!Timers.updateTabButton) {
			Timers.init('updateTabButton', () => {
				let numberOfGroups = GroupItems.size;

				setAttribute(this.exitBtn, "groups", numberOfGroups);
				gTabView.updateGroupNumberBroadcaster(numberOfGroups);
			}, 100);
		}
	},

	// Sets up the allowed browser keys using key elements.
	_setupBrowserKeys: function() {
		this._browserKeys = [];
		this._browserKeysNotInInput = new Set([
			"newNavigator", "closeWindow", "undoCloseWindow",
			"newNavigatorTab", "close", "closeNotMac", "undoCloseTab",
			"moveTabForward", "moveTabBackward", "moveTabToStart", "moveTabToEnd"
		]);

		let keyArray = [
			"newNavigator", "closeWindow", "undoCloseWindow",
			"newNavigatorTab", "close", "undoCloseTab",
			"undo", "redo", "cut", "copy", "paste",
			"selectAll", "find"
		];
		if(gWindow.gDevTools) {
			keyArray.push("browserConsole");
		}
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

				for(let k of this._browserKeys) {
					if(k.key == key && k.accel == accel && k.alt == alt && k.shift == shift) {
						if(input && this._browserKeysNotInInput.has(k.name)) { break; }

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

				// We cancel most shortcuts that shouldn't take place while TabView is shown.
				e.preventDefault();
				e.stopPropagation();
			}
		};

		let focusedNode = $$(":focus")[0];
		let inTextField = this.isTextField(focusedNode) && focusedNode != Search.searchquery;
		if(inTextField
		|| (Search.inSearch && (Prefs.searchMode == 'list' || !(new Set([ "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight" ])).has(e.key)))
		|| GroupOptionsUI.activeOptions) {
			processBrowserKeys(e, focusedNode);
			return;
		}

		// Finds what tab is closest to the active tab in the direction provided by the pressed arrow key.
		let getClosestBy = (norm) => {
			// The starting point is of course the active tab if it exists.
			let activeTab = this.getActiveTab();

			if(!activeTab) {
				// If there's no active tab, check if there's an expanded stacked group. If there is, return its first tab.
				for(let groupItem of GroupItems) {
					if(!groupItem.hidden && groupItem.expanded) {
						let topChild = groupItem.getTopChild();
						return topChild;
					}
				}

				// No group was expanded, so get the first tab/group in the list, because we have to start from somwehere.
				for(let groupItem of GroupItems) {
					if(!groupItem.hidden) {
						// If this group is stacked, return the group itself.
						if(groupItem.isStacked) {
							return groupItem;
						}

						// Otherwise return its first child if it has one.
						let topChild = groupItem.getTopChild();
						if(topChild) {
							return topChild;
						}
					}
				}

				// We have no active or available tabs to select.
				return null;
			}

			// Alright, we have an active tab, use the distance from its center point to another item's center point as a reference.
			// Don't forget to only check highlighted tabs if a search is active.
			let myCenter = activeTab.getBounds().center();
			let activeGroup = activeTab.parent;
			let siblings = new Map();

			// If we're in a stacked group and it's expanded, or if we're in single view, we only need to check tabs in this group.
			if(activeGroup.expanded || this.single) {
				for(let child of activeGroup.children) {
					if(Search.inSearch && !Search.matches.has(child)) { continue; }

					let itemCenter = child.getBounds().center();
					if(norm(itemCenter, myCenter)) {
						siblings.set(child, itemCenter);
					}
				}
			}

			// Otherwise, we need to compare with every tab item visible, or with every stacked group.
			else {
				for(let groupItem of GroupItems) {
					if(groupItem.hidden) { continue; }
					if(Search.inSearch && !Search.groupsWithMatches.has(groupItem)) { continue; }

					if(groupItem.isStacked) {
						let itemCenter = groupItem.getBounds().center();
						if(norm(itemCenter, myCenter)) {
							siblings.set(groupItem, itemCenter);
						}
						continue;
					}

					for(let child of groupItem.children) {
						if(Search.inSearch && !Search.matches.has(child)) { continue; }

						let itemCenter = child.getBounds().center();
						if(norm(itemCenter, myCenter)) {
							siblings.set(child, itemCenter);
						}
					}
				}
			}

			// Now that we have a list a distances, find the shortest one.
			let match;
			for(let [item, center] of siblings) {
				let distance = myCenter.distance(center);
				if(!match || match[0] > distance) {
					match = [distance, item];
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
			let nextTabOrGroup = getClosestBy(norm);
			if(nextTabOrGroup) {
				this.setActive(nextTabOrGroup);
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
				// ctrl+(shift+)tab to go to the next group.
				let accel = (DARWIN && e.metaKey) || (!DARWIN && e.ctrlKey);
				if(accel) {
					let nextGroupTab = GroupItems.getNextGroupItemTab(e.shiftKey);
					if(nextGroupTab) {
						UI.setActive(nextGroupTab);
					}
					break;
				}

				// (shift+)tab to go to the next tab.
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

			case " ":
				if(!e.ctrlKey && !e.metaKey && !e.shiftKey) {
					// Spacebar should expanded the active group if it's stacked.
					activeGroupItem = GroupItems.getActiveGroupItem();
					if(activeGroupItem && activeGroupItem.isStacked) {
						activeGroupItem.expand();
					}
					break;
				}
				// no break; continue to default

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

	isTextField: function(node) {
		return node && ((node.nodeName == "input" && node.getAttribute('type') == "text") || node.nodeName == "textarea");
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

		let oldPageBounds = this.getPageBounds();
		let newPageBounds = this.getPageBounds(true);
		if(newPageBounds.equals(oldPageBounds)) { return; }

		// Check to see if the viewport ratio also changed, in which case we also need to update the thumbs ratio.
		this.updateViewportRatio();

		if(!UI.classic) {
			this._pageBounds = newPageBounds;
			this._save();

			if(UI.grid) {
				// I can't do this on a delay (so it won't resize on every mousemove),
				// it becomes very jaggy, and... weird. Sometimes it won't even resize at all after stopping the mouse
				// for a while until moving it again.
				GroupItems.arrange(true);
			}
			// In single mode we only need to rearrange the tabs, the group will always be fully extended to occupy all the available space.
			else if(UI.single) {
				for(let groupItem of GroupItems) {
					groupItem.delayArrange(200);
				}
			}
			return;
		}

		// Classic mode...

		if(!this.shouldResizeItems(newPageBounds)) {
			this._pageBounds = newPageBounds;
			this._save();
			return;
		}

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
	shouldResizeItems: function(newPageBounds) {
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

	// Scrolls the plus button in the group selectors into view.
	scrollSelectorsToEnd: function() {
		if(LTR) {
			if(this.groupSelector.scrollLeftMax > this.groupSelector.scrollLeft) {
				this.groupSelector.scrollLeft = this.groupSelector.scrollLeftMax;
			}
		} else {
			if(this.groupSelector.scrollLeftMin < this.groupSelector.scrollLeft) {
				this.groupSelector.scrollLeft = this.groupSelector.scrollLeftMin;
			}
		}
	},

	// Exits TabView UI.
	exit: function() {
		if(Search.inSearch) {
			if(Search.currentItem) {
				Search.currentItem.zoomIn();
				return;
			}
			Search.hide();
		}

		let activeGroup = GroupItems.getActiveGroupItem();
		if(!activeGroup) {
			for(let groupItem of GroupItems) {
				if(!groupItem.hidden) {
					this.setActive(groupItem);
					activeGroup = groupItem;
					break;
				}
			}
		}

		// no pinned tabs and no visible groups: open a new group. open a blank tab and return
		if(!activeGroup && !Tabs.numPinned) {
			let newGroup = GroupItems.newGroup();
			newGroup.newTab(true);
			return;
		}

		let activeTabItem = this.getActiveTab();
		if(!activeTabItem) {
			let tabItem = Tabs.selected._tabViewTabItem;
			if(tabItem) {
				if(!tabItem.parent || !tabItem.parent.hidden) {
					activeTabItem = tabItem;
				}
				// set active tab item if there is at least one unhidden group
				else if(activeGroup) {
					activeTabItem = activeGroup.getActiveTab();
				}
			}
		}

		// If there's an active TabItem, zoom into it.
		if(activeTabItem) {
			activeTabItem.zoomIn();
		}

		// If not (for instance when the selected tab is an app tab), just go there.
		else if(Tabs.numPinned > 0) {
			if(Tabs.selected.pinned) {
				this.goToTab(Tabs.selected);
			} else {
				let tab = Tabs.pinned[0];
				if(tab) {
					this.goToTab(tab);
				}
			}
		}

		// If we have no active tab and no pinned tabs, open a new tab in the active unhidden group.
		else if(activeGroup) {
			activeGroup.newTab();
		}
	},

	// Given storage data for this object, returns true if it looks valid.
	storageSanity: function(data) {
		if(Utils.isEmptyObject(data)) {
			return true;
		}

		if(!Utils.isRect(data.pageBounds) || !Utils.isNumber(data.pageBounds.realTop) || !Utils.isNumber(data.pageBounds.realLeft)) {
			data.pageBounds = null;
			return false;
		}

		// Don't block when this isn't valid, just reset it and let the Search module take care of itself.
		if(!Utils.isPoint(data.searchPosition)) {
			data.searchPosition = null;
		}

		return true;
	},

	// Saves the data for this object to persistent storage
	_save: function() {
		if(!this._frameInitialized) { return; }

		let data = {
			pageBounds: this._pageBounds,
			searchPosition: Search._position
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
	_blackCanvases: new Map(),

	blackCanvas: function(aCanvas) {
		let w = aCanvas.width;
		let h = aCanvas.height;
		let id = w+'x'+h;
		let dataURL = this._blackCanvases.get(id);
		if(!dataURL) {
			let canvas = TabItems.canvasFragment();
			canvas.width = w;
			canvas.height = h;
			let ctx = canvas.getContext("2d");
			ctx.fillStyle = "rgb(0,0,0)";
			ctx.fillRect(0, 0, w, h);
			dataURL = canvas.toDataURL();
			this._blackCanvases.set(id, dataURL);
		}
		return dataURL;
	},

	ghost: function(aName, aLambda) {
		this.__defineGetter__(aName, () => {
			delete this[aName];
			return this[aName] = aLambda();
		});
	},

	init: function() {
		let style = getComputedStyle(document.documentElement);

		this.ghost('tabCanvasOffset', function() {
			return parseInt(style.getPropertyValue('--canvas-border-width')) *2;
		});

		this.ghost('groupBorderColor', function() {
			return style.getPropertyValue('--group-border-color');
		});

		this.ghost('groupSelectorSize', function() {
			return parseInt(style.getPropertyValue('--group-selector-size'));
		});

		this.ghost('groupSelectorCanvasSize', () => {
			return	this.groupSelectorSize
				- (parseInt(style.getPropertyValue('--group-selector-padding')) *2)
				- parseInt(style.getPropertyValue('--group-selector-title-height'));
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
			return parseInt(style.getPropertyValue('--group-border-width'));
		});

		this.ghost('groupContentsMargin', function() {
			let val = parseInt(style.getPropertyValue('--group-contents-margin'));
			let top = parseInt(style.getPropertyValue('--group-contents-top-margin'));
			return {
				x: val *2,
				y: val + top
			};
		});

		this.ghost('scrollbarWidth', function() {
			return parseInt(style.getPropertyValue('--scrollbar-width'));
		});

		this.ghost('actionsWidth', function() {
			return parseInt(style.getPropertyValue('--actions-width'));
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
