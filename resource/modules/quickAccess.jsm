/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.11

this.__defineGetter__('PanelUI', function() { return window.PanelUI; });

this.quickAccess = {
	get PanelUIBtn() { return $('PanelUI-menu-button'); },

	get panel() { return $(objName+'-quickaccess-panel'); },
	get panelContents() { return $(objName+'-quickaccess-panel-contents'); },
	get panelTextbox() { return $(objName+'-quickaccess-panel-find'); },

	get view() { return $(objName+'-quickaccess-panelView'); },
	get viewContents() { return $(objName+'-quickaccess-panelView-contents'); },
	get viewTextbox() { return $(objName+'-quickaccess-panelView-find'); },

	activePanel: null,
	contents: null,
	searchbox: null,
	openedPanelUI: false,
	items: [],
	currentItem: null,
	_lastSearch: null,

	handleEvent: function(e) {
		switch(e.type) {
			case 'popupshowing':
				if(e.target == this.panel) {
					this.activePanel = e.target;
					this.contents = this.panelContents;
					this.searchbox = this.panelTextbox;
					this.populateGroups();
				}
				break;

			case 'popupshown':
				if(e.target == this.panel) {
					this.searchbox.value = '';
					this.searchbox.focus();
				}
				break;

			case 'popuphidden':
				removeAttribute(TabView.button, 'open');
				break;

			case 'ViewShowing':
				if(e.target == this.view) {
					this.activePanel = e.target;
					this.contents = this.viewContents;
					this.searchbox = this.viewTextbox;

					this.searchbox.value = '';
					this.searchbox.focus();
					this.populateGroups();
				}
				break;

			case 'ViewHiding':
				if(e.target == this.view && this.openedPanelUI) {
					this.openedPanelUI = false;
					if(PanelUI.panel.state == 'open') {
						PanelUI.toggle();
					}
				}
				break;

			case 'keydown':
				this._onKeydown(e);
				break;

			case 'input':
				this.performSearch();
				break;
		}
	},

	_onKeydown: function(e) {
		switch(e.key) {
			case "Enter":
				e.preventDefault();
				e.stopPropagation();
				if(this.currentItem) {
					if(this.currentItem.classList.contains('quickaccess-groupbutton') && e.shiftKey) {
						this.currentItem.showTabs();
					} else {
						this.currentItem.zoomIn();
					}
				}
				break;

			case "Tab":
			case "ArrowDown":
			case "ArrowUp": {
				e.preventDefault();
				e.stopPropagation();
				let i = (this.currentItem) ? this.items.indexOf(this.currentItem) : -1;
				if(e.key == "ArrowDown" || (e.key == "Tab" && !e.shiftKey)) {
					i++;
					if(i >= this.items.length) {
						i = 0;
					}
				} else {
					i--;
					if(i < 0) {
						i = this.items.length -1;
					}
				}
				let item = this.items[i] || null;
				this.focusItem(item);

				// Make sure the item is in view. .scrollIntoView() just scrolls indiscriminately...
				// The +1 and -1 helps deal with borders.
				if(item) {
					let offsetTop = item.boxObject.screenY;
					let offsetHeight = item.boxObject.height;
					let boxTop = this.contents.boxObject.screenY;
					let boxHeight = this.contents.boxObject.height;
					if(offsetTop + offsetHeight > boxTop + boxHeight) {
						let scrollTop = offsetTop + offsetHeight - (boxTop + boxHeight);
						scrollTop = Math.min(this.contents.scrollTop + scrollTop +1, this.contents.scrollTopMax);
						this.contents.scrollTop = scrollTop;
					}
					else if(offsetTop < boxTop) {
						let scrollTop = boxTop - offsetTop;
						scrollTop = Math.max(this.contents.scrollTop - scrollTop -1, 0);
						this.contents.scrollTop = scrollTop;
					}
				}
				break;
			}
		}
	},

	toggle: function() {
		// if the trigger is our button and it's placed in the PanelUI, open its subview panel instead
		let placement = CustomizableUI.getPlacementOfWidget(TabView.kButtonId);
		if(placement && placement.area == 'PanelUI-contents') {
			if(!trueAttribute(this.view, 'current') || PanelUI.panel.state == 'closed') {
				// we kinda need it open for this...
				this.openedPanelUI = false;
				if(PanelUI.panel.state == 'closed') {
					PanelUI.toggle();
					Listeners.add(PanelUI.panel, 'popupshown', () => {
						PanelUI.multiView.showSubView(this.view.id, TabView.button);
					}, true, true);
					this.openedPanelUI = true;
				}
				else {
					PanelUI.multiView.showSubView(this.view.id, TabView.button);
				}
			} else {
				PanelUI.multiView.showMainView();
			}

			return;
		}

		if(this.panel.state == 'closed') {
			// Anchor the panel to the menu button if our button isn't placed in the window.
			let btn;
			let anchor;
			if(placement) {
				btn = TabView.button;
				if(trueAttribute(btn, 'showGroupTitle')) {
					anchor = $ª(btn, 'toolbarbutton-text', 'class');
				}
			}
			if(!btn || !btn.clientWidth || !btn.clientHeight) {
				btn = this.PanelUIBtn;
			}
			if(!anchor) {
				if(btn && btn.clientWidth && btn.clientHeight) {
					anchor = $ª(btn, 'toolbarbutton-icon', 'class') || btn;
				} else {
					btn = null;
					// If we can't anchor the panel to either button, at least anchor it to the selected tab, so it doesn't float around.
					anchor = Tabs.selected;
					anchor.scrollIntoView();
				}
			}

			if(btn == TabView.button) {
				setAttribute(TabView.button, 'open', 'true');
			}

			this.panel.openPopup(anchor, 'bottomcenter topright', 0, 0, false, false);
		} else {
			this.panel.hidePopup();
		}
	},

	hide: function() {
		if(!this.activePanel) { return; }

		if(this.activePanel == this.panel) {
			if(this.panel.state == 'open') {
				this.panel.hidePopup();
			}
		}
		else if(this.activePanel == this.view) {
			// The menu panel is expected to close as well when performing any action targeting the outside of it.
			if(PanelUI.panel.state == 'open') {
				PanelUI.toggle();
			}
		}
	},

	populateGroups: function() {
		this.empty();
		this._lastSearch = null;
		this.contents.classList.add('loading');

		// Mostly for effect only, let the panel appear with the throbbing icon first if TabView isn't initialized yet,
		// so the user knows something is happening in the background.
		Timers.init('quickAccess.populateGroups', () => {
			TabView._initFrame(() => {
				this.contents.classList.remove('loading');

				let activeGroupItem = TabView._window[objName].GroupItems.getActiveGroupItem();
				let groupItems = (Prefs.sortGroupsByName) ? TabView._window[objName].GroupItems.sortByName() : TabView._window[objName].GroupItems.sortBySlot();
				for(let groupItem of groupItems) {
					this._createGroupItem(groupItem, activeGroupItem == groupItem);
				}
			});
		}, TabView._window ? 0 : 350);
	},

	_createGroupItem: function(groupItem, makeActive) {
		let container = document.createElement('hbox');
		container.classList.add('quickaccess-button');
		container.classList.add('quickaccess-groupbutton');
		container.setAttribute('tooltiptext', Strings.get('TabView', 'switchToGroupTooltip'));
		this.contents.appendChild(container);

		this.items.push(container);
		if(makeActive) {
			container.classList.add('quickaccess-activebutton');
			this.focusItem(container);
		}

		let button = document.createElement('toolbarbutton');
		button.setAttribute('flex', '1');
		button.setAttribute('label', groupItem.getTitle(true));
		container.appendChild(button);

		let tabs = document.createElement('toolbarbutton');
		tabs.classList.add('quickaccess-tabsbutton');
		tabs.setAttribute('label', Strings.get('TabView', 'tabs', [ [ '$tabs', groupItem.children.length ] ], groupItem.children.length));
		tabs.setAttribute('tooltiptext', Strings.get('TabView', 'viewTabsInGroupTooltip'));
		container.appendChild(tabs);

		container.zoomIn = function() {
			quickAccess.hide();
			groupItem.zoomIn();
		};
		container.showTabs = function() {
			quickAccess.populateTabs(groupItem);
		};
		container.handleEvent = function(e) {
			switch(e.type) {
				case 'click':
					// left clicks only
					if(e.button == 0) {
						switch(e.target) {
							case tabs:
								this.showTabs();
								break;

							default:
								this.zoomIn();
								break;
						}
					}
					break;

				case 'mousemove':
					quickAccess.focusItem(this);
					break;
			}
		};
		container.addEventListener('click', container);
		container.addEventListener('mousemove', container);
	},

	populateTabs: function(groupItem) {
		this.empty();

		// We don't need to wait for tabview to initialize here, if we get here it's definitely already initialized

		// At the top there should be an item to quickly go back from the tabs list to the groups list.
		let goback = this._createTabButton();
		goback.classList.add('quickaccess-gobackbutton');
		goback.setAttribute('label', Strings.get('TabView', 'goBackToGroupsLabel'));
		goback.zoomIn = function() {
			// we don't actually "zoom in" here, if anything we "zoom back"
			quickAccess.populateGroups();
		};

		this.contents.appendChild(goback);
		this.items.push(goback);
		this.focusItem(goback);

		this._addSeparator();

		let label = this._createLabel(groupItem.getTitle(true));
		this.contents.appendChild(label);

		// The tab order should be updated if necessary.
		if(TabView._window[objName].UI._reorderTabItemsOnShow.has(groupItem)) {
			groupItem.reorderTabItemsBasedOnTabOrder();
		}

		let activeTab = TabView._window[objName].UI._currentTab;
		let tabItems = groupItem.children.concat();

		// This may need its own pref eventually, but I think it's good behavior to sort tabs in the same way as groups for now.
		if(Prefs.sortGroupsByName) {
			tabItems.sort(function(a, b) {
				return Utils.sortReadable(a.tabTitle.textContent, b.tabTitle.textContent);
			});
		}
		for(let tabItem of tabItems) {
			this._createTabItem(tabItem, activeTab == tabItem.tab);
		}

		this._addSeparator();

		let newtab = this._createTabButton();
		newtab.classList.add('quickaccess-tabbutton');
		newtab.setAttribute('label', Strings.get('TabView', 'openNewTab'));
		newtab.style.listStyleImage = 'url("'+TabView._window[objName].FavIcons.defaultFavicon+'")';
		newtab.zoomIn = function() {
			quickAccess.hide();
			groupItem.newTab();
		};
		this.contents.appendChild(newtab);
		this.items.push(newtab);
	},

	_createTabItem: function(tabItem, makeActive) {
		let button = this._createTabButton(tabItem);
		button.classList.add('quickaccess-tabbutton');
		if(makeActive) {
			button.classList.add('quickaccess-activebutton');
		}

		tabItem.updateLabels().then(() => {
			button.setAttribute('label', tabItem.tabTitle.textContent);
			button.setAttribute('tooltiptext', tabItem.container.getAttribute('title'));
			if(tabItem.fav._iconUrl) {
				button.style.listStyleImage = 'url("'+tabItem.fav._iconUrl+'")';
			}
		});

		this.contents.appendChild(button);
		this.items.push(button);
	},

	_createTabButton: function(item) {
		let button = document.createElement('toolbarbutton');
		button.classList.add('quickaccess-button');

		button.handleEvent = function(e) {
			switch(e.type) {
				case 'click':
					// left clicks only
					if(e.button == 0) {
						this.zoomIn();
					}
					break;

				case 'mousemove':
					quickAccess.focusItem(this);
					break;
			}
		};
		button.zoomIn = function() {
			quickAccess.hide();
			item.zoomIn();
		};
		button.addEventListener('click', button);
		button.addEventListener('mousemove', button);

		return button;
	},

	_createLabel: function(str) {
		let label = document.createElement('label');
		label.classList.add('quickaccess-grouplabel');
		label.setAttribute('value', str);
		return label;
	},

	_addSeparator: function() {
		let separator = document.createElement('toolbarseparator');
		this.contents.appendChild(separator);
	},

	empty: function() {
		this.currentItem = null;
		this.items = [];
		if(this.contents) {
			while(this.contents.firstChild) {
				this.contents.firstChild.remove();
			}
		}
	},

	focusItem: function(item) {
		if(item == this.currentItem) { return; }

		if(this.currentItem) {
			this.currentItem.classList.remove('quickaccess-currentbutton');
		}
		this.currentItem = item;
		if(item) {
			item.classList.add('quickaccess-currentbutton');
		}
	},

	// Performs a search.
	performSearch: function() {
		Timers.init('quickAccess.performSearch', () => {
			// Could have exited by now.
			if(!this.activePanel
			|| (this.activePanel == this.panel && this.panel.state != 'open') || (this.activePanel == this.view && PanelUI.panel.state != 'open')) { return; }

			let term = this.searchbox.value;
			if(!term.length) {
				if(this._lastSearch) {
					this.populateGroups();
				}
			} else {
				if(this._lastSearch) {
					if(term == this._lastSearch.term) { return; }
					this._lastSearch.cancel();
				}

				this._lastSearch = new TabView._window[objName].TabMatcher(term);
				this._lastSearch.byParent = new Map();
				this._lastSearch.orderedGroups = [];
				this._lastSearch.activeTab = TabView._window[objName].UI._currentTab;
				this._lastSearch.doSearch(this);
			}
		}, 300);
	},

	clearSearch: function() {
		this.empty();
	},

	onMatch: function(tab, index) {
		let button = this._createTabButton(tab);
		button.classList.add('quickaccess-tabbutton');
		if(this._lastSearch.activeTab == tab.tab) {
			button.classList.add('quickaccess-activebutton');
		}

		if(tab.isATabItem) {
			button.setAttribute('label', tab.tabTitle.textContent);
			button.setAttribute('tooltiptext', tab.container.getAttribute('title'));
			if(tab.fav._iconUrl) {
				button.style.listStyleImage = 'url("'+tab.fav._iconUrl+'")';
			}
		}
		else if(tab.isAnAppItem) {
			button.setAttribute('label', tab.tab.label);
			button.setAttribute('title', tab.tab.getAttribute('label'));
			TabView._window[objName].PinnedItems.getFavIconUrl(tab.tab, (iconUrl) => {
				button.style.listStyleImage = "url('"+iconUrl+"')";
			});
		}

		if(!this._lastSearch.byParent.has(tab.parent)) {
			let title;
			if(tab.parent.isAGroupItem) {
				title = tab.parent.getTitle(true);
			} else if(tab.parent == TabView._window[objName].PinnedItems.tray) {
				title = Strings.get('TabView', 'pinnedItemsGroup');
			}
			let label = this._createLabel(title);
			label._items = [];
			this._lastSearch.byParent.set(tab.parent, label);
			this._lastSearch.orderedGroups.push(label);
		}
		this._lastSearch.byParent.get(tab.parent)._items.push(button);
	},

	finishSearch: function() {
		let firstItem = true;
		for(let groupLabel of this._lastSearch.orderedGroups) {
			if(!firstItem) {
				this._addSeparator();
			}

			this.contents.appendChild(groupLabel);

			for(let button of groupLabel._items) {
				this.items.push(button);
				this.contents.appendChild(button);
				if(firstItem) {
					this.focusItem(button);
				}

				firstItem = false;
			}
		}
	},

	onLoad: function() {
		toggleAttribute(this.panel, 'FF48', Services.vc.compare(Services.appinfo.version, "48.0a1") >= 0);
		toggleAttribute(this.view, 'FF48', Services.vc.compare(Services.appinfo.version, "48.0a1") >= 0);
		toggleAttribute(this.panel, 'FF50', Services.vc.compare(Services.appinfo.version, "50.0a1") >= 0);
		toggleAttribute(this.view, 'FF50', Services.vc.compare(Services.appinfo.version, "50.0a1") >= 0);

		Listeners.add(this.panel, 'popupshowing', this);
		Listeners.add(this.panel, 'popupshown', this);
		Listeners.add(this.panel, 'popuphidden', this);
		Listeners.add(this.view, 'ViewShowing', this);
		Listeners.add(this.view, 'ViewHiding', this);
		Listeners.add(this.panelTextbox, 'keydown', this);
		Listeners.add(this.viewTextbox, 'keydown', this);
		Listeners.add(this.panelTextbox, 'input', this);
		Listeners.add(this.viewTextbox, 'input', this);
	},

	onUnload: function() {
		Listeners.remove(this.panel, 'popupshowing', this);
		Listeners.remove(this.panel, 'popupshown', this);
		Listeners.remove(this.panel, 'popuphidden', this);
		Listeners.remove(this.view, 'ViewShowing', this);
		Listeners.remove(this.view, 'ViewHiding', this);
		Listeners.remove(this.panelTextbox, 'keydown', this);
		Listeners.remove(this.viewTextbox, 'keydown', this);
		Listeners.remove(this.panelTextbox, 'input', this);
		Listeners.remove(this.viewTextbox, 'input', this);

		removeAttribute(this.panel, 'FF48');
		removeAttribute(this.view, 'FF48');
		removeAttribute(this.panel, 'FF50');
		removeAttribute(this.view, 'FF50');
	}
};

Modules.LOADMODULE = function() {
	Overlays.overlayWindow(window, "quickAccess", quickAccess);
};

Modules.UNLOADMODULE = function() {
	Overlays.removeOverlayWindow(window, "quickAccess");
};
