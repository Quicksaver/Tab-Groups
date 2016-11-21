/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.6

// We try to use the styling defined in TMP's prefs in groups view as well.

this.TabMixPlus = {
	observe: function() {
		this.setColors();
	},

	init: function() {
		let defaults = Services.prefs.getDefaultBranch("extensions.tabmix.");
		Prefs.setDefaults({
			unloadedTab: defaults.getBoolPref("unloadedTab"),
			unreadTab: defaults.getBoolPref("unreadTab"),
			["styles.unloadedTab"]: defaults.getCharPref("styles.unloadedTab"),
			["styles.unreadTab"]: defaults.getCharPref("styles.unreadTab"),

			// This is to control the behavior when closing the last visible tab, in TabView.jsm
			["loadOnNewTab.type"]: defaults.getIntPref("loadOnNewTab.type"),

			// This is to make sure tabs are created in the appropriate order when importing from backups.
			openTabNext: defaults.getBoolPref("openTabNext")
		}, 'tabmix');

		Prefs.listen("unloadedTab", this);
		Prefs.listen("unreadTab", this);
		Prefs.listen("styles.unloadedTab", this);
		Prefs.listen("styles.unreadTab", this);

		this.setColors();
	},

	uninit: function() {
		Prefs.unlisten("unloadedTab", this);
		Prefs.unlisten("unreadTab", this);
		Prefs.unlisten("styles.unloadedTab", this);
		Prefs.unlisten("styles.unreadTab", this);
		Styles.unload("TabMixPlus_colors");
	},

	setColors: function() {
		if(!Prefs.unloadedTab && !Prefs.unreadTab) {
			Styles.unload("TabMixPlus_colors");
			return;
		}

		let bothSelectors = '';
		let unloadedSelector = '';
		let sscode = '@-moz-document url("chrome://'+objPathString+'/content/tabview.xhtml") {\n';

		if(Prefs.unloadedTab) {
			bothSelectors += '[pending]';
			unloadedSelector = ':not([pending])';
			if(Prefs.unreadTab) {
				bothSelectors += ',';
			}

			// Styling the favicons when tiling only icons needs the important tags to override their usual colors.

			try {
				let style = JSON.parse(Prefs["styles.unloadedTab"]);
				if(style.italic || style.bold || style.underline || style.text) {
					sscode += '.tab[pending] .tab-label {\n';
					if(style.italic) {
						sscode += 'font-style: italic;\n';
					}
					if(style.bold) {
						sscode += 'font-weight: bold;\n';
					}
					if(style.underline) {
						sscode += 'text-decoration: underline;\n';
					}
					if(style.text) {
						sscode += 'color: '+style.textColor+';\n';
					}
					sscode += '}\n';

					if(style.text) {
						sscode += '\
							.groupItem:not(.thumbing) .tab-container:not(.noThumbs):not(.onlyIcons) .tab[pending] .thumb {\n\
								box-shadow: 0 0 2px '+style.textColor+';\n\
							}\n\
							.groupItem:not(.thumbing) .tab-container:not(.noThumbs):not(.onlyIcons) .tab[pending] .tab-thumb-container {\n\
								border-color: '+style.textColor+';\n\
							}\n\
							.groupItem:not(.thumbing) .tab-container:not(.onlyIcons) .tab[pending] .favicon-container {\n\
								background-color: '+style.textColor+';\n\
							}\n\
							.groupItem:not(.thumbing) .tab-container.onlyIcons .tab[pending] .favicon-container {\n\
								border-color: '+style.textColor+' !important;\n\
								box-shadow: inset 0 0 1px '+style.textColor+', 0 0 2px '+style.textColor+' !important;\n\
							}\n';
					}
				}
			}
			catch(ex) {
				Cu.reportError(ex);
			}
		}

		if(Prefs.unreadTab) {
			bothSelectors += '[unread]';

			try {
				let style = JSON.parse(Prefs["styles.unreadTab"]);
				if(style.italic || style.bold || style.underline || style.text) {
					sscode += '.tab'+unloadedSelector+'[unread] .tab-label {\n';
					if(style.italic) {
						sscode += 'font-style: italic;\n';
					}
					if(style.bold) {
						sscode += 'font-weight: bold;\n';
					}
					if(style.underline) {
						sscode += 'text-decoration: underline;\n';
					}
					if(style.text) {
						sscode += 'color: '+style.textColor+';\n';
					}
					sscode += '}\n';

					if(style.text) {
						sscode += '\
							.groupItem:not(.thumbing) .tab-container:not(.noThumbs):not(.onlyIcons) .tab'+unloadedSelector+'[unread] .thumb {\n\
								box-shadow: 0 0 2px '+style.textColor+';\n\
							}\n\
							.groupItem:not(.thumbing) .tab-container:not(.noThumbs):not(.onlyIcons) .tab'+unloadedSelector+'[unread] .tab-thumb-container {\n\
								border-color: '+style.textColor+';\n\
							}\n\
							.groupItem:not(.thumbing) .tab-container:not(.onlyIcons) .tab'+unloadedSelector+'[unread] .favicon-container {\n\
								background-color: '+style.textColor+';\n\
							}\n\
							.groupItem:not(.thumbing) .tab-container.onlyIcons .tab[unread] .favicon-container {\n\
								border-color: '+style.textColor+' !important;\n\
								box-shadow: inset 0 0 1px '+style.textColor+', 0 0 2px '+style.textColor+' !important;\n\
							}\n';
					}
				}
			}
			catch(ex) {
				Cu.reportError(ex);
			}
		}

		sscode += '\
				.tab-container:not(.noThumbs):not(.onlyIcons) .tab:not(.stacked):-moz-any('+bothSelectors+') .favicon-container {\n\
					top: 0;\n\
					width: 27px;\n\
					height: 27px;\n\
				}\n\
				.tab-container:not(.noThumbs):not(.onlyIcons) .tab:not(.stacked):-moz-any('+bothSelectors+') .favicon-container:-moz-locale-dir(ltr) {\n\
					left: 0;\n\
					border-bottom-right-radius: 0.4em;\n\
				}\n\
				.tab-container:not(.noThumbs):not(.onlyIcons) .tab:not(.stacked):-moz-any('+bothSelectors+') .favicon-container:-moz-locale-dir(rtl) {\n\
					right: 0;\n\
					border-bottom-left-radius: 0.4em;\n\
				}\n\
				.tab-container:not(.noThumbs):not(.onlyIcons) .tab:not(.stacked):-moz-any('+bothSelectors+') .favicon {\n\
					position: relative;\n\
					top: 0 !important;\n\
					left: 0 !important;\n\
				}\n\
			}';

		Styles.load("TabMixPlus_colors", sscode, true);
	}
};

Modules.LOADMODULE = function() {
	TabMixPlus.init();
};

Modules.UNLOADMODULE = function() {
	TabMixPlus.uninit();
};
