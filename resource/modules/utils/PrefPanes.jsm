/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.1.0
Modules.UTILS = true;

// PrefPanes - handles the preferences tab and all its contents for the add-on
// register(aPane, aModules) - registers a new preferences pane to be appended to the preferences tab
//	aPane - (str) name of the pane, in the form of a aPane.xul overlay to be found in content
//	(optional) aModules -	(object) containing a list of modules to be loaded when the corresponding categories are shown, in the form { category: module [, ...] }, where:
//		category - (str) name of the pane as defined in the overlay
//		module - (str) name of the module to be loaded
//				or if (bool) true, the object takes the form { aPane: aPane } (only a single property where both category and module take the value of aPane)
// unregister(aPane) - unregisters a preferences pane from the preferences tab
//	see register()
// setList(list) - register a set of panes at once
//	list - (iterable) list of arguments to apply to register()
// open(aWindow, aOptions) - tries to switch to an already opened add-on preferences tab; if none is found then a new one is opened
//	aWindow - (chrome window) in which the preferences tab will be opened
//	(optional) aOptions - (obj) with any of the following optional properties:
//		pane - (string) name of the pane that should be shown by default in the preferences tab
//		jumpto - (string) query to insert in the Jump To field, to go to a specific area as soon as the preferences tab is ready
//	(don't set) loadOnStartup - for internal use only, used to show the about pane when the add-on is updated
// closeAll() - closes all the add-on's preferences tab
this.PrefPanes = {
	chromeUri: 'chrome://'+objPathString+'/content/utils/preferences.xul',
	aboutUri: null,

	get notifyUri () {
		return (this.aboutUri ? this.aboutUri.spec : this.chromeUri) + '#paneAbout';
	},

	panes: new Map(),
	previousVersion: null,

	observe: function(aSubject, aTopic, aData) {
		switch(aTopic) {
			case 'pageshow':
				this.initWindow(aSubject);
				break;

			case 'alertclickcallback':
				this.closeToaster();
				this.openWhenReady();
				break;
		}
	},

	register: function(aPane, aModules) {
		if(!this.panes.has(aPane)) {
			if(aModules === true) {
				aModules = { [aPane]: aPane };
			}

			this.panes.set(aPane, aModules);
		}
	},

	unregister: function(aPane) {
		if(this.panes.has(aPane)) {
			this.panes.delete(aPane);
		}
	},

	setList: function(list) {
		for(let args of list) {
			this.register.apply(this, args);
		}
	},

	init: function() {
		// if defaults.js supplies an addonUUID, use it to register the about: uri linking to the add-on's preferences
		if(addonUUID) {
			this.aboutUri = {
				spec: 'about:'+objPathString,
				manager: Cm.QueryInterface(Ci.nsIComponentRegistrar),

				handler: {
					uri: Services.io.newURI(this.chromeUri, null, null),
					classDescription: 'about: handler for add-on '+objName,
					classID: Components.ID(addonUUID),
					contractID: '@mozilla.org/network/protocol/about;1?what='+objPathString,
					QueryInterface: XPCOMUtils.generateQI([Ci.nsIAboutModule]),
					newChannel: function(aURI, aLoadInfo) {
						let chan = Services.io.newChannelFromURIWithLoadInfo(this.uri, aLoadInfo);
						chan.originalURI = aURI;
						return chan;
					},
					getURIFlags: function(aURI) { return 0; }
				},

				loaded: function() {
					return this.manager.isContractIDRegistered(this.handler.contractID);
				},

				load: function() {
					if(!this.loaded()) {
						this.manager.registerFactory(this.handler.classID, this.handler.classDescription, this.handler.contractID, this);
					}
				},

				unload: function() {
					if(this.loaded()) {
						this.manager.unregisterFactory(this.handler.classID, this);
					}
				},

				createInstance: function(outer, iid) {
					if(outer) {
						throw Cr.NS_ERROR_NO_AGGREGATION;
					}
					return this.handler;
				}
			};
			this.aboutUri.load();

			if(isChrome) {
				// We still need to register the about: handler in the content process, so that web navigation works;
				// see https://bugzilla.mozilla.org/show_bug.cgi?id=1215793#c7
				Messenger.loadInAll('utils/PrefPanes');
				Browsers.callOnAll(aWindow => { this.initWindow(aWindow); }, this.aboutUri.spec);
				Browsers.register(this, 'pageshow', this.aboutUri.spec);
			}
		}

		// In the content process we really only need to register the about: handler.
		if(isContent) { return; }

		// we set the add-on status in the API webpage from within the add-on itself
		Messenger.loadInAll('utils/api');

		// always add the about pane to the preferences dialog, it should be the last category in the list
		this.register('utils/about', { paneAbout: 'utils/about' });

		Browsers.callOnAll(aWindow => { this.initWindow(aWindow); }, this.chromeUri);
		Browsers.register(this, 'pageshow', this.chromeUri);

		// if we're in a dev version, ignore all this
		if(AddonData.version.includes('a') || AddonData.version.includes('b')) { return; }

		if(STARTED == ADDON_UPGRADE) {
			// if we're updating from a version without this module, try to figure out the last version
			if(Prefs.lastVersionNotify == '0' && AddonData.oldVersion) {
				Prefs.lastVersionNotify = AddonData.oldVersion;
			}

			// Don't show notifications if the user decided not to receive any,
			// and make sure we notify the user when updating only; when installing for the first time do nothing.
			if(!Prefs.silentUpdates && Prefs.lastVersionNotify != '0' && Services.vc.compare(Prefs.lastVersionNotify, AddonData.version) < 0) {
				this.previousVersion = Prefs.lastVersionNotify;

				// Show the about page directly, with the release notes, if the user chose to.
				if(Prefs.showTabOnUpdates) {
					this.openWhenReady();
				}
				// Otherwise show only the notification toaster message for now,
				// it's much less intrusive for when you can't/don't want to check the notes.
				else {
					this.showToaster();
				}
			}
		}

		// always keep this flag up to date with the current version
		if(Prefs.lastVersionNotify != AddonData.version) {
			Prefs.lastVersionNotify = AddonData.version;
		}
	},

	uninit: function() {
		if(this.aboutUri) {
			if(isChrome) {
				Messenger.unloadFromAll('utils/PrefPanes');
				Browsers.unregister(this, 'pageshow', this.aboutUri.spec);
			}
			this.aboutUri.unload();
		}

		if(isContent) { return; }

		Messenger.unloadFromAll('utils/api');
		Browsers.unregister(this, 'pageshow', this.chromeUri);

		this.closeAll();
	},

	// Show the user a notification about the add-on having been updated.
	showToaster: function() {
		try {
			let icon = "chrome://"+objPathString+"/skin/icon.png";
			let title = Strings.get('utils-toaster', 'title');
			let text = Strings.get('utils-toaster', 'line1', [ [ '$vx', AddonData.version ] ])+'\n'+Strings.get('utils-toaster', 'line2');
			let name = 'toast-'+objName+'-updated';

			let alertsService = Cc["@mozilla.org/alerts-service;1"].getService(Ci.nsIAlertsService);
			alertsService.showAlertNotification(icon, title, text, true, "", this, name);
		}
		catch(ex) {
			Cu.reportError(ex);
		}
	},

	closeToaster: function() {
		try {
			let name = 'toast-'+objName+'-updated';

			let alertsService = Cc["@mozilla.org/alerts-service;1"].getService(Ci.nsIAlertsService);
			alertsService.closeAlert(name);
		}
		catch(ex) {
			Cu.reportError(ex);
		}
	},

	// we have to wait for Session Store to finish, otherwise our tab will be overriden by a session-restored tab
	openWhenReady: function() {
		// in theory, the add-on could be disabled inbetween aSync calls
		if(typeof(PrefPanes) == 'undefined') { return; }

		// most recent window, if it doesn't exist yet it means we're still starting up, so give it a moment
		let aWindow = window;
		if(!aWindow || !aWindow.SessionStore) {
			aSync(() => { this.openWhenReady(); }, 500);
			return;
		}

		// SessionStore should have registered the window and initialized it, to ensure it doesn't overwrite our tab with any saved ones
		// (ours will open in addition to session-saved tabs)
		let state = JSON.parse(aWindow.SessionStore.getBrowserState());
		if(state.windows.length == 0) {
			aSync(() => { this.openWhenReady(); }, 500);
			return;
		}

		// also ensure the window is fully initialized before trying to open a new tab
		if(!aWindow.gBrowserInit || !aWindow.gBrowserInit.delayedStartupFinished) {
			aSync(() => { this.openWhenReady(); }, 500);
			return;
		}

		this.open(aWindow, null, true);
	},

	open: function(aWindow, aOptions, loadOnStartup) {
		// first try to switch to an already opened options tab
		for(let tab of aWindow.gBrowser.mTabs) {
			if(this.ours(tab.linkedBrowser.currentURI.spec)) {
				aWindow.gBrowser.selectedTab = tab;
				aWindow.focus();
				this.goTos(tab, aOptions);
				return;
			}
		}

		// no tab was found, so open a new one
		if(loadOnStartup) {
			aWindow.gBrowser.selectedTab = aWindow.gBrowser.addTab(this.notifyUri);
			aWindow.gBrowser.selectedTab.loadOnStartup = true; // for Tab Mix Plus
		}
		else {
			aWindow.gBrowser.selectedTab = aWindow.gBrowser.addTab(this.aboutUri ? this.aboutUri.spec : this.chromeUri);
		}
		aWindow.focus();
		this.goTos(aWindow.gBrowser.selectedTab, aOptions);
	},

	goTos: function(aTab, aOptions) {
		if(!aOptions || (!aOptions.jumpto && !aOptions.pane)) { return; }

		if(aTab.linkedBrowser.contentDocument.readyState != 'complete') {
			let loader = () => {
				aTab.linkedBrowser.removeEventListener('load', loader, true);
				this.goTos(aTab, aOptions);
			};
			aTab.linkedBrowser.addEventListener('load', loader, true);
			return;
		}

		if(aOptions.jumpto) {
			try {
				aTab.linkedBrowser.contentWindow[objName].controllers.jumpto(aOptions.jumpto);
			}
			catch(ex) {
				// the object either doesn't exist or hasn't been initialized yet,
				// place our jump to query in a var in the window, and it will be picked up as soon as the object is ready
				aTab.linkedBrowser.contentWindow.__jumpTo = aOptions.jumpto;
			}
		}

		if(aOptions.pane) {
			try {
				aTab.linkedBrowser.contentWindow[objName].categories.gotoPref(aOptions.pane);
			}
			catch(ex) {
				// the object either doesn't exist or hasn't been initialized yet,
				// place our jump to query in a var in the window, and it will be picked up as soon as the object is ready
				aTab.linkedBrowser.contentWindow.__gotoPane = aOptions.pane;
			}
		}
	},

	closeAll: function() {
		Windows.callOnAll(aWindow => {
			for(let tab of aWindow.gBrowser.mTabs) {
				if(this.ours(tab.linkedBrowser.currentURI.spec)) {
					aWindow.gBrowser.removeTab(tab);
				}
			}

			// since we're disabling the add-on there's really no point in keeping closed tabs references to our preferences tab, as they won't be valid anymore
			if(aWindow.__SSi && aWindow.SessionStore) {
				let closedTabs = JSON.parse(aWindow.SessionStore.getClosedTabData(aWindow));
				let count = closedTabs.length;

				// we go backwards because forgetClosedTab() changes the array and we can only do one tab at once
				for(let i = count-1; i >= 0; i--) {
					let state = closedTabs[i].state;
					if(state && state.entries && state.entries.length) {
						for(let entry of state.entries) {
							if(this.ours(entry.url)) {
								aWindow.SessionStore.forgetClosedTab(aWindow, i);
								break;
							}
						}
					}
				}
			}
		}, 'navigator:browser');
	},

	ours: function(spec) {
		return spec.startsWith(this.chromeUri) || (this.aboutUri && spec.startsWith(this.aboutUri.spec));
	},

	initWindow: function(aWindow) {
		// prepare the window as usual
		replaceObjStrings(aWindow.document);
		prepareObject(aWindow, objName);

		// load the utils only when the preferences tab is finished with its overlays from this object
		let promises = [];
		for(let pane of this.panes.keys()) {
			promises.push(new Promise(function(resolve, reject) {
				let overlay = pane;
				Overlays.overlayWindow(aWindow, overlay, {
					onLoad: function() {
						resolve();
					}
				});
			}));
		}

		Promise.all(promises).then(() => {
			aWindow[objName].Modules.load("utils/preferencesUtils");

			// if any of the panes require their own module, make sure they are registered with the tab's categories object,
			// so that they are loaded when the corresponding categories are shown
			for(let modules of this.panes.values()) {
				if(modules) {
					for(let category in modules) {
						aWindow[objName].categories.addModule(category, modules[category]);
					}
				}
			}
		});
	}
};

Modules.LOADMODULE = function() {
	if(isChrome) {
		// Initialize some pref dependencies.
		Prefs.setDefaults({
			lastPrefPane: '',
			lastVersionNotify: '0',
			showTabOnUpdates: false,
			silentUpdates: false
		});
	}

	PrefPanes.init();
};

Modules.UNLOADMODULE = function() {
	PrefPanes.uninit();
};
