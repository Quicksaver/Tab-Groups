// VERSION 1.2.3

// Class: GroupItem - A single groupItem in the TabView window.
// Parameters:
//   listOfEls - an array of DOM elements for tabs to be added to this groupItem
//   options - various options for this groupItem (see below). In addition, gets passed to <add> along with the elements provided.
// Possible options:
//   id - specifies the groupItem's id; otherwise automatically generated
//   userSize - see <Item.userSize>; default is null
//   bounds - a <Rect>; otherwise based on the locations of the provided elements
//   container - a DOM element to use as the container for this groupItem; otherwise will create
//   title - the title for the groupItem; otherwise blank
//   focusTitle - focus the title's input field after creation
//   immediately - true if we want all placement immediately, not with animation
this.GroupItem = function(listOfEls, options) {
	if(!options) {
		options = {};
	}

	Subscribable(this);

	this._inited = false;
	this._uninited = false;
	this.children = []; // an array of Items
	this.isAGroupItem = true;
	this.id = options.id || GroupItems.getNextID();
	this.isStacked = false;
	this.expanded = null;
	this.hidden = false;
	this.childHandling = false;
	this.fadeAwayUndoButtonDelay = 15000;
	this.fadeAwayUndoButtonDuration = 300;
	this.lastMouseDownTarget = null;

	this._itemSizeFrozen = false;
	this._delaySetCurrentSize = null;

	// A <Point> that describes the last size specifically chosen by the user.
	this.userSize = null;

	// The <TabItem> for the groupItem's active tab.
	this._activeTab = null;

	this._onChildClose = this._onChildClose.bind(this);

	if(Utils.isPoint(options.userSize)) {
		this.userSize = new Point(options.userSize);
	}

	let rectToBe;
	if(options.bounds) {
		rectToBe = new Rect(options.bounds);
	}

	if(!rectToBe) {
		rectToBe = GroupItems.getBoundingBox(listOfEls);
		rectToBe.inset(-42, -42);
	}

	this.container = document.createElement('div');
	this.container.id = 'group'+this.id;
	this.container.classList.add('groupItem');
	this.container._item = this;

	this.$container = iQ(this.container).css(rectToBe);
	this.bounds = this.$container.bounds();

	this.isDragging = false;
	this.isResizing = false;
	document.body.appendChild(this.container);

	// ___ Titlebar
	this.titlebar = document.createElement('div');
	this.titlebar.classList.add('titlebar');
	this.container.appendChild(this.titlebar);

	let tbContainer = document.createElement('div');
	tbContainer.classList.add('title-container');
	this.titlebar.appendChild(tbContainer);

	this.title = document.createElement('input');
	this.title.classList.add('name');
	this.title.setAttribute('placeholder', this.defaultName);
	this.title.setAttribute("title", Strings.get("TabView", "groupItemDefaultName"));
	this.title.handleEvent = (e) => {
		switch(e.type) {
			case 'mousedown':
				e.stopPropagation();
				break;

			case 'mouseout':
				this.title.classList.remove("transparentBorder");
				Listeners.remove(this.title, 'mouseout', this.title);
				break;

			case 'keypress':
				if(e.key == "Escape" || e.key == "Enter") {
					this.title.blur();
					this.title.classList.add("transparentBorder");
					Listeners.add(this.title, 'mouseout', this.title);
					e.stopPropagation();
					e.preventDefault();
				}
				break;

			case 'keypup':
				// NOTE: When user commits or cancels IME composition, the last key event fires only a keyup event.
				// Then, we shouldn't take any reactions but we should update our status.
				this.save();
				break;

			case 'blur':
				this._titleFocused = false;
				this.title.setSelectionRange(0, 0);
				this.titleShield.hidden = false;
				this.save();
				break;

			case 'focus':
				this._unfreezeItemSize();
				if(!this._titleFocused) {
					this.title.select();
					this._titleFocused = true;
				}
				break;
		}
	};
	this.title.addEventListener('mousedown', this.title, true);
	this.title.addEventListener('keypress', this.title, true);
	this.title.addEventListener('keyup', this.title);
	this.title.addEventListener('focus', this.title);
	this.title.addEventListener('blur', this.title);
	tbContainer.appendChild(this.title);

	this.titleShield = document.createElement('div');
	this.titleShield.classList.add('title-shield');
	this.titleShield.setAttribute('title', Strings.get("TabView", "groupItemDefaultName"));
	this.titleShield.handleEvent = (e) => {
		switch(e.type) {
			case 'mousedown':
				this.lastMouseDownTarget = (e.button == 0 ? e.target : null);
				break;

			case 'mouseup':
				let same = (e.target == this.lastMouseDownTarget);
				this.lastMouseDownTarget = null;
				if(same && !this.isDragging && !this.isResizing) {
					this.focusTitle();
				}
				break;
		}
	};
	this.titleShield.addEventListener('mousedown', this.titleShield);
	this.titleShield.addEventListener('mouseup', this.titleShield);
	tbContainer.appendChild(this.titleShield);

	this.setTitle(options.title);
	if(options.focusTitle) {
		this.focusTitle();
	}

	this.closeButton = document.createElement('div');
	this.closeButton.classList.add('close');
	this.closeButton.setAttribute("title", Strings.get("TabView", "groupItemCloseGroup"));
	this.closeButton.handleEvent = () => {
		// click
		this.closeAll();
	};
	this.closeButton.addEventListener('click', this.closeButton);
	this.titlebar.appendChild(this.closeButton);

	// content area
	this.contents = document.createElement('div');
	this.contents.classList.add('contents');
	this.container.appendChild(this.contents);
	this.$contents = iQ(this.contents);

	// tabs container
	this.tabContainer = document.createElement('div');
	this.tabContainer.classList.add('tab-container');
	this.contents.appendChild(this.tabContainer);
	this.$tabContainer = iQ(this.tabContainer);

	// ___ Stack Expander
	this.expander = document.createElement("div");
	this.expander.classList.add("stackExpander");
	this.expander.handleEvent = () => {
		// click
		this.expand();
	};
	this.expander.addEventListener("click", this.expander);
	this.contents.appendChild(this.expander);

	// ___ Undo Close
	this.undoContainer = null;

	// ___ Children
	// We explicitly set dontArrange=true to prevent the groupItem from re-arranging its children after a tabItem has been added.
	// This saves us a group.arrange() call per child and therefore some tab.setBounds() calls.
	options.dontArrange = true;
	for(let el of listOfEls) {
		this.add(el, options);
	}

	// ___ Finish Up
	this.container.addEventListener('mousedown', this);
	this.container.addEventListener('mouseup', this);
	this.container.addEventListener('dragover', this);
	this.container.addEventListener('dragenter', this);

	GroupItems.register(this);

	// ___ Position
	this.setBounds(rectToBe, options.immediately);

	// Calling snap will also trigger pushAway
	this.snap(options.immediately);

	if(!options.immediately && listOfEls.length) {
		this.$container.hide().fadeIn();
	}

	this._inited = true;
	this.save();
};

