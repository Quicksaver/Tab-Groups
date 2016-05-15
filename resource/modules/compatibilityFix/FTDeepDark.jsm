// VERSION 1.0.1

Modules.LOADMODULE = function() {
	Styles.load('FTDeepDark', 'compatibilityFix/FTDeepDark');
	Styles.load('FTDeepDark-theme', 'compatibilityFix/FTDeepDark-theme');
	Styles.load('FTDeepDark-scrollbars', 'compatibilityFix/FTDeepDark-scrollbars', false, 'agent');
};

Modules.UNLOADMODULE = function() {
	Styles.unload('FTDeepDark');
	Styles.unload('FTDeepDark-theme');
	Styles.unload('FTDeepDark-scrollbars');
};
