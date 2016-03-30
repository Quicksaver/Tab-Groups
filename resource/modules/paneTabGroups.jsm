// VERSION 1.0.4

this.sessionRestore = {
	get button() { return $('paneTabGroups-sessionRestore-button'); },
	get groupbox() { return $('paneTabGroups-sessionRestore'); },

	handleEvent: function() {
		this.enable();
	},

	observe: function() {
		this.updateGroupbox();
	},

	init: function() {
		pageWatch.register(this);

		Listeners.add(this.button, 'command', this);

		this.updateGroupbox();
	},

	uninit: function() {
		Listeners.remove(this.button, 'command', this);

		try { pageWatch.unregister(this); }
		catch(ex) { /* doesn't matter */ }
	},

	updateGroupbox: function() {
		this.groupbox.hidden = pageWatch.sessionRestoreEnabled;
	},

	enable: function() {
		pageWatch.enableSessionRestore();
		if(controllers.nodes.jumpto.value == 'sessionRestore') {
			controllers.jumpto('');
		}
	}
};

Modules.LOADMODULE = function() {
	sessionRestore.init();
};

Modules.UNLOADMODULE = function() {
	sessionRestore.uninit();
};
