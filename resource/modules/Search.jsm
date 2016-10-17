/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 2.1.3

// Implementation for the search functionality of Firefox Panorama.
// Class: TabUtils - A collection of helper functions for dealing with both <TabItem>s and <xul:tab>s without having to worry which one is which.
// We can have two types of tabs: A <TabItem> or an <AppItem> because we have to deal with both tabs represented inside
// of active Panoramas. We use object sniffing to determine the type of tab and then returns its name.
this.TabUtils = {
	getTabItem: function(tab) {
		return tab._tabViewTabItem || tab._tabViewAppItem || tab;
	},

	// Given a <TabItem> or a <xul:tab> returns the tab's name.
	nameOf: function(tab) {
		tab = this.getTabItem(tab);
		if(tab.isATabItem) {
			return tab.tabTitle.textContent;
		}
		if(tab.isAnAppItem) {
			tab = tab.tab;
		}
		return tab.label;
	},

	// Given a <TabItem> or a <xul:tab> returns the URL of tab.
	URLOf: function(tab) {
		tab = this.getTabItem(tab);
		if(tab.isATabItem) {
			return tab.tabUrl.textContent;
		}
		if(tab.isAnAppItem) {
			tab = tab.tab;
		}
		return tab.linkedBrowser.currentURI.spec;
	},

	// Given a <TabItem> or a <xul:tab> returns the URL of tab's favicon.
	faviconURLOf: function(tab) {
		tab = this.getTabItem(tab);
		if(tab.isATabItem) {
			return tab.fav._iconUrl;
		}
		if(tab.isAnAppTab) {
			return tab._iconUrl;
		}
		return tab.image;
	}
};

// Class: TabMatcher - A class that allows you to iterate over matching and not-matching tabs, given a case-insensitive search term.
this.TabMatcher = function(term) {
	this.term = term;
	this.matches = null;
	this.nonmatches = null;
	this.cancelled = false;

	// We need updated labels, urls and icons for our results.
	this.promises = [];
	this.promises.push(PinnedItems.flushUpdates());
	this.promises.push(TabItems.flushLabelsUpdates());
	this.ready = Promise.all(this.promises);

	this.tabs = [];
	for(let appItem of PinnedItems) {
		this.tabs.push(appItem);
	}
	for(let tabItem of TabItems) {
		this.tabs.push(tabItem);
	}
};