this.GroupItem.prototype = {
	// The prompt text for the title field.
	defaultName: Strings.get("TabView", "groupItemDefaultName"),

	// Sets the active <TabItem> for this groupItem; can be null, but only if there are no children.
	setActiveTab: function(tab) {
		this._activeTab = tab;

		if(this.isStacked) {
			this.arrange();
		}
	},

	// Gets the active <TabItem> for this groupItem; can be null, but only if there are no children.
	getActiveTab: function() {
		return this._activeTab;
	},

	// Returns all of the info worth storing about this groupItem.
	getStorageData: function() {
		let data = {
			bounds: this.getBounds(),
			userSize: null,
			title: this.getTitle(),
			id: this.id
		};

		if(Utils.isPoint(this.userSize)) {
			data.userSize = new Point(this.userSize);
		}

		return data;
	},

	// Returns true if the tab groupItem is empty and unnamed.
	isEmpty: function() {
		return !this.children.length && !this.getTitle();
	},

	// Returns true if the item is showing on top of this group's stack, determined by whether the tab is this group's topChild,
	// or if it doesn't have one, its first child.
	isTopOfStack: function(item) {
		return this.isStacked && item == this.getTopChild();
	},

	// Saves this groupItem to persistent storage.
	save: function() {
		// too soon/late to save
		if(!this._inited || this._uninited) { return; }

		let data = this.getStorageData();
		if(GroupItems.storageSanityGroupItem(data)) {
			Storage.saveGroupItem(gWindow, data);
		}
	},

	// Deletes the groupItem in the persistent storage.
	deleteData: function() {
		this._uninited = true;
		Storage.deleteGroupItem(gWindow, this.id);
	},

	// Returns the title of this groupItem as a string.
	getTitle: function() {
		return this.title ? this.title.value : '';
	},

	// Sets the title of this groupItem with the given string
	setTitle: function(value) {
		this.title.value = value || "";
		this.save();
	},

	// Hide the title's shield and focus the underlying input field.
	focusTitle: function() {
		this.titleShield.hidden = true;
		this.title.focus();
	},

	// Returns a <Rect> for the groupItem's content area (which doesn't include the title, etc).
	getContentBounds: function(justTabs) {
		return (justTabs) ? this.$tabContainer.bounds() : this.$contents.bounds();
	},

	// Returns a copy of the Item's bounds as a <Rect>.
	getBounds: function() {
		return new Rect(this.bounds);
	},

	// Sets the bounds with the given <Rect>, animating unless "immediately" is false.
	// Parameters:
	//   inRect - a <Rect> giving the new bounds
	//   immediately - true if it should not animate; default false
	//   options - an object with additional parameters, see below
	// Possible options:
	//   force - true to always update the DOM even if the bounds haven't changed; default false
	setBounds: function(inRect, immediately, options) {
		// Validate and conform passed in size
		let validSize = GroupItems.calcValidSize(new Point(inRect.width, inRect.height));
		let rect = new Rect(inRect.left, inRect.top, validSize.x, validSize.y);

		if(!options) {
			options = {};
		}

		// ___ Determine what has changed
		let css = {};

		if(rect.left != this.bounds.left || options.force) {
			css.left = rect.left;
		}

		if(rect.top != this.bounds.top || options.force) {
			css.top = rect.top;
		}

		if(rect.width != this.bounds.width || options.force) {
			css.width = rect.width;
		}

		if(rect.height != this.bounds.height || options.force) {
			css.height = rect.height;
		}

		if(Utils.isEmptyObject(css)) { return; }

		let offset = new Point(rect.left - this.bounds.left, rect.top - this.bounds.top);
		this.bounds = new Rect(rect);

		// ___ Update our representation
		if(immediately) {
			this.$container.css(css);
			if(css.width || css.height) {
				this.arrange();
			}
		} else {
			TabItems.pausePainting();
			this.$container.animate(css, {
				duration: 350,
				easing: "tabviewBounce",
				complete: () => {
					TabItems.resumePainting();
					if(css.width || css.height) {
						this.arrange();
					}
				}
			});
		}

		UI.clearShouldResizeItems();
		this.setTrenches(rect);
		this.save();
	},

	setSize: function(bounds, options) {
		if(this._delaySetCurrentSize) {
			this._delaySetCurrentSize.cancel();
			this._delaySetCurrentSize = null;
		}

		if(!options) {
			options = {};
		}

		// Trigger handlers only if needed.
		if(!bounds) {
			let box = this.$container.bounds();
			let valid = GroupItems.calcValidSize(new Point(box.width, box.height));
			bounds = new Rect(box.left, box.top, valid.x, valid.y);
		}
		if(!bounds.equals(this.bounds) || options.force) {
			this.bounds = bounds;
			UI.clearShouldResizeItems();
			this.setTrenches(bounds);
			this.save();

			if(options.immediate) {
				this.arrange();
			} else {
				this.delayArrange(350);
			}
		}
	},

	// Pushes all other items away so none overlap this Item.
	// Parameters:
	//  immediately - boolean for doing the pushAway without animation
	pushAway: function(immediately) {
		// we need at least two top-level items to push something away
		if(GroupItems.size < 2) { return; }

		let buffer = Math.floor(GroupItems.defaultGutter / 2);

		// setup each Item's pushAwayData attribute:
		for(let item of GroupItems) {
			let data = {};
			data.bounds = item.getBounds();
			data.startBounds = new Rect(data.bounds);
			// Infinity = (as yet) unaffected
			data.generation = Infinity;
			item.pushAwayData = data;
		}

		// The first item is a 0-generation pushed item. It all starts here.
		let itemsToPush = [this];
		this.pushAwayData.generation = 0;

		let pushOne = function(baseItem) {
			// the baseItem is an n-generation pushed item. (n could be 0)
			let baseData = baseItem.pushAwayData;
			let bb = new Rect(baseData.bounds);

			// make the bounds larger, adding a +buffer margin to each side.
			bb.inset(-buffer, -buffer);
			// bbc = center of the base's bounds
			let bbc = bb.center();

			for(let item of GroupItems) {
				if(item == baseItem) { continue; }

				let data = item.pushAwayData;

				// if the item under consideration has already been pushed, or has a lower
				// "generation" (and thus an implictly greater placement priority) then don't move it.
				if(data.generation <= baseData.generation) { continue; }

				// box = this item's current bounds, with a +buffer margin.
				let bounds = data.bounds;
				let box = new Rect(bounds);
				box.inset(-buffer, -buffer);

				// if the item under consideration overlaps with the base item let's push it a little.
				if(box.intersects(bb)) {
					// First, decide in which direction and how far to push. This is the offset.
					let offset = new Point();
					// center = the current item's center.
					let center = box.center();

					// Consider the relationship between the current item (box) + the base item.
					// If it's more vertically stacked than "side by side" push vertically.
					if(Math.abs(center.x - bbc.x) < Math.abs(center.y - bbc.y)) {
						if(center.y > bbc.y) {
							offset.y = bb.bottom - box.top;
						} else {
							offset.y = bb.top - box.bottom;
						}
					}

					// if they're more "side by side" than stacked vertically push horizontally.
					else {
						if(center.x > bbc.x) {
							offset.x = bb.right - box.left;
						} else {
							offset.x = bb.left - box.right;
						}
					}

					// Actually push the Item.
					bounds.offset(offset);

					// This item now becomes an (n+1)-generation pushed item.
					data.generation = baseData.generation +1;

					// keep track of who pushed this item.
					data.pusher = baseItem;

					// add this item to the queue, so that it, in turn, can push some other things.
					itemsToPush.push(item);
				}
			}
		};

		// push each of the itemsToPush, one at a time.
		// itemsToPush starts with just [this], but pushOne can add more items to the stack.
		// Maximally, this could run through all Items on the screen.
		while(itemsToPush.length) {
			pushOne(itemsToPush.shift());
		}

		// ___ Squish!
		let pageBounds = GroupItems.getSafeWindowBounds();
		for(let item of GroupItems) {
			let data = item.pushAwayData;
			if(data.generation == 0) { continue; }

			let apply = function(item, posStep, posStep2, sizeStep) {
				let data = item.pushAwayData;
				if(data.generation == 0) { return; }

				let bounds = data.bounds;
				bounds.width -= sizeStep.x;
				bounds.height -= sizeStep.y;
				bounds.left += posStep.x;
				bounds.top += posStep.y;

				let validSize = GroupItems.calcValidSize(new Point(bounds.width, bounds.height));
				bounds.width = validSize.x;
				bounds.height = validSize.y;

				let pusher = data.pusher;
				if(pusher) {
					var newPosStep = new Point(posStep.x + posStep2.x, posStep.y + posStep2.y);
					apply(pusher, newPosStep, posStep2, sizeStep);
				}
			};

			let bounds = data.bounds;
			let posStep = new Point();
			let posStep2 = new Point();
			let sizeStep = new Point();

			if(bounds.left < pageBounds.left) {
				posStep.x = pageBounds.left - bounds.left;
				sizeStep.x = posStep.x / data.generation;
				posStep2.x = -sizeStep.x;
			} else if(bounds.right > pageBounds.right) { // this may be less of a problem post-601534
				posStep.x = pageBounds.right - bounds.right;
				sizeStep.x = -posStep.x / data.generation;
				posStep.x += sizeStep.x;
				posStep2.x = sizeStep.x;
			}

			if(bounds.top < pageBounds.top) {
				posStep.y = pageBounds.top - bounds.top;
				sizeStep.y = posStep.y / data.generation;
				posStep2.y = -sizeStep.y;
			} else if(bounds.bottom > pageBounds.bottom) { // this may be less of a problem post-601534
				posStep.y = pageBounds.bottom - bounds.bottom;
				sizeStep.y = -posStep.y / data.generation;
				posStep.y += sizeStep.y;
				posStep2.y = sizeStep.y;
			}

			if(posStep.x || posStep.y || sizeStep.x || sizeStep.y) {
				apply(item, posStep, posStep2, sizeStep);
			}
		}

		// ___ Unsquish
		let pairs = [];
		for(let item of GroupItems) {
			let data = item.pushAwayData;
			pairs.push({
				item: item,
				bounds: data.bounds
			});
		}

		GroupItems.unsquish(pairs);

		// ___ Apply changes
		for(let item of GroupItems) {
			let data = item.pushAwayData;
			let bounds = data.bounds;
			if(!bounds.equals(data.startBounds)) {
				item.setBounds(bounds, immediately);
			}
		}
	},

	// Sets up/moves the trenches for snapping to this item.
	setTrenches: function(rect) {
		if(!this.borderTrenches) {
			this.borderTrenches = Trenches.registerWithItem(this, "border");
		}

		let bT = this.borderTrenches;
		Trenches.getById(bT.left).setWithRect(rect);
		Trenches.getById(bT.right).setWithRect(rect);
		Trenches.getById(bT.top).setWithRect(rect);
		Trenches.getById(bT.bottom).setWithRect(rect);

		if(!this.guideTrenches) {
			this.guideTrenches = Trenches.registerWithItem(this, "guide");
		}

		let gT = this.guideTrenches;
		Trenches.getById(gT.left).setWithRect(rect);
		Trenches.getById(gT.right).setWithRect(rect);
		Trenches.getById(gT.top).setWithRect(rect);
		Trenches.getById(gT.bottom).setWithRect(rect);
	},

	// Removes the trenches for snapping to this item.
	removeTrenches: function() {
		for(let edge in this.borderTrenches) {
			Trenches.unregister(this.borderTrenches[edge]); // unregister can take an array
		}
		this.borderTrenches = null;
		for(let edge in this.guideTrenches) {
			Trenches.unregister(this.guideTrenches[edge]); // unregister can take an array
		}
		this.guideTrenches = null;
	},

	// The snap function used during groupItem creation via drag-out
	// Parameters:
	//  immediately - bool for having the drag do the final positioning without animation
	snap: function(immediately) {
		// make the snapping work with a wider range!
		let defaultRadius = Trenches.defaultRadius;
		Trenches.defaultRadius = 2 * defaultRadius; // bump up from 10 to 20!

		new GroupDrag(this);
		DraggingGroup.start();
		DraggingGroup.snap('none');
		DraggingGroup.stop(immediately);

		Trenches.defaultRadius = defaultRadius;
	},

	handleEvent: function(e) {
		switch(e.type) {
			case 'mouseup': {
				let same = (e.target == this.lastMouseDownTarget);
				this.lastMouseDownTarget = null;

				if(!this.childHandling && same && !this.isDragging && !this.isResizing) {
					if(Tabs.selected.pinned
					&& UI.getActiveTab() != this.getActiveTab()
					&& this.children.length) {
						UI.setActive(this, { dontSetActiveTabInGroup: true });
						UI.goToTab(Tabs.selected);
					} else {
						let tabItem = this.getTopChild();
						if(tabItem) {
							tabItem.zoomIn();
						} else {
							this.newTab();
						}
					}
				}

				this.childHandling = false;
				break;
			}

			case 'mousedown':
				// only set the last mouse down target if it is a left click, not on the close button,
				// not on the expand button, not on the title bar and its elements
				this.lastMouseDownTarget = null;
				if(e.button == 0) {
					// Make sure it knows to snap to another group's edges when being resized.
					if(e.originalTarget.localName == 'resizer' && e.originalTarget.parentNode == this.container) {
						new GroupDrag(this, e, true);
					}
					else if(this.closeButton != e.target
					&& this.expander != e.target) {
						if(!this.childHandling) {
							new GroupDrag(this, e);
						}
						if(!isAncestor(e.target, this.titlebar)) {
							this.lastMouseDownTarget = e.target;
						}
					}
				}

				this.childHandling = false;
				break;

			case 'dragover':
			case 'dragenter':
				if(DraggingTab) {
					DraggingTab.canDrop(e, this);
				}
				break;

			case 'tabviewhidden':
				this._unfreezeItemSize()
				break;

			case 'mousemove': {
				let cursor = new Point(e.pageX, e.pageY);
				if(!this.bounds.contains(cursor)) {
					this._unfreezeItemSize();
				}
				break;
			}
		}
	},

	// Closes the groupItem, removing (but not closing) all of its children.
	// Parameters:
	//   options - An object with optional settings for this call.
	// Options:
	//   immediately - (bool) if true, no animation will be used
	close: function(options) {
		this.removeAll({ dontClose: true });
		GroupItems.unregister(this);

		// remove unfreeze event handlers, if item size is frozen
		this._unfreezeItemSize(true);

		let destroyGroup = () => {
			this.container.remove();
			if(this.undoContainer) {
				this.undoContainer.remove();
				this.undoContainer = null;
			}
			this.removeTrenches();
			Styles.unload('group_'+this.id+'_'+_UUID);
			GroupItems.unsquish();
			this._sendToSubscribers("close");
		};

		if(this.hidden || (options && options.immediately)) {
			destroyGroup();
		} else {
			this.$container.animate({
				opacity: 0,
				"transform": "scale(.3)",
			}, {
				duration: 170,
				complete: destroyGroup
			});
		}

		this.deleteData();
	},

	// Closes the groupItem and all of its children.
	closeAll: function() {
		if(this.children.length) {
			this._unfreezeItemSize();

			this.$container.animate({
				opacity: 0,
				"transform": "scale(.3)",
			}, {
				duration: 170,
				complete: () => {
					this.$container.hide();
				}
			});

			this.removeTrenches();
			this._createUndoButton();
		}
		else {
			this.close();
		}

		this._makeLastActiveGroupItemActive();
	},

	// Make the closest tab external to this group active. Used when closing the group.
	_makeClosestTabActive: function() {
		let closeCenter = this.getBounds().center();

		// Find closest tab to make active
		let closestTabItem = UI.getClosestTab(closeCenter);
		if(closestTabItem) {
			UI.setActive(closestTabItem);
		}
	},

	// Makes the last active group item active.
	_makeLastActiveGroupItemActive: function() {
		let groupItem = GroupItems.getLastActiveGroupItem();
		if(groupItem) {
			UI.setActive(groupItem);
		} else {
			this._makeClosestTabActive();
		}
	},

	// Closes the group if it's empty, is closable, and autoclose is enabled (see pauseAutoclose()).
	// Returns true if the close occurred and false otherwise.
	closeIfEmpty: function() {
		if(this.isEmpty()
		&& !UI._closedLastVisibleTab
		&& !GroupItems._autoclosePaused) {
			this.close();
			return true;
		}
		return false;
	},

	// Shows the hidden group.
	// Parameters:
	//   options - various options (see below)
	// Possible options:
	//   immediately - true when no animations should be used
	_unhide: function(options) {
		this._cancelFadeAwayUndoButtonTimer();
		this.hidden = false;
		this.removeUndoButton();
		this.setTrenches(this.bounds);

		let finalize = () => {
			UI.setActive(this);
			this._sendToSubscribers("groupShown");
		};

		this.$container.show();
		if(!options || !options.immediately) {
			this.$container.animate({
				"transform": "scale(1)",
				"opacity": 1
			}, {
				duration: 170,
				complete: finalize
			});
		} else {
			this.$container.css({ "transform": "none", opacity: 1 });
			finalize();
		}
	},

	// Function: closeHidden
	// Removes the group item, its children and its container.
	closeHidden: function() {
		this._cancelFadeAwayUndoButtonTimer();

		// When the last non-empty groupItem is closed then create a new group with a blank tab.
		let remainingGroups = false;
		for(let groupItem of GroupItems) {
			if(groupItem != this && groupItem.children.length) {
				remainingGroups = true;
				break;
			}
		}

		let tab = null;
		if(!remainingGroups) {
			let group;
			for(let groupItem of GroupItems) {
				if(groupItem != this && !groupItem.children.length) {
					group = groupItem;
					break;
				}
			}
			if(!group) {
				group = GroupItems.newGroup();
			}
			tab = group.newTab(null, { dontZoomIn: true });
		}

		let closed = this.destroy();

		if(!tab) { return; }

		if(closed) {
			// Let's make the new tab the selected tab.
			UI.goToTab(tab);
		} else {
			// Remove the new tab and group, if this group is no longer closed.
			tab._tabViewTabItem.parent.destroy({ immediately: true });
		}
	},

	// Close all tabs linked to children (tabItems), removes all children and close the groupItem.
	// Parameters:
	//   options - An object with optional settings for this call.
	// Options:
	//   immediately - (bool) if true, no animation will be used
	// Returns true if the groupItem has been closed, or false otherwise.
	// A group could not have been closed due to a tab with an onUnload handler (that waits for user interaction).
	destroy: function(options) {
		// when "TabClose" event is fired, the browser tab is about to close and our item "close" event is fired. And then, the browser tab gets closed.
		// In other words, the group "close" event is fired before all browser tabs in the group are closed.
		// The below code would fire the group "close" event only after all browser tabs in that group are closed.
		for(let child of this.children.concat()) {
			child.removeSubscriber("close", this._onChildClose);

			if(child.close(true)) {
				this.remove(child, { dontArrange: true });
			} else {
				// child.removeSubscriber() must be called before child.close(),
				// therefore we call child.addSubscriber() if the tab is not removed.
				child.addSubscriber("close", this._onChildClose);
			}
		}

		if(this.children.length) {
			if(this.hidden && !this.clickUndoButton()) {
				this._unhide();
			}

			return false;
		} else {
			this.close(options);
			return true;
		}
	},

	// Fades away the undo button
	_fadeAwayUndoButton: function() {
		if(this.undoContainer) {
			// if there is more than one group and other groups are not empty, fade away the undo button.
			let shouldFadeAway = false;

			if(GroupItems.size > 1) {
				for(let groupItem of GroupItems) {
					if(groupItem != this && groupItem.children.length > 0) {
						shouldFadeAway = true;
						break;
					}
				}
			}

			if(shouldFadeAway) {
				iQ(this.undoContainer).animate({
					color: "transparent",
					opacity: 0
				}, {
					duration: this._fadeAwayUndoButtonDuration,
					complete: () => { this.closeHidden(); }
				});
			}
		}
	},

	// Makes the affordance for undo a close group action
	_createUndoButton: function() {
		this.undoContainer = document.createElement('div');
		this.undoContainer.classList.add('undo');
		this.undoContainer.setAttribute('type', 'button');
		document.body.appendChild(this.undoContainer);

		let $undoContainer = iQ(this.undoContainer);

		let span = document.createElement('span');
		span.textContent = Strings.get("TabView", "groupItemUndoCloseGroup");
		this.undoContainer.appendChild(span);

		let undoClose = document.createElement('div');
		undoClose.classList.add('close');
		undoClose.setAttribute('title', Strings.get("TabView", "groupItemDiscardClosedGroup"));
		undoClose.handleEvent = (e) => {
			// click
			e.preventDefault();
			e.stopPropagation();
			this._cancelFadeAwayUndoButtonTimer();
			$undoContainer.fadeOut(() => { this.closeHidden(); });
		};
		undoClose.addEventListener('click', undoClose, true);
		this.undoContainer.appendChild(undoClose);

		$undoContainer.css({
			left: this.bounds.left + this.bounds.width /2 - $undoContainer.width() /2,
			top:  this.bounds.top + this.bounds.height /2 - $undoContainer.height() /2,
			"transform": "scale(.1)",
			opacity: 0
		});
		this.hidden = true;

		// hide group item and show undo container.
		aSync(() => {
			$undoContainer.animate({
				"transform": "scale(1)",
				"opacity": 1
			}, {
				easing: "tabviewBounce",
				duration: 170,
				complete: () => { this._sendToSubscribers("groupHidden"); }
			});
		}, 50);

		// add click handlers
		this.undoContainer.handleEvent = (e) => {
			switch(e.type) {
				case 'click':
					// don't do anything if the close button is clicked.
					if(e.originalTarget == undoClose) { break; }

					this.clickUndoButton();
					break;

				// Cancel the fadeaway if you move the mouse over the undo button, and restart the countdown once you move out of it.
				case 'mouseover':
					this._cancelFadeAwayUndoButtonTimer();
					break;

				case 'mouseout':
					this.setupFadeAwayUndoButtonTimer();
					break;
			}
		};
		this.undoContainer.addEventListener('click', this.undoContainer);
		this.undoContainer.addEventListener('mouseover', this.undoContainer);
		this.undoContainer.addEventListener('mouseout', this.undoContainer);

		this.setupFadeAwayUndoButtonTimer();
	},

	// Sets up fade away undo button timeout.
	setupFadeAwayUndoButtonTimer: function() {
		if(!this.undoButtonFadeTimer) {
			this.undoButtonFadeTimer = aSync(() => {
				this._fadeAwayUndoButton();
			}, this.fadeAwayUndoButtonDelay);
		}
	},

	// Cancels the fade away undo button timeout.
	_cancelFadeAwayUndoButtonTimer: function() {
		if(this.undoButtonFadeTimer) {
			this.undoButtonFadeTimer.cancel();
			this.undoButtonFadeTimer = null;
		}
	},

	removeUndoButton: function() {
		this._cancelFadeAwayUndoButtonTimer();
		// Only remove the container if it's not animating out, it will remove itself when it finishes.
		if(this.undoContainer) {
			this.undoContainer.remove();
			this.undoContainer = null;
		}
	},

	clickUndoButton: function() {
		if(!this.undoContainer) { return false; }

		this._cancelFadeAwayUndoButtonTimer();

		// This makes it so we can begin restoring the group without having to remove the undo button first == better animation.
		// After this animation finished, the undo button will self remove.
		let undoContainer = this.undoContainer;
		this.undoContainer = null;

		iQ(undoContainer).animate({
			opacity: 0,
			"transform": "scale(.1)",
		}, {
			duration: 170,
			complete: () => {
				undoContainer.remove();
			}
		});

		// Begin showing the group even before the undo button is fully removed.
		aSync(() => {
			this._unhide();
		}, 50);

		return true;
	},

	// Adds an item to the groupItem.
	// Parameters:
	//   a - The item to add. Can be an <Item>.
	//   options - An object with optional settings for this call.
	// Options:
	//   index - (int) if set, add this tab at this index
	//   dontArrange - (bool) if true, will not trigger an arrange on the group
	add: function(item, options) {
		try {
			// safeguard to remove the item from its previous group
			if(item.parent && item.parent !== this) {
				item.parent.remove(item);
			}

			if(!options) {
				options = {};
			}

			let wasAlreadyInThisGroupItem = false;
			let oldIndex = this.children.indexOf(item);
			if(oldIndex != -1) {
				this.children.splice(oldIndex, 1);
				wasAlreadyInThisGroupItem = true;
			}

			// Insert the tab into the right position.
			let index = this.children.length;
			if(options.index !== undefined && options.index < index && options.index > -1) {
				index = options.index;
			}
			this.children.splice(index, 0, item);

			if(!wasAlreadyInThisGroupItem) {
				item.groupItemData = {};

				item.addSubscriber("close", this._onChildClose);
				item.setParent(this);

				if(item == UI.getActiveTab() || !this._activeTab) {
					this.setActiveTab(item);
				}

				// if it matches the selected tab or no active tab and the browser tab is hidden, the active group item would be set.
				if(item.tab.selected || (!GroupItems.getActiveGroupItem() && !item.tab.hidden)) {
					UI.setActive(this);
				}
			}

			this._unfreezeItemSize(true);
			if(!options.dontArrange) {
				this.arrange();
			}

			this._sendToSubscribers("childAdded", { item: item });

			UI.setReorderTabsOnHide(this);
		}
		catch(ex) {
			Cu.reportError(ex);
		}
	},

	// Handles "close" events from the group's children.
	// Parameters:
	//   tabItem - The tabItem that is closed.
	_onChildClose: function(tabItem) {
		let dontArrange = tabItem.closedManually && (this.expanded || !this.shouldStack());
		let dontClose = !tabItem.closedManually && Tabs.numPinned;
		this.remove(tabItem, { dontArrange: dontArrange, dontClose: dontClose });

		if(dontArrange) {
			this._freezeItemSize();
		}

		if(this.children.length && this._activeTab && tabItem.closedManually) {
			UI.setActive(this);
		}
	},

	// Removes an item from the groupItem.
	// Parameters:
	//   a - The item to remove. Can be an <Item>, a DOM element or an iQ object. The latter two must refer to the container of an <Item>.
	//   options - An optional object with settings for this call. See below.
	// Possible options:
	//   dontArrange - don't rearrange the remaining items
	//   dontClose - don't close the group even if it normally would
	remove: function(item, options) {
		try {
			if(!options) {
				options = {};
			}

			let index = this.children.indexOf(item);
			let prevIndex = 0;
			if(index != -1) {
				this.children.splice(index, 1);
				prevIndex = Math.max(0, index -1);
			}

			if(item == this._activeTab || !this._activeTab) {
				if(this.children.length) {
					this._activeTab = this.children[prevIndex];
				} else {
					this._activeTab = null;
				}
			}

			item.setParent(null);
			item.removeClass("stacked");
			item.removeClass("stack-trayed");
			item.isStacked = false;
			item.hidden = false;
			item.setRotation(0);
			item.removeSubscriber("close", this._onChildClose);

			// if a blank tab is selected while restoring a tab the blank tab gets removed. we need to keep the group alive for the restored tab.
			if(item.isRemovedAfterRestore) {
				options.dontClose = true;
			}

			let closed = options.dontClose ? false : this.closeIfEmpty();
			if(closed || (!this.children.length && !Tabs.numPinned && !item.isDragging)) {
				this._makeLastActiveGroupItemActive();
			} else if(!options.dontArrange) {
				this._unfreezeItemSize();
			}

			this._sendToSubscribers("childRemoved", { item: item });
		}
		catch(ex) {
			Cu.reportError(ex);
		}
	},

	// Removes all of the groupItem's children. The optional "options" param is passed to each remove call.
	removeAll: function(options) {
		let newOptions = { dontArrange: true };
		if(options) {
			Utils.extend(newOptions, options);
		}

		for(let child of this.children.concat()) {
			this.remove(child, newOptions);
		}
	},

	// Returns true if the groupItem should stack (instead of grid).
	shouldStack: function() {
		let options = {
			getDimensions: true,
			count: this.children.length
		};
		let box = this.getContentBounds();
		let arrObj = TabItems.arrange(this.children, box);

		let shouldStack = arrObj.tabWidth < TabItems.minTabWidth;
		this._columns = shouldStack ? null : arrObj.columns;

		return shouldStack;
	},

	// Freezes current item size (when removing a child).
	_freezeItemSize: function() {
		if(this._itemSizeFrozen) { return; }
		this._itemSizeFrozen = true;

		// unfreeze item size when tabview is hidden
		Listeners.add(window, 'tabviewhidden', this);

		// unfreeze item size when cursor is moved out of group bounds
		// we don't need to observe mouse movement when expanded because the tray is closed when we leave it and collapse causes unfreezing
		if(!this.expanded) {
			Listeners.add(window, 'mousemove', this);
		}
	},

	// Unfreezes and updates item size.
	// Parameters:
	//   dontArrange - do not arrange items when unfreezing
	_unfreezeItemSize: function(dontArrange) {
		if(!this._itemSizeFrozen) { return; }
		this._itemSizeFrozen = false;

		Listeners.remove(window, 'tabviewhidden', this);
		Listeners.remove(window, 'mousemove', this);

		if(!dontArrange) {
			this.arrange();
		}
	},

	_delayArrange: null,
	delayArrange: function(delay) {
		if(this._delayArrange) { return; }

		this._delayArrange = aSync(() => {
			this._delayArrange = null;
			this.arrange();
		}, delay);
	},

	// Lays out all of the children.
	arrange: function() {
		if(this._delayArrange) {
			this._delayArrange.cancel();
			this._delayArrange = null;
		}

		if(this._itemSizeFrozen) { return; }

		if(GroupItems._arrangePaused) {
			GroupItems.pushArrange(this);
			return;
		}

		// Ensure the tab nodes are shown in the right order.
		let tabs = this.tabContainer.childNodes;
		for(let i = 0; i < this.children.length; i++) {
			let tab = this.children[i].container;
			tab.style.order = i;
		}

		let shouldStack = this.shouldStack() && !this.expanded;

		// if we should stack and we're not expanded
		if(shouldStack) {
			this.container.classList.add('stackedGroup');
			// When first opening groups mode, the expanders icons are only 1px high, for clown reasons of course.
			let expanderHeight;
			while(expanderHeight != this.expander.clientHeight) {
				expanderHeight = this.expander.clientHeight;
				this._stackArrange();
			}
		} else {
			this.container.classList.remove('stackedGroup');
			this._gridArrange();
		}
	},

	// Arranges the children in a stack.
	_stackArrange: function() {
		let childrenToArrange = this.children.concat();
		let count = childrenToArrange.length;
		if(!count) { return; }

		let itemAspect = TabItems.tabAspect;
		let scale = 0.7;
		let bb = this.getContentBounds(true);
		let bbAspect = bb.height / bb.width;
		let numInPile = 6;
		let zIndex = numInPile;
		let angleDelta = 3.5; // degrees

		// compute size of the entire stack, modulo rotation.
		let size;
		if(bbAspect > itemAspect) {
			// Tall, thin groupItem
			size = TabItems.calcValidSize(new Point(bb.width * scale, -1));
		} else {
			// Short, wide groupItem
			size = TabItems.calcValidSize(new Point(-1, bb.height * scale));
		}

		// x is the left margin that the stack will have, within the content area (bb)
		// y is the vertical margin
		let position = {
			x: (bb.width - size.x) / 2,
			y: (bb.height - size.y) / 2
		};

		let sscode = '\
			html['+objName+'_UUID="'+_UUID+'"] #group'+this.id+' .tab {\n\
				width: '+size.x+'px;\n\
				height: '+size.y+'px;\n\
				top: '+position.y+'px;\n\
				left: '+position.x+'px;\n\
			}';

		Styles.load('group_'+this.id+'_'+_UUID, sscode, true);

		let children = [];

		// ensure topChild is the first item in childrenToArrange
		let topChild = this.getTopChild();
		let topChildPos = childrenToArrange.indexOf(topChild);
		if(topChildPos > 0) {
			childrenToArrange = childrenToArrange.concat(childrenToArrange.splice(0, topChildPos));
		}

		for(let child of childrenToArrange) {
			// Children are still considered stacked even if they're hidden later.
			child.addClass("stacked");
			child.isStacked = true;
			setAttribute(child.container, 'draggable', 'false');
			if(numInPile-- > 0) {
				children.push(child);
			} else {
				child.hidden = true;
			}
		}

		this.isStacked = true;
		removeAttribute(this.tabContainer, 'columns');

		let angleAccum = 0;
		for(let child of children) {
			if(angleAccum != 0) {
				child.addClass('behind');
			} else {
				child.removeClass('behind');
			}

			child.setZ(zIndex--);
			child.setRotation((UI.rtl ? -1 : 1) * angleAccum);
			child.hidden = false;
			angleAccum += angleDelta;
		}
	},

	// Arranges the children into a grid.
	_gridArrange: function() {
		let cols;
		if(!this.expanded) {
			this.isStacked = false;
			cols = this._columns;
		}

		if(!this.children.length) { return; }

		for(let child of this.children) {
			child.removeClass("stacked");
			child.isStacked = false;
			child.setRotation(0);
			child.hidden = false;
			setAttribute(child.container, 'draggable', 'true');
		}

		let box = this.getContentBounds(true);
		this._lastTabSize = TabItems.arrange(this.children, box, cols);
		let { tabWidth, tabHeight, columns } = this._lastTabSize;
		let fontSize = TabItems.getFontSizeFromWidth(tabWidth);
		let spaceWidth = tabWidth + TabItems.tabItemPadding.x;
		let spaceHeight = tabHeight + TabItems.tabItemPadding.y;

		setAttribute(this.tabContainer, 'columns', columns);

		let sscode = '\
			html['+objName+'_UUID="'+_UUID+'"] #group'+this.id+' .tab,\n\
			html['+objName+'_UUID="'+_UUID+'"] .expandedTray[group="'+this.id+'"] .tab {\n\
				width: '+tabWidth+'px;\n\
				height: '+tabHeight+'px;\n\
				font-size: '+fontSize+'px;\n\
			}\n\
			html['+objName+'_UUID="'+_UUID+'"] #group'+this.id+' .tab-container:not([columns="1"]) .tab.space-before,\n\
			html['+objName+'_UUID="'+_UUID+'"] .expandedTray[group="'+this.id+'"] .tab-container:not([columns="1"]) .tab.space-before {\n\
				-moz-margin-start: '+spaceWidth+'px;\n\
			}\n\
			html['+objName+'_UUID="'+_UUID+'"] #group'+this.id+' .tab-container:not([columns="1"]) .tab.space-after,\n\
			html['+objName+'_UUID="'+_UUID+'"] .expandedTray[group="'+this.id+'"] .tab-container:not([columns="1"]) .tab.space-after {\n\
				-moz-margin-end: '+spaceWidth+'px;\n\
			}\n\
			html['+objName+'_UUID="'+_UUID+'"] #group'+this.id+' .tab-container[columns="1"] .tab.space-before,\n\
			html['+objName+'_UUID="'+_UUID+'"] .expandedTray[group="'+this.id+'"] .tab-container[columns="1"] .tab.space-before {\n\
				margin-top: '+spaceHeight+'px;\n\
			}\n\
			html['+objName+'_UUID="'+_UUID+'"] #group'+this.id+' .tab-container[columns="1"] .tab.space-after,\n\
			html['+objName+'_UUID="'+_UUID+'"] .expandedTray[group="'+this.id+'"] .tab-container[columns="1"] .tab.space-after {\n\
				margin-bottom: '+spaceHeight+'px;\n\
			}';

		Styles.load('group_'+this.id+'_'+_UUID, sscode, true);
	},

	expand: function() {
		UI.setActive(this.getTopChild());

		let startBounds = this.getBounds();
		let tray = document.createElement('div');
		let $tray = iQ(tray).css({
			top: startBounds.top,
			left: startBounds.left,
			width: startBounds.width,
			height: startBounds.height
		});
		document.body.appendChild(tray);

		tray.classList.add("expandedTray");
		tray.setAttribute('group', this.id);
		Listeners.add(tray, 'dragover', this);

		let w = 180;
		let h = w * (TabItems.tabHeight / TabItems.tabWidth) * 1.1;
		let padding = 20;
		let col = Math.ceil(Math.sqrt(this.children.length));
		let row = Math.ceil(this.children.length/col);

		let overlayWidth = Math.min(window.innerWidth - (padding * 2), w*col + padding*(col+1));
		let overlayHeight = Math.min(window.innerHeight - (padding * 2), h*row + padding*(row+1));

		let pos = { left: startBounds.left, top: startBounds.top };
		pos.left -= overlayWidth / 3;
		pos.top  -= overlayHeight / 3;

		if(pos.top < 0) {
			pos.top = 20;
		}
		if(pos.left < 0) {
			pos.left = 20;
		}
		if(pos.top + overlayHeight > window.innerHeight) {
			pos.top = window.innerHeight - overlayHeight - 20;
		}
		if(pos.left + overlayWidth > window.innerWidth) {
			pos.left = window.innerWidth - overlayWidth - 20;
		}

		let shield = document.createElement('div');
		shield.classList.add('shield');
		shield.handleEvent = (e) => {
			this.collapse();
		};
		shield.addEventListener('click', shield);
		document.body.appendChild(shield);

		let bounds = new Rect(pos.left, pos.top, overlayWidth, overlayHeight);
		this.expanded = { tray, $tray, shield, bounds };

		$tray
			.animate({
				width:  overlayWidth,
				height: overlayHeight,
				top: pos.top,
				left: pos.left
			}, {
				duration: 200,
				easing: "tabviewBounce",
				complete: () => {
					if(!this.expanded) { return; }

					// There is a race-condition here. If there is a mouse-move while the shield is coming up it will collapse, which we don't want.
					// Thus, we wait a little bit before adding this event handler.
					shield.addEventListener('mouseover', shield);

					tray.appendChild(this.tabContainer);
					this.arrange();

					this._sendToSubscribers("expanded");
				}
			})
		tray.classList.add("overlay");

		for(let child of this.children) {
			child.addClass("stack-trayed");
		}
	},

	// Collapses the groupItem from the expanded "tray" mode.
	collapse: function() {
		if(!this.expanded) { return }

		let box = this.getBounds();
		let $tray = this.expanded.$tray;
		let tray = this.expanded.tray;
		$tray
			.animate({
				width:  box.width,
				height: box.height,
				top: box.top,
				left: box.left,
				opacity: 0
			}, {
				duration: 350,
				easing: "tabviewBounce",
				complete: () => {
					tray.remove();
					this._sendToSubscribers("collapsed");
				}
			});

		Listeners.remove(this.expanded.tray, 'dragover', this);

		this.expanded.shield.remove();
		this.expanded = null;

		for(let child of this.children) {
			child.removeClass("stack-trayed");
		}

		this.contents.insertBefore(this.tabContainer, this.contents.firstChild);
		this._unfreezeItemSize();
	},

	// Creates a new tab within this groupItem.
	// Parameters:
	//  url - the new tab should open this url as well
	//  options - the options object
	//    dontZoomIn - set to true to not zoom into the newly created tab
	//    closedLastTab - boolean indicates the last tab has just been closed
	newTab: function(url, options) {
		if(options && options.closedLastTab) {
			UI.closedLastTabInTabView = true;
		}

		UI.setActive(this, { dontSetActiveTabInGroup: true });

		let dontZoomIn = !!(options && options.dontZoomIn);
		return gBrowser.loadOneTab(url || gWindow.BROWSER_NEW_TAB_URL, { inBackground: dontZoomIn });
	},

	// Reorders the tabs in a groupItem based on the arrangement of the tabs shown in the tab bar.
	// It does it by sorting the children of the groupItem by the positions of their respective tabs in the tab bar.
	reorderTabItemsBasedOnTabOrder: function() {
		this.children.sort((a,b) => a.tab._tPos - b.tab._tPos);

		this.arrange();
		// this.arrange calls this.save for us
	},

	// Reorders the tabs in the tab bar based on the arrangment of the tabs shown in the groupItem.
	reorderTabsBasedOnTabItemOrder: function() {
		let indices;
		let tabs = this.children.map(tabItem => tabItem.tab);

		tabs.forEach(function(tab, index) {
			if(!indices) {
				indices = tabs.map(tab => tab._tPos);
			}

			let start = index ? indices[index - 1] + 1 : 0;
			let end = index + 1 < indices.length ? indices[index + 1] - 1 : Infinity;
			let targetRange = new Range(start, end);

			if(!targetRange.contains(tab._tPos)) {
				gBrowser.moveTabTo(tab, start);
				indices = null;
			}
		});
	},

	// Gets the <Item> that should be displayed on top when in stack mode.
	getTopChild: function() {
		if(!this.children.length) {
			return null;
		}

		return this.getActiveTab() || this.children[0] || null;
	}
};

