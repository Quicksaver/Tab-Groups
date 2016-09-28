/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 2.4.0
Modules.UTILS = true;
Modules.BASEUTILS = true;

// Strings - use for getting strings out of bundles from .properties locale files
// get(bundle, string, replace, aNumber) - returns the desired string
//	bundle - (string) name of the bundle to retrieve the string from, just aBundle in chrome://objPathString/locale/aBundle.properties
//	string - (string) name of the string to retrieve from bundle
//	(optional) replace - (array) [ [original, new] x n ] retrieves the string with the occurences of original replaced with new
//	(optional) aNumber - 	(int) if set will choose the corresponding Plural Form from the string returned based on it;
//				expects string "PluralRule" defined in the same bundle representing a number.
//				See https://developer.mozilla.org/en-US/docs/Localization_and_Plurals
this.Strings = {
	bundles: {},

	getPath: function(aPath) {
		let cacheBuster = (AddonData) ? '?'+AddonData.initTime : '';
		return "chrome://"+objPathString+"/locale/"+aPath+".properties"+cacheBuster;
	},

	get: function(bundle, string, replace, aNumber) {
		var bundleObj = bundle;

		if(!this.bundles[bundleObj]) {
			this.bundles[bundleObj] = Services.strings.createBundle(this.getPath(bundle));
		}

		try {
			string = this.bundles[bundleObj].GetStringFromName(string);
		}
		catch(ex) {
			Cu.reportError('Failed to load string from properties file. [Addon: '+objPathString+'] [File: '+bundle+'] [String: '+string+']');
			Cu.reportError(ex);
			return '';
		}

		// This means we are dealing with a possible Plural Form, so we need to make sure we treat it accordingly
		if(aNumber != undefined && string.includes(';')) {
			try {
				var [getForm, numForms] = PluralForm.makeGetter(this.bundles[bundleObj].GetStringFromName('PluralRule'));
				string = getForm(aNumber, string);
			}
			catch(ex) {} // if there's no "PluralRule" defined, skip this as it might just actually be an intentional semi-colon
		}

		if(replace) {
			for(let x of replace) {
				while(string.includes(x[0])) {
					string = string.replace(x[0], x[1]);
				}
			}
		}

		return string;
	}
};
