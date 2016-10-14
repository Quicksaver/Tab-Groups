/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.1.4

// TODO: create/adapt an actual native dark style, rather than reuse FT DeepDark's one.

this.__defineGetter__('LightweightThemeManager', function() {
	delete this.LightweightThemeManager;
	Cu.import("resource://gre/modules/LightweightThemeManager.jsm", this);
	return this.LightweightThemeManager;
});

this.brightText = {
	permanent: false,
	dark: false,

	useDarkTheme: function() {
		return this.permanent || this.dark;
	},

	observe: function(aSubject, aTopic, aData) {
		// Only possibilities are forceBrightText pref changed or the lwtheme changed.
		aSync(() => {
			Windows.callOnMostRecent((aWindow) => {
				this.check(aWindow.document);
			}, 'navigator:browser');
		}, 100);
	},

	_parseRGB: /^rgba?\((\d+), (\d+), (\d+)/,

	parseRGB: function(aColorString) {
		let rgb = this._parseRGB.exec(aColorString);
		rgb.shift();
		return { r: parseInt(rgb[0]), g: parseInt(rgb[1]), b: parseInt(rgb[2]) };
	},

	parseLuminance: function(rgb) {
		return 0.2125 * rgb.r + 0.7154 * rgb.g + 0.0721 * rgb.b;
	},

	check: function(aDocument) {
		if(this.permanent) { return; }

		// We only need to listen for changes when a(ny) window opens up the groups view.
		Prefs.listen('forceBrightText', brightText);
		Observers.add(brightText, "lightweight-theme-styling-update");

		// The user can choose to force a theme on the frame.
		switch(Prefs.forceBrightText) {
			case 1:
				Styles.unload('brightText');
				this.unload();
				break;

			case 2:
				Styles.unload('brightText');
				this.load();
				break;

			case 0:
			default:
				// When using a lwtheme, we try to show it in the background of TabView as well.
				let theme = LightweightThemeManager.currentTheme;
				if(theme && theme.id != 'firefox-devedition@mozilla.org') {
					// this only applies if the accentcolor value supplied by the theme is valid, otherwise it defaults to the gradient using white in the stylesheet
					let sscode = '\
						@-moz-document url("chrome://'+objPathString+'/content/tabview.xhtml") {\n\
							body.classic[lwtheme] {\n\
								background-image: linear-gradient(transparent 100px, '+theme.accentcolor+' 178px, '+theme.accentcolor+');\n\
							}\n\
						}';
					Styles.load('brightText', sscode, true);
					this.unload();
					break;
				}
				Styles.unload('brightText');

				let style = getComputedStyle(aDocument.documentElement);
				let rgb = this.parseRGB(style.color);
				let luminance = this.parseLuminance(rgb);
				if(luminance > 110) {
					this.load();
				} else {
					this.unload();
				}
				break;
		}
	},

	load: function() {
		if(!this.dark) {
			Styles.load('FTDeepDark', 'compatibilityFix/FTDeepDark');
			Styles.load('FTDeepDark-scrollbars', 'compatibilityFix/FTDeepDark-scrollbars', false, 'agent');
			this.dark = true;
			Observers.notify(objName+'-darktheme-changed', null);
		}
	},

	unload: function() {
		if(this.dark) {
			Styles.unload('FTDeepDark');
			Styles.unload('FTDeepDark-scrollbars');
			this.dark = false;
			Observers.notify(objName+'-darktheme-changed', null);
		}
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
	Prefs.unlisten('forceBrightText', brightText);
	Observers.remove(brightText, "lightweight-theme-styling-update");

	Modules.unload('compatibilityFix/FTDeepDark');
	brightText.unload();
	Styles.unload('brightText');
};