this.TabMatcher.prototype = {
	cancel: function() {
		this.cancelled = true;
	},

	// Given an array of <TabItem>s and <xul:tab>s returns a new array of tabs whose name matched the search term, sorted by lexical closeness.
	_filterAndSortForMatches: function() {
		let tabs = this.tabs.filter((tab) => {
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
	_filterForUnmatches: function() {
		return this.tabs.filter((tab) => {
			let name = TabUtils.nameOf(tab);
			let url = TabUtils.URLOf(tab);
			return !name.match(new RegExp(this.term, "i")) && !url.match(new RegExp(this.term, "i"));
		});
	},

	// Returns an array of <TabItem>s which match the current search term.
	// If there is no search term, it returns nothing.
	matched: function() {
		if(!this.matches) {
			if(!this.term.length) {
				this.matches = [];
			} else {
				this.matches = this._filterAndSortForMatches();
			}
		}
		return this.matches;
	},

	// Returns all of <TabItem>s that .matched() doesn't return.
	unmatched: function() {
		if(!this.nonmatches) {
			if(!this.term.length) {
				this.nonmatches = this.tabs;
			} else {
				this.nonmatches = this._filterForUnmatches();
			}
		}
		return this.nonmatches;
	},

	// Performs the search. Lets you provide three functions.
	// The first is on all matched tabs in the window, the second on all unmatched tabs in the window, and the third on all matched tabs in other windows.
	// The first two functions take two parameters: A <TabItem> and its integer index indicating the absolute rank of the <TabItem> in terms of match to the search term.
	// The last function also takes two paramaters, but can be passed both <TabItem>s and <xul:tab>s and the index is offset by the number of matched tabs inside the window.
	doSearch: function(handler) {
		this.ready.then(() => {
			if(this.cancelled) { return; }

			handler.clearSearch();

			let matches = this.matched();
			matches.forEach(function(tab, i) {
				handler.onMatch(tab, i);
			});

			if(handler.onUnmatch) {
				let unmatched = this.unmatched();
				unmatched.forEach(function(tab) {
					handler.onUnmatch(tab);
				});
			}

			if(handler.finishSearch) {
				handler.finishSearch();
			}
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

// Class: Search - A object that handles the search feature.
this.Search = {
	inSearch: false,
	_initiatedByKeypress: false,
	_blockClick: false,
	_lastSearch: null,
	_activeTab: null,
	_position: null,
	lastMouseDownTarget: null,

	_fragmentGroup: null,
	_fragmentResult: null,

	get searchbox() { return $('searchbox'); },
	get searchquery() { return $('searchquery'); },
	get searchshade() { return $('searchshade'); },
	get searchbutton() { return $('searchbutton'); },
	get searchmode() { return $('search-mode'); },
	get searchclose() { return $('search-close'); },

	get results() { return $('searchresults'); },

	handleEvent: function(e) {
		switch(e.type) {
			case 'input':
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

					case this.searchmode:
					case this.searchclose:
					case this.searchbox:
						e.preventDefault();

						if(Prefs.searchMode == 'highlight') {
							this.lastMouseDownTarget = e.target;

							new HighlighterDrag(e, () => {
								if(!DraggingHighlighter.started) {
									switch(this.lastMouseDownTarget) {
										case this.searchmode:
											this.toggleMode();
											break;

										case this.searchclose:
											this.hide();
											break;
									}
								}
								else {
									// Make sure it wasn't dragged too far out of the window bounds. If it was, snap it back into view.
									this.snapToView();
									this.savePosition();
								}

								this.lastMouseDownTarget = null;
							});
						}
						else {
							switch(e.target) {
								case this.searchmode:
									this.toggleMode();
									break;

								case this.searchclose:
									this.hide();
									break;
							}
						}
						break;
				}
				break;

			case 'mousemove':
				if(e.target.classList.contains('tab')) {
					this.focusItem(e.target._item);
				}
				break;

			case 'focus':
				if(this.inSearch) {
					this._blockClick = true;
					aSync(() => {
						this._blockClick = false;
					}, 0);
				}
				break;

			case 'blur':
				aSync(() => {
					// This could happen as a result of switching modes, which in turn can refocus the searchquery.
					if(Prefs.searchMode == 'highlight' && this.searchquery != document.activeElement && !this.searchquery.value.length) {
						this.hide();
					}
				}, 10);
				break;

			case 'keydown':
				if(this.inSearch && document.activeElement == this.searchquery) {
					this._inSearchKeyHandler(e);
				} else {
					this._beforeSearchKeyHandler(e);
				}
				break;
		}
	},

	observe: function(aSubject, aTopic, aData) {
		switch(aSubject) {
			case 'searchMode':
				this.applyMode();
				break;
		}
	},

	// Initializes the searchbox to be focused, and everything else to be hidden, and to have everything have the appropriate event handlers.
	init: function() {
		this.$searchbox = iQ(this.searchbox);

		Prefs.listen('searchMode', this);
		Listeners.add(this.searchshade, 'mousedown', this);
		Listeners.add(this.searchquery, 'input', this);
		Listeners.add(this.searchquery, 'blur', this);
		Listeners.add(this.searchbutton, 'mousedown', this);
		Listeners.add(this.results, 'mousemove', this);
		Listeners.add(this.searchbox, 'mousedown', this);
		Listeners.add(window, 'focus', this);
		Listeners.add(window, 'keydown', this);
	},

	uninit: function() {
		Prefs.unlisten('searchMode', this);
		Listeners.remove(this.searchshade, 'mousedown', this);
		Listeners.remove(this.searchquery, 'input', this);
		Listeners.remove(this.searchquery, 'blur', this);
		Listeners.remove(this.searchbutton, 'mousedown', this);
		Listeners.remove(this.results, 'mousemove', this);
		Listeners.remove(this.searchbox, 'mousedown', this);
		Listeners.remove(window, 'focus', this);
		Listeners.remove(window, 'keydown', this);
	},

	// Handles all keydown before the search interface is brought up.
	_beforeSearchKeyHandler: function(e) {
		if(this.inSearch && e.key == "Escape") {
			e.preventDefault();
			e.stopPropagation();
			this.hide();
			return;
		}

		// Only match reasonable text-like characters for quick search.
		if(e.altKey || e.ctrlKey || e.metaKey) { return; }

		let isDeleteKey = (e.key == "Backspace" || e.key == "Delete");
		if(!this.searchquery.value.length && isDeleteKey) { return; }
		if(!isDeleteKey && (e.key.length != 1 || e.key == " ")) { return; }

		// If we are already in an input field, allow typing as normal.
		if(UI.isTextField(e.target)) { return; }

		// Don't start a search if a group's options dialog is already shown.
		if(GroupOptionsUI.activeOptions) { return; }

		// / is used to activate the search feature so the key shouldn't be entered into the search box.
		if(e.key == "\\") {
			e.stopPropagation();
			e.preventDefault();
		}

		// Do we already have a search active?
		if(this.inSearch) {
			if(!isDeleteKey) {
				this.clearSearch(true);
			}
			this.focus(isDeleteKey);
		}

		this.ensureShown(true);
	},

	// Handles all keydown while search mode.
	_inSearchKeyHandler: function(e) {
		switch(e.key) {
			case "Backspace":
				if(this.searchquery.value.length > 1 || !this._initiatedByKeypress) { break; }
				// no break; continue to Escape

			case "Escape":
				this.hide(e);
				break;

			case "Enter":
				if(Prefs.searchMode == 'highlight') {
					if(e.shiftKey && document.activeElement == this.searchquery) {
						this.searchquery.blur();
						e.preventDefault();
						e.stopPropagation();
					}
					break;
				}

				if(this.currentItem) {
					if(e.shiftKey) {
						this.currentItem.setActive(e);
					} else {
						this.currentItem.zoomIn(e);
					}
				}
				break;

			case "Tab":
			case "ArrowDown":
			case "ArrowUp": {
				if(Prefs.searchMode != 'list') { break; }

				e.preventDefault();
				e.stopPropagation();
				let i = (this.currentItem) ? this.ordered.indexOf(this.currentItem) : -1;
				if(e.key == "ArrowDown" || (e.key == "Tab" && !e.shiftKey)) {
					i++;
					if(i >= this.ordered.length) {
						i = 0;
					}
				} else {
					i--;
					if(i < 0) {
						i = this.ordered.length -1;
					}
				}
				let item = this.ordered[i] || null;
				this.focusItem(item);

				// Make sure the item is in view. .scrollIntoView() just scrolls indiscriminately...
				if(item) {
					let results = this.results;
					let offsetNode = item.container;
					let offsetTop = 0;
					while(offsetNode != results) {
						offsetTop += offsetNode.offsetTop;
						offsetNode = offsetNode.offsetParent;
					}
					let offsetHeight = item.container.offsetHeight;

					if(offsetTop + offsetHeight > results.scrollTop + results.offsetHeight) {
						let scrollTop = offsetTop - results.offsetHeight + offsetHeight;
						scrollTop = Math.min(scrollTop, results.scrollTopMax);
						results.scrollTop = scrollTop;
					}
					else if(offsetTop < results.scrollTop) {
						let scrollTop = offsetTop;
						scrollTop = Math.max(scrollTop, 0);
						results.scrollTop = scrollTop;
					}
				}
				break;
			}
		}
	},

	// Hides search mode.
	hide: function(e) {
		if(!this.inSearch) { return; }

		// Only return focus to the previously active tab when exiting search mode if the search returned no results.
		if((Prefs.searchMode == 'highlight' || !this.currentItem) && this._activeTab && !this._activeTab.parent.hidden) {
			UI.setActive(this._activeTab);
		}

		removeAttribute(document.body, 'searching');
		this.inSearch = false;
		this._activeTab = null;
		this.clearSearch(true);

		if(e) {
			e.preventDefault();
			e.stopPropagation();
		}

		// Return focus to the tab window
		UI.blurAll();
		window.focus();

		dispatch(window, { type: "tabviewsearchdisabled", cancelable: false, bubbles: false });
	},

	// Performs a search.
	perform: function() {
		Timers.init('PerformSearch', () => {
			// Could have exited by now.
			if(!this.inSearch) { return; }

			let term = this.searchquery.value;
			if(this._lastSearch) {
				if(term == this._lastSearch.term) { return; }
				this._lastSearch.cancel();
			}
			this._lastSearch = new TabMatcher(term);
			this._lastSearch.doSearch(this);
		}, 300);
	},

	// Ensures the search feature is displayed.  If not, display it.
	// Parameters:
	//  - a boolean indicates whether this is triggered by a keypress or not
	ensureShown: function(activatedByKeypress) {
		this._initiatedByKeypress = !!activatedByKeypress;

		if(!this.inSearch) {
			this.inSearch = true;
			this._activeTab = UI.getActiveTab();
			this.applyMode();

			if(activatedByKeypress) {
				// set the focus so key strokes are entered into the textbox.
				this.focus();
			} else {
				// marshal the focusing, otherwise it ends up with searchquery.focus gets called before the search button gets the focus after being pressed.
				aSync(() => {
					this.focus();
				}, 0);
			}
		}
	},

	// Switch between showing the results in a list overlayed over the tabs, or highlighting the tab items themselves.
	applyMode: function() {
		if(this.inSearch) {
			setAttribute(document.body, 'searching', Prefs.searchMode);

			if(Prefs.searchMode == 'highlight') {
				// Make sure to have the top (technically current) result selected as the active tab.
				if(this.searchquery.value.length) {
					if(this.currentItem && this.currentItem.isATabItem) {
						this.setActive(this.currentItem._tabItem);
					} else {
						UI.clearActiveTab();
					}
				}

				// Restore the position of the searchbox if placed before by the user.
				let position = this._position && new Point(this._position);
				if(!position) {
					// There's no user-saved position (i.e. first time opening search in this window).
					// So figure out what the best default placement should be.
					position = this.defaultPosition();
				}

				this.$searchbox.css(position);

				// In case the window dimensions changed, the saved position could not be valid anymore, in which case we snap them to the closest valid position available.
				this.snapToView();
				this.savePosition();
			}
			else {
				// The manual placement of the searchbox can't be used while in list mode, the search box is always in the same place there.
				this.resetPosition();
			}
		}
	},

	toggleMode: function() {
		// We toggle between two available modes: "list" and "highlight".
		// I could have made this into a boolean, but meh.
		if(Prefs.searchMode == 'list') {
			Prefs.searchMode = 'highlight';
		} else {
			Prefs.searchMode = 'list';
		}
	},

	// Focuses the search box and selects its contents.
	focus: function(noSelect) {
		if(!noSelect) {
			this.searchquery.select();
		}
		this.searchquery.focus();
		dispatch(window, { type: "tabviewsearchenabled", cancelable: false, bubbles: false });
	},

	snapToView: function() {
		let css = {};
		let bounds = GroupItems.getSafeWindowBounds();
		let box = this.$searchbox.bounds();

		if(box.top < bounds.top) {
			css.top = bounds.top;
		} else if(box.bottom > bounds.bottom) {
			css.top = bounds.height - box.height;
		}

		if(box.left < bounds.left) {
			css.left = bounds.left;
		} else if(box.right > bounds.right) {
			css.left = bounds.width - box.width;
		}

		if(!Utils.isEmptyObject(css)) {
			this.$searchbox.css(css);
		}
	},

	resetPosition: function() {
		this.$searchbox.css({
			top: null,
			left: null
		});
	},

	defaultPosition: function() {
		let bounds = GroupItems.getSafeWindowBounds();
		let box = this.$searchbox.bounds();
		return new Point(bounds.width - box.width - 5, 60);
	},

	savePosition: function() {
		let position = this.$searchbox.position();
		if(!this._position || this._position.x != position.x || this._position.y != position.y) {
			this._position = position;
			UI._save();
		}
	},

	fragmentGroup: function() {
		if(!this._fragmentGroup) {
			let container = document.createElement('div');
			container.classList.add('search-result-group');

			let title = document.createElement('span');
			title.classList.add('search-result-group-title');
			container.appendChild(title);

			let tabContainer = document.createElement('div');
			tabContainer.classList.add("tab-container");
			tabContainer.classList.add("noThumbs");
			container.appendChild(tabContainer);

			this._fragmentGroup = container;
		}

		let container = this._fragmentGroup.cloneNode(true);
		let title = container.firstChild;
		let tabContainer = title.nextSibling;

		return { container, title, tabContainer };
	},

	fragmentResult: function() {
		if(!this._fragmentResult) {
			let div = document.createElement("div");
			div.classList.add("tab");
			div.setAttribute('draggable', 'true');

			let faviconContainer = document.createElement('div');
			faviconContainer.classList.add('favicon-container');
			div.appendChild(faviconContainer);

			let favicon = document.createElement('div');
			favicon.classList.add('favicon');
			faviconContainer.appendChild(favicon);

			let label = document.createElement('span');
			label.classList.add('tab-label');
			div.appendChild(label);

			let title = document.createElement('span');
			title.classList.add('tab-title');
			title.textContent = ' ';
			label.appendChild(title);

			let separator = document.createElement('span');
			separator.classList.add('tab-label-separator');
			separator.textContent = ' - ';
			label.appendChild(separator);

			let url = document.createElement('span');
			url.classList.add('tab-url');
			label.appendChild(url);

			let controls = document.createElement('div');
			controls.classList.add('tab-result-buttons');
			div.appendChild(controls);

			let showBtn = document.createElement('div');
			showBtn.classList.add('tab-setactive');
			showBtn.setAttribute('title', Strings.get('TabView', 'showItemInGroupTooltip'));
			controls.appendChild(showBtn);

			let close = document.createElement('div');
			close.classList.add('close');
			setAttribute(close, "title", Strings.get("TabView", "closeTab"));
			controls.appendChild(close);

			this._fragmentResult = div;
		}

		let container = this._fragmentResult.cloneNode(true);
		let favicon = container.firstChild.firstChild;
		let title = container.firstChild.nextSibling.firstChild;
		let url = title.nextSibling.nextSibling;
		let showBtn = container.lastChild.firstChild;
		let closeBtn = showBtn.nextSibling;

		return { container, favicon, title, url, showBtn, closeBtn };
	},

	// Following comes the part that handles the search results and operations.

	matches: new Map(),
	groupsWithMatches: new Map(),
	firstGroup: null,
	lastGroup: null,
	currentItem: null,
	ordered: [],

	handleSubscription: function(eventName, eventInfo) {
		switch(eventName) {
			case 'tabRemoved':
				this.onUnmatch(eventInfo);
				break;
		}
	},

	focusItem: function(item) {
		if(this.currentItem == item) { return; }

		if(this.currentItem) {
			this.currentItem.container.classList.remove('focus');
		}
		this.currentItem = item;
		if(this.currentItem) {
			this.currentItem.container.classList.add('focus');
		}
	},

	setActive: function(tabItem) {
		if(tabItem.isAnAppItem) {
			UI._dontHideTabView = true;
			UI.goToTab(tabItem.tab);
		} else if(tabItem.isATabItem) {
			UI.setActive(tabItem);
		}
	},

	// Adds styles and event listeners to the matched tab items.
	onMatch: function(tabItem, index) {
		// Highlight the tabItem itself in TabView. Has to be compatible with appItems as well.
		tabItem.container.classList.add('highlighted');
		if(tabItem.parent.isAGroupItem) {
			tabItem.parent.container.classList.add('hasHighlightedItems');
			tabItem.parent.selector.classList.add('hasHighlightedItems');
		}

		// Add an entry for this tab and its parent group into the results list, in case the user wants to use that instead.
		let group = this.groupsWithMatches.get(tabItem.parent);
		if(!group) {
			group = this.createGroupForMatches(tabItem.parent);
			this.groupsWithMatches.set(tabItem.parent, group);
		}

		let order = index +1;
		if(!group.order || group.order > order) {
			group.order = order;
			group.container.style.order = order;

			if(!this.firstGroup || order < this.firstGroup.order) {
				this.firstGroup = group;
			}
			if(!this.lastGroup || order > this.lastGroup.order) {
				this.lastGroup = group;
			}
		}

		group.tabs.add(tabItem);
		let item = this.matches.get(tabItem);
		if(!item) {
			item = this.fragmentResult();
			item.container._item = item;
			item._tabItem = tabItem;
			item._parent = tabItem.parent;
			item.zoomIn = (e) => {
				this.hide(e);
				tabItem.zoomIn();
			};
			item.setActive = (e) => {
				this.toggleMode();
				this.setActive(tabItem);
			};
			item.handleEvent = function(e) {
				switch(e.target) {
					case item.showBtn:
						this.setActive();
						break;

					case item.closeBtn: {
						tabItem.close();
						break;
					}

					case item.container:
					default:
						this.zoomIn();
						break;
				}
			};
			item.container.addEventListener('click', item);

			let title = TabUtils.nameOf(tabItem);
			let url = TabUtils.URLOf(tabItem);
			let iconUrl = TabUtils.faviconURLOf(tabItem);
			let tooltip = title;
			if(title != url) {
				tooltip += "\n" + url;
			} else {
				item.container.classList.add('onlyUrl');
			}

			item.title.textContent = title;
			item.url.textContent = url;
			item.container.setAttribute("title", tooltip);
			if(iconUrl) {
				item.favicon._iconUrl = iconUrl;
				item.favicon.style.backgroundImage = 'url("'+iconUrl+'")';
				item.container.classList.remove('noFavicon');
			} else {
				item.favicon._iconUrl = '';
				item.favicon.style.backgroundImage = '';
				item.container.classList.add('noFavicon');
			}

			this.matches.set(tabItem, item);
			if(tabItem.isATabItem) {
				tabItem.addSubscriber('tabRemoved', this);
			}
		}

		if(group.tabContainer != item.container.parentNode) {
			group.tabContainer.appendChild(item.container);
		}
		item.order = order;
		item.container.style.order = order;

		if(!this.currentItem || order < this.currentItem.order) {
			if(this.currentItem) {
				this.currentItem.container.classList.remove('focus');
			}
			this.currentItem = item;
			item.container.classList.add('focus');
		}

		this.results.removeAttribute('empty');
	},

	// Removes styles and event listeners from the unmatched tab items.
	onUnmatch: function(tabItem) {
		tabItem.container.classList.remove('highlighted');

		let parent = tabItem.parent;

		if(this.matches.has(tabItem)) {
			let item = this.matches.get(tabItem);
			item.container.remove();
			this.matches.delete(tabItem);
			if(tabItem.isATabItem) {
				tabItem.removeSubscriber('tabRemoved', this);
			}

			if(!parent) {
				parent = item._parent;
			}
		}

		if(this.groupsWithMatches.has(parent)) {
			let group = this.groupsWithMatches.get(parent);
			group.tabs.delete(tabItem);
			if(!group.tabs.size) {
				group.container.remove();
				this.groupsWithMatches.delete(parent);
				if(!this.groupsWithMatches.size) {
					this.results.setAttribute('empty', 'true');
					document.body.classList.remove('searched');
				}

				if(parent.isAGroupItem) {
					parent.container.classList.remove('hasHighlightedItems');
					parent.selector.classList.remove('hasHighlightedItems');
				}
			}
		}
	},

	createGroupForMatches: function(groupItem) {
		let { container, title, tabContainer } = this.fragmentGroup();

		if(groupItem.isAGroupItem) {
			title.textContent = groupItem.getTitle(true);
			title.classList[title.textContent == groupItem.defaultName ? 'add' : 'remove']('unnamed-group');
		}
		else if(groupItem == PinnedItems.tray) {
			title.textContent = Strings.get('TabView', 'pinnedItemsGroup');
			title.classList.add('unnamed-group');
		}

		let group = {
			tabs: new Set(),
			order: 0,
			groupItem, container, title, tabContainer
		};
		this.results.appendChild(group.container);
		return group;
	},

	clearSearch: function(endSearch) {
		this.firstGroup = null;
		this.lastGroup = null;
		this.focusItem(null);
		this.ordered = [];

		if(endSearch) {
			for(let tab of this.matches.keys()) {
				this.onUnmatch(tab);
			}
			this._lastSearch = null;
			this.searchquery.value = "";

			// Stacked groups should restack the active tab rather than only the highlighted tabs when ending a search.
			GroupItems.arrangeAllGroups();

			document.body.classList.remove('searched');
		}
		else {
			for(let group of this.groupsWithMatches.values()) {
				group.order = 0;
				group.container.style.order = '';
			}
		}
	},

	finishSearch: function() {
		let groups = [];
		for(let group of this.groupsWithMatches.values()) {
			group.container.classList[group == this.firstGroup ? 'add' : 'remove']('first-child');
			group.container.classList[group == this.lastGroup ? 'add' : 'remove']('last-child');
			groups.push(group);
		}
		groups.sort(function(a,b) { return a.order - b.order; });

		for(let group of groups) {
			let tabItems = [];
			for(let tab of group.tabs) {
				let item = this.matches.get(tab);
				tabItems.push(item);
			}
			tabItems.sort(function(a,b) { return a.order - b.order; });

			for(let tabItem of tabItems) {
				this.ordered.push(tabItem);
			}
		}

		// Stacked groups should stack only the highlighted tabs when performing a search.
		GroupItems.arrangeAllGroups();

		// Make sure to have the top (technically current) result selected as the active tab.
		if(this.searchquery.value.length) {
			document.body.classList.add('searched');
			if(Prefs.searchMode == 'highlight') {
				if(this.currentItem) {
					this.setActive(this.currentItem._tabItem);
				} else {
					UI.clearActiveTab();
				}
			}
		} else {
			document.body.classList.remove('searched');
		}
	}
};
