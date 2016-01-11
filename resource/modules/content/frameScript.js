// VERSION 1.0.0

'use strict';
// frame scripts instantiate objects once per tab, JSMs once per process
// -> reduce footprint by passing |this| to JSM and then letting the script get GCed
(function(frameMM) {
	let module = {};
	Components.utils.import("resource://tabgroups/modules/content/frameModule.jsm", module);
	module.registerFrame(frameMM);
})(this);
