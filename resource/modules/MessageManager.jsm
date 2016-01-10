// VERSION 1.0.0

const uri = "resource://tabgroups/modules/content/frameScript.js";

Modules.LOADMODULE = function() {
  Services.mm.loadFrameScript(uri, true, true);
  
  let data = {
      addonUris: addonUris,
      objPathString: objPathString
  }
  
  Services.ppmm.initialProcessData["tabgroups:config"] = data;
  Services.ppmm.broadcastAsyncMessage("tabgroups:config-update", data);
};

Modules.UNLOADMODULE = function() {
  Services.mm.removeDelayedFrameScript(uri);
  Services.ppmm.broadcastAsyncMessage("tabgroups:shutdown-content");
};