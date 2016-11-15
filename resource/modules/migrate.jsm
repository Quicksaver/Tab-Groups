/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.3.1

this.migrate = {
	migratorBackstage: null,

	init: function() {
		this.migratePrefs();
		this.skipTabGroupsMigrator();
	},

	uninit: function() {
		if(this.migratorBackstage) {
			this.migratorBackstage.TabGroupsMigrator = this.migratorBackstage._TabGroupsMigrator;
			delete this.migratorBackstage._TabGroupsMigrator;
		}
	},

	migratePrefs: function() {
		if(!Prefs.migratedPrefs) {
			if(Services.prefs.prefHasUserValue('browser.panorama.session_restore_enabled_once')) {
				Prefs.pageAutoChanged = Services.prefs.getBoolPref('browser.panorama.session_restore_enabled_once');
			}
			Prefs.migratedPrefs = true;
		}
	},

	// we need to wait until at least one window is finished loading, so that CustomizableUI knows what it's doing
	migrateWidget: function() {
		// try to place our widget in the same place where the native widget used to be
		if(!Prefs.migratedWidget) {
			for(let area of CustomizableUI.areas) {
				try {
					let ids = CustomizableUI.getWidgetIdsInArea(area);
					let position = ids.indexOf("tabview-button");
					if(position != -1) {
						CustomizableUI.addWidgetToArea(objName+'-tabview-button', area, position);
						break;
					}
				}
				catch(ex) { Cu.reportError(ex); }
			}
			Prefs.migratedWidget = true;
		}
	},

	skipTabGroupsMigrator: function() {
		try {
			this.migratorBackstage = Cu.import("resource:///modules/TabGroupsMigrator.jsm", {});
		}
		catch(ex) {
			// this will fail until bug 1221050 lands
			return;
		}

		this.migratorBackstage._TabGroupsMigrator = this.migratorBackstage.TabGroupsMigrator;
		this.migratorBackstage.TabGroupsMigrator = {
			// no-op the migration, we'll just keep using the same data in the add-on anyway
			migrate: function() {}
		};
	}
};

Modules.LOADMODULE = function() {
	migrate.init();
};

Modules.UNLOADMODULE = function() {
	migrate.uninit();
};