// Singleton for managing all <GroupItem>s.
this.GroupItems = {
	groupItems: new Map(),
	nextID: 1,
	_inited: false,
	_activeGroupItem: null,
	_arrangePaused: false,
	_arrangesPending: new Set(),
	_removingHiddenGroups: false,
	_autoclosePaused: false,
	_lastActiveList: null,
	workSpace: document,

	get size() { return this.groupItems.size; },
	[Symbol.iterator]: function* () {
		for(let groupItem of this.groupItems.values()) {
			yield groupItem;
		}
	},

	// Keep in sync with the CSS values
	minGroupHeight: 145,
	minGroupWidth: 120,

	// How far apart Items should be from each other and from bounds
	defaultGutter: 15,
	// set the top gutter separately, as the top of the window has its own extra chrome which makes a large top gutter unnecessary.
	topGutter: 5,

	// Function: init
	init: function() {
		this._lastActiveList = new MRUList();
	},

	// Function: uninit
	uninit: function() {
		for(let group of this) {
			Styles.unload('group_'+group.id+'_'+_UUID);
		}

		// additional clean up
		this.groupItems = new Map();
	},

	// Creates a new empty group.
	newGroup: function() {
		let bounds = new Rect(20, 20, 250, 200);
		return new GroupItem([], { bounds: bounds, immediately: true });
	},

	// Bypass arrange() calls and collect for resolution in	resumeArrange()
	pauseArrange: function() {
		this._arrangePaused = true;
	},

	// Push an arrange() call and its arguments onto a map to be resolved in resumeArrange()
	pushArrange: function(groupItem, options) {
		this._arrangesPending.add(groupItem);
	},

	// Resolve bypassed and collected arrange() calls
	resumeArrange: function() {
		this._arrangePaused = false;
		for(let groupItem of this._arrangesPending) {
			groupItem.arrange();
		}
		this._arrangesPending = new Set();
	},

	// Returns the next unused groupItem ID.
	getNextID: function() {
		let result = this.nextID;
		this.nextID++;
		this._save();
		return result;
	},

	// Saves GroupItems state, as well as the state of all of the groupItems.
	saveAll: function() {
		this._save();
		for(let groupItem of this) {
			groupItem.save();
		}
	},

	// Saves GroupItems state.
	_save: function() {
		// too soon to save now
		if(!this._inited) { return; }

		let activeGroupId = this._activeGroupItem ? this._activeGroupItem.id : null;
		Storage.saveGroupItemsData(gWindow, {
			nextID: this.nextID,
			activeGroupId: activeGroupId,
			totalNumber: this.size
		});
	},

	// Given an array of DOM elements, returns a <Rect> with (roughly) the union of their locations.
	getBoundingBox: function(els) {
		let bounds = els.map(el => el.$container.bounds());
		let left   = Math.min.apply({}, bounds.map(b => b.left));
		let top    = Math.min.apply({}, bounds.map(b => b.top));
		let right  = Math.max.apply({}, bounds.map(b => b.right));
		let bottom = Math.max.apply({}, bounds.map(b => b.bottom));

		return new Rect(left, top, right-left, bottom-top);
	},

	// Restores to stored state, creating groupItems as needed.
	reconstitute: function(groupItemsData, groupItemData) {
		try {
			let activeGroupId;

			if(groupItemsData) {
				if(groupItemsData.nextID) {
					this.nextID = Math.max(this.nextID, groupItemsData.nextID);
				}
				if(groupItemsData.activeGroupId) {
					activeGroupId = groupItemsData.activeGroupId;
				}
			}

			if(groupItemData) {
				let toClose = new Set(this);
				for(let id in groupItemData) {
					let data = groupItemData[id];
					if(this.storageSanityGroupItem(data)) {
						let groupItem = this.groupItem(data.id);
						if(groupItem && !groupItem.hidden) {
							// (TMP) In case this group is re-used by session restore, make sure all of its children still belong to this group.
							// Do it before setBounds trigger data save that will overwrite session restore data.
							// TabView will use TabItems.resumeReconnecting or UI.reset to reconnect the tabItem.
							for(let tabItem of groupItem.children) {
								let tabData = Storage.getTabData(tabItem.tab);
								if(!TabItems.storageSanity(tabData) || tabData.groupID != data.id) {
									tabItem._reconnected = false;
								}
							}

							groupItem.userSize = data.userSize;
							groupItem.setTitle(data.title);
							groupItem.setBounds(data.bounds, true);

							toClose.delete(groupItem);
						} else {
							let options = {
								// we always push when first appending the group, in case new groups (from other add-ons, or imported in prefs)
								// overlap existing groups
								immediately: true
							};
							new GroupItem([], Utils.extend({}, data, options));
						}
					}
				}

				for(let groupItem of toClose) {
					// all tabs still existing in closed groups will be moved to new groups. prepare them to be reconnected later.
					for(let tabItem of groupItem.children) {
						if(tabItem.parent.hidden) {
							tabItem.$container.show();
						}

						tabItem._reconnected = false;

						// sanity check the tab's groupID
						let tabData = Storage.getTabData(tabItem.tab);

						if(TabItems.storageSanity(tabData)) {
							let parentGroup = this.groupItem(tabData.groupID);

							// the tab's group id could be invalid or point to a non-existing group.
							// correct it by assigning the active group id or the first group of the just restored session.
							if(!parentGroup || toClose.has(parentGroup)) {
								tabData.groupID = activeGroupId || Object.keys(groupItemData)[0];
								Storage.saveTab(tabItem.tab, tabData);
							}
						}
					}

					// this closes the group but not its children
					groupItem.close({ immediately: true });
				}
			}

			// set active group item
			if(activeGroupId) {
				let activeGroupItem = this.groupItem(activeGroupId);
				if(activeGroupItem) {
					UI.setActive(activeGroupItem);
				}
			}

			this._inited = true;
			this._save(); // for nextID
		}
		catch(ex) {
			Cu.reportError(ex);
		}
	},

	// Loads the storage data for groups. Returns true if there was global group data.
	load: function() {
		let groupItemsData = Storage.readGroupItemsData(gWindow);
		let groupItemData = Storage.readGroupItemData(gWindow);
		this.reconstitute(groupItemsData, groupItemData);

		return (groupItemsData && !Utils.isEmptyObject(groupItemsData));
	},

	// Given persistent storage data for a groupItem, returns true if it appears to not be damaged.
	storageSanityGroupItem: function(groupItemData) {
		if(!groupItemData.id
		|| (groupItemData.userSize && !Utils.isPoint(groupItemData.userSize))) {
			return false;
		}

		// For compatibility with other add-ons that might modify (read: create) groups, instead of discarting invalid groups we "fix" them.
		if(!groupItemData.bounds || !Utils.isRect(groupItemData.bounds)) {
			let pageBounds = UI.getPageBounds();
			pageBounds.inset(20, 20);

			let box = new Rect(pageBounds);
			box.width = 250;
			box.height = 200;

			groupItemData.bounds = box;
			Storage.saveGroupItem(gWindow, groupItemData);
		}

		return true;
	},

	// Adds the given <GroupItem> to the list of groupItems we're tracking.
	register: function(groupItem) {
		this.groupItems.set(groupItem.id, groupItem);
		UI.updateTabButton();
	},

	// Removes the given <GroupItem> from the list of groupItems we're tracking.
	unregister: function(groupItem) {
		this.groupItems.delete(groupItem.id);

		if(groupItem == this._activeGroupItem) {
			this._activeGroupItem = null;
		}

		this._arrangesPending.delete(groupItem);

		this._lastActiveList.remove(groupItem);
		UI.updateTabButton();
	},

	// Given some sort of identifier, returns the appropriate groupItem. Currently only supports groupItem ids.
	groupItem: function(a) {
		return this.groupItems.get(a) || null;
	},

	// Removes all tabs from all groupItems (which automatically closes all unnamed groupItems).
	removeAll: function() {
		for(let groupItem of this) {
			groupItem.removeAll();
		}
	},

	// Given a <TabItem>, files it in the appropriate groupItem.
	newTab: function(tabItem, options) {
		let activeGroupItem = this.getActiveGroupItem();

		// 1. Active group
		// 2. First visible non-app tab (that's not the tab in question)
		// 3. First group
		// 4. At this point there should be no groups or tabs (except for app tabs and the tab in question): make a new group

		if(activeGroupItem && !activeGroupItem.hidden) {
			activeGroupItem.add(tabItem, options);
			return;
		}

		// find first non-app visible tab belongs a group, and add the new tabItem to that group
		for(let tab of Tabs.visible) {
			if(!tab.pinned && tab != tabItem.tab) {
				if(tab._tabViewTabItem && tab._tabViewTabItem.parent && !tab._tabViewTabItem.parent.hidden) {
					let targetGroupItem = tab._tabViewTabItem.parent;
					targetGroupItem.add(tabItem);
					UI.setActive(targetGroupItem);
					return;
				}
				break;
			}
		}

		// find the first visible group item
		for(let groupItem of this) {
			if(!groupItem.hidden) {
				groupItem.add(tabItem);
				UI.setActive(groupItem);
				return;
			}
		}

		// create new group for the new tabItem
		let newGroupItemBounds = new Rect(20, 20, 250, 200);;
		let newGroupItem = new GroupItem([tabItem], { bounds: newGroupItemBounds });
		newGroupItem.snap();
		UI.setActive(newGroupItem);
	},

	// Returns the active groupItem. Active means its tabs are shown in the tab bar when not in the TabView interface.
	getActiveGroupItem: function() {
		return this._activeGroupItem;
	},

	// Sets the active groupItem, thereby showing only the relevant tabs and setting the groupItem which will receive new tabs.
	// Paramaters:
	//  groupItem - the active <GroupItem>
	setActiveGroupItem: function(groupItem) {
		if(this._activeGroupItem) {
			this._activeGroupItem.container.classList.remove('activeGroupItem');
		}

		groupItem.container.classList.add('activeGroupItem');

		this._lastActiveList.update(groupItem);
		this._activeGroupItem = groupItem;
		this._save();
	},

	// Gets last active group item. Returns the <groupItem>. If nothing is found, return null.
	getLastActiveGroupItem: function() {
		return this._lastActiveList.peek(function(groupItem) {
			return (groupItem && !groupItem.hidden && groupItem.children.length)
		});
	},

	// Hides and shows tabs in the tab bar based on the active groupItem
	_updateTabBar: function() {
		// called too soon
		if(!window[objName] || !window[objName].UI) { return; }

		let tabItems = this._activeGroupItem.children;
		gBrowser.showOnlyTheseTabs(tabItems.map(item => item.tab));
		gTabView.updateAeroPeek();
	},

	// Sets active TabItem and GroupItem, and updates tab bar appropriately.
	// Parameters:
	// tabItem - the tab item
	// options - is passed to UI.setActive() directly
	updateActiveGroupItemAndTabBar: function(tabItem, options) {
		UI.setActive(tabItem, options);
		this._updateTabBar();
	},

	getNextItemTabFromGroups: function(groupItems) {
		for(let groupItem of groupItems) {
			if(groupItem.hidden) { continue; }

			// restore the last active tab in the group
			let activeTab = groupItem.getActiveTab();
			if(activeTab) {
				return activeTab;
			}

			// if no tab is active, use the first one
			let child = groupItem.children[0];
			if(child) {
				return child;
			}

			// if the group has no tabs, open a new one in it
			let newTab = groupItem.newTab();
			if(newTab) {
				return newTab._tabViewTabItem;
			}

			break;
		}

		return null;
	},

	// Paramaters:
	//  reverse - the boolean indicates the direction to look for the next groupItem.
	// Returns the <tabItem>. If nothing is found, return null.
	getNextGroupItemTab: function(reverse) {
		let groupItems = [];
		for(let groupItem of this) {
			groupItems.push(groupItem);
		}

		// When cycling through groups, order them by their titles, otherwise it's far too arbitrary.
		for(let groupItem of groupItems) {
			groupItem.groupTitle = gWindow[objName].TabView.getGroupTitle(groupItem);
		}
		groupItems.sort(function(a, b) {
			if(a.groupTitle < b.groupTitle) { return -1; }
			if(a.groupTitle > b.groupTitle) { return 1; }
			return 0;
		});

		if(reverse) {
			groupItems.reverse();
		}

		let tabItem = null;
		let activeGroupItem = this.getActiveGroupItem();
		if(!activeGroupItem) {
			tabItem = this.getNextItemTabFromGroups(groupItem);
		}
		else {
			let currentIndex = groupItems.indexOf(activeGroupItem);
			let firstGroupItems = groupItems.slice(currentIndex + 1);
			tabItem = this.getNextItemTabFromGroups(firstGroupItems);
			if(!tabItem) {
				let secondGroupItems = groupItems.slice(0, currentIndex);
				tabItem = this.getNextItemTabFromGroups(secondGroupItems);
			}
		}

		return tabItem;
	},

	// Used for the right click menu in the tab strip; moves the given tab into the given group. Does nothing if the tab is an app tab.
	// Paramaters:
	//  tab - the <xul:tab>.
	//  groupItemId - the <groupItem>'s id.  If nothing, create a new <groupItem>.
	moveTabToGroupItem: function(tab, groupItemId) {
		if(tab.pinned) { return; }

		// given tab is already contained in target group
		if(tab._tabViewTabItem.parent && tab._tabViewTabItem.parent.id == groupItemId) { return; }

		let shouldUpdateTabBar = false;
		let shouldShowTabView = false;
		let groupItem;

		// switch to the appropriate tab first.
		if(tab.selected) {
			if(Tabs.visible.length > 1) {
				gBrowser._blurTab(tab);
				shouldUpdateTabBar = true;
			} else {
				shouldShowTabView = true;
			}
		} else {
			shouldUpdateTabBar = true
		}

		// remove tab item from a groupItem
		if(tab._tabViewTabItem.parent) {
			tab._tabViewTabItem.parent.remove(tab._tabViewTabItem);
		}

		// add tab item to a groupItem
		if(groupItemId) {
			groupItem = this.groupItem(groupItemId);
			groupItem.add(tab._tabViewTabItem);
			groupItem.reorderTabsBasedOnTabItemOrder()
		} else {
			let pageBounds = UI.getPageBounds();
			pageBounds.inset(20, 20);

			let box = new Rect(pageBounds);
			box.width = 250;
			box.height = 200;

			new GroupItem([ tab._tabViewTabItem ], { bounds: box, immediately: true });
		}

		if(shouldUpdateTabBar) {
			this._updateTabBar();
		} else if(shouldShowTabView) {
			UI.showTabView();
		}
	},

	// Removes all hidden groups' data and its browser tabs.
	removeHiddenGroups: function() {
		if(this._removingHiddenGroups) { return; }
		this._removingHiddenGroups = true;

		for(let groupItem of this) {
			if(groupItem.hidden) {
				groupItem.closeHidden();
			}
		}

		this._removingHiddenGroups = false;
	},

	// Basic measure rules. Assures that item is a minimum size.
	calcValidSize: function(size) {
		return new Point(Math.max(size.x, this.minGroupWidth), Math.max(size.y, this.minGroupHeight));
	},

	// Returns the bounds within which it is safe to place all non-stationary <Item>s.
	getSafeWindowBounds: function() {
		// the safe bounds that would keep it "in the window"
		let gutter = this.defaultGutter;
		let topGutter = this.topGutter;
		return new Rect(gutter, topGutter, window.innerWidth - 2 * gutter, window.innerHeight - gutter - topGutter);
	},

	// Checks to see which items can now be unsquished.
	// Parameters:
	//   pairs - an array of objects, each with two properties: item and bounds. The bounds are modified as appropriate, but the items are not changed.
	//     If pairs is null, the operation is performed directly on all of the top level items.
	//   ignore - an <Item> to not include in calculations (because it's about to be closed, for instance)
	unsquish: function(pairs, ignore) {
		let pairsProvided = (pairs ? true : false);
		if(!pairsProvided) {
			pairs = [];
			for(let item of GroupItems) {
				pairs.push({
					item: item,
					bounds: item.getBounds()
				});
			}
		}

		let pageBounds = this.getSafeWindowBounds();
		for(let pair of pairs) {
			let item = pair.item;
			if(item == ignore) { continue; }

			let bounds = pair.bounds;
			let newBounds = new Rect(bounds);

			let newSize;
			if(Utils.isPoint(item.userSize)) {
				newSize = new Point(item.userSize);
			} else {
				newSize = GroupItems.calcValidSize(new Point(GroupItems.minGroupWidth, -1));
			}

			newBounds.width = Math.max(newBounds.width, newSize.x);
			newBounds.height = Math.max(newBounds.height, newSize.y);

			newBounds.left -= (newBounds.width - bounds.width) / 2;
			newBounds.top -= (newBounds.height - bounds.height) / 2;

			let offset = new Point();
			if(newBounds.left < pageBounds.left) {
				offset.x = pageBounds.left - newBounds.left;
			} else if(newBounds.right > pageBounds.right) {
				offset.x = pageBounds.right - newBounds.right;
			}

			if(newBounds.top < pageBounds.top) {
				offset.y = pageBounds.top - newBounds.top;
			} else if(newBounds.bottom > pageBounds.bottom) {
				offset.y = pageBounds.bottom - newBounds.bottom;
			}

			newBounds.offset(offset);

			if(!bounds.equals(newBounds)) {
				let blocked = false;
				for(let pair2 of pairs) {
					if(pair2 == pair || pair2.item == ignore) { continue; }

					let bounds2 = pair2.bounds;
					if(bounds2.intersects(newBounds)) {
						blocked = true;
					}
				}

				if(!blocked) {
					pair.bounds.copy(newBounds);
				}
			}
		}

		if(!pairsProvided) {
			for(let pair of pairs) {
				pair.item.setBounds(pair.bounds);
			}
		}
	},

	// Temporarily disable the behavior that closes groups when they become empty.
	// This is used when entering private browsing, to avoid trashing the user's groups while private browsing is shuffling things around.
	pauseAutoclose: function() {
		this._autoclosePaused = true;
	},

	// Re-enables the auto-close behavior.
	resumeAutoclose: function() {
		this._autoclosePaused = false;
	}
};

