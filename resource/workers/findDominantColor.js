/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.0

self.onmessage = function (e) {
	let iconUrl = e.data.iconUrl;
	let data = e.data.imageData.data;

	// keep track of how many times a color appears in the image
	let colorCount = new Map();
	for(let i = 0; i < data.length; i += 4) {
		// ignore transparent pixels
		if(data[i+3] < 32) { continue; }

		// Do some rounding, to get a "feel" of the icons rather than the precise rgb values in the image.
		// This has the added bonus of having to loop through less entries in the checks below,
		// so it seems to compensate for the extra calculations here to round the values.
		let color = roundColor(data[i]) + "," + roundColor(data[i+1]) + "," + roundColor(data[i+2]);
		// ignore white --- quicksaver: why?
		//if(color == "255,255,255") { continue; }

		colorCount.set(color, (colorCount.get(color) || 0) + 1);
	}

	let maxCount = 0;
	let dominantColor = "";
	for(let [ color, count ] of colorCount) {
		if(count > maxCount) {
			maxCount = count;
			dominantColor = color;
		}
	}

	self.postMessage({ iconUrl, dominantColor });
};

let roundColor = function(v) {
	return Math.min(Math.round(v /8) *8, 255);
};
