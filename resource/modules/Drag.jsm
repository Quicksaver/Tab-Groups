/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 2.5.6

// This will be the GroupDrag object created when a group is dragged or resized.
this.DraggingGroup = null;

// Called to create a Drag in response to a <GroupItem> draggable "start" event.
// Parameters:
//   item - The <Item> being dragged
//   e - The DOM event that kicks off the drag
//   resizing - whether the groupitem is being resized rather than repositioned
//   callback - a method that will be called when the drag operation ends
this.GroupDrag = function(item, e, resizing, callback) {
	DraggingGroup = this;
	this.item = item;
	this.container = item.container;
	this.callback = callback;
	this.started = false;

	// If we're in grid mode, this is an HTML5 drag.
	if(UI.grid) {
		e.dataTransfer.setData("text/plain", "tabview-group");

		this.item.isDragging = true;
		this.start();
		return;
	}

	Listeners.add(gWindow, 'mousemove', this);
	Listeners.add(gWindow, 'mouseup', this);

	this.startBounds = this.item.getBounds();
	if(e) {
		this.startMouse = new Point(e.clientX, e.clientY);
		if(!resizing) {
			e.preventDefault();
			if(this.item.isAFauxItem) {
				this.item.setBounds(new Rect(this.startMouse.y, this.startMouse.x, 0, 0));
			}
		}
	}

	if(resizing) {
		this.item.isResizing = true;
		this.start();
	}
};

