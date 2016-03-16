// VERSION 2.0.3

// This will be the GroupDrag object created when a group is dragged or resized.
this.DraggingGroup = null;

// Called to create a Drag in response to a <GroupItem> draggable "start" event.
// Parameters:
//   item - The <Item> being dragged
//   event - The DOM event that kicks off the drag
//   resizing - whether the groupitem is being resized rather than repositioned
//   callback - a method that will be called when the drag operation ends
this.GroupDrag = function(item, e, resizing, callback) {
	DraggingGroup = this;
	this.item = item;
	this.el = item.container;
	this.callback = callback;
	this.started = false;

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

	start: function() {
		if(!this.check()) { return; }

		if(!this.item.isResizing) {
			// show a dragging cursor while the item is being dragged
			this.el.classList.add('dragging');

			if(!this.item.isAFauxItem) {
				UI.setActive(this.item);
				this.item._unfreezeItemSize(true);
			}

			this.started = true;
		}
		else {
			this.el.classList.add('resizing');
		}

		this.item.isDragging = true;

		this.safeWindowBounds = GroupItems.getSafeWindowBounds();

		Trenches.activateOthersTrenches(this.el);
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
					let bounds = this.item.getBounds();
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
						this.item.setSize(null, { force: true, immediate: true });
					}, 50);
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
		}
	},

	// Adjusts the given bounds according to the currently active trenches. Used by <Drag.snap>
	// Parameters:
	//   bounds             - (<Rect>) bounds
	//   stationaryCorner   - which corner is stationary? by default, the top left in LTR mode, and top right in RTL mode.
	//                        "topleft", "bottomleft", "topright", "bottomright"
	//   assumeConstantSize - (boolean) whether the bounds' dimensions are sacred or not.
	snapBounds: function(bounds, stationaryCorner = RTL ? 'topright' : 'topleft', assumeConstantSize) {
		let update = false; // need to update
		let updateX = false;
		let updateY = false;
		let newRect;
		let snappedTrenches = new Map();

		// OH SNAP!

		// if we aren't holding down the meta key or have trenches disabled...
		if(!Keys.meta && !Trenches.disabled) {
			newRect = Trenches.snap(bounds, stationaryCorner, assumeConstantSize);
			// might be false if no changes were made
			if(newRect) {
				update = true;
				snappedTrenches = newRect.snappedTrenches || new Map();
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
				this.item.container.style.opacity = '1';
			} else {
				this.item.container.style.opacity = '0.7';
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
			this.item.setSize(null, { immediate: true });
			this.snap();

			// Remembers the current size as one the user has chosen.
			this.item.userSize = new Point(this.item.bounds.width, this.item.bounds.height);
			this.item.save();

			this.item.pushAway();
		}

		Trenches.hideGuides();
		this.item.isDragging = false;
		this.item.isResizing = false;
		this.el.classList.remove('dragging');
		this.el.classList.remove('resizing');

		this.item.pushAway(immediately);

		Trenches.disactivate();

		this.end();
	},

	end: function() {
		DraggingGroup = null;
		if(this.callback) {
			this.callback();
		}
	}
};

// This will be the TabDrag object created when a tab is dragged.
this.DraggingTab = null;

