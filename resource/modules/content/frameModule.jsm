// VERSION 1.0.0

'use strict';

var EXPORTED_SYMBOLS = ["registerFrame"]

const Cu = Components.utils;
const Ci = Components.interfaces;
const Cc = Components.classes;
const systemPrincipal = Cc["@mozilla.org/systemprincipal;1"].createInstance(Ci.nsIPrincipal);
const loader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"].getService(Components.interfaces.mozIJSSubScriptLoader);

let sandbox = Cu.Sandbox(systemPrincipal, {freshZone: true, sandboxName: "tabgroups content sandbox", wantComponents: true});

loader.loadSubScript("resource://tabgroups/modules/content/contentSandbox.js" , sandbox);

const Services = Cu.import("resource://gre/modules/Services.jsm", {}).Services;
const cpmm = Services.cpmm;
const console = Cu.import("resource://gre/modules/devtools/Console.jsm", {}).console;

let active = true;

//console.log("tabgroups frame module loaded");

const shutdownHook = {
	receiveMessage: function(m) {
		if(!active)
			return;
		//console.log("unloading tabgroups frame module");
		active = false;
		sandbox.shutdown();
		Cu.nukeSandbox(sandbox)
		sandbox = null;
		cpmm.removeMessageListener("tabgroups:shutdown-content", shutdownHook);
		Cu.unload("resource://tabgroups/modules/content/frameModule.jsm");
	}
}

cpmm.addMessageListener("tabgroups:shutdown-content", shutdownHook);


function registerFrame(frame) {
	if(!active) { return; }
	sandbox.registerFrame(frame);
}
