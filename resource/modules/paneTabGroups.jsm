/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.1.0

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

this.setdefaults = {
	btn: $('paneTabGroups-setdefaults-button'),

	handleEvent: function() {
		Observers.notify(objName+'-set-groups-defaults');
	},

	init: function() {
		Listeners.add(this.btn, 'command', this);
	},

	uninit: function() {
		Listeners.remove(this.btn, 'command', this);
	}
};

Modules.LOADMODULE = function() {
	sessionRestore.init();
	setdefaults.init();
};

Modules.UNLOADMODULE = function() {
	sessionRestore.uninit();
	setdefaults.uninit();
};