this.TabDrag = function(e, tabItem) {
	DraggingTab = this;
	this.item = tabItem;
	this.dropTarget = tabItem.parent;
	e.dataTransfer.setData("text/plain", "tabview-tab");

	let target;
	if(this.dropTarget.expanded) {
		target = this.dropTarget.expanded.tray;
		Listeners.add(this.dropTarget.expanded.shield, 'dragenter', this);
	} else {
		target = this.getDropTargetNode();
	}
	Listeners.add(target, 'drop', this);
	Listeners.add(this.item.container, 'dragend', this);

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

		this.delayedStart = null;
		this.item.hidden = true;

		let sibling = this.item.parent.children[this.item.parent.children.indexOf(this.item) +1];
		if(sibling) {
			this.dropHere(sibling);

			// force a flush before animating the transitions, so that it seems like this first space appears immediately
			sibling.container.clientTop;
		}

		document.body.classList.add('DraggingTab');
	},

	getDropTargetNode: function() {
		if(this.dropTarget.isAGroupItem) {
			return this.dropTarget.container;
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

		if(this.dropTarget != dropTarget) {
			// If the drop target changed, we absolutely need to reset the sibling as well.
			if(this.sibling && this.sibling.parent != dropTarget) {
				this.dropHere(null);
			}

			if(this.dropTarget) {
				let target = this.getDropTargetNode();
				target.classList.remove('dragOver');
				Listeners.remove(target, 'drop', this);
			}

			this.dropTarget = dropTarget;
			if(this.dropTarget) {
				let target = this.getDropTargetNode();
				target.classList.add('dragOver');
				Listeners.add(target, 'drop', this);
			}
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

			i = sibling.parent.children.indexOf(sibling);
			ii = sibling.parent.children.indexOf(this.item);
			if(this.sibling) {
				si = sibling.parent.children.indexOf(this.sibling);
			}
		}

		// If the currently spaced item is set in the same group before the just hovered item,
		// the space should be set on the item immediately after.
		if(si > -1 && si < i) {
			i++;
			siblingToBe = sibling.parent.children[i];
		}

		// Hovering the last item of a row should set the space an item next to it instead,
		// as margins of items in flexboxes are still rendered next to the items as usual.
		let columns = siblingToBe ? sibling.parent._lastTabSize.columns : 0;
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

	drop: function(e) {
		// No-op, shouldn't happen though.
		if(!this.dropTarget) { return; }

		// If we have a valid drop target (group), add the item to it.
		if(this.dropTarget.isAGroupItem) {
			let options = {};
			let ii = this.dropTarget.children.indexOf(this.item);
			if(this.sibling) {
				options.index = this.dropTarget.children.indexOf(this.sibling);
				if(this.sibling.container.classList.contains('space-after')) {
					options.index++;
				}
				// Don't count the item currently being dragged, it will be removed from the array so this index won't match.
				let ii = this.dropTarget.children.indexOf(this.item);
				if(ii > -1 && ii < options.index) {
					options.index--;
				}
			}
			// If dropping onto the same stacked group it came form, keep the same index.
			else if(this.dropTarget.isStacked && ii > -1) {
				options.index = ii;
			}
			this.dropTarget.add(this.item, options);
		}
		// Otherwise create a new group in the place where the tab was dropped.
		else {
			let tabSize = TabItems;
			if(this.item.parent && this.item.parent._lastTabSize) {
				tabSize = this.item.parent._lastTabSize;
			}

			let { tabWidth, tabHeight } = tabSize;
			tabWidth += TabItems.tabItemPadding.x +10;
			tabHeight += TabItems.tabItemPadding.y +50;

			let bounds = new Rect(e.offsetX - (tabWidth /2), e.offsetY - (tabHeight /2), tabWidth, tabHeight);
			new GroupItem([ this.item ], { bounds, focusTitle: true });
		}
	},

	end: function() {
		if(this.dropTarget) {
			let target = this.getDropTargetNode();
			target.classList.remove('dragOver');
			Listeners.remove(target, 'drop', this);
			if(this.dropTarget.expanded) {
				Listeners.remove(this.dropTarget.expanded.shield, 'dragenter', this);
				Listeners.remove(this.dropTarget.expanded.tray, 'drop', this);
			}
		}

		if(this.sibling) {
			this.sibling.container.classList.remove('space-before');
			this.sibling.container.classList.remove('space-after');
		}

		Listeners.remove(this.item.container, 'dragend', this);
		this.item.hidden = false;
		document.body.classList.remove('DraggingTab');

		DraggingTab = null;
	}
};
