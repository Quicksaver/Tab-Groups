// VERSION 1.1.0

// Implementation for the search functionality of Firefox Panorama.
// Class: TabUtils - A collection of helper functions for dealing with both <TabItem>s and <xul:tab>s without having to worry which one is which.
this.TabUtils = {
	// Given a <TabItem> or a <xul:tab> returns the tab's name.
	nameOf: function(tab) {
		// We can have two types of tabs: A <TabItem> or a <xul:tab> because we have to deal with both tabs represented inside
		// of active Panoramas as well as for windows in which Panorama has yet to be activated. We uses object sniffing to
		// determine the type of tab and then returns its name.
		return tab.label != undefined ? tab.label : tab.tabTitle.textContent;
	},

	// Given a <TabItem> or a <xul:tab> returns the URL of tab.
	URLOf: function(tab) {
		// Convert a <TabItem> to <xul:tab>
		if("tab" in tab) {
			tab = tab.tab;
		}
		return tab.linkedBrowser.currentURI.spec;
	},

	// Given a <TabItem> or a <xul:tab> returns the URL of tab's favicon.
	faviconURLOf: function(tab) {
		return tab.image != undefined ? tab.image : tab.fav._iconUrl;
	},

	// Given a <TabItem> or a <xul:tab>, focuses it and it's window.
	focus: function(tab) {
		// Convert a <TabItem> to a <xul:tab>
		if("tab" in tab) {
			tab = tab.tab;
		}
		tab.ownerDocument.defaultView.gBrowser.selectedTab = tab;
		tab.ownerDocument.defaultView.focus();
	}
};

// Class: TabMatcher - A class that allows you to iterate over matching and not-matching tabs, given a case-insensitive search term.
this.TabMatcher = function(term) {
	this.term = term;
};

