/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.3

// This script should be loaded by defaultsContent.js, which is in turn loaded directly by the Messenger module.
// defaultsContent.js call its .init(objPathString, frame) method, where frame is the enviroment of the frame script.
// This helps with defining a "separate" environment in the content script, while remaining accessible to the rest of the content scope.
//
// Use the Messenger object to send message safely to this object without conflicting with other add-ons.
// To load or unload modules in the modules/content/ folder into this object, use Messenger's loadIn* methods.
// Reserved messages for the Messenger system: shutdown, load, unload, init, disable.
//
// The Frames object allows interaction with each individual frame environment from within the process environment.
// Frames.callOnAll(aCallback) - executes aCallback with each frame script given as its single argument.
// Frames.register(aListener) - registers aListener as a handler to initialize new frames with. Expects an object with the following optional methods and properties:
//	onFrameAdded(aFrame) - (method) called when a new frame (tab) is opened.
//	onFrameDeleted(aFrame) - (method) called when a frame (tab) is closed.
//	moduleName -	(string) if set, only those frames defined with the same value will be run through aListener's initialization methods.
//			This is done through Messenger's loadInWindow method in the chrome process, see its notes there.
// Frames.get(aFrame) - returns our constructed environment for the given frame script, aFrame[objName], with Modules and utils loaded in it.
//
// Methods that can be used inside content modules (both for process scripts and frame scripts):
// listen(aMessage, aListener) - adds aListener as a receiver for when aMessage is passed from chrome to content through the Messenger object.
//	aMessage - (string) message to listen to
//	aListener - (function) the listener that will respond to the message. Expects (message) as its only argument; see https://developer.mozilla.org/en-US/docs/The_message_manager
// unlisten(aMessage, aListener) - stops aListener from responding to aMessage.
//	see listen()
// message(aMessage, aData, aCPOW, bSync) - sends a message to chrome to be handled through Messenger
//	aData - to be sent with the message
//	(optional) aCPOW - object to be sent with the message; may cause performance issues, so avoid at all costs; defaults to undefined.
//	(optional) bSync - (bool) true sends the message synchronously; may cause performance issues, so avoid at all costs; defaults to false.
//	see listen()
// handleDeadObject(ex) - 	expects [nsIScriptError object] ex. Shows dead object notices as warnings only in the console.
//				If the code can handle them accordingly and firefox does its thing, they shouldn't cause any problems.
//				This should be a copy of the same method in bootstrap.js.
// DOMContentLoaded.add(aListener) - use this to listen to DOMContentLoaded events in frame scripts, instead of adding a dedicated listener to Scope
//	aListener - (function) normal event listener or (object) a object containing a .handleEvent method as typical event listeners;
// DOMContentLoaded.remove(aListener) - undo the above step
//	see DOMContentLoaded.add

var {classes: Cc, interfaces: Ci, utils: Cu, manager: Cm} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "console", "resource://gre/modules/Console.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "PluralForm", "resource://gre/modules/PluralForm.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Promise", "resource://gre/modules/Promise.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Task", "resource://gre/modules/Task.jsm");
XPCOMUtils.defineLazyServiceGetter(Services, "navigator", "@mozilla.org/network/protocol;1?name=http", "nsIHttpProtocolHandler");

// See the definition of these in bootstrap.js
var AddonData = null;
var Globals = {};
var objName = null;
var objPathString = null;
var prefList = null;
var addonUris = {
	homepage: '',
	support: '',
	fullchangelog: '',
	email: '',
	profile: '',
	api: '',
	development: ''
};

var Scope = this;
var isChrome = false;
var isContent = true;

// to nuke the sandbox we are in
var gModuleInSandbox = null;

var gInitialized = false;
var gDisabled = false;

var WINNT = Services.appinfo.OS == 'WINNT';
var DARWIN = Services.appinfo.OS == 'Darwin';
var LINUX = Services.appinfo.OS != 'WINNT' && Services.appinfo.OS != 'Darwin';

