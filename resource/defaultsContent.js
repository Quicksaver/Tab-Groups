/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 2.0.1

// By using a JSM, we can initialize each individual tab (frame) with our scripts without having to instanciate the same objects with each one.
(function(frame) {
	let targetScope = {};
	Components.utils.import("resource://tabgroups/modules/content/utils/ModuleInSandbox.jsm", targetScope);
	targetScope.ModuleInSandbox.init('tabgroups', frame);
})(this);
