/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.1

this.CatchRules = {
	initialized: false,
	rules: null,

	receiveMessage: function(m) {
		let tab = gBrowser.getTabForBrowser(m.target);
		if(!tab) { return; }

		let url = m.data;
		for(let rule of this.rules) {
			// This is likely not a new tab, so process it only if the user chose to catch all tabs.
			if(rule.once && tab._caughtOnce) { continue; }

			if(rule.exp.test(url)) {
				TabView._initFrame(function() {
					TabView.moveTabTo(tab, rule.groupId, true);
				});
				break;
			}
		}
		tab._caughtOnce = true;
	},

	handleEvent: function(e) {
		// SSWindowStateReady or SSWindowRestored
		this.init();
	},

	init: function() {
		this.rules = [];

		let groupData = Storage.readGroupItemData(window);
		if(groupData) {
			for(let id in groupData) {
				let data = groupData[id];
				if(data.id && data.catchRules && typeof(data.catchRules) == 'string') {
					let lines = data.catchRules.replace(/\r\n/g, "\n").split("\n");
					for(let line of lines) {
						try {
							let trimmed = trim(line);
							if(trimmed) {
								let exp = new RegExp(line);
								this.rules.push({
									groupId: data.id,
									once: data.catchOnce,
									exp
								});
							}
						}
						catch(ex) {
							// This will fail on poorly constructed expressions. Just ignore those.
						}
					}
				}
			}
		}

		// We only initialize the content script if we have user-set rules to follow,
		// otherwise don't waste cycles processing the tabs.
		if(!this.rules.length) {
			this.uninit();
			return;
		}

		if(this.initialized) { return; }
		this.initialized = true;

		// Mark currently open tabs as already been visited by us.
		for(let tab of Tabs.all) {
			tab._caughtOnce = true;
		}

		Messenger.loadInWindow(window, 'CatchRules');
		Messenger.listenWindow(window, 'CatchRule', this);
	},

	uninit: function() {
		if(!this.initialized) { return; }
		this.initialized = false;

		for(let tab of Tabs.all) {
			delete tab._caughtOnce;
		}

		Messenger.unloadFromWindow(window, 'CatchRules');
		Messenger.unlistenWindow(window, 'CatchRule', this);
	}
};

Modules.LOADMODULE = function() {
	// Sometimes restoring a window's data doesn't happen right away at startup. Other times its session can be rewritten entirely.
	if(Services.vc.compare(Services.appinfo.version, "51.0a1") < 0) {
		Listeners.add(window, "SSWindowStateReady", CatchRules);
	} else {
		Listeners.add(window, "SSWindowRestored", CatchRules);
	}

	CatchRules.init();
};

Modules.UNLOADMODULE = function() {
	if(Services.vc.compare(Services.appinfo.version, "51.0a1") < 0) {
		Listeners.remove(window, "SSWindowStateReady", CatchRules);
	} else {
		Listeners.remove(window, "SSWindowRestored", CatchRules);
	}

	CatchRules.uninit();
};