this.PinnedItems = {
	get tray() { return $('pinnedTabs'); },

	icons: new Map(),
	_delayedUpdates: new Set(),

	handleEvent: function(e) {
		let tab = e.target;

		switch(e.type) {
			case "TabOpen":
				if(tab.pinned) {
					this.add(tab);
				}
				break;

			case "TabClose":
				// make sure any closed tabs are removed from the delay update list
				this._delayedUpdates.delete(tab);

				if(tab.pinned) {
					this.remove(tab);
				}
				break;

			case "TabMove":
				if(tab.pinned) {
					this.arrange(tab);
				}
				break;

			case 'TabPinned':
				this.add(tab);
				break;

			case 'TabUnpinned':
				this.remove(tab);
				break;

			// watch for icon changes on app tabs
			case 'TabAttrModified':
				if(!UI.isTabViewVisible()) {
					this._delayedUpdates.add(tab);
				} else {
					this._updateIcons(tab);
				}
				break;
		}
	},

	init: function() {
		Tabs.listen("TabOpen", this);
		Tabs.listen("TabClose", this);
		Tabs.listen("TabMove", this);
		Tabs.listen("TabPinned", this);
		Tabs.listen("TabUnpinned", this);
		Tabs.listen("TabAttrModified", this);

		for(let tab of Tabs.pinned) {
			this.add(tab);
		}
	},

	uninit: function() {
		Tabs.unlisten("TabOpen", this);
		Tabs.unlisten("TabClose", this);
		Tabs.unlisten("TabMove", this);
		Tabs.unlisten("TabPinned", this);
		Tabs.unlisten("TabUnpinned", this);
		Tabs.unlisten("TabAttrModified", this);

		for(let icon of this.icons.values()) {
			icon.remove();
		}
		this.icons.clear();
		this.tray.hidden = true;
	},

	// Show the pinned tabs group only when there are pinned tabs.
	updateTray: function() {
		this.tray.hidden = !this.icons.size;
	},

	// Update apptab icons based on xulTabs which have been updated while the TabView hasn't been visible
	flushUpdates: function() {
		for(let tab of this._delayedUpdates) {
			this._updateIcons(tab);
		}
		this._delayedUpdates.clear();
	},

	// Update images of any apptab icons that point to passed in xultab
	_updateIcons: function(tab) {
		if(!tab.pinned) { return; }

		this.getFavIconUrl(tab, (iconUrl) => {
			let icon = this.icons.get(tab);
			if(icon && icon.getAttribute("src") != iconUrl) {
				icon.setAttribute("src", iconUrl);
			}
		});
	},

	// Gets the fav icon url for app tab.
	getFavIconUrl: function(tab, callback) {
		FavIcons.getFavIconUrlForTab(tab, function(iconUrl) {
			callback(iconUrl || FavIcons.defaultFavicon);
		});
	},

	// Adds the given xul:tab as an app tab in the apptab tray
	add: function(tab) {
		// This shouldn't happen, just making sure.
		if(this.icons.has(tab)) { return; }

		this.getFavIconUrl(tab, (iconUrl) => {
			// The tab might have been removed or unpinned while waiting.
			if(!Utils.isValidXULTab(tab) || !tab.pinned) { return; }

			let icon = document.createElement("input");
			icon.classList.add("appTabIcon");
			icon.setAttribute('type', 'button');
			icon.style.backgroundImage = "url('"+iconUrl+"')";
			icon.handleEvent = function(e) {
				// "click" event only
				// left-clicks only
				if(e.button != 0) { return; }

				UI.goToTab(tab);
			};
			icon.addEventListener("click", icon);

			this.icons.set(tab, icon);
			this.tray.appendChild(icon);
			this.updateTray();
		});
	},

	// Removes the given xul:tab as an app tab in the apptab tray
	remove: function(tab) {
		let icon = this.icons.get(tab);
		if(icon) {
			icon.remove();
			this.icons.delete(tab);
			this.updateTray();
		}
	},

	// Arranges the given xul:tab as an app tab in the group's apptab tray
	arrange: function(tab) {
		let icon = this.icons.get(tab);
		if(icon) {
			// so that the indexes match
			icon.remove();

			let sibling = this.tray.childNodes[tab._tPos] || null;
			this.tray.insertBefore(icon, sibling);
		}
	}
};
