/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.4

this.TabCenter = {
	id: 'tabcentertest1@mozilla.com',

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
		});
	},

	unlisten: function() {
		AddonManager.removeAddonListener(this);
		this.disable();
	},

	enable: function() {
		if(!this.enabled) {
			this.enabled = true;

			Styles.load('TabCenter', 'compatibilityFix/TabCenter');

			if(window.VerticalTabs) {
				this.init();
			} else {
				window.__defineGetter__('VerticalTabs', function() { return undefined; });
				window.__defineSetter__('VerticalTabs', (v) => {
					delete window.VerticalTabs;
					window.VerticalTabs = v;
					this.init(true);
				})
			}
		}
	},

	disable: function() {
		if(this.enabled) {
			this.enabled = false;

			Styles.unload('TabCenter', 'compatibilityFix/TabCenter');

			// Make sure our setter handler is removed.
			if(!window.VerticalTabs) {
				delete window.VerticalTabs;
			}
			// Otherwise we have to undo our fixes properly.
			else {
				this.uninit();
			}
		}
	},

	get findInput() { return $('find-input'); },

	handleEvent: function(e) {
		switch(e.type) {
			case 'TabBarUpdated':
				window.VerticalTabs.clearFind('tabGroupChange');
				break;
		}
	},

	attrWatcher: function() {
		toggleAttribute($('TabsToolbar'), 'tabCenterInputFocused', trueAttribute($('find-input'), 'focused'));
	},

	init: function(justCreated) {
		window.VerticalTabs._lastInputValue = '';

		Piggyback.add('TabCenter', window.VerticalTabs, 'filtertabs', function() {
			// There's no need to re-filter the tabs if the correct ones are already showing.
			// This saves precious cycles on startup, by not initializing TabView immediately.
			let hidden_tab = $('filler-tab');
			let find_input = $('find-input');
			let input_value = find_input.value.toLowerCase();
			if(!input_value && !this._lastInputValue) {
				hidden_tab.setAttribute('hidden', 'true');
				Timers.init('TabCenter.filtertabs', () => {
					this.actuallyResizeTabs();
				}, 300);
				return;
			}

			TabView._initFrame(() => {
				Timers.init('TabCenter.filtertabs', () => {
					this._lastInputValue = input_value;

					// If there's no filter term, show all the tabs in the current group.
					if(!input_value) {
						TabView._window.UI.updateShownTabs();
						hidden_tab.setAttribute('hidden', 'true');
						this.actuallyResizeTabs();
						return;
					}

					// Only filter tabs from the current group.
					let tabs;
					let activeGroup = TabView._window.GroupItems.getActiveGroupItem();
					if(activeGroup) {
						// Pinned tabs are always shown, regardless of group.
						tabs = Tabs.pinned.concat(activeGroup.children.map((tabItem) => { return tabItem.tab; }));
					} else {
						// The few cases where there is no active group, it's safe to assume all tabs are visble.
						tabs = Tabs.all;
					}

					let hidden_counter = 0;
					for(let tab of tabs) {
						let label = tab.label || '';
						if(label.toLowerCase().match(input_value) || this.getUri(tab).spec.toLowerCase().match(input_value)) {
							tab.removeAttribute('hidden');
						}
						else {
							tab.setAttribute('hidden', 'true');
							hidden_counter++;
						}
					}

					let hidden_tab_label = hidden_tab.children[0];

					if(hidden_counter > 0) {
						hidden_tab_label.setAttribute('value', `${hidden_counter} more tab${hidden_counter > 1 ? 's' : ''}...`);
						hidden_tab.removeAttribute('hidden');
					} else {
						hidden_tab.setAttribute('hidden', 'true');
					}
					this.actuallyResizeTabs();
				}, 300);
			});
		});

		// We have to call this at least once now, to make sure that when it was enabled before, we hide tabs from other groups.
		if(!justCreated) {
			window.VerticalTabs.filtertabs();
		}

		Tabs.listen('TabBarUpdated', this);

		let setupTextbox = () => {
			Watchers.addAttributeWatcher(this.findInput, 'focused', this, false, false);
			this.attrWatcher();
		};

		// Hide our button when Tab Center's find textbox is focused.
		if(this.findInput) {
			setupTextbox();
		} else {
			Piggyback.add('TabCenter', window.VerticalTabs, 'rearrangeXUL', () => {
				setupTextbox();
			}, Piggyback.MODE_AFTER);
		}
	},

	uninit: function() {
		Timers.cancel('TabCenter.filtertabs');
		Piggyback.revert('TabCenter', window.VerticalTabs, 'filtertabs');
		Piggyback.revert('TabCenter', window.VerticalTabs, 'rearrangeXUL');
		delete window.VerticalTabs._lastInputValue;

		Tabs.unlisten('TabBarUpdated', this);
		if(this.findInput) {
			Watchers.removeAttributeWatcher(this.findInput, 'focused', this, false, false);
		}
		removeAttribute($('TabsToolbar'), 'tabCenterInputFocused');

		// TabCenter should show any tabs it wants to now.
		window.VerticalTabs.filtertabs();
	}
};

Modules.LOADMODULE = function() {
	TabCenter.listen();
};

Modules.UNLOADMODULE = function() {
	TabCenter.unlisten();
};
