/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.1.0

XPCOMUtils.defineLazyModuleGetter(this, "gSessionManager", "chrome://sessionmanager/content/modules/session_manager.jsm");

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
			if(addon && addon.isActive) {
				this.enable();
			}

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
		pageWatch.SM = true;

		Cu.import("chrome://sessionmanager/content/modules/shared_data/constants.jsm", this);
		pageWatch.kKeepingSession.add(this.Constants.STARTUP_PROMPT);
		pageWatch.kKeepingSession.add(this.Constants.STARTUP_LOAD);

		let defaults = Services.prefs.getDefaultBranch("extensions."+this.id+".");
		Prefs.setDefaults({
			startup: defaults.getIntPref("startup"),
			backup_session: defaults.getIntPref("backup_session")
		}, this.id);

		// SM's auto backup and restore preferences could have been changed, so see if we should adapt anything.
		Prefs.listen('startup', pageWatch);
		Prefs.listen('backup_session', pageWatch);
		pageWatch.callListeners();
	},

	disable: function() {
		if(this.enabled) {
			this.enabled = false;
			pageWatch.SM = false;

			pageWatch.kKeepingSession.delete(this.Constants.STARTUP_PROMPT);
			pageWatch.kKeepingSession.delete(this.Constants.STARTUP_LOAD);

			Prefs.unlisten('startup', pageWatch);
			Prefs.unlisten('backup_session', pageWatch);
			pageWatch.callListeners();
		}
	},

	isSavingSession: function() {
		return Prefs.backup_session && Prefs.startup;
	}
};

Modules.LOADMODULE = function() {
	SessionManager.listen();
};

Modules.UNLOADMODULE = function() {
	SessionManager.unlisten();
};
