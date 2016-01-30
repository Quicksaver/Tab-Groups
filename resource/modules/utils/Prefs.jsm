// VERSION 2.6.1
Modules.UTILS = true;
Modules.BASEUTILS = true;

// Prefs -	Object to contain and manage all preferences related to the add-on (and others if necessary)
// 		All default preferences of the add-on ('extensions.objPathString.*') are sync'ed by Firefox Sync by default,
//		to prevent a specific preference "pref" from sync'ing, add in prefList a property "NoSync_pref" set to (bool) true.
// setDefaults(prefList, branch, trunk) - sets the add-on's preferences default values
//	prefList - (object) { prefName: defaultValue }, looks for 'trunk.branch.prefName'
//	(optional) branch - (string) defaults to objPathString
//	(optional) trunk - (string) defaults to 'extensions'
// listen(pref, handler) - add handler as a change event listener to pref
//	pref - (string) name of preference to append handler to
//	handler -	(function) to be fired on change event, expects (aSubject, aData) arguments,
//			or (nsiObserver) with observe(aSubject, aTopic, aData), where:
//				aSubject - (string) name of preference that was changed
//				aTopic - (string) "nsPref:changed"
//				aData - new preference value
// unlisten(pref, handler) - remove handler as a change event listener of pref
//	see listen()
// listening(pref, handler) - returns (bool) if handler is registered as pref listener, returns (bool) false otherwise
//	see listen()
// reset(pref) - resets pref to default value
//	see listen()
// proxyNative(cPref, nPrefName, nPrefDefaultValue, branch, trunk) -	use an add-on preference to proxy a native Firefox preference, possibly changing its default value even.
//									The native preference will be accesible by our Prefs object like if it was our own as well.
//									The native preference will be returned to its original value when disabling the add-on. If, on alternative,
//									you want to fully reset the preference instead (by user option for instance), just define a 'resetNative'
//									bool preference in the initial prefList and toggle it accordingly.
//	cPref - (string) name of our proxy preference as defined in prefList
//	nPrefName - (string) name of the native preference we want to proxy
//	nPrefDefaultValue - (string/bool/int) default value this preference has in Firefox.
//	see setDefaults()
// unProxyNative(cPref, nPrefName) - undoes proxying a native preference by the above proxyNative() method
//	see proxyNative()
this.Prefs = {
	instances: new Map(),
	natives: new Set(),
	cleaningOnShutdown: false,

	setDefaults: function(prefList, branch, trunk) {
		if(!branch) {
			branch = objPathString;
		}
		if(!trunk && trunk !== '') {
			trunk = 'extensions';
		}

		// we assume that a Prefs module has been initiated in the main process at least once, so none of this is actually necessary
		if(self.isChrome) {
			var branchString = ((trunk) ? trunk+'.' : '') +branch+'.';
			var defaultBranch = Services.prefs.getDefaultBranch(branchString);
			var syncBranch = Services.prefs.getDefaultBranch('services.sync.prefs.sync.');

			for(let pref in prefList) {
				if(pref.startsWith('NoSync_')) { continue; }

				// When updating from a version with prefs of same name but different type would throw an error and stop.
				// In this case, we need to clear it before we can set its default value again.
				var savedPrefType = defaultBranch.getPrefType(pref);
				var prefType = typeof(prefList[pref]);
				var compareType = '';
				switch(savedPrefType) {
					case defaultBranch.PREF_STRING:
						compareType = 'string';
						break;
					case defaultBranch.PREF_INT:
						compareType = 'number';
						break;
					case defaultBranch.PREF_BOOL:
						compareType = 'boolean';
						break;
					default: break;
				}
				if(compareType && prefType != compareType) {
					defaultBranch.clearUserPref(pref);
				}

				switch(prefType) {
					case 'string':
						defaultBranch.setCharPref(pref, prefList[pref]);
						break;
					case 'boolean':
						defaultBranch.setBoolPref(pref, prefList[pref]);
						break;
					case 'number':
						defaultBranch.setIntPref(pref, prefList[pref]);
						break;
					default:
						Cu.reportError('Preferece '+pref+' is of unrecognizeable type!');
						break;
				}

				if(trunk == 'extensions' && branch == objPathString && !prefList['NoSync_'+pref]) {
					syncBranch.setBoolPref(trunk+'.'+branch+'.'+pref, true);
				}
			}
		}

		// We do this separate from the process above because we would get errors sometimes:
		// setting a pref that has the same string name initially (e.g. "something" and "somethingElse"), it would trigger a change event for "something"
		// when set*Pref()'ing "somethingElse"
		for(let pref in prefList) {
			if(pref.startsWith('NoSync_')) { continue; }

			if(!this.instances.has(pref)) {
				this._setPref(pref, branch, trunk);
			}
		}
	},

	_setPref: function(pref, branch, trunk) {
		let instance = {};

		instance.listeners = new Set();
		instance.branch = Services.prefs.getBranch(((trunk) ? trunk+'.' : '') +branch+'.');
		instance.type = instance.branch.getPrefType(pref);

		switch(instance.type) {
			case Services.prefs.PREF_STRING:
				instance.__defineGetter__('value', function() { return this.branch.getCharPref(pref); });
				instance.__defineSetter__('value', function(v) { this.branch.setCharPref(pref, v); return this.value; });
				break;
			case Services.prefs.PREF_INT:
				instance.__defineGetter__('value', function() { return this.branch.getIntPref(pref); });
				instance.__defineSetter__('value', function(v) { this.branch.setIntPref(pref, v); return this.value; });
				break;
			case Services.prefs.PREF_BOOL:
				instance.__defineGetter__('value', function() { return this.branch.getBoolPref(pref); });
				instance.__defineSetter__('value', function(v) { this.branch.setBoolPref(pref, v); return this.value; });
				break;
		}

		this.__defineGetter__(pref, function() { return instance.value; });
		this.__defineSetter__(pref, function(v) { return instance.value = v; });

		this.instances.set(pref, instance);
		instance.branch.addObserver(pref, this, false);
	},

	listen: function(pref, handler) {
		let instance = this.instances.get(pref);

		// failsafe
		if(!instance) {
			Cu.reportError('Setting listener on unset preference: '+pref);
			return false;
		}

		if(!this.listening(pref, handler)) {
			instance.listeners.add(handler);
			return true;
		}
		return false;
	},

	unlisten: function(pref, handler) {
		let instance = this.instances.get(pref);

		// failsafe
		if(!instance) {
			Cu.reportError('Setting listener on unset preference: '+pref);
			return false;
		}

		if(this.listening(pref, handler)) {
			instance.listeners.delete(handler);
			return true;
		}
		return false;
	},

	listening: function(pref, handler) {
		return this.instances.get(pref).listeners.has(handler);
	},

	reset: function(pref) {
		this.instances.get(pref).branch.clearUserPref(pref);
	},

	observe: function(aSubject, aTopic, aData) {
		let pref = aData;
		while(!this.instances.has(pref)) {
			if(!pref.includes('.')) {
				Cu.reportError("Couldn't find listener handlers for preference "+aData);
				return;
			}
			pref = pref.substr(pref.indexOf('.')+1);
		}
		let instance = this.instances.get(pref);

		// in case we remove a listener and re-add it inside that same listener, it would be part of the iterable object as a new listener, creating an endless loop,
		// so we call only the listeners that were set at the time the change occurred
		let handlers = new Set();
		for(let handler of instance.listeners) {
			handlers.add(handler);
		}

		for(let handler of handlers) {
			// don't block executing of other possible listeners if one fails
			try {
				if(handler.observe) {
					handler.observe(pref, aTopic, this[pref]);
				} else {
					handler(pref, this[pref]);
				}
			}
			catch(ex) { Cu.reportError(ex); }
		}
	},

	proxyNative: function(cPref, nPrefName, nPrefDefaultValue, branch, trunk) {
		// When we're proxying a preference, we need to make sure it's always reverted on shutdown, so that its value is always reset to before it was changed by us.
		if(!this.cleaningOnShutdown) {
			this.cleaningOnShutdown = true;
			alwaysRunOnShutdown.push(() => { this.cleanNatives(); });
		}

		// We need to keep this preference accessible also from this object like any of our own preferences.
		this.setDefaults({ [nPrefName]: nPrefDefaultValue }, branch, trunk);

		let handler = {
			nPref: nPrefName,
			cPref: cPref,
			revertValue: Prefs[nPrefName],

			observe: function(aSubject, aTopic, aData) {
				switch(aSubject) {
					case this.nPref:
						this.revertValue = Prefs[this.nPref];
						Prefs.unlisten(this.cPref, this);
						Prefs[this.cPref] = Prefs[this.nPref];
						Prefs.listen(this.cPref, this);
						break;

					case this.cPref:
						Prefs.unlisten(this.nPref, this);
						Prefs[this.nPref] = Prefs[this.cPref];
						Prefs.listen(this.nPref, this);
						break;
				}
			}
		};

		this.natives.add(handler);
		this[nPrefName] = this[cPref];
		this.listen(cPref, handler);
		this.listen(nPrefName, handler);
	},

	unProxyNative: function(cPref, nPrefName) {
		for(let x of this.natives) {
			if(x.nPref == nPrefName && x.cPref == cPref) {
				this.shutdownProxy(x);
				this.natives.delete(x);
				break;
			}
		}
	},

	shutdownProxy: function(proxy) {
		this.unlisten(proxy.cPref, proxy);
		this.unlisten(proxy.nPref, proxy);
		if(!this.resetNative) {
			this[proxy.nPref] = proxy.revertValue;
		} else {
			this.reset(proxy.nPref);
		}
	},

	clean: function() {
		// Removing our change observer is enough, all actual listeners are just added to a sub-object that's about to be nuked with the add-on anyway.
		for(let [ pref, instance ] of this.instances) {
			instance.branch.removeObserver(pref, this);
		}

		this.cleanNatives();
	},

	cleanNatives: function() {
		// Restore native preferences to their value before our proxy preferences changed them (if applicable).
		for(let x of this.natives) {
			this.shutdownProxy(x);
		}
	}
};

Modules.LOADMODULE = function() {
	if(prefList) {
		Prefs.setDefaults(prefList);
	}
};

Modules.UNLOADMODULE = function() {
	Prefs.clean();
};
