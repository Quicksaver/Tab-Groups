// VERSION 1.0.0

this.PinnedItems = {
	get actions() { return $('actions'); },
	get tray() { return $('pinnedTabs'); },

	icons: new Map(),
	_delayedUpdates: new Set(),
	_activeItem: null,

	handleEvent: function(e) {
		let tab = e.target;

		switch(e.type) {
			case "TabOpen":
				if(tab.pinned) {
					this.add(tab);
				}
				break;

			case "TabClose":
				if(tab.pinned) {
					this.remove(tab);
				}
				break;

			case "TabMove":
				if(tab.pinned) {
					this.arrange(tab);
				}
				break;

			case 'TabPinned':
				this.add(tab);
				break;

			case 'TabUnpinned':
				this.remove(tab);
				break;

			// watch for icon changes on app tabs
			case 'TabAttrModified':
				this.updateIcon(tab);
				break;

			case 'TabSelect':
				this.makeActive(tab);
				break;

			case 'dragover':
				if(DraggingTab) {
					DraggingTab.canDrop(e, this.tray);
				}
				break;
		}
	},

	init: function() {
		// To optimize drag handlers.
		this.tray._appTabsContainer = true;

		Tabs.listen("TabOpen", this);
		Tabs.listen("TabClose", this);
		Tabs.listen("TabMove", this);
		Tabs.listen("TabPinned", this);
		Tabs.listen("TabUnpinned", this);
		Tabs.listen("TabAttrModified", this);
		Tabs.listen("TabSelect", this);

		Listeners.add(this.actions, 'dragover', this);

		for(let tab of Tabs.pinned) {
			this.add(tab);
		}
	},

	uninit: function() {
		Tabs.unlisten("TabOpen", this);
		Tabs.unlisten("TabClose", this);
		Tabs.unlisten("TabMove", this);
		Tabs.unlisten("TabPinned", this);
		Tabs.unlisten("TabUnpinned", this);
		Tabs.unlisten("TabAttrModified", this);
		Tabs.unlisten("TabSelect", this);

		Listeners.remove(this.actions, 'dragover', this);

		for(let icon of this.icons.values()) {
			icon.remove();
		}
		this.icons.clear();
		removeAttribute(this.tray, 'visible');
	},

	// Show the pinned tabs group only when there are pinned tabs.
	updateTray: function() {
		toggleAttribute(this.tray, 'visible', this.icons.size);
	},

	// Update apptab icons based on xulTabs which have been updated while the TabView hasn't been visible
	flushUpdates: function() {
		for(let tab of this._delayedUpdates) {
			this._updateIcon(tab);
		}
		this._delayedUpdates.clear();
	},

	updateIcon: function(tab) {
		if(!UI.isTabViewVisible()) {
			this._delayedUpdates.add(tab);
		} else {
			this._updateIcon(tab);
		}
	},

	// Update images of any apptab icons that point to passed in xultab
	_updateIcon: function(tab) {
		if(!tab.pinned) { return; }

		this.getFavIconUrl(tab, (iconUrl) => {
			// The tab might have been removed or unpinned while waiting.
			if(!Utils.isValidXULTab(tab) || !tab.pinned || !this.icons.has(tab)) { return; }

			let icon = this.icons.get(tab);
			icon.setAttribute('title', tab.getAttribute('label'));
			icon.style.backgroundImage = "url('"+iconUrl+"')";
		});
	},

	// Gets the fav icon url for app tab.
	getFavIconUrl: function(tab, callback) {
		FavIcons.getFavIconUrlForTab(tab, function(iconUrl) {
			callback(iconUrl || FavIcons.defaultFavicon);
		});
	},

	// Adds the given xul:tab as an app tab in the apptab tray
	add: function(tab, sibling) {
		let icon = this.icons.get(tab);
		if(!icon) {
			icon = document.createElement("input");
			icon.isAnAppItem = true;
			icon.parent = this.tray;
			icon.container = icon; // for equivalency with tab items in drag handlers
			icon.tab = tab;
			icon.classList.add("appTabIcon");
			icon.setAttribute('type', 'button');
			icon.setAttribute('draggable', 'true');
			icon.handleEvent = function(e) {
				switch(e.type) {
					case 'click':
						// left-clicks only
						if(e.button != 0) { break; }

						UI.goToTab(tab);
						break;

					case 'dragenter':
						if(DraggingTab) {
							DraggingTab.dropHere(this);
						}
						break;

					case 'dragover':
						if(DraggingTab) {
							DraggingTab.canDrop(e, this.parent);
						}
						break;

					case 'dragstart':
						new TabDrag(e, this);
						break;
				}
			};
			icon.addEventListener("click", icon);
			icon.addEventListener("dragover", icon);
			icon.addEventListener("dragenter", icon);
			icon.addEventListener("dragstart", icon);

			this.icons.set(tab, icon);
		}

		if(sibling && sibling.isAnAppItem) {
			this.tray.insertBefore(icon, sibling);
		} else {
			this.tray.appendChild(icon);
		}
		this.updateTray();

		this.updateIcon(tab);

		if(tab == Tabs.selected) {
			this.makeActive(tab);
		}
	},

	// Removes the given xul:tab as an app tab in the apptab tray
	remove: function(tab) {
		// make sure any closed tabs are removed from the delay update list
		this._delayedUpdates.delete(tab);

		let icon = this.icons.get(tab);
		if(icon) {
			icon.remove();
			this.icons.delete(tab);
			this.updateTray();
		}
	},

	// Arranges the given xul:tab as an app tab in the group's apptab tray
	arrange: function(tab) {
		let icon = this.icons.get(tab);
		if(icon && this.tray.childNodes[tab._tPos] != icon) {
			// so that the indexes match
			icon.remove();

			let sibling = this.tray.childNodes[tab._tPos] || null;
			this.tray.insertBefore(icon, sibling);
		}
	},

	reorderTabsBasedOnAppItemOrder: function() {
		let tabs = [];
		for(let icon of this.tray.childNodes) {
			tabs.push(icon.tab);
		}
		GroupItems.reorderTabsBasedOnGivenOrder(tabs);
	},

	makeActive: function(tab) {
		if(this._activeItem) {
			this._activeItem.classList.remove('activeAppTab');
			this._activeItem = null;
		}

		if(!tab.pinned) { return; }

		let icon = this.icons.get(tab);
		if(icon) {
			this._activeItem = icon;
			this._activeItem.classList.add('activeAppTab');
		}
	}
};
