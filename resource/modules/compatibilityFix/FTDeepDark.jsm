// VERSION 1.0.0

Modules.LOADMODULE = function() {
	Styles.load('FTDeepDark', 'compatibilityFix/FTDeepDark');
	Styles.load('FTDeepDark-scrollbars', 'compatibilityFix/FTDeepDark-scrollbars', false, 'agent');
};

Modules.UNLOADMODULE = function() {
	Styles.unload('FTDeepDark');
	Styles.unload('FTDeepDark-scrollbars');
};