this.TabMatcher.prototype = {
	// Given an array of <TabItem>s and <xul:tab>s returns a new array of tabs whose name matched the search term, sorted by lexical closeness.
	_filterAndSortForMatches: function(tabs) {
		tabs = tabs.filter((tab) => {
			let name = TabUtils.nameOf(tab);
			let url = TabUtils.URLOf(tab);
			return name.match(new RegExp(this.term, "i")) || url.match(new RegExp(this.term, "i"));
		});

		tabs.sort((x, y) => {
			let yScore = this._scorePatternMatch(this.term, TabUtils.nameOf(y));
			let xScore = this._scorePatternMatch(this.term, TabUtils.nameOf(x));
			return yScore - xScore;
		});

		return tabs;
	},

	// Given an array of <TabItem>s returns an unsorted array of tabs whose name does not match the the search term.
	_filterForUnmatches: function(tabs) {
		return tabs.filter((tab) => {
			let name = tab.tabTitle.textContent;
			let url = TabUtils.URLOf(tab);
			return !name.match(new RegExp(this.term, "i")) && !url.match(new RegExp(this.term, "i"));
		});
	},

	// Returns an array of <TabItem>s and <xul:tabs>s representing tabs from all windows but the current window. <TabItem>s will be returned
	// for windows in which Panorama has been activated at least once, while <xul:tab>s will be returned for windows in which Panorama has never been activated.
	_getTabsForOtherWindows: function() {
		let enumerator = Services.wm.getEnumerator("navigator:browser");
		let allTabs = [];

		while(enumerator.hasMoreElements()) {
			let win = enumerator.getNext();
			// This function gets tabs from other windows, not from the current window
			if(win != gWindow) {
				allTabs.push.apply(allTabs, win.gBrowser.tabs);
			}
		}
		return allTabs;
	},

	// Returns an array of <TabItem>s and <xul:tab>s that match the search term from all windows but the current window.
	// <TabItem>s will be returned for windows in which Panorama has been activated at least once, while <xul:tab>s will be returned for windows in which Panorama has never
	// been activated. // (new TabMatcher("app")).matchedTabsFromOtherWindows();
	matchedTabsFromOtherWindows: function() {
		if(this.term.length < 2) {
			return [];
		}

		let tabs = this._getTabsForOtherWindows();
		return this._filterAndSortForMatches(tabs);
	},

	getTabItems: function() {
		let tabs = [];
		for(let tabItem of TabItems) {
			tabs.push(tabItem);
		}
		return tabs;
	},

	// Returns an array of <TabItem>s which match the current search term.
	// If the term is less than 2 characters in length, it returns nothing.
	matched: function() {
		if(this.term.length < 2) {
			return [];
		}

		let tabs = this.getTabItems();
		return this._filterAndSortForMatches(tabs);
	},

	// Returns all of <TabItem>s that .matched() doesn't return.
	unmatched: function() {
		let tabs = this.getTabItems();
		if(this.term.length < 2) {
			return tabs;
		}

		return this._filterForUnmatches(tabs);
	},

	// Performs the search. Lets you provide three functions.
	// The first is on all matched tabs in the window, the second on all unmatched tabs in the window, and the third on all matched tabs in other windows.
	// The first two functions take two parameters: A <TabItem> and its integer index indicating the absolute rank of the <TabItem> in terms of match to the search term.
	// The last function also takes two paramaters, but can be passed both <TabItem>s and <xul:tab>s and the index is offset by the number of matched tabs inside the window.
	doSearch: function() {
		TabHandlers.clearOtherMatches();

		let matches = this.matched();
		let unmatched = this.unmatched();
		let otherMatches = this.matchedTabsFromOtherWindows();

		matches.forEach(function(tab, i) {
			TabHandlers.onMatch(tab, i);
		});

		otherMatches.forEach(function(tab, i) {
			TabHandlers.onOther(tab, i + matches.length);
		});

		unmatched.forEach(function(tab) {
			TabHandlers.onUnmatch(tab);
		});
	},

	// Given a pattern string, returns a score between 0 and 1 of how well that pattern matches the original string.
	// It mimics the heuristics of the Mac application launcher Quicksilver.
	_scorePatternMatch: function(pattern, matched, offset) {
		offset = offset || 0;
		pattern = pattern.toLowerCase();
		matched = matched.toLowerCase();

		if(pattern.length == 0) {
			return 0.9;
		}
		if(pattern.length > matched.length) {
			return 0.0;
		}

		for(let i = pattern.length; i > 0; i--) {
			let sub_pattern = pattern.substring(0,i);
			let index = matched.indexOf(sub_pattern);

			if(index < 0) { continue; }
			if(index + pattern.length > matched.length + offset) { continue; }

			let next_string = matched.substring(index+sub_pattern.length);
			let next_pattern = null;

			if(i >= pattern.length) {
				next_pattern = '';
			} else {
				next_pattern = pattern.substring(i);
			}

			let remaining_score = this._scorePatternMatch(next_pattern, next_string, offset + index);

			if(remaining_score > 0) {
				let score = matched.length-next_string.length;

				if(index != 0) {
					let c = matched.charCodeAt(index-1);
					if(c == 32 || c == 9) {
						for(let j = (index - 2); j >= 0; j--) {
							c = matched.charCodeAt(j);
							score -= ((c == 32 || c == 9) ? 1 : 0.15);
						}
					} else {
						score -= index;
					}
				}

				score += remaining_score * next_string.length;
				score /= matched.length;
				return score;
			}
		}
		return 0.0;
	}
};

