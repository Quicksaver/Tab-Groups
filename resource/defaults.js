// VERSION 1.3.6

objName = 'tabGroups';
objPathString = 'tabgroups';
addonUUID = 'd9d0e890-860a-11e5-a837-0800200c9a66';

addonUris = {
	homepage: '',
	support: '',
	fullchangelog: '',
	email: 'quicksaver@gmail.com',
	profile: 'https://addons.mozilla.org/firefox/user/quicksaver/',
	api: '',
	development: ''
};

prefList = {
	animateZoom: true,
	session_restore_enabled_once: false,
	
	// for internal use
	migratedWidget: false,
	migratedPrefs: false,
};

paneList = [
	[ "paneTabGroups" ]
];

function startAddon(window) {
	prepareObject(window);
	window[objName].Modules.load('TabView', window.gBrowserInit);
}

function stopAddon(window) {
	removeObject(window);
}

function onStartup(aReason) {
	Modules.load('Utils');
	Modules.load('Storage');
	Modules.load('migrate');
	
	// Apply the add-on to every window opened and to be opened
	Windows.callOnAll(startAddon, 'navigator:browser');
	Windows.register(startAddon, 'domwindowopened', 'navigator:browser');
}

function onShutdown(aReason) {
	// remove the add-on from all windows
	Windows.callOnAll(stopAddon, null, null, true);
	
	Modules.unload('migrate');
	Modules.unload('Storage');
	Modules.unload('Utils');
}
