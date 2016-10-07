/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.7

this.GroupOptions = function(groupItem) {
	this.groupItem = groupItem;
	this.showDialog();
};

this.GroupOptions.prototype = {
	get title() {
		return this.groupItem.getTitle();
	},

	set title(v) {
		return this.groupItem.setTitle(v);
	},

	get placeholder() {
		return this.groupItem.defaultName;
	},

	get stackTabs() {
		return this.groupItem.stackTabs;
	},

	set stackTabs(v) {
		return this.groupItem.stackTabs = v;
	},

	get showThumbs() {
		return this.groupItem.showThumbs;
	},

	set showThumbs(v) {
		return this.groupItem.showThumbs = v;
	},

	get showUrls() {
		return this.groupItem.showUrls;
	},

	set showUrls(v) {
		return this.groupItem.showUrls = v;
	},

	get tileIcons() {
		return this.groupItem.tileIcons;
	},

	set tileIcons(v) {
		return this.groupItem.tileIcons = v;
	},

	get catchOnce() {
		return this.groupItem.catchOnce;
	},

	set catchOnce(v) {
		return this.groupItem.catchOnce = v;
	},

	get catchRules() {
		return this.groupItem.catchRules;
	},

	set catchRules(v) {
		return this.groupItem.catchRules = v;
	},

	showDialog: function() {
		GroupOptionsUI.show(this);
	},

	finish: function() {
		// We don't need to call save() on the group, that's done at least once already when setting the title.
		this.groupItem.arrange();
	}
};

this.GroupOptionsUI = {
	dialog: $('groupOptions'),
	close: $('groupOptions-close'),
	shade: $('groupOptions-shade'),
	title: $('groupOptions-title'),
	showThumbs: $('groupOptions-showThumbs'),
	showUrls: $('groupOptions-showUrls'),
	showUrlsLabel: $('groupOptions-showUrls-label'),
	tileIcons: $('groupOptions-tileIcons'),
	tileIconsLabel: $('groupOptions-tileIcons-label'),
	stackTabs: $$('[name="groupOptions-stackTabs"]'),
	stackTabsBox: $('groupOptions-stackTabs'),
	catchOnce: $('groupOptions-catchOnce'),
	catchRules: $('groupOptions-catchRules'),
	catchRulesPlaceholder: $('groupOptions-catchRules-placeholder'),

	activeOptions: null,

	handleEvent: function(e) {
		switch(e.type) {
			case 'click':
				switch(e.target) {
					case this.showThumbs:
						this.toggleThumbs();
						break;

					default:
						this.hide();
						break;
				}
				break;

			case 'keypress':
				switch(e.key) {
					case "Escape":
						this.hide();
						break;
				}

			case 'input':
				this.updateCatchRulesPlaceholder();
				break;
		}
	},

	toggleThumbs: function() {
		toggleAttribute(this.showUrls, 'disabled', this.showThumbs.checked);
		toggleAttribute(this.showUrlsLabel, 'disabled', this.showThumbs.checked);
		toggleAttribute(this.tileIcons, 'disabled', !this.showThumbs.checked);
		toggleAttribute(this.tileIconsLabel, 'disabled', !this.showThumbs.checked);

		let disabled = UI.single || !this.showThumbs.checked;
		toggleAttribute(this.stackTabsBox, 'disabled', disabled);
		for(let radio of this.stackTabs) {
			toggleAttribute(radio, 'disabled', disabled);
		}
	},

	updateCatchRulesPlaceholder: function() {
		this.catchRulesPlaceholder.hidden = this.catchRules.value.length;
	},

	show: function(groupOptions) {
		if(this.activeOptions) { return; }

		Listeners.add(this.showThumbs, 'click', this);
		Listeners.add(this.shade, 'click', this);
		Listeners.add(this.close, 'click', this);
		Listeners.add(this.catchRules, 'input', this);
		Listeners.add(window, 'keypress', this);

		this.activeOptions = groupOptions;

		this.title.value = this.activeOptions.title;
		this.title.setAttribute('placeholder', this.activeOptions.placeholder);
		this.showThumbs.checked = this.activeOptions.showThumbs;
		this.showUrls.checked = this.activeOptions.showUrls;
		this.tileIcons.checked = this.activeOptions.tileIcons;
		for(let radio of this.stackTabs) {
			radio.checked = (radio.value == 'stack' && this.activeOptions.stackTabs) || (radio.value == 'list' && !this.activeOptions.stackTabs);
		}
		this.catchOnce.checked = this.activeOptions.catchOnce;
		this.catchRules.value = this.activeOptions.catchRules;

		this.toggleThumbs();
		this.updateCatchRulesPlaceholder();
		document.body.classList.add('groupOptions');

		// make sure the cursor doesn't remain somewhere else
		this.dialog.focus();
	},

	hide: function() {
		if(!this.activeOptions) { return; }

		// We do this first so that only the first click/action actually goes through, no point in doing the same thing several times in case clicks stack up.
		Listeners.remove(this.showThumbs, 'click', this);
		Listeners.remove(this.shade, 'click', this);
		Listeners.remove(this.close, 'click', this);
		Listeners.remove(this.catchRules, 'input', this);
		Listeners.remove(window, 'keypress', this);

		this.activeOptions.catchOnce = this.catchOnce.checked;
		this.activeOptions.catchRules = this.catchRules.value;
		for(let radio of this.stackTabs) {
			if(radio.checked) {
				this.activeOptions.stackTabs = radio.value == 'stack';
				break;
			}
		}
		this.activeOptions.showThumbs = this.showThumbs.checked;
		this.activeOptions.showUrls = this.showUrls.checked;
		this.activeOptions.tileIcons = this.tileIcons.checked;
		// The title should be the last thing to be set, as it calls save() for use.
		this.activeOptions.title = this.title.value;

		this.activeOptions.finish();

		document.body.classList.remove('groupOptions');
		this.activeOptions = null;

		// Return focus to the tab window
		UI.blurAll();
		window.focus();
	}
};