// easy and useful helpers for when I'm debugging
function LOG(str) {
	if(!str) { str = typeof(str)+': '+str; }
	console.log(objName+' :: CONTENT :: '+str);
}
function STEPLOGGER(name) {
	this.name = name;
	this.steps = [];
	this.initTime = new Date().getTime();
	this.lastTime = this.initTime;
}
STEPLOGGER.prototype = {
	step: function(name) {
		let time = new Date().getTime();
		this.steps.push({ name, time: time - this.lastTime});
		this.lastTime = time;
	},
	end: function() {
		this.step('end');
		let endTime = new Date().getTime();
		let report = { name: this.name, total: endTime - this.initTime };
		for(let x of this.steps) {
			report[x.name] = x.time;
		}
		console.log(report);
	}
};

function handleDeadObject(ex) {
	if(ex.message == "can't access dead object") {
		let scriptError = Cc["@mozilla.org/scripterror;1"].createInstance(Ci.nsIScriptError);
		scriptError.init("Can't access dead object. This shouldn't cause any problems.", ex.sourceName || ex.fileName || null, ex.sourceLine || null, ex.lineNumber || null, ex.columnNumber || null, scriptError.warningFlag, 'XPConnect JavaScript');
		Services.console.logMessage(scriptError);
		return true;
	} else {
		Cu.reportError(ex);
		return false;
	}
}

function messageName(m) {
	// +1 is for the ':' after objName
	return m.name.substr(objName.length +1);
}

