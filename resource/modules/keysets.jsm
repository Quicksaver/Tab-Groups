Modules.VERSION = '1.0.0';

this.tabViewKey = {
	id: objName+'-key-tabView',
	command: objName+':ToggleTabView',
	get keycode () { return Prefs.tabViewKeycode; },
	get accel () { return Prefs.tabViewAccel; },
	get shift () { return Prefs.tabViewShift; },
	get alt () { return Prefs.tabViewAlt; },

	observe: function(aSubject, aTopic, aData) {
		this.set();
	},

	set: function() {
		if(this.keycode != 'none') { Keysets.register(this); }
		else { Keysets.unregister(this); }
	}
};

Modules.LOADMODULE = function() {
	tabViewKey.set();

	Prefs.listen('tabViewKeycode', tabViewKey);
	Prefs.listen('tabViewAccel', tabViewKey);
	Prefs.listen('tabViewShift', tabViewKey);
	Prefs.listen('tabViewAlt', tabViewKey);
};

Modules.UNLOADMODULE = function() {
	Prefs.unlisten('tabViewKeycode', tabViewKey);
	Prefs.unlisten('tabViewAccel', tabViewKey);
	Prefs.unlisten('tabViewShift', tabViewKey);
	Prefs.unlisten('tabViewAlt', tabViewKey);

	Keysets.unregister(tabViewKey);
};
