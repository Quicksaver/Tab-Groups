// VERSION 1.0.0

this.__defineGetter__('gTabControl', function() { return window.gTabControl; });

Modules.LOADMODULE = function() {
	// Don't let tab control focus the tab next to the one that's closed through TabView.
	// This is a listener that's registered directly, so we need to remove that listener, make the changes, and add it again.
	gBrowser.tabContainer.removeEventListener("TabClose", gTabControl.onTabClose);
	Piggyback.add(objName, gTabControl, 'onTabClose', function() {
		return !TabView.isVisible();
	}, Piggyback.MODE_BEFORE);
	gBrowser.tabContainer.addEventListener("TabClose", gTabControl.onTabClose);
};

Modules.UNLOADMODULE = function() {
	gBrowser.tabContainer.removeEventListener("TabClose", gTabControl.onTabClose);
	Piggyback.revert(objName, gTabControl, 'onTabClose');
	gBrowser.tabContainer.addEventListener("TabClose", gTabControl.onTabClose);
};
