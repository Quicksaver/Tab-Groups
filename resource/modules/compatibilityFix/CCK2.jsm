/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.0

// The CCK2FileBlock module prevents our main iframe from loading browser.dtd to fetch needed localized textbox context menu entries.
// This has since been fixed in the latest version of CCK2.2, but older deployments may take some time to be updated, considering the nature of CCK2.
// So this is meant for compatibility with older versions of CCK2 only, by replacing their method with the updated one.

this.CCK2 = {
	fileBlock: null,

	observe: function(aSubject, aTopic, aData) {
		// We're only observing 'final-ui-startup'
		Observers.remove(this, 'final-ui-startup');

		aSync(() => {
			this.check();
		});
	},

	check: function() {
		// Is the file block component registered? Since CCK2 isn't technically an add-on, this is the most reliable check I could think of.
		let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
		if(registrar.isContractIDRegistered('@kaply.com/cck2-fileblock-service;1')) {
			try {
				let fileBlock = Cu.import("resource://cck2/CCK2FileBlock.jsm").CCK2FileBlock;
				// Only replace if the method isn't already updated.
				if(!fileBlock.shouldLoad.toString().includes('.includes(".xul")')) {
					this.fileBlock = fileBlock;
					// This is the same exact method as found on https://github.com/mkaply/cck2wizard/blob/master/cck2/modules/CCK2FileBlock.jsm#L10-L26,
					// which already contains the working update commited at https://github.com/mkaply/cck2wizard/commit/8846fb3bcc8e873f05b73e4d26819d84cb70325a
					Piggyback.add('CCK2', this.fileBlock, 'shouldLoad', function(aContentType, aContentLocation, aRequestOrigin, aContext, aMimeTypeGuess, aExtra) {
						// Prevent the loading of chrome URLs into the main browser window
						if(aContentLocation.scheme == "chrome") {
							if(aRequestOrigin && (aRequestOrigin.spec == "chrome://browser/content/browser.xul" || aRequestOrigin.scheme == "moz-nullprincipal")) {
								for(let i = 0; i < this.chromeBlacklist.length; i++) {
									if(aContentLocation.host == this.chromeBlacklist[i]) {
										if(aContentLocation.spec.includes(".xul")) {
											return Ci.nsIContentPolicy.REJECT_REQUEST;
										}
									}
								}
							}
						}
						return Ci.nsIContentPolicy.ACCEPT;
					});
				}
			}
			catch(ex) {
				// Very old versions of CCK2 (April 2015 and before) don't have this module exposed, so there's nothing we can do then.
				// Doesn't really matter, whatever caused the failure there's nothing we can do. The user should really update CCK2 at this point if possible anyway.
			}
		}
	},

	init: function() {
		this.check();

		// The FileBlock component is only registered once this notification is fired.
		Observers.add(this, 'final-ui-startup');
	},

	uninit: function() {
		Observers.remove(this, 'final-ui-startup');
		if(this.fileBlock) {
			Piggyback.revert('CCK2', this.fileBlock, 'shouldLoad');
		}
	}
};

Modules.LOADMODULE = function() {
	CCK2.init();
};

Modules.UNLOADMODULE = function() {
	CCK2.uninit();
};