// List of tabs (frames) being tracked by the module in this process.
var Frames = {
	_tracked: new Map(),
	_listeners: new Set(),

	MESSAGES: [
		'loadInWindow',
		'unloadFromWindow',
		'load',
		'unload'
	],

	receiveMessage: function(m) {
		// I wonder if this can even happen
		if(!this._tracked.has(m.target)) { return; }

		let name = messageName(m);

		switch(name) {
			case 'loadInWindow':
				// These are modules that are loaded once in the ChildProcess object, but initialized with every frame.
				// Useful for simple listeners and communications for each frame that don't necessarily need to keep any data in memory.
				if(m.data.inProcess) {
					let modulesInFrame = this._tracked.get(m.target);

					// Already initialized in this frame. Nothing to do.
					if(modulesInFrame.get(m.data.name) === true) { break; }
					modulesInFrame.set(m.data.name, false);

					// Make sure the Module is ready
					ChildProcess.loadModule(m.data.name);
					if(!gInitialized) { break; }

					for(let listener of this._listeners) {
						if(listener.moduleName == m.data.name) {
							this.callOnFrameAdded(m.target, listener);
						}
					}

					break;
				}

				// These modules, while loaded in all frames of the window, are treated as individual modules for each frame script.
				this.loadModule(m.target, m.data.name);
				break;

			case 'unloadFromWindow':
				if(m.data.inProcess) {
					let modulesInFrame = this._tracked.get(m.target);
					if(modulesInFrame.get(m.data.name) === true) {
						for(let listener of this._listeners) {
							if(listener.moduleName == m.data.name) {
								this.callOnFrameDeleted(m.target, listener);
							}
						}
					}
					modulesInFrame.delete(m.data.name);

					// If no frames are defined with this module, we most likely don't need it loaded anymore
					// (its feature has probably been disabled for instance).
					for(let modulesInFrame of this._tracked.values()) {
						if(modulesInFrame.has(m.data.name)) { return; }
					}

					ChildProcess.unloadModule(m.data.name);

					break;
				}

				this.unloadModule(m.target, m.data.name);
				break;

			case 'load':
				this.loadModule(m.target, m.data);
				break;

			case 'unload':
				this.unloadModule(m.target, m.data);
				break;
		}
	},

	handleEvent: function(e) {
		switch(e.type) {
			case 'unload':
				if(e.target instanceof Ci.nsIMessageListenerManager) {
					e.target.unloaded = true;
					this.delete(e.target);
				}
				break;
		}
	},

	get: function(aFrame) {
		if(!this._tracked.has(aFrame)) { return null; }

		// We want to return our helper object, and not the frame environment itself.
		if(!aFrame[objName]) {
			aFrame[objName] = {
				// lazy load the utils, to avoid any unnecessary wasted cycles
				ModulesLoaded: false,
				get Modules () {
					this.ModulesLoaded = true;
					delete this.Modules;
					Services.scriptloader.loadSubScript("resource://"+objPathString+"/modules/utils/Modules.jsm", this);
					Services.scriptloader.loadSubScript("resource://"+objPathString+"/modules/utils/windowUtilsPreload.jsm", this);
					return this.Modules;
				},

				Scope: aFrame,
				get docShell () { return aFrame.docShell; },
				get content () { return aFrame.content; },
				get document () { return this.content.document; },
				$: function(id) { return this.document.getElementById(id); },
				$$: function(sel, parent = this.document) { return parent.querySelectorAll(sel); },
				$ª: function(parent, anonid, anonattr = 'anonid') { return this.document.getAnonymousElementByAttribute(parent, anonattr, anonid); },

				// send a message to chrome from this specific frame
				message: function(aMessage, aData, aCPOW, bSync) {
					Frames.message(aFrame, aMessage, aData, aCPOW, bSync);
				},

				listen: function(aMessage, aListener) {
					Frames.listen(aFrame, aMessage, aListener);
				},

				unlisten: function(aMessage, aListener) {
					Frames.unlisten(aFrame, aMessage, aListener);
				},

				// Originally this was to prevent a weird ZC when adding multiple listeners to the frame script scope for DOMContentLoaded.
				// I can't reproduce this anymore though, but I'm leaving this because I use it often and it's better to attach a single listener
				// than multiple ones over all the scripts.
				DOMContentLoaded: {
					listening: false,
					listeners: new Set(),

					add: function(aListener) {
						if(!this.listening) {
							aFrame.addEventListener('DOMContentLoaded', this);
							this.listening = true;
						}

						this.listeners.add(aListener);
					},

					remove: function(aListener) {
						this.listeners.delete(aListener);
					},

					handleEvent: function(e) {
						for(let listener of this.listeners) {
							try {
								if(typeof(listener.handleEvent) == 'function') {
									listener.handleEvent(e);
								} else {
									listener(e);
								}
							}
							catch(ex) { Cu.reportError(ex); }
						}
					}
				},

				// Apparently if removing a listener that hasn't been added (or maybe it's something else?) this will throw,
				// the error should be reported but it's probably ok to continue with the process, this shouldn't block modules from being (un)loaded.
				WebProgress: {
					_nsI: null,
					get nsI() {
						if(!this._nsI) {
							this._nsI = aFrame.docShell.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebProgress);
						}
						return this._nsI;
					},

					add: function(aListener, aNotifyMask) {
						try { this.nsI.addProgressListener(aListener, aNotifyMask); }
						catch(ex) { Cu.reportError(ex); }
					},

					remove: function(aListener, aNotifyMask) {
						if(!this._nsI) { return; }

						try { this.nsI.removeProgressListener(aListener, aNotifyMask); }
						catch(ex) { Cu.reportError(ex); }
					}
				}
			};
		}

		return aFrame[objName];
	},

	message: function(aFrame, aMessage, aData, aCPOW, bSync) {
		// prevents console messages on e10s closing windows (i.e. view-source),
		// there's no point in sending messages from here if "here" doesn't exist anymore
		if(!aFrame.content) { return; }

		if(bSync) {
			aFrame.sendSyncMessage(objName+':'+aMessage, aData, aCPOW);
			return;
		}

		aFrame.sendAsyncMessage(objName+':'+aMessage, aData, aCPOW);
	},

	listen: function(aFrame, aMessage, aListener) {
		aFrame.addMessageListener(objName+':'+aMessage, aListener);
	},

	unlisten: function(aFrame, aMessage, aListener) {
		aFrame.removeMessageListener(objName+':'+aMessage, aListener);
	},

	loadModule: function(aFrame, aModule) {
		// prevents console messages on e10s startup if this is loaded onto the initial temporary browser, which is almost immediately removed afterwards
		if(!aFrame.content) { return; }

		let gFrame = this.get(aFrame);
		if(!gFrame) { return; }

		gFrame.Modules.load('content/'+aModule);
	},

	unloadModule: function(aFrame, aModule) {
		// prevents console messages on e10s startup if this is loaded onto the initial temporary browser, which is almost immediately removed afterwards
		if(!aFrame.content) { return; }

		// Bail-out early when possible.
		if(!aFrame[objName]) { return; }

		let gFrame = this.get(aFrame);
		if(!gFrame) { return; }

		gFrame.Modules.unload('content/'+aModule);
	},

	add: function(aFrame) {
		if(!this._tracked.has(aFrame)) {
			this._tracked.set(aFrame, new Map());

			aFrame.addEventListener('unload', this);
			for(let msg of this.MESSAGES) {
				this.listen(aFrame, msg, this);
			}

			for(let listener of this._listeners) {
				// Only initialize modules that aren't specific to a given window here. Those will be initialized independently later.
				if(!listener.moduleName) {
					this.callOnFrameAdded(aFrame, listener);
				}
			}

			this.message(aFrame, 'init');
		}
	},

	delete: function(aFrame) {
		if(this._tracked.has(aFrame)) {
			aFrame.removeEventListener('unload', this);
			for(let msg of this.MESSAGES) {
				this.unlisten(aFrame, msg, this);
			}

			for(let listener of this._listeners) {
				this.callOnFrameDeleted(aFrame, listener);
			}

			if(aFrame[objName]) {
				if(!aFrame.unloaded) {
					if(aFrame[objName].DOMContentLoaded.listening) {
						aFrame.removeEventListener('DOMContentLoaded', aFrame[objName].DOMContentLoaded);
					}
					if(aFrame[objName].ModulesLoaded) {
						aFrame[objName].Modules.clean();
					}
				}
				delete aFrame[objName];
			}

			this._tracked.delete(aFrame);
		}
	},

	register: function(aListener) {
		if(this._listeners.has(aListener)) { return; }

		this._listeners.add(aListener);
		for(let frame of this._tracked.keys()) {
			this.callOnFrameAdded(frame, aListener);
		}
	},

	unregister: function(aListener) {
		if(!this._listeners.has(aListener)) { return; }

		this._listeners.delete(aListener);
		for(let frame of this._tracked.keys()) {
			this.callOnFrameDeleted(frame, aListener);
		}
	},

	callOnFrameAdded: function(aFrame, aListener) {
		let modulesInFrame = this._tracked.get(aFrame);
		if(!aListener.moduleName || modulesInFrame.get(aListener.moduleName) === false) {
			if(aListener.onFrameAdded) {
				try { aListener.onFrameAdded(aFrame); }
				catch(ex) { Cu.reportError(ex); }
			}

			if(aListener.moduleName) {
				modulesInFrame.set(aListener.moduleName, true);
			}
		}
	},

	callOnFrameDeleted: function(aFrame, aListener) {
		let modulesInFrame = this._tracked.get(aFrame);
		if(!aListener.moduleName || modulesInFrame.get(aListener.moduleName) === true) {
			if(aListener.onFrameDeleted) {
				try { aListener.onFrameDeleted(aFrame); }
				catch(ex) { Cu.reportError(ex); }
			}

			if(aListener.moduleName) {
				modulesInFrame.set(aListener.moduleName, false);
			}
		}
	},

	callOnAll: function(aCallback) {
		for(let frame of this._tracked.keys()) {
			try { aCallback(frame); }
			catch(ex) { Cu.reportError(ex); }
		}
	},

	clean: function() {
		for(let frame of this._tracked.keys()) {
			try { this.delete(frame); }
			catch(ex) { Cu.reportError(ex); }
		}
	}
};

