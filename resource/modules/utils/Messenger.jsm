/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.6.0
Modules.UTILS = true;

// Messenger - 	Aid object to communicate with browser content scripts (e10s).
//		Important: this loads the defaults.js file into every browser window, so make sure that everything in it is wrapped in their own methods,
//		or that at least it won't fail when loaded like this.
// messageName(aMessage) - to ensure that all receivers respond to messages that come only from this add-on
//	aMessage - (message object) will return the message name stripped off the add-on's identifier; or (string) returns with the add-on identifier appended
// messageChild(aSender, aMessage, aData, aCPOW) - sends a message to the given process script's message sender.
//	aSender - (object) the nsIMessageSender of the child process to receive the message
//	aMessage - (string) message to send, will be sent as objName-aMessage
//	aData - (string) data to be passed along with the message; can be a JSON-serializable object
//	aCPOW - (object) an object, typically a xul element, that will be proxied to the content script
// messageBrowser(aBrowser, aMessage, aData, aCPOW) - sends a message to frame scripts of a browser
//	aBrowser - (xul element) the browser element to send the message to
//	see messageChild()
// messageWindow(aWindow, aMessage, aData, aCPOW) - sends a message to frame scripts of all browsers in the provided window
//	aWindow - (obj) window of which all browsers should receive this message
//	see messageChild()
// messageAll(aMessage, aData, aCPOW) - sends a message to frame scripts of all browsers in all windows
//	see messageChild()
// listenBrowser(aBrowser, aMessage, aListener) - registers a listener for messages sent from content scripts through this backbone's methods
//	aBrowser - (xul element) the browser element from which to listen to messages
//	aMessage - (string) message to listen for
//	aListener - (function) the listener that will respond to the message. Expects (message) as its only argument; see https://developer.mozilla.org/en-US/docs/The_message_manager
// unlistenBrowser(aBrowser, aMessage, aListener) - unregisters a listener for messages sent from content scripts
//	see listenBrowser()
// listenWindow(aWindow, aMessage, aListener) - registers a listener for messages sent from all browsers in the provided window
//	aWindow - (obj) window of which all browsers should be listened to
//	see listenBrowser()
// unlistenWindow(aWindow, aMessage, aListener) - unregisters a listener for messages sent from all browsers in the provided window
//	see listenWindow()
// listenAll(aMessage, aListener) - registers a listener for messages sent from all browsers open in all windows
//	see listenBrowser()
// unlistenAll(aMessage, aListener) - unregisters a listener for messages sent from all browsers open in all windows
//	see listenBrowser()
// loadInBrowser(aBrowser, aModule) - loads a module into the frame script of the specified browser
//	aBrowser - (xul element) the browser element corresponding to the content script into which to load the module
//	aModule - (string) name of the module to load
// unloadFromBrowser(aBrowser, aModule) - unloads a module from a frame script [undoes loadInBrowser()]
//	see loadInBrowser()
// loadInWindow(aWindow, aModule, inProcess) - loads a module into all the content scripts of a specified window
//	aWindow - (xul element) navigator window of which all content scripts will have the module loaded into
//	inProcess -	(bool) if false, the content script will be loaded into each individual frame script of the given window.
//			If true (default), it will be loaded into the global child process script. Use the Frames object to register the content module properly in this case,
//			by setting its .moduleName property to its own name.
//	see loadInBrowser()
// unloadFromWindow(aWindow, aModule) - unloads a module from all the content scripts of a window [undoes loadInWindow()]
//	see loadInWindow()
// loadInAll(aModule) - loads a module into all child process scripts
//	see loadInBrowser()
// unloadFromAll(aModule) - unloads a module from all child process scripts [undoes loadInAll()]
//	see loadInBrowser()
this.Messenger = {
	loadedInAll: new Set(),

	messageName: function(aMessage) {
		// when supplying a message object, we want to strip it of this add-on's unique identifier to get only the actual message
		if(aMessage.name) {
			if(aMessage.name.startsWith(objName+':')) {
				// +1 is for the ':' after objName
				return aMessage.name.substr(objName.length +1);
			}

			return aMessage.name;
		}

		// if supplying a string, we make sure it is appended with this add-on's unique identifier
		if(!aMessage.startsWith(objName+':')) {
			return objName+':'+aMessage;
		}

		// nothing to do, return as is
		return aMessage;
	},

	messageChild: function(aSender, aMessage, aData, aCPOW) {
		if(!aSender || !(aSender instanceof Ci.nsIMessageSender)) { return; }

		aSender.sendAsyncMessage(this.messageName(aMessage), aData, aCPOW);
	},

	messageBrowser: function(aBrowser, aMessage, aData, aCPOW) {
		if(aBrowser && aBrowser.messageManager) {
			this.messageChild(aBrowser.messageManager, aMessage, aData, aCPOW);
			return;
		}

		this.messageChild(aBrowser, aMessage, aData, aCPOW);
	},

	messageWindow: function(aWindow, aMessage, aData, aCPOW) {
		if(!aWindow || !aWindow.messageManager) { return; }

		aWindow.messageManager.broadcastAsyncMessage(this.messageName(aMessage), aData, aCPOW);
	},

	messageAll: function(aMessage, aData, aCPOW) {
		Services.mm.broadcastAsyncMessage(this.messageName(aMessage), aData, aCPOW);
	},

	listenBrowser: function(aBrowser, aMessage, aListener) {
		if(!aBrowser || !aBrowser.messageManager) { return; }

		aBrowser.messageManager.addMessageListener(this.messageName(aMessage), aListener);
	},

	unlistenBrowser: function(aBrowser, aMessage, aListener) {
		if(!aBrowser || !aBrowser.messageManager) { return; }

		aBrowser.messageManager.removeMessageListener(this.messageName(aMessage), aListener);
	},

	listenWindow: function(aWindow, aMessage, aListener) {
		if(!aWindow || !aWindow.messageManager) { return; }

		aWindow.messageManager.addMessageListener(this.messageName(aMessage), aListener);
	},

	unlistenWindow: function(aWindow, aMessage, aListener) {
		if(!aWindow || !aWindow.messageManager) { return; }

		aWindow.messageManager.removeMessageListener(this.messageName(aMessage), aListener);
	},

	listenAll: function(aMessage, aListener) {
		Services.mm.addMessageListener(this.messageName(aMessage), aListener);
	},

	unlistenAll: function(aMessage, aListener) {
		Services.mm.removeMessageListener(this.messageName(aMessage), aListener);
	},

	loadInBrowser: function(aBrowser, aModule) {
		this.messageBrowser(aBrowser, 'load', aModule);
	},

	unloadFromBrowser: function(aBrowser, aModule) {
		this.messageBrowser(aBrowser, 'unload', aModule);
	},

	loadInWindow: function(aWindow, aModule, inProcess = true) {
		if(!aWindow[objName+'Content']) {
			aWindow[objName+'Content'] = new Set();
		}
		else {
			// If it's already loaded we probably don't need the overhead of all the back and forth messaging.
			for(let module of aWindow[objName+'Content']) {
				if(module.name == aModule && module.inProcess == inProcess) { return; }
			}
		}

		let module = {
			name: aModule,
			inProcess: inProcess
		};
		aWindow[objName+'Content'].add(module);
		this.messageWindow(aWindow, 'loadInWindow', module);
	},

	unloadFromWindow: function(aWindow, aModule) {
		// If it's already not loaded we definitely don't need the overhead of all the back and forth messaging.
		if(!aWindow[objName+'Content']) { return; }

		for(let module of aWindow[objName+'Content']) {
			if(module.name == aModule) {
				this.messageWindow(aWindow, 'unloadFromWindow', module);

				aWindow[objName+'Content'].delete(module);
				if(!aWindow[objName+'Content'].size) {
					delete aWindow[objName+'Content'];
				}
				break;
			}
		}
	},

	loadInAll: function(aModule) {
		if(this.loadedInAll.has(aModule)) { return; }

		this.loadedInAll.add(aModule);
		Services.ppmm.broadcastAsyncMessage(this.messageName('load'), aModule);
	},

	unloadFromAll: function(aModule) {
		if(!this.loadedInAll.has(aModule)) { return; }

		this.loadedInAll.delete(aModule);
		Services.ppmm.broadcastAsyncMessage(this.messageName('unload'), aModule);
	},

	receiveMessage: function(m) {
		// Initialize any frame script with the modules that should be loaded in all tabs of that window.
		if(m.target.ownerGlobal) {
			let modules = m.target.ownerGlobal[objName+'Content'];
			if(modules) {
				for(let module of modules) {
					this.messageBrowser(m.target, 'loadInWindow', module);
				}
			}
			return;
		}

		// can't stringify AddonData directly, because it contains an nsIFile instance (installPath) and an nsIURI instance (resourceURI)
		let carryData = {
			AddonData: {
				id: AddonData.id,
				initTime: AddonData.initTime,
				version: AddonData.version,
				oldVersion: AddonData.oldVersion,
				newVersion: AddonData.newVersion
			}
		};
		this.messageChild(m.target, 'init', carryData);

		// load into this browser all the content modules that should be loaded in all content scripts
		for(let module of this.loadedInAll) {
			this.messageChild(m.target, 'load', module);
		}
	},

	cleanWindow: function(aWindow) {
		if(aWindow[objName+'Content']) {
			for(let module of aWindow[objName+'Content']) {
				this.messageWindow(aWindow, 'unloadFromWindow', module);
			}
			delete aWindow[objName+'Content'];
		}
	}
};

Modules.LOADMODULE = function() {
	MessengerLoaded = true;

	Messenger.listenAll('init', Messenger);
	Services.ppmm.addMessageListener(Messenger.messageName('init'), Messenger);
	Services.mm.loadFrameScript('resource://'+objPathString+'/defaultsContent.js?'+AddonData.initTime, true);
};

Modules.UNLOADMODULE = function() {
	Services.ppmm.removeMessageListener(Messenger.messageName('init'), Messenger);
	Messenger.unlistenAll('init', Messenger);

	Windows.callOnAll(Messenger.cleanWindow, 'navigator:browser');

	Services.mm.removeDelayedFrameScript('resource://'+objPathString+'/defaultsContent.js?'+AddonData.initTime);
	Services.ppmm.broadcastAsyncMessage(Messenger.messageName('shutdown'));
};