this.GroupDrag.prototype = {
	minDragDistance: 3,
	_stoppedMoving: null,

	check: function() {
		return DraggingGroup == this;
	},

	start: function(isAuto) {
		if(!this.check()) { return; }

		// If we're in grid mode, this is an HTML5 drag.
		if(UI.grid) {
			this.dropTarget = this.item;
			this.container.classList.add('dragging');

			Listeners.add(this.container, 'drop', this);
			Listeners.add(this.container, 'dragend', this);

			document.body.classList.add('DraggingGroup');
			return;
		}

		if(!this.item.isResizing) {
			// show a dragging cursor while the item is being dragged
			this.container.classList.add('dragging');

			if(!this.item.isAFauxItem) {
				if(!isAuto) {
					UI.setActive(this.item);
				}
				this.item._unfreezeItemSize(true);
			}

			this.started = true;
		}
		else {
			this.container.classList.add('resizing');
		}

		this.item.isDragging = true;

		this.safeWindowBounds = GroupItems.getSafeWindowBounds();

		Trenches.activateOthersTrenches(this.container);
	},

	handleEvent: function(e) {
		if(!this.check()) { return; }

		switch(e.type) {
			case 'mousemove':
				// global drag tracking
				UI.lastMoveTime = Date.now();

				let mouse = new Point(e.clientX, e.clientY);

				if(this.item.isResizing) {
					// Forcing a reflush to get the real dimensions on each mousemove lags a lot.
					// So simply update the item's .bounds property for now with the calc'ed dimensions.
					let x = this.startBounds.width + (mouse.x - this.startMouse.x);
					let y = this.startBounds.height + (mouse.y - this.startMouse.y);
					let validSize = GroupItems.calcValidSize({ x, y });
					let bounds = this.item.getBounds({ real: true });
					bounds.width = validSize.x;
					bounds.height = validSize.y;
					this.item.setSize(bounds);
					this.snapGetBounds();

					// If we stop dragging for a bit, reaarange the items immediately,
					// makes it seem snappier without sacrificing responsiveness.
					if(this._stoppedMoving) {
						this._stoppedMoving.cancel();
					}
					this._stoppedMoving = aSync(() => {
						this.item.setSize(bounds, true);
					}, 100);
					break;
				}

				// positioning
				if(!this.started && this.startMouse) {
					if(Math.abs(mouse.x - this.startMouse.x) > this.minDragDistance
					|| Math.abs(mouse.y - this.startMouse.y) > this.minDragDistance) {
						this.start();
					}
				}

				this.drag(e);

				e.preventDefault();
				break;

			case 'mouseup':
				this.stop();
				break;

			case 'drop':
				this.drop(e);
				// no break; end the drag now

			// If this fires, it means no valid drop occurred, so just end the drag as if nothing happened in the first place.
			case 'dragend':
				this.end();
				break;
		}
	},

	// Adjusts the given bounds according to the currently active trenches. Used by <Drag.snap>
	// Parameters:
	//   bounds             - (<Rect>) bounds
	//   stationaryCorner   - which corner is stationary? by default, the top left in LTR mode, and top right in RTL mode.
	//                        "topleft", "bottomleft", "topright", "bottomright"
	//   assumeConstantSize - (boolean) whether the bounds' dimensions are sacred or not.
	snapBounds: function(bounds, stationaryCorner, assumeConstantSize) {
		if(!stationaryCorner) {
			stationaryCorner = RTL ? 'topright' : 'topleft';
		}
		let update = false; // need to update
		let newRect;
		let snappedTrenches = new Map();

		// OH SNAP!

		// if we aren't holding down the meta key or have trenches disabled...
		if(!Keys.meta && !Trenches.disabled) {
			newRect = Trenches.snap(bounds, stationaryCorner, assumeConstantSize);
			// might be false if no changes were made
			if(newRect) {
				update = true;
				if(newRect.snappedTrenches) {
					snappedTrenches = newRect.snappedTrenches;
				}
				bounds = newRect;
			}
		}

		// make sure the bounds are in the window.
		newRect = this.snapToEdge(bounds, stationaryCorner, assumeConstantSize);
		if(newRect) {
			update = true;
			bounds = newRect;
			for(let [ edge, trench ] of newRect.snappedTrenches) {
				snappedTrenches.set(edge, trench);
			}
		}

		Trenches.hideGuides();
		for(let trench of snappedTrenches.values()) {
			if(typeof(trench) == 'object') {
				trench.showGuide = true;
				trench.show();
			}
		}

		return update ? bounds : false;
	},

	// Called when a drag or mousemove occurs. Set the bounds based on the mouse move first, then call snap and it will adjust the item's bounds if appropriate.
	// Parameters:
	//   stationaryCorner   - which corner is stationary? by default, the top left in LTR mode, and top right in RTL mode.
	//                        "topleft", "bottomleft", "topright", "bottomright"
	//   assumeConstantSize - (boolean) whether the bounds' dimensions are sacred or not.
	snap: function(stationaryCorner, assumeConstantSize) {
		if(!this.check()) { return; }

		let bounds = this.snapGetBounds(stationaryCorner, assumeConstantSize);
		if(bounds) {
			this.item.setBounds(bounds, true);
			return true;
		}
		return false;
	},

	// Select the trenches to snap the item to and returns a bounds object of the target dimensions.
	// Also triggers the display of trenches that it snapped to.
	// Parameters: same as above for snap.
	snapGetBounds: function(stationaryCorner, assumeConstantSize) {
		let bounds = this.item.getBounds();
		return this.snapBounds(bounds, stationaryCorner, assumeConstantSize);
	},

	// Returns a version of the bounds snapped to the edge if it is close enough. If not, returns false.
	// If <Keys.meta> is true, this function will simply enforce the window edges.
	// Parameters:
	//   rect - (<Rect>) current bounds of the object
	//   stationaryCorner   - which corner is stationary? by default, the top left in LTR mode, and top right in RTL mode.
	//                        "topleft", "bottomleft", "topright", "bottomright"
	//   assumeConstantSize - (boolean) whether the rect's dimensions are sacred or not
	snapToEdge: function(rect, stationaryCorner, assumeConstantSize) {
		let swb = this.safeWindowBounds;
		let update = false;
		let updateX = false;
		let updateY = false;
		let snappedTrenches = new Map();

		let snapRadius = (Keys.meta ? 0 : Trenches.defaultRadius);
		if(rect.left < swb.left + snapRadius ) {
			if(stationaryCorner.indexOf('right') > -1 && !assumeConstantSize) {
				rect.width = rect.right - swb.left;
			}
			rect.left = swb.left;
			update = true;
			updateX = true;
			snappedTrenches.set('left', 'edge');
		}

		if(rect.right > swb.right - snapRadius) {
			if(updateX || !assumeConstantSize) {
				let newWidth = swb.right - rect.left;
				rect.width = newWidth;
				update = true;
			}
			else if(!updateX || !Trenches.preferLeft) {
				rect.left = swb.right - rect.width;
				update = true;
			}
			snappedTrenches.set('right', 'edge');
			snappedTrenches.delete('left');
		}
		if(rect.top < swb.top + snapRadius) {
			if(stationaryCorner.indexOf('bottom') > -1 && !assumeConstantSize) {
				rect.height = rect.bottom - swb.top;
			}
			rect.top = swb.top;
			update = true;
			updateY = true;
			snappedTrenches.set('top', 'edge');
		}
		if(rect.bottom > swb.bottom - snapRadius) {
			if(updateY || !assumeConstantSize) {
				let newHeight = swb.bottom - rect.top;
				rect.height = newHeight;
				update = true;
			}
			else if(!updateY || !Trenches.preferTop) {
				rect.top = swb.bottom - rect.height;
				update = true;
			}
			snappedTrenches.set('top', 'edge');
			snappedTrenches.delete('bottom');
		}

		if(update) {
			rect.snappedTrenches = snappedTrenches;
			return rect;
		}
		return false;
	},

	getStationaryCorner: function(coords, box) {
		let stationaryCorner = "";
		if(coords.y == box.top) {
			stationaryCorner += "top";
		} else {
			stationaryCorner += "bottom";
		}
		if(coords.x == box.left) {
			stationaryCorner += "left";
		} else {
			stationaryCorner += "right";
		}
		return stationaryCorner;
	},

	// Called in response to an <Item> draggable "drag" event.
	drag: function(e) {
		if(!this.started) { return; }

		let stationaryCorner = "";

		// Faux-items can be resized beyond their boundaries.
		if(this.item.isAFauxItem) {
			let box = new Rect();
			box.left = Math.min(this.startMouse.x, e.clientX);
			box.right = Math.max(this.startMouse.x, e.clientX);
			box.top = Math.min(this.startMouse.y, e.clientY);
			box.bottom = Math.max(this.startMouse.y, e.clientY);
			this.item.setBounds(box);

			if(box.width > GroupItems.minGroupWidth && box.height > GroupItems.minGroupHeight) {
				this.container.classList.add("activeGroupItem");
			} else {
				this.container.classList.remove("activeGroupItem");
			}
		}
		else {
			let mouse = new Point(e.clientX, e.clientY);
			let box = this.item.getBounds();
			box.left = this.startBounds.left + (mouse.x - this.startMouse.x);
			box.top = this.startBounds.top + (mouse.y - this.startMouse.y);
			this.item.setBounds(box, true);
		}

		this.snapGetBounds(stationaryCorner, true);
	},

	// Called in response to an <Item> draggable "stop" event.
	// Parameters:
	//  immediately - bool for doing the pushAway immediately, without animation
	stop: function(immediately) {
		if(!this.check()) { return; }

		Listeners.remove(gWindow, 'mousemove', this);
		Listeners.remove(gWindow, 'mouseup', this);

		// We only snap the groups to a trench when it's finished dragging.
		if(!this.item.isResizing) {
			if(!this.started) {
				this.end();
				return;
			}

			if(this.item.isAFauxItem) {
				let box = this.item.getBounds();
				let stationaryCorner = this.getStationaryCorner(this.startMouse, box);
				this.snap(stationaryCorner);
			} else {
				this.snap(null, true);
			}
		} else {
			if(this._stoppedMoving) {
				this._stoppedMoving.cancel();
				this._stoppedMoving = null;
			}
			this.item.setSize(null, true);
			this.snap();

			// Remembers the current size as one the user has chosen.
			this.item.userSize = new Point(this.item.bounds.width, this.item.bounds.height);
			this.item.save();

			this.item.pushAway();
		}

		Trenches.hideGuides();
		this.item.isDragging = false;
		this.item.isResizing = false;
		this.container.classList.remove('dragging');
		this.container.classList.remove('resizing');

		this.item.pushAway(immediately);

		Trenches.disactivate();

		this.end();
	},

	canDrop: function(e, dropTarget) {
		e.preventDefault();

		// global drag tracking
		UI.lastMoveTime = Date.now();

		if(this.dropTarget != dropTarget) {
			this.dropTarget.container.classList.remove('dragOver');
			Listeners.remove(this.dropTarget.container, 'drop', this);

			this.dropTarget = dropTarget;
			this.dropTarget.container.classList.add('dragOver');
			Listeners.add(this.dropTarget.container, 'drop', this);
		}
	},

	drop: function(e) {
		if(!this.check()) { return; }

		// No-op, shouldn't happen though.
		if(!this.dropTarget) { return; }

		// Don't need to do anything.
		if(this.dropTarget == this.item) {
			this.end();
			return;
		}

		// Move the dragged group to the slot and shift everything in between
		// There's no need to recalc the grid dimensions, they should
		// stay the same, only the groups that change row change size

		let groups = GroupItems.sortBySlot();
		let itemBounds = this.item._gridBounds;
		let itemRow = this.item.row;
		let carry = null;

		// Start at the end of the groups and work your way up
		let direction = -1;
		let i = groups.length - 1;

		// Unless you're dragging upwards, then work your way down
		if(this.item.slot > this.dropTarget.slot) {
			direction = 1;
			i = 0;
		}

		while(i < groups.length && i >= 0) {
			let nextElement = groups[i];

			// If the element is the drop target, start the carry
			if(nextElement === this.dropTarget) {
				carry = this.item;
			}

			// If we're carrying a group, swap the group with the next one
			if(carry !== null) {
				let elem = nextElement;
				nextElement = carry;
				carry = elem;

				// Store the bounds and row in case we need to change the next element
				let lastBounds = carry._gridBounds;
				let lastRow = carry.row;

				// If the carry is the item we're dragging, end the carry and
				// set the bounds the item originally had
				if(carry === this.item) {
					carry = null;
					lastBounds = itemBounds;
					lastRow = itemRow;
				}

				// Rearrange if this element changed row
				if(lastRow != nextElement.row) {
					nextElement._gridBounds = lastBounds;
					nextElement.row = lastRow;
					nextElement.arrange();
				}
			}

			// Set the slot and save
			nextElement.slot = i + 1;
			nextElement.save();
			i += direction;
		}

		this.end();
	},

	end: function() {
		// Is this an HTML5 drag? We have some extra things to end in this case.
		if(UI.grid) {
			this.dropTarget.container.classList.remove('dragOver');
			this.container.classList.remove('dragging');
			Listeners.remove(this.dropTarget.container, 'drop', this);
			Listeners.remove(this.container, 'dragend', this);
			document.body.classList.remove('DraggingGroup');
			this.item.isDragging = false;
		}

		DraggingGroup = null;
		if(this.callback) {
			this.callback();
		}
	}
};

