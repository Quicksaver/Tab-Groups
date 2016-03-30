// VERSION 1.0.0

this.SessionManager = {
	id: '{1280606b-2510-4fe0-97ef-9b5a22eafe30}',

	Constants: null,
	enabled: false,

	onEnabled: function(addon) {
		if(addon.id == this.id) { this.enable(); }
	},

	onDisabled: function(addon) {
		if(addon.id == this.id) { this.disable(); }
	},

	listen: function() {
		AddonManager.addAddonListener(this);
		AddonManager.getAddonByID(this.id, (addon) => {
			if(addon && addon.isActive) { this.enable(); }

			if(pageWatch.waitForSessionManagerModule) {
				pageWatch.waitForSessionManagerModule();
				delete pageWatch.waitForSessionManagerModule;
			}
		});
	},

	unlisten: function() {
		AddonManager.removeAddonListener(this);
		this.disable();
	},

	enable: function() {
		this.enabled = true;

		Cu.import("chrome://sessionmanager/content/modules/shared_data/constants.jsm", this);
		pageWatch.kKeepingSession.add(this.Constants.STARTUP_PROMPT);
		pageWatch.kKeepingSession.add(this.Constants.STARTUP_LOAD);
	},

	disable: function() {
		if(this.enabled) {
			this.enabled = false;

			pageWatch.kKeepingSession.delete(this.Constants.STARTUP_PROMPT);
			pageWatch.kKeepingSession.delete(this.Constants.STARTUP_LOAD);
		}
	}
};

Modules.LOADMODULE = function() {
	SessionManager.listen();
};

Modules.UNLOADMODULE = function() {
	SessionManager.unlisten();
};
