/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.2.1

this.Storage = {
	kGroupIdentifier: "tabview-group",
	kGroupsIdentifier: "tabview-groups",
	kTabIdentifier: "tabview-tab",
	kUIIdentifier: "tabview-ui",

	_migrationScope: null,
	_scope: null,

	// Saves the data for a single tab.
	saveTab: function(tab, data) {
		SessionStore.setTabValue(tab, this.kTabIdentifier, JSON.stringify(data));
	},

	// Load tab data from session store and return it.
	getTabData: function(tab) {
		try {
			let tabData = SessionStore.getTabValue(tab, this.kTabIdentifier);
			if(tabData) {
				return JSON.parse(tabData);
			}
		}
		catch(ex) { /* getTabValue will fail if the property doesn't exist. */ }

		return null;
	},

	// Returns the current state of the given tab.
	getTabState: function(tab) {
		try {
			let tabState = SessionStore.getTabState(tab);
			if(tabState) {
				return JSON.parse(tabState);
			}
		}
		catch(ex) {}

		return null;
	},

	// Saves the data for a single groupItem, associated with a specific window.
	saveGroupItem: function(win, data) {
		let id = data.id;
		let existingData = this.readGroupItemData(win) || {};
		existingData[id] = data;
		this.saveData(win, this.kGroupIdentifier, existingData);
	},

	// Deletes the data for a single groupItem from the given window.
	deleteGroupItem: function(win, id) {
		let existingData = this.readGroupItemData(win) || {};
		delete existingData[id];
		this.saveData(win, this.kGroupIdentifier, existingData);
	},

	// Returns the data for all groupItems associated with the given window.
	readGroupItemData: function(win) {
		return this.readData(win, this.kGroupIdentifier);
	},

	// Returns the current busyState for the given window.
	readWindowBusyState: function(win) {
		let state;

		try {
			let data = SessionStore.getWindowState(win);
			if(data) {
				state = JSON.parse(data);
			}
		}
		catch(ex) {}

		return (state && state.windows[0].busy);
	},

	// Saves the global data for the <GroupItems> singleton for the given window.
	saveGroupItemsData: function(win, data) {
		this.saveData(win, this.kGroupsIdentifier, data);
	},

	// Reads the global data for the <GroupItems> singleton for the given window.
	readGroupItemsData: function(win) {
		return this.readData(win, this.kGroupsIdentifier);
	},

	// Saves the global data for the <UIManager> singleton for the given window.
	saveUIData: function(win, data) {
		this.saveData(win, this.kUIIdentifier, data);
	},

	// Reads the global data for the <UIManager> singleton for the given window.
	readUIData: function(win) {
		return this.readData(win, this.kUIIdentifier);
	},

	// Generic routine for saving data to a window.
	saveData: function(win, id, data) {
		try {
			SessionStore.setWindowValue(win, id, JSON.stringify(data));
		}
		catch(ex) {}
	},

	// Generic routine for reading data from a window.
	readData: function(win, id) {
		try {
			let data = SessionStore.getWindowValue(win, id);
			if(data) {
				return JSON.parse(data);
			}
		}
		catch(ex) {}

		return null;
	}
};

Modules.LOADMODULE = function() {
	Storage._scope = Cu.import("resource:///modules/sessionstore/SessionStore.jsm", self);
	Storage._migrationScope = Cu.import("resource:///modules/sessionstore/SessionMigration.jsm", {});

	Piggyback.add('Storage', Storage._scope.SessionStoreInternal, '_prepWindowToRestoreInto', function(aWindow) {
		if(!aWindow) { return; }

		// Step 1 of processing:
		// Inspect extData for Tab Groups identifiers. If found, then we want to inspect further.
		// If there is a single group, then we can use this window. If there are multiple groups then we won't use this window.
		let groupsData = this.getWindowValue(aWindow, Storage.kGroupsIdentifier);
		if(groupsData) {
			groupsData = JSON.parse(groupsData);

			// If there are multiple groups, we don't want to use this window.
			if(groupsData.totalNumber > 1) {
				return [false, false];
			}
		}

		return this.__prepWindowToRestoreInto(aWindow);
	});

	Piggyback.add('Storage', Storage._scope.SessionStoreInternal, 'restoreWindow', function(aWindow, winData, aOptions) {
		// Deinitialize tab view in any window that will have its session overwritten.
		// Nothing in TabView will be useful anyway, just let it reinistialize if/when necessary later by itself.
		if(aWindow.TabView) {
			aWindow.TabView._deinitFrame();
		}

		// Call the original method.
		this._restoreWindow(aWindow, winData, aOptions);

		// Update our button's label, to reflect the groups data in the new/different session.
		if(aWindow.TabView) {
			aWindow.TabView.setButtonLabel();
		}
	});

	Piggyback.add('Storage', Storage._migrationScope.SessionMigrationInternal, 'convertState', function(aStateObj) {
		let state = {
			selectedWindow: aStateObj.selectedWindow,
			_closedWindows: []
		};
		state.windows = aStateObj.windows.map(function(oldWin) {
			let win = { extData: {} };
			win.tabs = oldWin.tabs.map(function(oldTab) {
				let tab = {};
				// Keep only titles and urls for history entries
				tab.entries = oldTab.entries.map(function(entry) {
					return { url: entry.url, title: entry.title };
				});
				tab.index = oldTab.index;
				tab.hidden = oldTab.hidden;
				tab.pinned = oldTab.pinned;

				// The tabgroup info is in the extData, so we need to get it out.
				if(oldTab.extData && Storage.kTabIdentifier in oldTab.extData) {
					tab.extData = { [Storage.kTabIdentifier]: oldTab.extData[Storage.kTabIdentifier] };
				}
				return tab;
			});

			// There are various tabgroup-related attributes that we need to get out of the session restore data for the window, too.
			if(oldWin.extData) {
				for(let k of Object.keys(oldWin.extData)) {
					if(k.startsWith("tabview-")) {
						win.extData[k] = oldWin.extData[k];
					}
				}
			}

			win.selected = oldWin.selected;
			win._closedTabs = [];
			return win;
		});

		let url = "about:welcomeback";
		let formdata = { id: { sessionData: state }, url };
		return { windows: [ { tabs: [ { entries: [ { url } ], formdata } ] } ] };
	});
};

Modules.UNLOADMODULE = function() {
	Piggyback.revert('Storage', Storage._scope.SessionStoreInternal, '_prepWindowToRestoreInto');
	Piggyback.revert('Storage', Storage._scope.SessionStoreInternal, 'restoreWindow');
	Piggyback.revert('Storage', Storage._migrationScope.SessionMigrationInternal, 'convertState');
};
