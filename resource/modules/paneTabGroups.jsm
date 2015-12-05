// VERSION 1.0.1

this.sessionRestore = {
	get button() { return $('paneTabGroups-sessionRestore-button'); },

	handleEvent: function() {
		this.enable();
	},

	observe: function() {
		this.updateButton();
	},

	init: function() {
		Prefs.listen('page', this);

		Listeners.add(this.button, 'command', this);

		this.updateButton();
	},

	uninit: function() {
		Listeners.remove(this.button, 'command', this);

		Prefs.unlisten('page', sessionRestore);
	},

	updateButton: function() {
		toggleAttribute(this.button, 'disabled', Prefs.page == 3);
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
