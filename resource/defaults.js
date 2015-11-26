// VERSION 1.3.10

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
	
	tabViewKeycode: 'E',
	tabViewAccel: true,
	tabViewShift: true,
	tabViewAlt: false,
	
	// for internal use
	pageBackup: -1,
	pageAutoChanged: false,
	migratedWidget: false,
	migratedPrefs: false
};

paneList = [
	[ "paneTabGroups", true ],
	[ "paneHowTo", true ]
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
	Modules.load('nativePrefs');
	Modules.load('migrate');
	//if(Services.vc.compare(Services.appinfo.version, "45.0a1") >= 0) {
	//	Modules.load('keysets');
	//}
	
	// Apply the add-on to every window opened and to be opened
	Windows.callOnAll(startAddon, 'navigator:browser');
	Windows.register(startAddon, 'domwindowopened', 'navigator:browser');
}

function onShutdown(aReason) {
	// remove the add-on from all windows
	Windows.callOnAll(stopAddon, null, null, true);
	
	//if(Services.vc.compare(Services.appinfo.version, "45.0a1") >= 0) {
	//	Modules.unload('keysets');
	//}
	Modules.unload('migrate');
	Modules.unload('nativePrefs');
	Modules.unload('Storage');
	Modules.unload('Utils');
}