// This will be the GroupSelectorDrag object created when a group selector is dragged.
this.DraggingGroupSelector = null;

this.GroupSelectorDrag = function(e, item) {
	DraggingGroupSelector = this;
	this.item = item;
	this.sorted = GroupItems.sortBySlot();
	this.i = this.sorted.indexOf(this.item.groupItem);
	this.started = false;

	// In single mode we're just dragging the group selector item, not the actual group.
	e.dataTransfer.setData("text/plain", "tabview-group-selector");

	this.item.groupItem.isDragging = true;
	Listeners.add(this.item, 'dragend', this);

	// Hide async so that the translucent image that follows the cursor actually shows something.
	this.delayedStart = aSync(() => { this.finishDragStart(); });
};

this.GroupSelectorDrag.prototype = {
	delayedStart: null,

	check: function() {
		return DraggingGroupSelector == this;
	},

	handleEvent: function(e) {
		if(!this.check()) { return; }

		switch(e.type) {
			case 'drop':
				this.drop(e);
				// no break; end the drag now

			// If this fires, it means no valid drop occurred, so just end the drag as if nothing happened in the first place.
			case 'dragend':
				this.end();
				break;
		}
	},

	finishDragStart: function() {
		if(!this.check()) { return; }

		// In single mode we're just dragging the group selector item, not the actual group.
		if(this.delayedStart) {
			this.delayedStart.cancel();
			this.delayedStart = null;
		}
		this.item.hidden = true;

		Listeners.add(UI.groupSelector, 'drop', this);

		let si = this.i +1;
		if(si < this.sorted.length) {
			this.dropHere(this.sorted[si].selector);
		}

		// force a flush before animating the transitions, so that it seems like this first space appears immediately
		if(this.dropTarget) {
			this.dropTarget.clientTop;
		}

		document.body.classList.add('DraggingGroupSelector');
	},

	canDrop: function(e) {
		e.preventDefault();

		if(this.delayedStart) {
			this.delayedStart.cancel();
			this.finishDragStart();
		}

		// global drag tracking
		UI.lastMoveTime = Date.now();
	},

	dropHere: function(dropTarget) {
		// This shouldn't happen, but still better make sure.
		if(dropTarget == this.item) { return; }

		// If we're hovering over a group that's already shifted, it can only shift to the other side.
		if(dropTarget && this.dropTarget == dropTarget) {
			if(dropTarget.classList.contains('space-before')) {
				dropTarget.classList.remove('space-before');
				dropTarget.classList.add('space-after');
			} else {
				dropTarget.classList.add('space-before');
				dropTarget.classList.remove('space-after');
			}
			return;
		}

		if(this.dropTarget != dropTarget) {
			let si = -1;
			if(this.dropTarget) {
				this.dropTarget.classList.remove('space-before');
				this.dropTarget.classList.remove('space-after');
				si = this.sorted.indexOf(this.dropTarget.groupItem);
			}

			// When dragging over another selector, we need to make sure the behavior is predictable
			if(dropTarget) {
				let ti = this.sorted.indexOf(dropTarget.groupItem);
				if(si > -1 && si < ti) {
					ti++;
					if(ti == this.i) {
						ti++;
					}
					if(ti < this.sorted.length) {
						dropTarget = this.sorted[ti].selector;
					} else {
						dropTarget = null;
					}
				}
			}

			this.dropTarget = dropTarget;
			if(dropTarget) {
				dropTarget.classList.add('space-before');
			}
		}
	},

	drop: function() {
		let slot;
		let dropTarget = this.dropTarget;
		if(dropTarget) {
			if(dropTarget.classList.contains('space-after')) {
				let ti = this.sorted.indexOf(dropTarget.groupItem) +1;
				if(ti == this.i) {
					ti++;
				}
				if(ti < this.sorted.length) {
					dropTarget = this.sorted[ti].selector;
				} else {
					dropTarget = null;
				}
			}

			// We could not have a dropTarget anymore if we're moving to the last slot.
			if(dropTarget) {
				slot = dropTarget.groupItem.slot;

				// make sure the relative order of the groups remains unchanged, we don't want doubled slots
				for(let group of GroupItems) {
					if(group != this.item.groupItem && group.slot >= slot) {
						group.slot++;
						group.save();
					}
				}
			}
		}

		// default moving to the last slot on every valid drop.
		if(!slot) {
			slot = GroupItems.nextSlot();
		}

		this.item.groupItem.slot = slot;
		this.item.groupItem.save();
	},

	end: function() {
		if(this.dropTarget) {
			this.dropTarget.classList.remove('space-before');
			this.dropTarget.classList.remove('space-after');
		}

		this.item.hidden = false;
		this.item.groupItem.isDragging = false;
		Listeners.remove(this.item, 'dragend', this);
		Listeners.remove(UI.groupSelector, 'drop', this);
		document.body.classList.remove('DraggingGroupSelector');

		DraggingGroupSelector = null;
	}
};

