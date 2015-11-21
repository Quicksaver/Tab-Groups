// VERSION 1.0.0

this.migrate = {
	onLoad: function(aWindow) {
		// we can use our add-on even in builds with Tab View still present, we just have to properly deinitialize it
		if(aWindow.TabView) {
			aWindow.TabView.uninit();
			aWindow.TabView._deck = null;
			
			if(aWindow.gTaskbarTabGroup) {
				aWindow.gTaskbarTabGroup.win.removeEventListener("tabviewshown", aWindow.gTaskbarTabGroup);
				aWindow.gTaskbarTabGroup.win.removeEventListener("tabviewhidden", aWindow.gTaskbarTabGroup);
			}
		}
	},
	
	onUnload: function(aWindow) {
		if(aWindow.TabView) {
			aWindow.TabView.init();
			
			if(aWindow.gTaskbarTabGroup) {
				aWindow.gTaskbarTabGroup.win.addEventListener("tabviewshown", aWindow.gTaskbarTabGroup);
				aWindow.gTaskbarTabGroup.win.addEventListener("tabviewhidden", aWindow.gTaskbarTabGroup);
			}
		}
	}
};

Modules.LOADMODULE = function() {
	// disables native TabView command and hides native menus and buttons and stuff through CSS.
	// can be removed in Firefox 45 (once bug 1222490 lands)
	//if(Services.vc.compare(Services.appinfo.version, "45.0a1") < 0) {
		Overlays.overlayURI('chrome://browser/content/browser.xul', 'migrate', migrate);
	//}
};

Modules.UNLOADMODULE = function() {
	Overlays.removeOverlayURI('chrome://browser/content/browser.xul', 'migrate');
};
