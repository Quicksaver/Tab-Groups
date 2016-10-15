/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.3.3

// Class: Point - A simple point.
// If a is a Point, creates a copy of it. Otherwise, expects a to be x, and creates a Point with it along with y.
// If either a or y are omitted, 0 is used in their place.
this.Point = function(a, y) {
	if(Utils.isPoint(a)) {
		this.x = a.x;
		this.y = a.y;
	} else {
		this.x = (Utils.isNumber(a) ? a : 0);
		this.y = (Utils.isNumber(y) ? y : 0);
	}
};

this.Point.prototype = {
	// Returns the distance from this point to the given <Point>.
	distance: function(point) {
		let ax = this.x - point.x;
		let ay = this.y - point.y;
		return Math.sqrt((ax * ax) + (ay * ay));
	}
};

// Class: Rect - A simple rectangle. Note that in addition to the left and width, it also has a right property; changing one affects the others appropriately.
// Same for the vertical properties.
// If a is a Rect, creates a copy of it. Otherwise, expects a to be left, and creates a Rect with it along with top, width, and height.
this.Rect = function(a, top, width, height) {
	// Note: perhaps 'a' should really be called 'rectOrLeft'
	if(Utils.isRect(a)) {
		this.left = a.left;
		this.top = a.top;
		this.width = a.width;
		this.height = a.height;
	} else {
		this.left = a;
		this.top = top;
		this.width = width;
		this.height = height;
	}
};

this.Rect.prototype = {
	get right() {
		return this.left + this.width;
	},
	set right(value) {
		this.width = value - this.left;
	},

	get bottom() {
		return this.top + this.height;
	},
	set bottom(value) {
		this.height = value - this.top;
	},

	// Gives you a new <Range> for the horizontal dimension.
	get xRange() {
		return new Range(this.left, this.right);
	},

	// Gives you a new <Range> for the vertical dimension.
	get yRange() {
		return new Range(this.top, this.bottom);
	},

	// Returns true if this rectangle intersects the given <Rect>.
	intersects: function(rect) {
		return (rect.right > this.left && rect.left < this.right && rect.bottom > this.top && rect.top < this.bottom);
	},

	// Returns a new <Rect> with the intersection of this rectangle and the give <Rect>, or null if they don't intersect.
	intersection: function(rect) {
		let box = new Rect(Math.max(rect.left, this.left), Math.max(rect.top, this.top), 0, 0);
		box.right = Math.min(rect.right, this.right);
		box.bottom = Math.min(rect.bottom, this.bottom);
		if(box.width > 0 && box.height > 0) {
			return box;
		}

		return null;
	},

	// Returns a boolean denoting if the <Rect> or <Point> is contained inside this rectangle.
	// Parameters:
	//  - A <Rect> or a <Point>
	contains: function(a) {
		if(Utils.isPoint(a)) {
			return (a.x > this.left && a.x < this.right && a.y > this.top && a.y < this.bottom);
		}

		return (a.left >= this.left && a.right <= this.right && a.top >= this.top && a.bottom <= this.bottom);
	},

	// Returns a new <Point> with the center location of this rectangle.
	center: function() {
		return new Point(this.left + (this.width / 2), this.top + (this.height / 2));
	},

	// Returns a new <Point> with the dimensions of this rectangle.
	size: function() {
		return new Point(this.width, this.height);
	},

	// Returns a new <Point> with the top left of this rectangle.
	position: function() {
		return new Point(this.left, this.top);
	},

	// Returns the area of this rectangle.
	area: function() {
		return this.width * this.height;
	},

	// Makes the rect smaller (if the arguments are positive) as if a margin is added all around the initial rect,
	// with the margin widths (symmetric) being specified by the arguments.
	// Paramaters
	//  - A <Point> or two arguments: x and y
	inset: function(a, b) {
		if(Utils.isPoint(a)) {
			b = a.y;
			a = a.x;
		}

		this.left += a;
		this.width -= a *2;
		this.top += b;
		this.height -= b *2;
	},

	// Moves (translates) the rect by the given vector.
	// Paramaters
	//  - A <Point> or two arguments: x and y
	offset: function(a, b) {
		if(Utils.isPoint(a)) {
			this.left += a.x;
			this.top += a.y;
		} else {
			this.left += a;
			this.top += b;
		}
	},

	// Returns true if this rectangle is identical to the given <Rect>.
	equals: function(rect) {
		return (rect.left == this.left && rect.top == this.top && rect.width == this.width && rect.height == this.height);
	},

	// Returns a new <Rect> with the union of this rectangle and the given <Rect>.
	union: function(a) {
		let newLeft = Math.min(a.left, this.left);
		let newTop = Math.min(a.top, this.top);
		let newWidth = Math.max(a.right, this.right) - newLeft;
		let newHeight = Math.max(a.bottom, this.bottom) - newTop;
		let newRect = new Rect(newLeft, newTop, newWidth, newHeight);

		return newRect;
	},

	// Copies the values of the given <Rect> into this rectangle.
	copy: function(a) {
		this.left = a.left;
		this.top = a.top;
		this.width = a.width;
		this.height = a.height;
	}
};

