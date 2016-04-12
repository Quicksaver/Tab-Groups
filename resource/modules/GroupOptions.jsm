// VERSION 1.0.3

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

	get onOverflow() {
		return this.groupItem.onOverflow;
	},

	set onOverflow(v) {
		return this.groupItem.onOverflow = v;
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
	onOverflow: $$('[name="groupOptions-onOverflow"]'),
	onOverflowBox: $('groupOptions-onOverflow'),

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
		}
	},

	toggleThumbs: function() {
		toggleAttribute(this.showUrls, 'disabled', this.showThumbs.checked);
		toggleAttribute(this.showUrlsLabel, 'disabled', this.showThumbs.checked);

		let disabled = UI.single || !this.showThumbs.checked;
		toggleAttribute(this.onOverflowBox, 'disabled', disabled);
		for(let radio of this.onOverflow) {
			toggleAttribute(radio, 'disabled', disabled);
		}
	},

	show: function(groupOptions) {
		if(this.activeOptions) { return; }

		Listeners.add(this.showThumbs, 'click', this);
		Listeners.add(this.shade, 'click', this);
		Listeners.add(this.close, 'click', this);
		Listeners.add(window, 'keypress', this);

		this.activeOptions = groupOptions;

		this.title.value = this.activeOptions.title;
		this.title.setAttribute('placeholder', this.activeOptions.placeholder);
		this.showThumbs.checked = this.activeOptions.showThumbs;
		this.showUrls.checked = this.activeOptions.showUrls;
		for(let radio of this.onOverflow) {
			radio.checked = radio.value == this.activeOptions.onOverflow;
		}

		this.toggleThumbs();
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
		Listeners.remove(window, 'keypress', this);

		for(let radio of this.onOverflow) {
			if(radio.checked) {
				this.activeOptions.onOverflow = radio.value;
				break;
			}
		}
		this.activeOptions.showThumbs = this.showThumbs.checked;
		this.activeOptions.showUrls = this.showUrls.checked;
		// The title should be the last thing to be set, as it calls save() for use.
		this.activeOptions.title = this.title.value;

		this.activeOptions.finish();

		document.body.classList.remove('groupOptions');
		this.activeOptions = null;
	}
};
