/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.3.1

this.about = {
	kNS: 'http://www.w3.org/1999/xhtml',

	get openAddonsMgrLink() { return $('openAddonsMgr'); },
	get allVersionsLink() { return $('allVersions'); },

	changelog: null,

	handleEvent: function(e) {
		switch(e.type) {
			case 'click':
				// Clicking a "#" anchor seems to "reset" the page's location (FF51+), which in turn changes panes because of the categories handlers.
				e.preventDefault();

				switch(e.target) {
					case this.openAddonsMgrLink:
						this.openAddonsMgr();
						break;

					case this.allVersionsLink:
						this.fillChangeLog('0');
						break;
				}
				break;

			case 'mouseup':
			case 'mouseover':
				// only do this for links and checkboxes
				if(e.target.nodeName != 'a' && e.target.nodeName != 'html:a' && e.target.nodeName != 'checkbox') { return; }

				if(e.target == document.activeElement) {
					document.activeElement.blur();
				}
				break;
		}
	},

	init: function() {
		Listeners.add(this.openAddonsMgrLink, 'click', this);
		Listeners.add(this.allVersionsLink, 'click', this);

		// place the current version in the page
		$('currentVersion').textContent = $('currentVersion').textContent.replace('{v}', AddonData.version);
		removeAttribute($('version'), 'invisible');

		// fill in the links with data from the add-on; these come directly from defaults.js (overriden from the declared vars in bootstrap.js)
		setAttribute($('paneAbout-homepage'), 'href', addonUris.homepage);
		setAttribute($('paneAbout-support'), 'href', addonUris.support);
		setAttribute($('paneAbout-fullchangelog'), 'href', addonUris.fullchangelog);
		setAttribute($('paneAbout-email'), 'href', addonUris.email);
		setAttribute($('paneAbout-profile'), 'href', addonUris.profile);
		setAttribute($('paneAbout-development'), 'href', addonUris.development);

		// check to see if there is a more recent version available
		this.checkUpdates();

		// need to get the changelog in order to populate the list of changes
		xmlHttpRequest('resource://'+objPathString+'/changelog.json', (xmlhttp) => {
			if(xmlhttp.readyState == 4 && xmlhttp.response) {
				this.changelog = xmlhttp.response;

				this.fillChangeLog(PrefPanes.previousVersion);
				PrefPanes.previousVersion = null;
			}
		}, 'JSON');

		// init AddToAny stuff (share buttons)
		this.shareLinks();

		// fetch the development hours data and show it
		this.api();

		// these are so we can click html links in a xul window without their outline becoming permanent (until clicking another link)
		Listeners.add(window, 'mouseup', this);
		Listeners.add(window, 'mouseover', this, true);
	},

	uninit: function() {
		Listeners.remove(this.openAddonsMgrLink, 'click', this);
		Listeners.remove(this.allVersionsLink, 'click', this);
		Listeners.remove(window, 'mouseup', this);
		Listeners.remove(window, 'mouseover', this, true);
	},

	checkUpdates: function() {
		Addon.findUpdates({
			onUpdateAvailable: function() {
				$('needsupdate').hidden = false;
			},
			onNoUpdateAvailable: function() {
				$('uptodate').hidden = false;
			}
		}, AddonManager.UPDATE_WHEN_PERIODIC_UPDATE);
	},

	// this fills the notes section of the page
	fillChangeLog: function(version) {
		if(!this.changelog.current) { return; }

		// show the all versions link by default
		$('allVersions').hidden = false;

		if(!version) {
			version = this.changelog.current;
		}

		var notes = $('notes');

		// clean up that section before we add everything to it
		while(notes.firstChild) {
			notes.firstChild.remove();
		}

		for(let release in this.changelog.releases) {
			if(Services.vc.compare(release, version) > 0 || (!PrefPanes.previousVersion && Services.vc.compare(release, version) == 0)) {
				let section = document.createElementNS(this.kNS, 'section');
				section.id = release;
				section.classList.add('notes');

				let h3 = document.createElementNS(this.kNS, 'h3');
				h3.textContent = 'Version '+release+' - Release Notes';
				section.appendChild(h3);

				let h4 = document.createElementNS(this.kNS, 'h4');
				h4.textContent = 'Released '+this.changelog.releases[release].date;
				section.appendChild(h4);

				let ul = document.createElementNS(this.kNS, 'ul');
				ul.classList.add('notes-items');
				section.appendChild(ul);

				for(let note of this.changelog.releases[release].notes) {
					this.appendLogEntry(ul, note[1], note[0]);
				}

				let sibling = notes.firstChild;
				while(sibling && (sibling.id == 'knownissues' || Services.vc.compare(release, sibling.id) < 0)) {
					sibling = sibling.nextSibling;
				}
				notes.insertBefore(section, sibling);

				// if we're printing the current release, also print the known issues if there are any
				if(release == this.changelog.current && this.changelog.knownissues) {
					let section = document.createElementNS(this.kNS, 'section');
					section.id = 'knownissues';
					section.classList.add('notes');

					let h3 = document.createElementNS(this.kNS, 'h3');
					h3.textContent = 'Known Issues';
					section.appendChild(h3);

					let ul = document.createElementNS(this.kNS, 'ul');
					ul.classList.add('notes-items');
					section.appendChild(ul);

					for(let issue of this.changelog.knownissues) {
						this.appendLogEntry(ul, issue[0], 'unresolved');
					}

					notes.insertBefore(section, sibling);
				}
			}
		}

		// if we're printing all the releases, hide the button to show them as it won't be needed anymore
		if(Services.vc.compare(version, '0') == 0) {
			$('allVersions').hidden = true;
		}
	},

	appendLogEntry: function(ul, string, category) {
		let li = document.createElementNS(this.kNS, 'li');

		if(category) {
			let b = document.createElementNS(this.kNS, 'b');
			b.classList.add(category);
			b.textContent = category;
			li.appendChild(b);
			li.classList.add('tagged');
		}

		let p = document.createElementNS(this.kNS, 'p');
		p.textContent = string;
		this.parseTextMarkup(p.firstChild);

		li.appendChild(p);
		ul.appendChild(li);
	},

	markupExp: /<([baie]{1})(?:=([^<]*)?)?>(?:([^<]*)?<\/\1>)?/,

	parseTextMarkup: function(textNode) {
		// textNode should always be a #text element
		while(textNode) {
			// if there's no valid beginning markup tag, bail out already
			if(!this.markupExp.test(textNode.textContent)) { break; }

			let match = this.markupExp.exec(textNode.textContent);
			let tag = match[1];
			let href = match[2];
			let text = match[3];

			let tagNode = textNode.splitText(match.index);
			let endNode = tagNode.splitText(match[0].length);
			let addNode;

			switch(tag) {
				case 'b':
					addNode = document.createElementNS(this.kNS, 'span');
					addNode.style.fontWeight = 'bold';
					break;

				case 'i':
					text = 'issue #' + href;
					addNode = this.createLinkNode(addonUris.support + "/" + href);
					break;

				case 'e':
					addNode = this.createLinkNode("https://addons.mozilla.org/firefox/addon/" + href + "/");
					break;

				case 'a':
					addNode = this.createLinkNode(href);
					break;
			}

			addNode.textContent = text;
			tagNode.parentNode.replaceChild(addNode, tagNode);

			// process the just added node for any nested tags
			this.parseTextMarkup(addNode.firstChild);

			// continue processing the rest of the text for more markup tags
			textNode = endNode;
		}
	},

	createLinkNode: function(href) {
		let node = document.createElementNS(this.kNS, 'a');
		setAttribute(node, 'target', '_blank');
		setAttribute(node, 'href', href);
		return node;
	},

	// Since I can't use a local iframe to load remote content, I have to include and build the buttons myself.
	// Build the buttons href's with the link to the add-on and the phrase to be used as default when sharing.
	// These values are defined in defaults.js (overriding the empty originals in bootstrap.js)
	shareLinks: function() {
		if(!addonUris.homepage) { return; }
		$('share').hidden = false;

		let linkurl = encodeURIComponent(addonUris.homepage);
		let linkname = encodeURIComponent($('share-links').getAttribute('linkname'));

		let as = $$('.share-link');
		for(let a of as) {
			let href = a.getAttribute('href');
			switch(a.title) {
				case 'Facebook':
					href += '?u='+linkurl;
					break;

				case 'Twitter':
					href += '?text='+linkname+'%20'+linkurl;
					break;

				case 'Google+':
					href += '?url='+linkurl;
					break;
			}
			setAttribute(a, 'href', href);
		}
	},

	api: function() {
		if(!addonUris.api) { return; }

		xmlHttpRequest(addonUris.api, function(xmlhttp) {
			if(xmlhttp.readyState != 4 || xmlhttp.status != 200 || !xmlhttp.response || !xmlhttp.response.id) { return; }

			var bank = $('bank');
			removeAttribute(bank, 'invisible');

			var hours = xmlhttp.response.hours;
			if(hours < 0) {
				bank.classList.add('negative');
				bank.classList.add('owed');
				bank.classList.remove('positive');
				bank.classList.remove('banked');
				hours = Math.abs(hours);
			}
			else {
				bank.classList.add('banked');
				bank.classList.remove('owed');

				if(hours > 0) {
					bank.classList.add('positive');
					bank.classList.remove('negative');
				} else {
					bank.classList.add('negative');
					bank.classList.remove('positive');
				}
			}

			$('balance').textContent = hours;

			if(xmlhttp.response.working) {
				bank.classList.add('working');
			} else {
				bank.classList.remove('working');
			}

			if(xmlhttp.response.owed > 0) {
				if(xmlhttp.response.owed == 1) {
					$('owed').style.backgroundColor = 'rgb(227,12,12)';
				} else {
					$('owed').style.backgroundImage = 'linear-gradient(to top, rgb(227,12,12) 0, rgb(227,12,12) '+(xmlhttp.response.owed *100)+'%, transparent calc('+(xmlhttp.response.owed *100)+'% + 4px))';
				}
			}

			if(xmlhttp.response.banked > 0) {
				if(xmlhttp.response.banked == 1) {
					$('banked').style.backgroundColor = 'rgb(11,216,11)';
				} else {
					$('banked').style.backgroundImage = 'linear-gradient(to top, rgb(11,216,11) 0, rgb(11,216,11) '+(xmlhttp.response.banked *100)+'%, transparent calc('+(xmlhttp.response.banked *100)+'% + 4px))';
				}
			}
		}, 'JSON');
	},

	openAddonsMgr: function() {
		gWindow.BrowserOpenAddonsMgr();
	}
};

