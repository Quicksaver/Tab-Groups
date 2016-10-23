/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.0.1

Modules.LOADMODULE = function() {
	toggleAttribute(document.documentElement, 'FF49', Services.vc.compare(Services.appinfo.version, "49.0a1") >= 0);

	let fulltext = $('paneHowTo-credits-body');
	let exploded = fulltext.textContent.split('support.mozilla.org');
	if(exploded.length == 2) {
		let first = document.createTextNode(exploded[0]);
		let second = document.createTextNode(exploded[1]);
		let link = document.createElementNS('http://www.w3.org/1999/xhtml', 'a');
		setAttribute(link, 'target', '_blank');
		setAttribute(link, 'href', 'https://support.mozilla.org/kb/tab-groups-organize-tabs');
		link.textContent = 'support.mozilla.org';

		fulltext.firstChild.remove();
		fulltext.appendChild(first);
		fulltext.appendChild(link);
		fulltext.appendChild(second);
	}
};