// Class: TabHandlers - A object that handles all of the event handlers.
this.TabHandlers = {
	_mouseDownLocation: null,

	get results() { return $('results'); },

	// Adds styles and event listeners to the matched tab items.
	onMatch: function(tab, index) {
		tab.addClass("onTop");
		index != 0 ? tab.addClass("notMainMatch") : tab.removeClass("notMainMatch");

		Listeners.add(tab.container, 'mousedown', this);
	},

	// Removes styles and event listeners from the unmatched tab items.
	onUnmatch: function(tab) {
		tab.removeClass("onTop");
		tab.removeClass("notMainMatch");

		Listeners.remove(tab.container, 'mousedown', this);
	},

	// Removes styles and event listeners from the unmatched tabs.
	onOther: function(tab, index) {
		// Unlike the other on* functions, in this function tab can either be a <TabItem> or a <xul:tab>. In other functions it is always a <TabItem>.
		// Also note that index is offset by the number of matches within the window.
		let item = document.createElement("div");
		item.classList.add('inlineMatch');
		item.handleEvent = function(e) {
			// click
			Search.hide(e);
			TabUtils.focus(tab);
		};
		item.addEventListener('click', item);

		let img = document.createElement('img');
		img.setAttribute('src', TabUtils.faviconURLOf(tab));
		item.appendChild(img);

		let span = document.createElement('span');
		span.textContent = TabUtils.nameOf(tab);
		item.appendChild(span);

		index != 0 ? item.classList.add("notMainMatch") : item.classList.remove("notMainMatch");
		this.results.appendChild(item);
		this.results.parentNode.classList.add('hasMatches');
	},

	clearOtherMatches: function() {
		let results = this.results;
		while(results.firstChild) {
			results.firstChild.remove();
		}
		results.parentNode.classList.remove('hasMatches');
	},

	handleEvent: function(e) {
		switch(e.type) {
			case 'mousedown':
				this._hideHandler(e);
				break;

			case 'mouseup':
			case 'dragend':
				this._showHandler(e);
				break;
		}
	},

	// Performs when mouse down on a canvas of tab item.
	_hideHandler: function(e) {
		this._mouseDownLocation = { x: e.clientX, y: e.clientY };
		Listeners.add(window, 'mouseup', this);
		Listeners.add(window, 'dragend', this);

		// Don't hide the shade right away, we won't need to if zooming into a tab or closing it, the shade should remain after closing a tab.
		aSync(function() {
			document.body.classList.remove('searching');
		}, 100);
	},

	// Performs when mouse up on a canvas of tab item.
	_showHandler: function(e) {
		Listeners.remove(window, 'mouseup', this);
		Listeners.remove(window, 'dragend', this);

		// If the user clicks on a tab without moving the mouse then they are zooming into the tab and we need to exit search mode.
		if(this._mouseDownLocation.x == e.clientX && this._mouseDownLocation.y == e.clientY) {
			Search.hide();
			return;
		}

		document.body.classList.add('searching');
		Search.searchbox.focus();

		// Marshal the search.
		aSync(() => { Search.perform(); }, 0);
	}
};

