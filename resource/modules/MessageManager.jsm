// VERSION 1.0.0

let cachebuster = Date.now()
let frameScriptUri = "resource://tabgroups/modules/content/frameScript.js?"+cachebuster;
let processScriptUri = "resource://tabgroups/modules/content/utils/pageapi.js?"+cachebuster;

Modules.LOADMODULE = function() {
  let data = {
      addonUris: addonUris,
      objPathString: objPathString
  }


  Services.mm.loadFrameScript(frameScriptUri, true, true);
  Services.ppmm.loadProcessScript(processScriptUri, true);

  // set for future processes
  Services.ppmm.initialProcessData["tabgroups:config"] = data;
  // send for already existing processes
  Services.ppmm.broadcastAsyncMessage("tabgroups:config-update", data);

};

Modules.UNLOADMODULE = function() {
  Services.mm.removeDelayedFrameScript(frameScriptUri);
  Services.ppmm.removeDelayedProcessScript(processScriptUri);
  Services.ppmm.broadcastAsyncMessage("tabgroups:shutdown-content");
};
