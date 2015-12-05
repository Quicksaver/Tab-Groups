// VERSION 1.0.1

this.pageWatch = {
	observe: function() {
		// the user changed this preference specifically, our backup is no longer valid
		if(Prefs.page != 3) {
			Prefs.pageBackup = -1;
			this.stop();
		}
	},

	start: function() {
		if(Prefs.page == 3 && Prefs.pageBackup != -1) {
			Prefs.listen('page', this);
		}
	},

	stop: function() {
		Prefs.unlisten('page', this);
	},

	enableSessionRestore: function() {
		if(Prefs.page == 3) { return; }

		Prefs.pageBackup = Prefs.page;
		Prefs.page = 3;
		this.start();
	},

	init: function() {
		Prefs.setDefaults({ page: 1 }, 'startup', 'browser');

		this.start();

		// nothing to do
		if(Prefs.page == 3 || Prefs.pageBackup == -1) { return; }

		// We have a backup, which means we have changed the preference, so make sure it stays changed!
		// (if the browser has been restarted in the meantime, it's probably too late to recover the previous session data already,
		// but this should never happen under normal circumstances)
		Prefs.page = 3;
	},

	uninit: function() {
		this.stop();

		// is this even possible?
		if(!UNLOADED) { return; }

		// did we even change the pref ourselves?
		if(Prefs.pageBackup == -1) { return; }

		// if the user has removed the add-on, we should restore the previous value if we changed it
		if(UNLOADED == ADDON_DISABLE || UNLOADED == ADDON_UNINSTALL) {
			Prefs.page = Prefs.pageBackup;
		}
	}
};

Modules.LOADMODULE = function() {
	pageWatch.init();
};

Modules.UNLOADMODULE = function() {
	pageWatch.uninit();
};
