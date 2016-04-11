// VERSION 1.0.1

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
	onOverflow: $$('[name="groupOptions-onOverflow"]'),
	onOverflowBox: $('groupOptions-onOverflow'),

	activeOptions: null,

	handleEvent: function(e) {
		switch(e.type) {
			case 'click':
				this.hide();
				break;

			case 'keypress':
				switch(e.key) {
					case "Escape":
						this.hide();
						break;
				}
		}
	},

	show: function(groupOptions) {
		if(this.activeOptions) { return; }

		Listeners.add(this.shade, 'click', this);
		Listeners.add(this.close, 'click', this);
		Listeners.add(window, 'keypress', this);

		this.activeOptions = groupOptions;

		this.title.value = this.activeOptions.title;
		this.title.setAttribute('placeholder', this.activeOptions.placeholder);

		toggleAttribute(this.onOverflowBox, 'disabled', UI.single);

		for(let radio of this.onOverflow) {
			radio.checked = radio.value == this.activeOptions.onOverflow;
			toggleAttribute(radio, 'disabled', UI.single);
		}

		document.body.classList.add('groupOptions');

		// make sure the cursor doesn't remain somewhere else
		this.dialog.focus();
	},

	hide: function() {
		if(!this.activeOptions) { return; }

		// We do this first so that only the first click/action actually goes through, no point in doing the same thing several times in case clicks stack up.
		Listeners.remove(this.shade, 'click', this);
		Listeners.remove(this.close, 'click', this);
		Listeners.remove(window, 'keypress', this);

		for(let radio of this.onOverflow) {
			if(radio.checked) {
				this.activeOptions.onOverflow = radio.value;
				break;
			}
		}

		// The title should be the last thing to be set, as it calls save() for use.
		this.activeOptions.title = this.title.value;

		this.activeOptions.finish();

		document.body.classList.remove('groupOptions');
		this.activeOptions = null;
	}
};