// Class: Range - A physical interval, with a min and max.
// Creates a Range with the given min and max
this.Range = function(min, max) {
	// if the one variable given is a range, copy it.
	if(Utils.isRange(min) && !max) {
		this.min = min.min;
		this.max = min.max;
	} else {
		this.min = min || 0;
		this.max = max || 0;
	}
};

this.Range.prototype = {
	// Equivalent to max-min
	get extent() {
		return (this.max - this.min);
	},

	set extent(extent) {
		this.max = extent - this.min;
	},

	// Whether the <Range> contains the given <Range> or value or not.
	// Parameters
	//  - a number or <Range>
	contains: function(value) {
		if(Utils.isNumber(value)) {
			return value >= this.min && value <= this.max;
		}
		if(Utils.isRange(value)) {
			return value.min >= this.min && value.max <= this.max;
		}
		return false;
	},

	// Whether the <Range> overlaps with the given <Range> value or not.
	// Parameters
	//  - a number or <Range>
	overlaps: function(value) {
		if(Utils.isNumber(value)) {
			return this.contains(value);
		}
		if(Utils.isRange(value)) {
			return !(value.max < this.min || this.max < value.min);
		}
		return false;
	},

	// Maps the given value to the range [0,1], so that it returns 0 if the value is <= the min,
	// returns 1 if the value >= the max, and returns an interpolated "proportion" in (min, max).
	// Parameters
	//  - a number
	//  - (bool) smooth? If true, a smooth tanh-based function will be used instead of the linear.
	proportion: function(value, smooth) {
		if(value <= this.min) {
			return 0;
		}
		if(this.max <= value) {
			return 1;
		}

		let proportion = (value - this.min) / this.extent;

		if(smooth) {
			return .5 -( .5 * this.tanh(2 -(4 *proportion) ) );
		}

		return proportion;
	},

	// The ease function ".5+.5*Math.tanh(4*x-2)" is a pretty little graph. It goes from near 0 at x=0 to near 1 at x=1 smoothly and beautifully.
	// http://www.wolframalpha.com/input/?i=.5+%2B+.5+*+tanh%28%284+*+x%29+-+2%29
	tanh: function(x) {
		let e = Math.exp(x);
		return (e - 1/e) / (e + 1/e);
	},

	// Takes the given value in [0,1] and maps it to the associated value on the Range.
	// Parameters
	//  - a number in [0,1]
	scale: function(value) {
		if(value > 1) {
			value = 1;
		}
		if(value < 0) {
			value = 0;
		}
		return this.min + (this.extent *value);
	}
};

// Subscribable - A mix-in for allowing objects to collect subscribers for custom events.
this.Subscribable = function(obj) {
	obj.subscribers = new Map();

	// The given callback will be called when the Subscribable fires the given event.
	obj.addSubscriber = function(eventName, callback) {
		if(!this.subscribers.has(eventName)) {
			this.subscribers.set(eventName, new Set());
		}

		let subscribers = this.subscribers.get(eventName);
		subscribers.add(callback);
	};

	// Removes the subscriber associated with the event for the given callback.
	obj.removeSubscriber = function(eventName, callback) {
		if(!this.subscribers.has(eventName)) { return; }

		let subscribers = this.subscribers.get(eventName);
		subscribers.delete(callback);
		if(!subscribers.size) {
			this.subscribers.delete(eventName);
		}
	};

	// Internal routine. Used by the Subscribable to fire events.
	obj._sendToSubscribers = function(eventName, eventInfo) {
		if(!this.subscribers.has(eventName)) { return; }

		let subscribers = this.subscribers.get(eventName);
		for(let callback of subscribers) {
			try {
				if(typeof(callback) == 'object') {
					callback.handleSubscription(eventName, eventInfo);
				} else {
					callback(eventInfo);
				}
			}
			catch(ex) { Cu.reportError(ex); }
		}
	};
};

