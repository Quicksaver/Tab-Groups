/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.5

this.FavIcons = {
	waiting: new Set(),

	get defaultFavicon() {
		return this._favIconService.defaultFavicon.spec;
	},

	init: function() {
		XPCOMUtils.defineLazyServiceGetter(this, "_favIconService", "@mozilla.org/browser/favicon-service;1", "nsIFaviconService");
	},

	// Gets the "favicon link URI" for the given xul:tab, or null if unavailable.
	getFavIconUrlForTab: function(tab, callback) {
		this._isImageDocument(tab).then((isImageDoc) => {
			if(isImageDoc) {
				callback(tab.pinned ? tab.image : null);
			} else {
				this._getFavIconForNonImageDocument(tab, callback);
			}
		}).catch(() => {
			callback(null);
		});
	},

	// Retrieves the favicon for a tab containing a non-image document.
	_getFavIconForNonImageDocument: function(tab, callback) {
		if(tab.image) {
			this._getFavIconFromTabImage(tab, callback);
		} else if(this._shouldLoadFavIcon(tab)) {
			this._getFavIconForHttpDocument(tab, callback);
		} else {
			callback(null);
		}
	},

	// Retrieves the favicon for tab with a tab image.
	_getFavIconFromTabImage: function(tab, callback) {
		let tabImage = gBrowser.getIcon(tab);

		// If the tab image's url starts with http(s), fetch icon from favicon service via the moz-anno protocol.
		if(/^https?:/.test(tabImage)) {
			let tabImageURI = gWindow.makeURI(tabImage);
			tabImage = this._favIconService.getFaviconLinkForIcon(tabImageURI).spec;
		}

		callback(tabImage);
	},

	// Retrieves the favicon for tab containg a http(s) document.
	_getFavIconForHttpDocument: function(tab, callback) {
		let {currentURI} = tab.linkedBrowser;
		this._favIconService.getFaviconURLForPage(currentURI, (uri) => {
			if(uri) {
				let icon = this._favIconService.getFaviconLinkForIcon(uri).spec;
				callback(icon);
			} else {
				callback(this.defaultFavicon);
			}
		});
	},

	// Checks whether an image is loaded into the given tab.
	_isImageDocument: function(tab) {
		return new Promise((resolve, reject) => {
			// sometimes on first open, we don't get a response right away because the message isn't actually sent, although I have no clue why...
			// We have to take care to only do this while the TabView frame exists, otherwise it can easily enter an endless loop, e.g. when updating the add-on.
			let receiver = {
				timer: null,
				count: 0,

				reject: function() {
					// We don't need to separate this from resolve, since rejecting it will prevent any subsequent resolves.
					reject(null);
					this.end(null);
				},

				receiveMessage: function(m) {
					this.end(m.data);
				},

				fire: function() {
					this.count++;
					if(this.count > 10) {
						this.reject();
					} else {
						Messenger.messageBrowser(tab.linkedBrowser, "isImageDocument");

						if(!this.timer) {
							this.timer = Timers.create(() => {
								this.fire();
							}, 1000, 'slack');
						}
					}
				},

				end: function(response) {
					this.timer.cancel();
					Messenger.unlistenBrowser(tab.linkedBrowser, "isImageDocument", this);
					resolve(response);
					// It may not exist anymore? Not sure if it's possible but it doesn't really matter at this point, let's just not stop shutdown.
					try { FavIcons.waiting.delete(this); }
					catch(ex) {}
				}
			};

			this.waiting.add(receiver);
			Messenger.listenBrowser(tab.linkedBrowser, "isImageDocument", receiver);
			receiver.fire();
		});
	},

	// Checks whether fav icon should be loaded for a given tab.
	_shouldLoadFavIcon: function(tab) {
		// No need to load a favicon if the user doesn't want site or favicons.
		if(!Prefs.site_icons || !Prefs.favicons) {
			return false;
		}

		let uri = tab.linkedBrowser.currentURI;

		// Stop here if we don't have a valid nsIURI.
		if(!uri || !(uri instanceof Ci.nsIURI)) {
			return false;
		}

		// Load favicons for http(s) pages only.
		return uri.schemeIs("http") || uri.schemeIs("https");
	}
};

Modules.LOADMODULE = function() {
	Prefs.setDefaults({
		site_icons: true,
		favicons: true
	}, 'chrome', 'browser');
};

Modules.UNLOADMODULE = function() {
	for(let receiver of FavIcons.waiting) {
		receiver.reject();
	}
};
