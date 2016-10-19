/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.1

self.onmessage = function (e) {
	let iconUrl = e.data.iconUrl;

	let xhr = new XMLHttpRequest();
	xhr.open('GET', iconUrl, true);
	xhr.responseType = 'blob';
	xhr.onload = function () {
		self.postMessage({ iconUrl, loaded: true });
	};
	xhr.onerror = function() {
		self.postMessage({ iconUrl, loaded: false });
	};
	xhr.send();
};
