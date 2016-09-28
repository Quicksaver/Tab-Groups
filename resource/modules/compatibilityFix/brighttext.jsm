/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.0

// TODO: create/adapt an actual native dark style, rather than reuse FT DeepDark's one.

this.brightText = {
	permanent: false,

	_parseRGB: /^rgba?\((\d+), (\d+), (\d+)/,

	parseRGB: function(aColorString) {
		let rgb = this._parseRGB.exec(aColorString);
		rgb.shift();
		return { r: parseInt(rgb[0]), g: parseInt(rgb[1]), b: parseInt(rgb[2]) };
	},

	parseLuminance: function(rgb) {
		return 0.2125 * rgb.r + 0.7154 * rgb.g + 0.0721 * rgb.b;
	},

	check: function(aElement) {
		if(this.permanent) { return; }

		let style = getComputedStyle(aElement);
		let rgb = this.parseRGB(style.color);
		let luminance = this.parseLuminance(rgb);
		if(luminance > 110) {
			this.load();
		} else {
			this.unload();
		}
	},

	load: function() {
		Styles.load('FTDeepDark', 'compatibilityFix/FTDeepDark');
		Styles.load('FTDeepDark-scrollbars', 'compatibilityFix/FTDeepDark-scrollbars', false, 'agent');
	},

	unload: function() {
		Styles.unload('FTDeepDark');
		Styles.unload('FTDeepDark-scrollbars');
	}
};

Modules.LOADMODULE = function() {
	AddonManager.getAddonByID('{77d2ed30-4cd2-11e0-b8af-0800200c9a66}', function(addon) {
		brightText.permanent = !!(addon && addon.isActive);
		if(brightText.permanent) {
			Modules.load('compatibilityFix/FTDeepDark');
		}
	});
};

Modules.UNLOADMODULE = function() {
	Modules.unload('compatibilityFix/FTDeepDark');
	Styles.unload('FTDeepDark');
	Styles.unload('FTDeepDark-scrollbars');
};
