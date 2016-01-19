// VERSION 1.1.0

this.api = {
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
	}
};

Modules.LOADMODULE = function() {
	Frames.register(api);
};

Modules.UNLOADMODULE = function() {
	Frames.unregister(api);
};
