/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.2

Modules.LOADMODULE = function() {
	Styles.load('FTDeepDark', 'compatibilityFix/FTDeepDark');
	Styles.load('FTDeepDark-theme', 'compatibilityFix/FTDeepDark-theme');
	Styles.load('FTDeepDark-scrollbars', 'compatibilityFix/FTDeepDark-scrollbars', false, 'agent');
	Observers.notify(objName+'-darktheme-changed', null);
};

Modules.UNLOADMODULE = function() {
	Styles.unload('FTDeepDark');
	Styles.unload('FTDeepDark-theme');
	Styles.unload('FTDeepDark-scrollbars');
	Observers.notify(objName+'-darktheme-changed', null);
};
