/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.4.24

objName = 'tabGroups';
objPathString = 'tabgroups';
addonUUID = 'd9d0e890-860a-11e5-a837-0800200c9a66';

addonUris = {
	homepage: 'https://addons.mozilla.org/firefox/addon/tab-groups-panorama/',
	support: 'https://github.com/Quicksaver/Tab-Groups/issues',
	fullchangelog: 'https://github.com/Quicksaver/Tab-Groups/commits/master',
	email: 'mailto:quicksaver@gmail.com',
	profile: 'https://addons.mozilla.org/firefox/user/quicksaver/',
	api: 'http://fasezero.com/addons/api/tabgroups',
	development: 'http://fasezero.com/addons/'
};

prefList = {
	quickAccessButton: true,
	groupTitleInButton: true,

	displayMode: 'single',
	searchMode: 'highlight',

	showGroupThumbs: true,
	gridDynamicSize: true,
	closeIfEmpty: true,
	sortGroupsByName: false,

	showTabCounter: true,
	stackTabs: true,
	showThumbs: true,
	showUrls: true,
	tileIcons: true,

	tabViewKeycode: 'E',
	tabViewAccel: true,
	tabViewShift: true,
	tabViewAlt: false,
	tabViewCtrl: false,

	quickAccessKeycode: 'none',
	quickAccessAccel: true,
	quickAccessShift: true,
	quickAccessAlt: false,
	quickAccessCtrl: false,

	nextGroupKeycode: '`',
	nextGroupAccel: !DARWIN,
	nextGroupShift: false,
	nextGroupAlt: false,
	nextGroupCtrl: DARWIN,

	previousGroupKeycode: '~',
	previousGroupAccel: !DARWIN,
	previousGroupShift: true,
	previousGroupAlt: false,
	previousGroupCtrl: DARWIN,

	noWarningsAboutSession: false,

	// hidden prefs
	forceBrightText: 0,
	overrideViewportRatio: "",

	// for internal use
	pageAutoChanged: false,
	migratedWidget: false, // remove after FF52
	migratedPrefs: false, // remove after FF52
	migratedKeysets: false
};

// If we're initializing in a content process, we don't care about the rest
if(isContent) { throw 'isContent'; }

paneList = [
	[ "paneTabGroups", true ],
	[ "paneHowTo", true ],
	[ "paneSession", true ]
];

function startAddon(window) {
	prepareObject(window);
	window[objName].Modules.load('TabView', window.gBrowserInit);
}

function stopAddon(window) {
	removeObject(window);
}

// Don't rely on other modules being loaded here, make sure this can do the backup by itself.
function backupCurrentSession() {
	let tmp = {};
	Cu.import("resource:///modules/sessionstore/SessionStore.jsm", tmp);
	let osfile = Cu.import("resource://gre/modules/osfile.jsm");

	let prefix = objName+'-update.js-';

	// We can use the initTime as a seed/identifier to make sure every file has a unique name.
	// This is the same suffix syntax as the automated backups created by Firefox upgrades, except it uses a buildID instead
	// (which we don't have for the add-on, hence initTime instead).
	let filename = prefix+AddonData.initTime;

	// This is the folder where the automated backups created by Firefox upgrades are saved.
	let profileDir = osfile.OS.Constants.Path.profileDir;
	let backupsDir = osfile.OS.Path.join(profileDir, "sessionstore-backups");
	let filepath = osfile.OS.Path.join(backupsDir, filename);

	let state = tmp.SessionStore.getCurrentState();
	let saveState = (new osfile.TextEncoder()).encode(JSON.stringify(state));

	osfile.OS.File.open(filepath, { truncate: true }).then((ref) => {
		ref.write(saveState).then(() => {
			ref.close();

			// Don't keep backups indefinitely, follow the same rules as Firefox does, keep a limited number and rotate them out.
			let existingBackups = [];
			let iterator = new osfile.OS.File.DirectoryIterator(backupsDir);
			iterating = iterator.forEach((file) => {
				// a copy of the current session, for crash-protection
				if(file.name.startsWith(prefix)) {
					let val = parseInt(file.name.substr(prefix.length));
					existingBackups.push(val);
				}
			});
			iterating.then(
				function() {
					iterator.close();
					let max = Services.prefs.getIntPref('browser.sessionstore.upgradeBackup.maxUpgradeBackups');
					if(existingBackups.length > max) {
						// keep the most recently created files
						existingBackups.sort(function(a,b) { return b-a; });
						let toRemove = existingBackups.splice(3);
						for(let seed of toRemove) {
							let name = prefix+seed;
							let path = osfile.OS.Path.join(backupsDir, name);
							osfile.OS.File.remove(path);
						}
					}
				},
				function(reason) { iterator.close(); throw reason; }
			);
		});
	});
}

function onStartup() {
	// If this is the first startup after installing or updating the add-on, make a backup of the session, just in case.
	if(STARTED == ADDON_INSTALL || STARTED == ADDON_UPGRADE || STARTED == ADDON_DOWNGRADE) {
		// Don't block add-on startup if it fails to create the backup for some reason.
		try { backupCurrentSession(); }
		catch(ex) { Cu.reportError(ex); }
	}

	Modules.load('Utils');
	Modules.load('Storage');
	Modules.load('nativePrefs');
	Modules.loadIf('migrate', Services.vc.compare(Services.appinfo.version, "52.0a1") < 0);
	Modules.load('compatibilityFix/sandboxFixes');
	Modules.load('keysets');

	// Scrollbar CSS code needs to be loaded as an AGENT sheet, otherwise it won't apply to scrollbars in non-xul documents.
	Styles.load('scrollbars', 'scrollbars', false, 'agent');

	// Apply the add-on to every window opened and to be opened
	Windows.callOnAll(startAddon, 'navigator:browser');
	Windows.register(startAddon, 'domwindowopened', 'navigator:browser');
}

function onShutdown() {
	// remove the add-on from all windows
	Windows.callOnAll(stopAddon, null, null, true);

	Styles.unload('scrollbars');

	Modules.unload('keysets');
	Modules.unload('compatibilityFix/sandboxFixes');
	Modules.unload('migrate');
	Modules.unload('nativePrefs');
	Modules.unload('Storage');
	Modules.unload('Utils');
}
