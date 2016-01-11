'use strict';

const Cu = Components.utils;
const Ci = Components.interfaces;
const Services = Cu.import("resource://gre/modules/Services.jsm", {}).Services;
const cpmm = Services.cpmm;
const observerService = Services.obs;

let crossProcessConfig = {};

if(cpmm.initialProcessData && cpmm.initialProcessData["tabgroups:config"]) {
  crossProcessConfig = cpmm.initialProcessData["tabgroups:config"];
}

function invokePageAPI(e) {
  let window = e.currentTarget;
  let document = window.document;
  window.removeEventListener("load", invokePageAPI);

  let addonUris = crossProcessConfig.addonUris;

  if(addonUris && addonUris.development && document.documentURI.startsWith(addonUris.development)) {
    let unsafeWindow = Cu.waiveXrays(document.defaultView);
    if(unsafeWindow.enable) {
      unsafeWindow.enable(crossProcessConfig.objPathString);
    }
  }
}

const observer = {
  observe: function(subject, topic, data) {
    if(topic != "content-document-global-created")
      return;
    if(!(subject instanceof Ci.nsIDOMWindow))
      return;
    let window = subject;
    // only act on top level windows
    if(window.top !== window)
      return;
    window.addEventListener("load", invokePageAPI);
  }
}


const shutdownHook = {
  receiveMessage: function() {
    observerService.removeObserver(observer, "content-document-global-created")
    cpmm.removeMessageListener("tabgroups:config-update", updateConfig);
    cpmm.removeMessageListener("tabgroups:shutdown-content", shutdownHook);
  }
}


cpmm.addMessageListener("tabgroups:config-update", updateConfig);
cpmm.addMessageListener("tabgroups:shutdown-content", shutdownHook);


observerService.addObserver(observer, "content-document-global-created", false);


function updateConfig(message) {
  crossProcessConfig = message.data;
}
