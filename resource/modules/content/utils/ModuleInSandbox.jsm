/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.0

// This is a workaround for bug 1195689, to allow us to update the ChildProcess.jsm module properly on add-on updates.
// Since we can't unload a JSM module on shutdown, we instead assign it to a sandbox that we can nuke.
// Because of that, any update to this file will typically require a full browser restart to fully take effect.
// Also, this doesn't eliminate the ZC when disabling the add-on, since this JSM will remain loaded in the process
// (even though the actual module in the sandbox is nuked).

// When bug 1195689 is fixed, we'll be able to use ChildProcess.jsm directly and discard this file completely.

var EXPORTED_SYMBOLS = [ "ModuleInSandbox" ];

var {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");

var gSandbox = null;

var ModuleInSandbox = {
	init: function(objPathString, aFrame) {
		if(!gSandbox) {
			let systemPrincipal = Cc["@mozilla.org/systemprincipal;1"].createInstance(Ci.nsIPrincipal);
			gSandbox = Cu.Sandbox(systemPrincipal, { freshZone: true, sandboxName: objPathString+"-ModuleInSandbox" });
			Services.scriptloader.loadSubScript("resource://"+objPathString+"/modules/content/utils/ChildProcess.jsm", gSandbox);
		}
		gSandbox.ChildProcess.init(objPathString, aFrame, this);
	},

	uninit: function() {
		if(gSandbox) {
			Cu.nukeSandbox(gSandbox);
			gSandbox = null;
		}
	}
};
