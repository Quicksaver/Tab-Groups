// VERSION 1.3.3

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
	animate_zoom: true,
	session_restore_enabled_once: false
};

paneList = [];

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
	
	// Apply the add-on to every window opened and to be opened
	Windows.callOnAll(startAddon, 'navigator:browser');
	Windows.register(startAddon, 'domwindowopened', 'navigator:browser');
}

function onShutdown(aReason) {
	// remove the add-on from all windows
	Windows.callOnAll(stopAddon, null, null, true);
	
	Modules.unload('Storage');
	Modules.unload('Utils');
}