// Class: Search - A object that handles the search feature.
this.Search = {
	inSearch: false,
	_initiatedByKeypress: false,
	_blockClick: false,

	get searchbox() { return $('searchbox'); },
	get searchshade() { return $('searchshade'); },
	get searchbutton() { return $('searchbutton'); },

	handleEvent: function(e) {
		switch(e.type) {
			// target == this.searchbox
			case 'keyup':
				this.perform();
				break;

			case 'mousedown':
				switch(e.target) {
					case this.searchshade:
						if(!this._blockClick) {
							this.hide();
						}
						break;

					case this.searchbutton:
						this.ensureShown();
						break;
				}
				break;

			// target == window
			case 'focus':
				if(this.inSearch) {
					this._blockClick = true;
					aSync(() => {
						this._blockClick = false;
					}, 0);
				}
				break;

			// target == window
			case 'keydown':
				if(this.inSearch) {
					this._inSearchKeyHandler(e);
				} else {
					this._beforeSearchKeyHandler(e);
				}
				break;
		}
	},

	// Initializes the searchbox to be focused, and everything else to be hidden, and to have everything have the appropriate event handlers.
	init: function() {
		Listeners.add(this.searchshade, 'mousedown', this);
		Listeners.add(this.searchbox, 'keyup', this);
		Listeners.add(this.searchbutton, 'mousedown', this);
		Listeners.add(window, 'focus', this);
		Listeners.add(window, 'keydown', this);
	},

	uninit: function() {
		Listeners.remove(this.searchshade, 'mousedown', this);
		Listeners.remove(this.searchbox, 'keyup', this);
		Listeners.remove(this.searchbutton, 'mousedown', this);
		Listeners.remove(window, 'focus', this);
		Listeners.remove(window, 'keydown', this);
	},

	// Handles all keydown before the search interface is brought up.
	_beforeSearchKeyHandler: function(e) {
		// Only match reasonable text-like characters for quick search.
		if(e.altKey || e.ctrlKey || e.metaKey) { return; }

		if((e.keyCode > 0 && e.keyCode <= e.DOM_VK_DELETE)
		|| e.keyCode == e.DOM_VK_CONTEXT_MENU
		|| e.keyCode == e.DOM_VK_SLEEP
		|| (e.keyCode >= e.DOM_VK_F1 && e.keyCode <= e.DOM_VK_SCROLL_LOCK)
		|| e.keyCode == e.DOM_VK_META
		// 91 = left windows key
		|| e.keyCode == 91
		// 92 = right windows key
		|| e.keyCode == 92
		|| (!e.keyCode && !e.charCode)) {
			return;
		}

		// If we are already in an input field, allow typing as normal.
		if(e.target.nodeName == "input") { return; }

		// / is used to activate the search feature so the key shouldn't be entered into the search box.
		if(e.keyCode == e.DOM_VK_SLASH) {
			e.stopPropagation();
			e.preventDefault();
		}

		this.ensureShown(true);
	},

	// Handles all keydown while search mode.
	_inSearchKeyHandler: function(e) {
		let term = this.searchbox.value;
		if((e.keyCode == e.DOM_VK_ESCAPE)
		|| (e.keyCode == e.DOM_VK_BACK_SPACE && term.length <= 1 && this._initiatedByKeypress)) {
			this.hide(e);
			return;
		}

		let matcher = this.createSearchTabMatcher();
		let matches = matcher.matched();
		let others =  matcher.matchedTabsFromOtherWindows();
		if(e.keyCode == e.DOM_VK_RETURN && (matches.length > 0 || others.length > 0)) {
			this.hide(e);
			if(matches.length > 0) {
				matches[0].zoomIn();
			} else {
				TabUtils.focus(others[0]);
			}
		}
	},

	createSearchTabMatcher: function() {
		return new TabMatcher(this.searchbox.value);
	},

	// Hides search mode.
	hide: function(e) {
		if(!this.inSearch) { return; }
		this.inSearch = false;
		document.body.classList.remove('searching');

		this.searchbox.value = "";

		if(DARWIN) {
			UI.setTitlebarColors(true);
		}

		this.perform();

		if(e) {
			// when hiding the search mode, we need to prevent the keypress handler in the keypress listeners to handle the key press again.
			// e.g. Esc which is already handled by the key down in this class.
			if(e.type == "keydown") {
				UI.ignoreKeypressForSearch = true;
			}
			e.preventDefault();
			e.stopPropagation();
		}

		// Return focus to the tab window
		UI.blurAll();
		gTabViewFrame.contentWindow.focus();

		dispatch(window, { type: "tabviewsearchdisabled", cancelable: false, bubbles: false });
	},

	// Performs a search.
	perform: function() {
		let matcher =  this.createSearchTabMatcher();
		matcher.doSearch();
	},

	// Ensures the search feature is displayed.  If not, display it.
	// Parameters:
	//  - a boolean indicates whether this is triggered by a keypress or not
	ensureShown: function(activatedByKeypress) {
		this._initiatedByKeypress = !!activatedByKeypress;

		if(!this.inSearch) {
			this.inSearch = true;
			document.body.classList.add('searching');

			if(DARWIN) {
				UI.setTitlebarColors({active: "#717171", inactive: "#EDEDED"});
			}

			if(activatedByKeypress) {
				// set the focus so key strokes are entered into the textbox.
				this.focus();
			} else {
				// marshal the focusing, otherwise it ends up with searchbox.focus gets called before the search button gets the focus after being pressed.
				aSync(() => {
					this.focus();
				}, 0);
			}
		}
	},

	// Focuses the search box and selects its contents.
	focus: function() {
		this.searchbox.select();
		this.searchbox.focus();
		dispatch(window, { type: "tabviewsearchenabled", cancelable: false, bubbles: false });
	}
};

