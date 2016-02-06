// VERSION 1.0.0

Modules.LOADMODULE = function() {
	AddonManager.getAddonByID('{39952c40-5197-11da-8cd6-0800200c9a66}', function(addon) {
		Modules.loadIf('compatibilityFix/tabControl', (addon && addon.isActive));
	});
};

Modules.UNLOADMODULE = function() {
	Modules.unload('compatibilityFix/tabControl');
};