// Class: Utils - Singelton with common utility functions.
this.Utils = {
	// A xulTab is valid if it has not been closed, and it has not been removed from the DOM.
	// Returns true if the tab is valid.
	isValidXULTab: function(xulTab) {
		return !xulTab.closing && xulTab.parentNode;
	},

	// Returns true if the argument is a valid number.
	isNumber: function(n) {
		return typeof n == 'number' && !Number.isNaN(n);
	},

	// Returns true if the given object (r) looks like a <Rect>.
	isRect: function(r) {
		return (r && this.isNumber(r.left) && this.isNumber(r.top) && this.isNumber(r.width) && this.isNumber(r.height));
	},

	// Returns true if the given object (r) looks like a <Range>.
	isRange: function(r) {
		return (r && this.isNumber(r.min) && this.isNumber(r.max));
	},

	// Returns true if the given object (p) looks like a <Point>.
	isPoint: function(p) {
		return (p && this.isNumber(p.x) && this.isNumber(p.y));
	},

	// Returns true if the given object has no members.
	isEmptyObject: function(obj) {
		for(let name in obj) {
			return false;
		}
		return true;
	},

	// Merge two array-like objects into the first and return it.
	merge: function(first, second) {
		Array.forEach(second, el => Array.push(first, el));
		return first;
	},

	sortReadable: function(a, b) {
		let ax = [];
		let bx = [];

		a.replace(/(\d+)|(\D+)/g, function(_, $1, $2) { ax.push([$1 || Infinity, $2 || ""]) });
		b.replace(/(\d+)|(\D+)/g, function(_, $1, $2) { bx.push([$1 || Infinity, $2 || ""]) });

		while(ax.length && bx.length) {
			let an = ax.shift();
			let bn = bx.shift();
			let nn = (an[0] - bn[0]) || an[1].localeCompare(bn[1]);
			if(nn) {
				return nn;
			}
		}

		return ax.length - bx.length;
	}
};

// Class: MRUList - A most recently used list.
// If a is an array of entries, creates a copy of it.
this.MRUList = function(a) {
	this._list = [];
	if(Array.isArray(a)) {
		this._list.concat(a);
	}
};

this.MRUList.prototype = {
	// Updates/inserts the given entry as the most recently used one in the list.
	update: function(entry) {
		this.remove(entry);
		this._list.unshift(entry);
	},

	// Inserts a new item at the end of the list if its not in it already.
	append: function(entry, force) {
		let index = this._list.indexOf(entry);
		if(force && index > -1) {
			this._list.splice(index, 1);
			index = -1;
		}
		if(index == -1) {
			this._list.push(entry);
		}
	},

	// Removes the given entry from the list.
	remove: function(entry) {
		let index = this._list.indexOf(entry);
		if(index > -1) {
			this._list.splice(index, 1);
		}
	},

	// Returns the most recently used entry. If a filter exists, gets the most recently used entry which matches the filter.
	peek: function(filter) {
		if(filter && typeof filter == "function") {
			for(let entry of this._list) {
				if(filter(entry)) {
					return entry;
				}
			}
			return null;
		}
		return !this.isEmpty() ? this._list[0] : null;
	},

	isEmpty: function() {
		return !this._list.length;
	},

	clear: function() {
		this._list = [];
	}
};

// Class: PriorityQueue - Container that returns items in a priority order
// Current implementation assigns an item to either a high priority or low priority queue, and toggles which queue items are popped from.
// This guarantees that high priority items which are constantly being added will not eclipse changes for lower priority items.
// Instanciation requires a method that will be called when pushing items to the queue;
// if this method returns true, the item is added to the high priority queue, otherwise it is added to the low priority queue.
this.PriorityQueue = function(isHighPriority) {
	this._isHighPriority = isHighPriority;

	this._low = []; // low priority queue
	this._high = []; // high priority queue
};

this.PriorityQueue.prototype = {
	// Empty the update queue
	clear: function() {
		this._low = [];
		this._high = [];
	},

	// Return whether pending items exist
	hasItems: function() {
		return (this._low.length > 0) || (this._high.length > 0);
	},

	// Returns all queued items, ordered from low to high priority
	getItems: function() {
		return this._high.concat(this._low);
	},

	// Add an item to be prioritized
	push: function(item) {
		// Push onto correct priority queue.
		// If it already exists in the destination queue, leave it.
		// If it exists in a different queue, remove it first and push onto new queue.
		let highPriority = this._isHighPriority(item);
		if(highPriority) {
			let i = this._low.indexOf(item);
			if(i != -1) {
				this._low.splice(i, 1);
			}
			if(this._high.indexOf(item) == -1) {
				this._high.push(item);
			}
		}
		else {
			let i = this._high.indexOf(item);
			if(i != -1) {
				this._high.splice(i, 1);
			}
			if(this._low.indexOf(item) == -1) {
				this._low.push(item);
			}
		}
	},

	// Remove and return the next item in priority order
	pop: function() {
		if(this._high.length) {
			return this._high.shift();
		}
		if(this._low.length) {
			return this._low.shift();
		}
		return null;
	},

	// Return the next item in priority order, without removing it
	peek: function() {
		if(this._high.length) {
			return this._high[0];
		}
		if(this._low.length) {
			return this._low[0];
		}
		return null;
	},

	// Remove the passed item
	remove: function(item) {
		let i = this._high.indexOf(item);
		if(i != -1) {
			this._high.splice(i, 1);
		} else {
			i = this._low.indexOf(item);
			if(i != -1) {
				this._low.splice(i, 1);
			}
		}
	}
};
