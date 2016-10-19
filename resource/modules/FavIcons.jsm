/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.1.3

this.FavIcons = {
	waiting: new Set(),
	colors: new Map(),
	_iconsNeedingColor: [],

	get enabled() {
		return Prefs.site_icons && Prefs.favicons;
	},

	get defaultFavicon() {
		return this._favIconService.defaultFavicon.spec;
	},

	init: function() {
		XPCOMUtils.defineLazyServiceGetter(this, "_favIconService", "@mozilla.org/browser/favicon-service;1", "nsIFaviconService");
	},

	uninit: function() {
		Styles.unload("FavIcons_"+_UUID);
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
				callback(null);
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
		if(!this.enabled) {
			return false;
		}

		let uri = tab.linkedBrowser.currentURI;

		// Stop here if we don't have a valid nsIURI.
		if(!uri || !(uri instanceof Ci.nsIURI)) {
			return false;
		}

		// Load favicons for http(s) pages only.
		return uri.schemeIs("http") || uri.schemeIs("https");
	},

	forgetItem: function(item) {
		if(item._iconUrl && this.colors.has(item._iconUrl)) {
			let deferred = this.colors.get(item._iconUrl);
			deferred.hold--;
		}
		item._iconUrl = null;
	},

	// Returns the dominant color for a given favicon url.
	getDominantColor: function(iconUrl, item) {
		// Keep track of how many tabs are using each icon, for cleanup purposes later.
		if(item._iconUrl && item._iconUrl != iconUrl && this.colors.has(item._iconUrl)) {
			let deferred = this.colors.get(item._iconUrl);
			deferred.hold--;
		}
		item._iconUrl = iconUrl;

		if(this.colors.has(iconUrl)) {
			let deferred = this.colors.get(iconUrl);
			deferred.hold++;
			return deferred.promise;
		}

		let deferred = {
			color: null,
			hold: 1
		};
		deferred.promise = new Promise((resolve, reject) => {
			// Store the resolve and reject methods in the deferred object.
			deferred.resolve = resolve;
			deferred.reject = reject;
		});

		this.colors.set(iconUrl, deferred);

		if(TabItems.shouldDeferPainting()) {
			this._iconsNeedingColor.push(iconUrl);
			if(!TabItems.isPaintingPaused()) {
				TabItems.startHeartbeat();
			}
		} else {
			this._findDominantColor(iconUrl).then(() => {
				// Make sure the new color is applied.
				this._loadColorsStylesheet();
			});
		}

		return deferred.promise;
	},

	// Finding the dominant colors is controlled from inside TabItems' heartbeats, so both processes don't stack over one another.

	_findDominantColor: Task.async(function* (iconUrl) {
		TabItems.paintingNow();

		// Preloading on a separate thread prevents flooding the main thread with that task,
		// which could become become the heaviest step in the process, especially in non-e10s.
		// (loading the icon in the img can take 100x as long in the main process for some reason...)
		let preloaded = yield this._preloadIcon(iconUrl);
		if(!preloaded) {
			return false;
		}

		return new Promise((resolve, reject) => {
			// The following was adapted from Margaret Leibovic's snippet posted at https://gist.github.com/leibovic/1017111

			let icon = document.createElement("img");
			icon.addEventListener("load", () => {
				// We don't need to remove this listener, this element isn't attached anywhere
				// and will be GC'd as soon as this finishes.

				let canvas = document.createElement("canvas");
				canvas.height = icon.height;
				canvas.width = icon.width;

				let context = canvas.getContext("2d");
				context.drawImage(icon, 0, 0);

				// data is an array of a series of 4 one-byte values representing the rgba values of each pixel
				let imageData = context.getImageData(0, 0, icon.height, icon.width);

				// keep track of how many times a color appears in the image
				let worker = new Worker('resource://'+objPathString+'/workers/findDominantColor.js');
				worker.onmessage = (e) => {
					if(e.data.iconUrl == iconUrl) {
						let deferred = this.colors.get(iconUrl);
						deferred.color = e.data.dominantColor;
						deferred.resolve(e.data.dominantColor);
						worker.terminate();
						resolve(true);
					}
				};
				worker.postMessage({ iconUrl, imageData });
			});
			icon.src = iconUrl;
		});
	}),

	_preloadIcon: function(iconUrl) {
		return new Promise((resolve, reject) => {
			let worker = new Worker('resource://'+objPathString+'/workers/preloadIcon.js');
			worker.onmessage = (e) => {
				if(e.data.iconUrl == iconUrl) {
					resolve(e.data.loaded);
					worker.terminate();
				}
			};
			worker.postMessage({ iconUrl });
		});
	},

	_loadColorsStylesheet: function() {
		if(!this.colors.size) {
			Styles.unload("FavIcons_"+_UUID);
			return;
		}

		let sscode = '@-moz-document url("'+document.baseURI+'") {\n';

		for(let [ iconUrl, deferred ] of this.colors) {
			let color = deferred.color;
			if(!color) { continue; }

			sscode += '\
				html['+objName+'_UUID="'+_UUID+'"] .tab-container.onlyIcons .tab:not([busy]) .favicon-container[iconUrl="'+iconUrl+'"] {\n\
					border-color: rgb('+color+');\n\
					background-image: linear-gradient(to bottom, rgba('+color+',0.1), rgba('+color+',0.4));\n\
					box-shadow: inset 0 0 1px rgba('+color+',0.5), var(--favicon-tile-shadow);\n\
				}\n';
		}

		sscode += '}';

		Styles.load("FavIcons_"+_UUID, sscode, true);
	},

	cleanupStaleColors: function() {
		let update = false;
		for(let [ iconUrl, deferred ] of this.colors) {
			if(!deferred.hold) {
				if(deferred.color === null) {
					deferred.reject();
					for(let i = 0; i < this._iconsNeedingColor.length; i++) {
						if(this._iconsNeedingColor[i] == iconUrl) {
							this._iconsNeedingColor.splice(i, 1);
							break;
						}
					}
				}
				this.colors.delete(iconUrl);
				update = true;
			}
		}

		if(update) {
			this._loadColorsStylesheet();
		}
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