// This will be the TabDrag object created when a tab is dragged.
this.DraggingTab = null;

this.TabDrag = function(e, tabItem) {
	DraggingTab = this;
	this.item = tabItem;
	this.container = tabItem.container;
	e.dataTransfer.setData("text/plain", "tabview-tab");

	this.updateTarget(tabItem.parent);
	if(this.dropTarget.expanded) {
		Listeners.add(this.dropTarget.expanded.shield, 'dragenter', this);
	}
	Listeners.add(this.container, 'dragend', this);

	// Hide async so that the translucent image that follows the cursor actually shows something.
	this.delayedStart = aSync(() => { this.finishDragStart(); });
};

this.TabDrag.prototype = {
	sibling: null,
	delayedStart: null,

	check: function() {
		return DraggingTab == this;
	},

	handleEvent: function(e) {
		if(!this.check()) { return; }

		switch(e.type) {
			case 'drop':
				this.drop(e);
				// no break; end the drag now

			// If this fires, it means no valid drop occurred, so just end the drag as if nothing happened in the first place.
			case 'dragend':
				this.end();
				break;

			// Leaving a group's expanded tray.
			case 'dragenter':
				// Something went wrong...
				if(!this.dropTarget.expanded) { break; }

				Listeners.remove(this.dropTarget.expanded.tray, 'drop', this);
				Listeners.remove(this.dropTarget.expanded.shield, 'dragenter', this);
				Listeners.add(this.dropTarget.container, 'drop', this);
				this.dropTarget.collapse();

				// collapsing the tray will have unhidden the dragged item
				this.item.hidden = true;
				break;
		}
	},

	finishDragStart: function() {
		if(!this.check()) { return; }

		if(this.delayedStart) {
			this.delayedStart.cancel();
			this.delayedStart = null;
		}
		this.item.hidden = true;

		let sibling;
		if(this.item.isATabItem) {
			sibling = !this.item.isStacked && this.item.parent.children[this.item.parent.children.indexOf(this.item) +1];
		} else if(this.item.isAnAppItem) {
			sibling = this.item.nextSibling;
		}
		if(sibling) {
			this.dropHere(sibling);

			// force a flush before animating the transitions, so that it seems like this first space appears immediately
			sibling.container.clientTop;
		}

		document.body.classList.add('DraggingTab');
	},

	getDropTargetNode: function() {
		if(!this.dropTarget) { return null; }

		if(this.dropTarget.isAGroupItem) {
			if(this.dropTarget.expanded) {
				return this.dropTarget.expanded.tray;
			}
			return this.dropTarget.container;
		}
		if(this.dropTarget._appTabsContainer) {
			return this.dropTarget.parentNode;
		}
		return this.dropTarget;
	},

	canDrop: function(e, dropTarget) {
		e.preventDefault();

		if(this.delayedStart) {
			this.delayedStart.cancel();
			this.finishDragStart();
		}

		// global drag tracking
		UI.lastMoveTime = Date.now();

		this.updateTarget(dropTarget);
	},

	updateTarget: function(dropTarget) {
		if(this.dropTarget != dropTarget) {
			// If the drop target changed, we absolutely need to reset the sibling as well.
			if(this.sibling && this.sibling.parent != dropTarget) {
				this.dropHere(null);
			}

			this.updateDropTargetNode(false);
			this.dropTarget = dropTarget;
			this.updateDropTargetNode(true);
		}
	},

	updateDropTargetNode: function(dragOver) {
		let node = this.getDropTargetNode();
		if(node) {
			let method = (dragOver) ? 'add' : 'remove';
			node.classList[method]('dragOver');
			Listeners[method](node, 'drop', this);
		}
	},

	dropHere: function(sibling) {
		// This shouldn't happen, but still better make sure.
		if(sibling == this.item) { return; }

		let siblingToBe = sibling;
		let i = -1;
		let ii = -1;
		let si = -1;
		let dir = 'before';

		if(sibling) {
			// When hovering the previously hovered item, all it can do is shift to the other side.
			if(this.sibling == sibling && sibling.container.classList.contains('space-before')) {
				sibling.container.classList.remove('space-before');
				sibling.container.classList.add('space-after');
				return;
			}

			if(!sibling.isAnAppItem) {
				i = sibling.parent.children.indexOf(sibling);
				ii = sibling.parent.children.indexOf(this.item);
				if(this.sibling) {
					si = sibling.parent.children.indexOf(this.sibling);

					// If the currently spaced item is set in the same group before the just hovered item,
					// the space should be set on the item immediately after.
					if(si > -1 && si < i) {
						i++;
						siblingToBe = sibling.parent.children[i];
					}
				}
			}
			else if(this.sibling && this.sibling.isAnAppItem) {
				let next = this.sibling.nextSibling;
				while(next) {
					if(next == siblingToBe) {
						siblingToBe = siblingToBe.nextSibling;
						break;
					}
					next = next.nextSibling;
				}
			}
		}

		// Hovering the last item of a row should set the space an item next to it instead,
		// as margins of items in flexboxes are still rendered next to the items as usual.
		let columns = (siblingToBe && !siblingToBe.isAnAppItem && sibling.parent._lastTabSize) ? sibling.parent._lastTabSize.columns : 0;
		if(columns > 1) {
			// Don't forget arrays are 0-based
			let c = i +1;

			// Don't count the item currently being dragged, it's invisible.
			if(ii > -1 && ii < i) {
				c--;
			}

			// Is this item the last one in the row?
			if(c % columns == 0) {
				let p = i -1;
				let n = i +1;

				if(ii > -1) {
					if(ii == p) {
						p--;
					} else if(ii == n) {
						n++;
					}
				}

				if(si > -1 && si < p) {
					siblingToBe = sibling.parent.children[n] || null;
				} else {
					siblingToBe = sibling.parent.children[p];
					dir = 'after';
				}
			}
		}

		// Make sure spaces around any previously hovered item are reset.
		if(this.sibling) {
			this.sibling.container.classList.remove('space-before');
			this.sibling.container.classList.remove('space-after');
		}

		this.sibling = siblingToBe;
		if(this.sibling) {
			this.sibling.container.classList.add('space-'+dir);
		}
	},

	pinItem: function() {
		let tab = this.item.tab;
		if(!tab.pinned) {
			Listeners.remove(this.container, 'dragend', this);
			gBrowser.pinTab(tab);
			this.item = PinnedItems.get(tab);
			this.container = this.item.container;
			Listeners.add(this.container, 'dragend', this);
		}
	},

	unpinItem: function() {
		let tab = this.item.tab;
		if(tab.pinned) {
			Listeners.remove(this.container, 'dragend', this);
			gBrowser.unpinTab(tab);
			this.item = tab._tabViewTabItem;
			this.container = this.item.container;
			Listeners.add(this.container, 'dragend', this);
		}
	},

	drop: function(e) {
		let dropTarget = this.dropTarget;

		// No-op, shouldn't happen though.
		if(!dropTarget) { return; }

		// When dropping onto a group selector, the tab should be added to the corresponding group.
		if(dropTarget.isASelectorItem) {
			dropTarget = dropTarget.groupItem;

			// If dropping in the same group as it comes from, no-op.
			if(dropTarget == this.item.parent) { return; }

			// When dragging a pinned tab into a group, we need to unpin it first, so that we have a tab item that we can drag.
			this.unpinItem();

			// See the note below on dropping onto a stacked group case.
			dropTarget._activeTab = null;
			dropTarget.add(this.item, { dontArrange: true, dontSetActive: true });
			dropTarget.reorderTabItemsBasedOnTabOrder(true);
		}
		// If we have a valid drop target (group), add the item to it.
		else if(dropTarget.isAGroupItem) {
			// When dragging a pinned tab into a group, we need to unpin it first, so that we have a tab item that we can drag.
			this.unpinItem();

			let options = {};
			let ii = dropTarget.children.indexOf(this.item);
			if(this.sibling) {
				options.index = dropTarget.children.indexOf(this.sibling);
				if(this.sibling.container.classList.contains('space-after')) {
					options.index++;
				}
				// Don't count the item currently being dragged, it will be removed from the array so this index won't match.
				let ii = dropTarget.children.indexOf(this.item);
				if(ii > -1 && ii < options.index) {
					options.index--;
				}
			}
			else if(dropTarget.isStacked) {
				// If dropping onto the same stacked group it came from, keep the same index.
				if(ii > -1) {
					options.index = ii;
				}
				// otherwise make it the active (top) tab on the stack, even though it'll be the last tab in the group.
				else {
					// nulling the group's active tab, will make the dragged tab the active one in .add(),
					// which also rearranges the group when that happens, so there's no need to call that twice.
					dropTarget._activeTab = null;
					options.dontArrange = true;
				}
			}
			dropTarget.add(this.item, options);
		}
		// If the drop target is the pinned tabs area, we should make sure the tab is pinned. Things are a little easier than as above though.
		else if(dropTarget == PinnedItems.tray) {
			// Pin the tab first, so that our handlers can first remove the original tab item, and then register it as an app tab.
			this.pinItem();

			let sibling = this.sibling;
			if(sibling && sibling.classList.contains('space-after')) {
				sibling = sibling.nextSibling;
				if(sibling && sibling == this.item) {
					sibling = sibling.nextSibling;
				}
			}

			PinnedItems.add(this.item.tab, sibling);
			PinnedItems.reorderTabsBasedOnAppItemOrder();
		}
		// Otherwise create a new group in the place where the tab was dropped.
		else {
			// We wouldn't be creating a new group for pinned tabs of course.
			this.unpinItem();

			let tabWidth = 10;
			let tabHeight = 50;
			if(this.item.parent && this.item.parent._lastTabSize) {
				tabWidth += this.item.parent._lastTabSize.tabWidth + (this.item.parent._lastTabSize.tabPadding *2);
				tabHeight += this.item.parent._lastTabSize.tabHeight + (this.item.parent._lastTabSize.tabPadding *2);
			} else {
				tabWidth += TabItems.tabWidth;
				tabHeight += TabItems.tabHeight;
			}

			let options = {
				focusTitle: true
			};
			if(UI.classic) {
				options.bounds = new Rect(e.offsetX - (tabWidth /2), e.offsetY - (tabHeight /2), tabWidth, tabHeight);
			}

			new GroupItem([ this.item ], options);
		}
	},

	end: function() {
		this.updateDropTargetNode(false);
		if(this.dropTarget && this.dropTarget.expanded) {
			Listeners.remove(this.dropTarget.expanded.shield, 'dragenter', this);
			Listeners.remove(this.dropTarget.expanded.tray, 'drop', this);
		}

		if(this.sibling) {
			this.sibling.container.classList.remove('space-before');
			this.sibling.container.classList.remove('space-after');
		}

		Listeners.remove(this.container, 'dragend', this);
		this.item.hidden = this.item.isStacked && !this.item._inVisibleStack;
		document.body.classList.remove('DraggingTab');

		DraggingTab = null;
	}
};

