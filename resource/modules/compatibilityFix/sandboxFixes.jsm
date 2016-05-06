// VERSION 1.0.3

Modules.LOADMODULE = function() {
	AddonManager.getAddonByID('bug566510@vovcacik.addons.mozilla.org', function(addon) {
		Modules.loadIf('compatibilityFix/bug566510', (addon && addon.isActive));
	});

	AddonManager.getAddonByID('{dc572301-7619-498c-a57d-39143191b318}', function(addon) {
		Modules.loadIf('compatibilityFix/TabMixPlus', (addon && addon.isActive));
	});

	AddonManager.getAddonByID('{77d2ed30-4cd2-11e0-b8af-0800200c9a66}', function(addon) {
		Modules.loadIf('compatibilityFix/FTDeepDark', (addon && addon.isActive));
	});

	Modules.load('compatibilityFix/SessionManager');
};

Modules.UNLOADMODULE = function() {
	Modules.unload('compatibilityFix/bug566510');
	Modules.unload('compatibilityFix/TabMixPlus');
	Modules.unload('compatibilityFix/FTDeepDark');
	Modules.unload('compatibilityFix/SessionManager');
};
