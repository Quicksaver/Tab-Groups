/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.2.2

// Returns an iQClass object which represents an individual element. selector can only be a DOM node.
// I'm keeping this only because I don't feel like rewritting all the bounds/animation/fadein/out code.
this.iQ = function(selector) {
	// The iQ object is actually just the init constructor 'enhanced'
	return new iQClass(selector);
};

// The actual class of iQ result objects, representing an individual element.
// You don't call this directly; this is what's called by iQ().
this.iQClass = function(selector) {
	this.context = selector;
	return this;
};

this.iQClass.prototype = {
	// Returns the width of the receiver, including padding and border.
	width: function() {
		return Math.floor(this.context.offsetWidth);
	},

	// Returns the height of the receiver, including padding and border.
	height: function() {
		return Math.floor(this.context.offsetHeight);
	},

	// Returns an object with the receiver's position in left and top properties.
	position: function() {
		let bounds = this.bounds();
		return new Point(bounds.left, bounds.top);
	},

	// Returns a <Rect> with the receiver's bounds.
	bounds: function() {
		let rect = this.context.getBoundingClientRect();
		return new Rect(Math.floor(rect.left), Math.floor(rect.top), Math.floor(rect.width), Math.floor(rect.height));
	},

	// Sets or gets CSS properties on the receiver. When setting certain numerical properties,
	// will automatically add "px". A property can be removed by setting it to null.
	// Possible call patterns:
	//   a: object, b: undefined - sets with properties from a
	//   a: string, b: undefined - gets property specified by a
	//   a: string, b: string/number - sets property specified by a to b
	css: function(a, b) {
		let properties = null;

		if(typeof(a) === 'string') {
			let key = a;
			if(b === undefined) {
				return getComputedStyle(this.context).getPropertyValue(key);
			}
			properties = {};
			properties[key] = b;
		}
		else if(a instanceof Rect) {
			properties = {
				left: a.left,
				top: a.top,
				width: a.width,
				height: a.height
			};
		}
		else if(a instanceof Point) {
			properties = {
				left: a.x,
				top: a.y
			}
		}
		else {
			properties = a;
		}

		let pixels = {
			'left': true,
			'top': true,
			'right': true,
			'bottom': true,
			'width': true,
			'height': true
		};

		for(let key in properties) {
			let value = properties[key];

			if(value == null) {
				this.context.style.removeProperty(key);
			} else {
				if(pixels[key] && typeof value != 'string') {
					value += 'px';
				}
				if(key.indexOf('-') != -1) {
					this.context.style.setProperty(key, value, '');
				} else {
					this.context.style[key] = value;
				}
			}
		}

		return this;
	},

	// Uses CSS transitions to animate the element.
	// Parameters:
	//   css - an object map of the CSS properties to change
	//   options - an object with various properites (see below)
	// Possible "options" properties:
	//   duration - how long to animate, in milliseconds
	//   easing - easing function to use. Possibilities include
	//     "tabviewBounce", "easeInQuad". Default is "ease".
	//   complete - function to call once the animation is done, takes nothing
	//     in, but "this" is set to the element that was animated.
	animate: function(css, options = {}) {
		let easings = {
			tabviewBounce: "cubic-bezier(0.0, 0.63, .6, 1.29)",
			easeInQuad: 'ease-in', // TODO: make it a real easeInQuad, or decide we don't care
			fast: 'cubic-bezier(0.7,0,1,1)'
		};

		let duration = (options.duration || 400);
		let easing = (easings[options.easing] || 'ease');

		if(css instanceof Rect) {
			css = {
				left: css.left,
				top: css.top,
				width: css.width,
				height: css.height
			};
		}


		// The latest versions of Firefox do not animate from a non-explicitly set css properties.
		// So for each element to be animated, go through and explicitly define 'em.
		let rupper = /([A-Z])/g;
		let cStyle = getComputedStyle(this.context);
		for(let prop in css) {
			prop = prop.replace(rupper, "-$1").toLowerCase();
			this.css(prop, cStyle.getPropertyValue(prop));
		}

		this.css({
			'transition-property': Object.keys(css).join(", "),
			'transition-duration': (duration / 1000) + 's',
			'transition-timing-function': easing
		});

		this.css(css);

		aSync(() => {
			this.css({
				'transition-property': 'none',
				'transition-duration': '',
				'transition-timing-function': ''
			});

			if(typeof(options.complete) == "function") {
				options.complete();
			}
		}, duration);

		return this;
	},

	// Animates the receiver to full transparency. Calls callback on completion.
	fadeOut: function(callback) {
		this.animate({
			opacity: 0
		}, {
			duration: 400,
			complete: () => {
				this.css({ display: 'none' });
				if(typeof(callback) == "function") {
					callback();
				}
			}
		});

		return this;
	},

	// Animates the receiver to full opacity.
	fadeIn: function() {
		this.css({ display: '' });
		this.animate({
			opacity: 1
		}, {
			duration: 400
		});

		return this;
	},

	// Hides the receiver.
	hide: function() {
		this.css({ display: 'none', opacity: 0 });
		return this;
	},

	// Shows the receiver.
	show: function() {
		this.css({ display: '', opacity: 1 });
		return this;
	}
};