// This will be the HighlighterDrag object created when a group is dragged or resized.
this.DraggingHighlighter = null;

// Called to create a Drag in response to dragging the search box when in highlight mode.
// Parameters:
//   e - The DOM event that kicks off the drag
this.HighlighterDrag = function(e, callback) {
	DraggingHighlighter = this;
	this.item = Search.searchbox;
	this.$item = iQ(this.item);
	this.callback = callback;
	this.started = false;

	Listeners.add(gWindow, 'mousemove', this);
	Listeners.add(gWindow, 'mouseup', this);

	this.startBounds = this.$item.bounds();
	this.startMouse = new Point(e.clientX, e.clientY);
};

this.HighlighterDrag.prototype = {
	minDragDistance: 3,
	_stoppedMoving: null,

	check: function() {
		return DraggingHighlighter == this;
	},

	start: function(isAuto) {
		if(!this.check()) { return; }

		this.started = true;
	},

	handleEvent: function(e) {
		if(!this.check()) { return; }

		switch(e.type) {
			case 'mousemove':
				let mouse = new Point(e.clientX, e.clientY);

				// positioning
				if(!this.started) {
					if(Math.abs(mouse.x - this.startMouse.x) > this.minDragDistance
					|| Math.abs(mouse.y - this.startMouse.y) > this.minDragDistance) {
						this.start();
					}
				}

				this.drag(e);

				e.preventDefault();
				break;

			case 'mouseup':
				this.stop();
				break;
		}
	},

	drag: function(e) {
		if(!this.check() || !this.started) { return; }

		let mouse = new Point(e.clientX, e.clientY);
		let css = {
			left: this.startBounds.left + (mouse.x - this.startMouse.x),
			top: this.startBounds.top + (mouse.y - this.startMouse.y)
		};
		this.$item.css(css);
	},

	stop: function(immediately) {
		if(!this.check()) { return; }

		Listeners.remove(gWindow, 'mousemove', this);
		Listeners.remove(gWindow, 'mouseup', this);

		if(this.callback) {
			this.callback();
		}

		DraggingHighlighter = null;
	}
};
