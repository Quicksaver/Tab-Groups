/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.0

this.CatchRules = {
	// This module will only be initialized in frame scripts from windows that need it.
	moduleName: 'CatchRules',

	onLocationChange: function(aWebProgress, aRequest, aLocation) {
		// There's probably an easier way to fetch the frame's message manager context from the webprogress instance, I don't know it.
		// aWebProgress.tabChild.messageManager == frame only in remote browsers apparently; this errors in non-e10s.
		for(let frame of Frames._tracked.keys()) {
			if(frame.content == aWebProgress.DOMWindow) {
				Frames.message(frame, 'CatchRule', aLocation.spec);
				return;
			}
		}
	},

	onFrameAdded: function(frame) {
		Frames.get(frame).WebProgress.add(this, Ci.nsIWebProgress.NOTIFY_ALL);
	},

	onFrameDeleted: function(frame) {
		Frames.get(frame).WebProgress.remove(this, Ci.nsIWebProgress.NOTIFY_ALL);
	},

	// this is needed in content progress listeners (for some reason)
	QueryInterface: XPCOMUtils.generateQI([Ci.nsIWebProgressListener, Ci.nsISupportsWeakReference])
};

Modules.LOADMODULE = function() {
	Frames.register(CatchRules);
};

Modules.UNLOADMODULE = function() {
	Frames.unregister(CatchRules);
};
