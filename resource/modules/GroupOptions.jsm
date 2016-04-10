// VERSION 1.0.0

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

	showDialog: function() {
		GroupOptionsUI.show(this);
	},

	hideDialog: function() {
		GroupOptionsUI.hide();
	}
};

this.GroupOptionsUI = {
	dialog: $('groupOptions'),
	close: $('groupOptions-close'),
	shade: $('groupOptions-shade'),
	title: $('groupOptions-title'),

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

		document.body.classList.add('groupOptions');

		// make sure the cursor doesn't remain somewhere else
		this.dialog.focus();
	},

	hide: function() {
		if(!this.activeOptions) { return; }

		this.activeOptions.title = this.title.value; // this will call group.save() because of the inner setTitle() call

		document.body.classList.remove('groupOptions');

		this.activeOptions = null;

		Listeners.remove(this.shade, 'click', this);
		Listeners.remove(this.close, 'click', this);
		Listeners.remove(window, 'keypress', this);
	}
};
