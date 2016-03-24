// VERSION 1.0.3

this.sessionRestore = {
	get button() { return $('paneTabGroups-sessionRestore-button'); },

	handleEvent: function() {
		this.enable();
	},

	observe: function() {
		this.updateButton();
	},

	init: function() {
		pageWatch.register(this);

		Listeners.add(this.button, 'command', this);

		this.updateButton();
	},

	uninit: function() {
		Listeners.remove(this.button, 'command', this);

		try { pageWatch.unregister(this); }
		catch(ex) { /* doesn't matter */ }
	},

	updateButton: function() {
		toggleAttribute(this.button, 'disabled', pageWatch.sessionRestoreEnabled);
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