// This communicates with the parent script (chrome) and handles everything in this process.
// It is a sort of bootstrap.js for the add-on in the child process.
var ChildProcess = {
	// implement message listeners
	MESSAGES: [
		'shutdown',
		'load',
		'unload',
		'init',
		'disable'
	],

	// modules that are found in modules/utils/ and not in modules/content/utils/
	nonContentModules: new Set([ 'utils/PrefPanes' ]),

	receiveMessage: function(m) {
		let name = messageName(m);

		switch(name) {
			case 'shutdown':
				this.unload();
				break;

			case 'load':
				this.loadModule(m.data);
				break;

			case 'unload':
				this.unloadModule(m.data);
				break;

			case 'init':
				this.finishInit(m.data);
				break;

			case 'disable':
				gDisabled = true;
				break;
		}
	},

	init: function(aObjPathString, aFrame, aModuleInSandbox) {
		if(!gModuleInSandbox) {
			gModuleInSandbox = aModuleInSandbox;

			try {
				Services.scriptloader.loadSubScript("resource://"+aObjPathString+"/defaults.js", Scope);
			}
			catch(ex) {
				// We expect there to be a controlled error that stops execution of that script,
				// since we really only care about getting the initial variables
				if(ex !== 'isContent') {
					Cu.reportError(ex);
				}
			}

			// and finally our add-on stuff begins
			Services.scriptloader.loadSubScript("resource://"+objPathString+"/modules/utils/Modules.jsm", Scope);
			Services.scriptloader.loadSubScript("resource://"+objPathString+"/modules/utils/sandboxUtilsPreload.jsm", Scope);

			for(let msg of this.MESSAGES) {
				this.listen(msg, this);
			}

			this.message('init');
		}

		Frames.add(aFrame);
	},

	finishInit: function(data) {
		AddonData = data.AddonData;
		gInitialized = true;
	},

	listen: function(aMessage, aListener) {
		Services.cpmm.addMessageListener(objName+':'+aMessage, aListener);
	},

	unlisten: function(aMessage, aListener) {
		Services.cpmm.removeMessageListener(objName+':'+aMessage, aListener);
	},

	// send a message to chrome
	message: function(aMessage, aData, aCPOW, bSync) {
		if(bSync) {
			Services.cpmm.sendSyncMessage(objName+':'+aMessage, aData, aCPOW);
			return;
		}

		Services.cpmm.sendAsyncMessage(objName+':'+aMessage, aData, aCPOW);
	},

	loadModule: function(name) {
		if(!this.nonContentModules.has(name)) {
			name = 'content/'+name;
		}
		Modules.load(name);
	},

	unloadModule: function(name) {
		if(!this.nonContentModules.has(name)) {
			name = 'content/'+name;
		}
		Modules.unload(name);
	},

	// clean up this object
	unload: function() {
		// when updating the add-on, the new content script is loaded before the shutdown message is received by the previous script (go figure...),
		// so we'd actually be unloading both the old and new scripts, that's obviously not what we want!
		if(gInitialized) {
			try {
				Modules.clean();
			}
			catch(ex) { Cu.reportError(ex); }

			for(let msg of this.MESSAGES) {
				this.unlisten(msg, this);
			}

			Frames.clean();
			gInitialized = false;
		}

		// We'll be able to unload the module directly once bug 1195689 is fixed. For now we can only nuke the sandbox we are loading into.
		//Cu.unload("resource://"+objPathString+"/modules/content/utils/ChildProcess.jsm");
		gModuleInSandbox.uninit();
	}
};
