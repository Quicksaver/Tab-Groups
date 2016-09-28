/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.1.1

this.api = {
	// weak-refing the listener may or may not be necessary to prevent leaks of the sandbox during addon reload due to dangling listeners
	QueryInterface: XPCOMUtils.generateQI([Ci.nsISupports, Ci.nsISupportsWeakReference, Ci.nsIDOMEventListener]),

	handleEvent: function(e) {
		let doc = e.originalTarget;
		if(doc && doc.defaultView && doc instanceof doc.defaultView.HTMLDocument) {
			// is this an inner frame? Skip if it is
			if(doc.defaultView.frameElement && doc !== doc.defaultView.frameElement.ownerDocument) { return; }

			if(e.type == 'load') {
				doc.defaultView.removeEventListener('load', this);
			}

			this.checkPage(doc);
		}
	},

	checkPage: function(document) {
		let content = document.defaultView;
		if(document.readyState != 'complete') {
			content.addEventListener('load', this);
			return;
		}

		if(document.documentURI.startsWith(addonUris.development)) {
			let unwrap = XPCNativeWrapper.unwrap(content);
			if(unwrap.enable) {
				unwrap.enable(objPathString);
			}
		}
	},

	onFrameAdded: function(frame) {
		frame.addEventListener('DOMContentLoaded', this);

		let document = frame.content && frame.content.document;
		if(document && document instanceof frame.content.HTMLDocument) {
			this.checkPage(document);
		}
	},

	onFrameDeleted: function(frame) {
		frame.removeEventListener('DOMContentLoaded', this);
		if(frame.content) {
			frame.content.removeEventListener('load', this);
		}

	}
};

Modules.LOADMODULE = function() {
	Frames.register(api);
};

Modules.UNLOADMODULE = function() {
	Frames.unregister(api);
};
