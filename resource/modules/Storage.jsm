// VERSION 1.0.0

// Singleton for permanent storage of TabView data.
this.Storage = {
	GROUP_DATA_IDENTIFIER: "tabview-group",
	GROUPS_DATA_IDENTIFIER: "tabview-groups",
	TAB_DATA_IDENTIFIER: "tabview-tab",
	UI_DATA_IDENTIFIER: "tabview-ui",
	
	// Prints [Storage] for debug use
	toString: function() {
		return "[Storage]";
	},
	
	// Sets up the object.
	init: function() {
		this._sessionStore = Cc["@mozilla.org/browser/sessionstore;1"].getService(Ci.nsISessionStore);
	},
	
	uninit: function() {
		this._sessionStore = null;
	},
	
	// Saves the data for a single tab.
	saveTab: function(tab, data) {
		Utils.assert(tab, "tab");
		
		this._sessionStore.setTabValue(tab, this.TAB_DATA_IDENTIFIER, JSON.stringify(data));
	},
	
	// Load tab data from session store and return it.
	getTabData: function(tab) {
		Utils.assert(tab, "tab");
		
		let existingData = null;
		
		try {
			let tabData = this._sessionStore.getTabValue(tab, this.TAB_DATA_IDENTIFIER);
			if(tabData != "") {
				existingData = JSON.parse(tabData);
			}
		}
		catch(ex) {
			// getTabValue will fail if the property doesn't exist.
			Utils.log(ex);
		}
		
		return existingData;
	},
	
	// Returns the current state of the given tab.
	getTabState: function(tab) {
		Utils.assert(tab, "tab");
		let tabState;
		
		try {
			tabState = JSON.parse(this._sessionStore.getTabState(tab));
		}
		catch(ex) {}
		
		return tabState;
	},
	
	// Saves the data for a single groupItem, associated with a specific window.
	saveGroupItem: function(win, data) {
		let id = data.id;
		let existingData = this.readGroupItemData(win);
		existingData[id] = data;
		this._sessionStore.setWindowValue(win, this.GROUP_DATA_IDENTIFIER, JSON.stringify(existingData));
	},
	
	// Deletes the data for a single groupItem from the given window.
	deleteGroupItem: function(win, id) {
		let existingData = this.readGroupItemData(win);
		delete existingData[id];
		this._sessionStore.setWindowValue(win, this.GROUP_DATA_IDENTIFIER, JSON.stringify(existingData));
	},
	
	// Returns the data for all groupItems associated with the given window.
	readGroupItemData: function(win) {
		let existingData = {};
		let data;
		try {
			data = this._sessionStore.getWindowValue(win, this.GROUP_DATA_IDENTIFIER);
			if(data) {
				existingData = JSON.parse(data);
			}
		}
		catch(ex) {
			// getWindowValue will fail if the property doesn't exist
			Utils.log("Error in readGroupItemData: "+ex, data);
		}
		return existingData;
	},
	
	// Returns the current busyState for the given window.
	readWindowBusyState: function(win) {
		let state;
		
		try {
			let data = this._sessionStore.getWindowState(win);
			if(data) {
				state = JSON.parse(data);
			}
		}
		catch(ex) {
			Utils.log("Error while parsing window state");
		}
		
		return (state && state.windows[0].busy);
	},
	
	// Saves the global data for the <GroupItems> singleton for the given window.
	saveGroupItemsData: function(win, data) {
		this.saveData(win, this.GROUPS_DATA_IDENTIFIER, data);
	},
	
	// Reads the global data for the <GroupItems> singleton for the given window.
	readGroupItemsData: function(win) {
		return this.readData(win, this.GROUPS_DATA_IDENTIFIER);
	},
	
	// Saves the global data for the <UIManager> singleton for the given window.
	saveUIData: function(win, data) {
		this.saveData(win, this.UI_DATA_IDENTIFIER, data);
	},
	
	// Reads the global data for the <UIManager> singleton for the given window.
	readUIData: function(win) {
		return this.readData(win, this.UI_DATA_IDENTIFIER);
	},
	
	// Saves visibility for the given window.
	saveVisibilityData: function(win, data) {
		this._sessionStore.setWindowValue(win, win.TabView.VISIBILITY_IDENTIFIER, data);
	},
	
	// Generic routine for saving data to a window.
	saveData: function(win, id, data) {
		try {
			this._sessionStore.setWindowValue(win, id, JSON.stringify(data));
		}
		catch(ex) {
			Utils.log("Error in saveData: "+ex);
		}
	},
	
	// Generic routine for reading data from a window.
	readData: function(win, id) {
		let existingData = {};
		try {
			let data = this._sessionStore.getWindowValue(win, id);
			if(data) {
				existingData = JSON.parse(data);
			}
		}
		catch(ex) {
			Utils.log("Error in readData: "+ex);
		}
		
		return existingData;
	}
};
