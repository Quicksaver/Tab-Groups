/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.1.1
Modules.UTILS = true;

this.Tabs = {
	get length() {
		return gBrowser.tabs.length;
	},

	get all() {
		// gBrowser.tabs is a NodeList, not an array
		return Array.filter(gBrowser.tabs, function(tab) { return !tab.closing; });
	},

	get pinned() {
		return this.all.filter(function(tab) { return tab.pinned; });
	},

	get notPinned() {
		return this.all.filter(function(tab) { return !tab.pinned; });
	},

	get numPinned() {
		return gBrowser._numPinnedTabs;
	},

	get visible() {
		return gBrowser.visibleTabs;
	},

	get selected() {
		return gBrowser.selectedTab;
	},
	set selected(tab) {
		return gBrowser.selectedTab = tab;
	},

	hasHidden: function() {
		return (this.length - Tabs.visible.length);
	},

	listen: function(eventName, listener) {
		Listeners.add(gBrowser.tabContainer, eventName, listener);
	},

	unlisten: function(eventName, listener) {
		Listeners.remove(gBrowser.tabContainer, eventName, listener);
	}
};
