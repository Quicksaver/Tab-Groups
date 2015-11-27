// VERSION 1.0.5

this.__defineGetter__('gWindow', function() { return window.parent; });
this.__defineGetter__('gBrowser', function() { return gWindow.gBrowser; });
this.__defineGetter__('gTabView', function() { return gWindow[objName].TabView; });
this.__defineGetter__('gTabViewDeck', function() { return gWindow[objName].gTabViewDeck; });
this.__defineGetter__('gBrowserPanel', function() { return gWindow[objName].$("browser-panel"); });
this.__defineGetter__('gTabViewFrame', function() { return gTabView._iframe; });

this.TabView = {
	_browserBundle: null,
	
	get browserBundle() {
		if(!this._browserBundle) {
			this._browserBundle = Services.strings.createBundle("chrome://browser/locale/tabbrowser.properties");
		}
		return this._browserBundle;
	},
	
	// compatibility shims, for other add-ons to interact with this window more closely to the original if needed
	shims: [
		'iQ',
		'Item', 'Items',
		'GroupItem', 'GroupItems',
		'TabItem', 'TabItems', 'TabPriorityQueue', 'TabCanvas',
		'FavIcons',
		'drag', 'resize', 'Drag',
		'Trench', 'Trenches',
		'TabUtils', 'TabMatcher', 'TabHandlers', 'Search',
		'Keys', 'UI'
	]
};

this.AllTabs = {
	_events: {
		attrModified: "TabAttrModified",
		close: "TabClose",
		move: "TabMove",
		open: "TabOpen",
		select: "TabSelect",
		pinned: "TabPinned",
		unpinned: "TabUnpinned"
	},
	
	get tabs() {
		return Array.filter(gBrowser.tabs, tab => Utils.isValidXULTab(tab));
	},
	
	register: function(eventName, callback) {
		Listeners.add(gBrowser.tabContainer, this._events[eventName], callback);
	},
	
	unregister: function(eventName, callback) {
		Listeners.remove(gBrowser.tabContainer, this._events[eventName], callback);
	}
};

Modules.LOADMODULE = function() {
	// compatibility shims, for other add-ons to interact with this window more closely to the original if needed
	for(let shim of TabView.shims) {
		let prop = shim;
		window.__defineGetter__(prop, function() { return self[prop]; });
	}
	
	Modules.load('iQ');
	Modules.load('Items');
	Modules.load('GroupItems');
	Modules.load('TabItems');
	Modules.load('FavIcons');
	Modules.load('Drag');
	Modules.load('Trench');
	Modules.load('Search');
	Modules.load('UI');
};

Modules.UNLOADMODULE = function() {
	Modules.unload('UI');
	Modules.unload('Search');
	Modules.unload('Trench');
	Modules.unload('Drag');
	Modules.unload('FacIcons');
	Modules.unload('TabItems');
	Modules.unload('GroupItems');
	Modules.unload('Items');
	Modules.unload('iQ');
	
	for(let shim of TabView.shims) {
		delete window[shim];
	}
};
