// VERSION 1.0.1

Modules.LOADMODULE = function() {
	AddonManager.getAddonByID('bug566510@vovcacik.addons.mozilla.org', function(addon) {
		Modules.loadIf('compatibilityFix/bug566510', (addon && addon.isActive));
	});

	Modules.load('compatibilityFix/SessionManager');
};

Modules.UNLOADMODULE = function() {
	Modules.unload('compatibilityFix/bug566510');
	Modules.unload('compatibilityFix/SessionManager');
};