this.promo = {
	current: '1',
	width: 779,
	height: 150,
	link: 'https://youtu.be/NuNlgEItQEk',

	get container() { return $('promo-matchhead'); },
	get tab() { return $('promo-matchhead-tab'); },
	get anchor() { return $('promo-matchhead-anchor'); },
	get close() { return $('promo-matchhead-close'); },
	get hideThis() { return $('promo-matchhead-hideThisPromo'); },
	get hideAll() { return $('promo-matchhead-hideAllPromos'); },

	handleEvent: function(e) {
		switch(e.type) {
			case 'click':
				// Clicking a "#" anchor seems to "reset" the page's location (FF51+), which in turn changes panes because of the categories handlers.
				e.preventDefault();

				switch(e.target) {
					// User wants to close this promo, it will not be shown again, but remains visible for now so the user
					// can decide whether this is just for this promo or for all (possible) future promos.
					case this.close:
						this.seen();
						break;

					// User does not want to view any more promos like this again.
					case this.hideAll:
						Prefs.showPromos = false;
						// Proceed to removing the promo from the screen.

					// Nothing to do at this point but to actually hide the promo from the screen.
					case this.hideThis:
						this.uninit();
						break;
				}
				break;

			case 'mouseup':
				this.seen();
				break;

			case 'resize':
				this.resize();
				break;
		}
	},

	init: function() {
		Prefs.setDefaults({
			showPromos: true,
			['showPromo'+this.current]: true
		});

		// if the user doesn't want any promos, or if they've already seen/closed the current one, skip
		if(!Prefs.showPromos || !Prefs['showPromo'+this.current]) { return; }

		setAttribute(this.tab, 'href', this.link);
		setAttribute(this.anchor, 'href', this.link);

		Listeners.add(this.tab, 'mouseup', this);
		Listeners.add(this.anchor, 'mouseup', this);
		Listeners.add(this.close, 'click', this);
		Listeners.add(this.hideThis, 'click', this);
		Listeners.add(this.hideAll, 'click', this);
		Listeners.add(window, 'resize', this);

		setAttribute(document.documentElement, 'showPromo', 'true');
		setAttribute(this.container, 'smoothSlide', 'true');
		Timers.init('promoSmoothSlide', () => {
			removeAttribute(this.container, 'smoothSlide');
		}, 500);

		this.resize();
	},

	uninit: function() {
		Timers.cancel('promoSmoothSlide');
		removeAttribute(document.documentElement, 'showPromo');
		removeAttribute(this.container, 'smoothSlide');

		Listeners.remove(this.tab, 'mouseup', this);
		Listeners.remove(this.anchor, 'mouseup', this);
		Listeners.remove(this.close, 'click', this);
		Listeners.remove(this.hideThis, 'click', this);
		Listeners.remove(this.hideAll, 'click', this);
		Listeners.remove(window, 'resize', this);

		Styles.unload('promo_'+_UUID);
	},

	resize: function() {
		if(!trueAttribute(document.documentElement, 'showPromo')) { return; }

		// The dimensions of the promo should be relative to the size of the preferences pane, and should keep the original aspect ratio.
		let prefPane = $('mainPrefPane');
		let width = prefPane.clientWidth;

		// subtract the small corner placeholder
		width -= 32;

		// compress to image size if necessary
		width = Math.min(width, this.width);

		// keep aspect ratio
		let height = Math.round(width * this.height / this.width);

		let sscode = '\
			@-moz-document url("'+document.baseURI+'") {\n\
				page['+objName+'_UUID="'+_UUID+'"] #promo-matchhead-image { width: '+width+'px; }\n\
				page['+objName+'_UUID="'+_UUID+'"] #promo-matchhead:hover #promo-matchhead-tab { height: '+height+'px; }\n\
			}';

		Styles.load('promo_'+_UUID, sscode, true);
	},

	seen: function() {
		Prefs['showPromo'+this.current] = false;
		this.close.hidden = true;
		this.hideThis.hidden = false;
		this.hideAll.hidden = false;
	}
};

Modules.LOADMODULE = function() {
	about.init();

	// Shamelessly promoting my own Firefox fan-series: a series of very-short-films made by myself about life
	// with Firefox, with knowledge and approval from Mozilla's marketing/social teams.
	// These promos only appear in the About pane of the add-on's preferences tab, are very non-intrusive,
	// they are hidden out of the way in a 32x32px corner unless the user interacts with it,
	// and can be disabled (hidden) completely by clicking its close button.
	// Everything is self-contained within the add-on, no remote connections are made what-so-ever.
	// The promo is an image/banner that links to an outside YouTube page where the user can see the video,
	// this behavior is clearly described in the promo itself.
	promo.init();
};

Modules.UNLOADMODULE = function() {
	about.uninit();
	promo.uninit();
};
