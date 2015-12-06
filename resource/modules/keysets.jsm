// VERSION 2.0.0

this.keysets = new Set([
	{
		id: objName+'-key-tabView',
		command: objName+':ToggleTabView',

		keycodePref: 'tabViewKeycode',
		accelPref: 'tabViewAccel',
		shiftPref: 'tabViewShift',
		altPref: 'tabViewAlt',

		get keycode () { return Prefs[this.keycodePref]; },
		get accel () { return Prefs[this.accelPref]; },
		get shift () { return Prefs[this.shiftPref]; },
		get alt () { return Prefs[this.altPref]; },

		observe: function(aSubject, aTopic, aData) {
			this.set();
		},

		set: function() {
			if(this.keycode != 'none') { Keysets.register(this); }
			else { Keysets.unregister(this); }
		}
	},
	{
		id: objName+'-key-nextGroup',
		command: objName+':NextGroup',

		keycodePref: 'nextGroupKeycode',
		accelPref: 'nextGroupAccel',
		shiftPref: 'nextGroupShift',
		altPref: 'nextGroupAlt',

		get keycode () { return Prefs[this.keycodePref]; },
		get accel () { return Prefs[this.accelPref]; },
		get shift () { return Prefs[this.shiftPref]; },
		get alt () { return Prefs[this.altPref]; },

		observe: function(aSubject, aTopic, aData) {
			this.set();
		},

		set: function() {
			if(this.keycode != 'none') { Keysets.register(this); }
			else { Keysets.unregister(this); }
		}
	},
	{
		id: objName+'-key-previousGroup',
		command: objName+':PreviousGroup',

		keycodePref: 'previousGroupKeycode',
		accelPref: 'previousGroupAccel',
		shiftPref: 'previousGroupShift',
		altPref: 'previousGroupAlt',

		get keycode () { return Prefs[this.keycodePref]; },
		get accel () { return Prefs[this.accelPref]; },
		get shift () { return Prefs[this.shiftPref]; },
		get alt () { return Prefs[this.altPref]; },

		observe: function(aSubject, aTopic, aData) {
			this.set();
		},

		set: function() {
			if(this.keycode != 'none') { Keysets.register(this); }
			else { Keysets.unregister(this); }
		}
	}
]);

Modules.LOADMODULE = function() {
	// this is to migrate to the new Keysets object, it can probably be removed once most users have updated to the latest version
	if(!Prefs.migratedKeysets) {
		Prefs.migratedKeysets = true;
		Prefs.tabViewKeycode = Keysets.translateFromConstantCode(Prefs.tabViewKeycode);
	}

	for(let key of keysets) {
		key.set();

		Prefs.listen(key.keycodePref, key);
		Prefs.listen(key.accelPref, key);
		Prefs.listen(key.shiftPref, key);
		Prefs.listen(key.altPref, key);
	}
};

Modules.UNLOADMODULE = function() {
	for(let key of keysets) {
		Prefs.unlisten(key.keycodePref, key);
		Prefs.unlisten(key.accelPref, key);
		Prefs.unlisten(key.shiftPref, key);
		Prefs.unlisten(key.altPref, key);

		Keysets.unregister(key);
	}
};
