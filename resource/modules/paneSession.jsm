/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VERSION 1.1.14

this.paneSession = {
	manualAction: false,
	migratedBackupFile: null,
	_deferredPromises: new Set(),
	_quickaccess: null,

	filestrings: {
		manual: objName+'-manual'
	},

	filenames: {
		previous: /^previous.js$/,
		recovery: /^recovery.js$/,
		recoveryBackup: /^recovery.bak$/,
		upgrade: /^upgrade.js-[0-9]{14}$/,
		tabMixPlus: /^tabmix_sessions-[0-9]{4}-[0-9]{2}-[0-9]{2}.rdf$/,
		manual: /^tabGroups-manual-[0-9]{8}-[0-9]{6}.json$/,
		update: /^tabGroups-update.js-[0-9]{13,14}$/
	},

	// some things needed to import from Session Manager files
	SessionIo: null,
	FileUtils: null,
	Utils: null,

	// some things needed to import from tab mix plus sessions
	TabmixSessionManager: null,
	TabmixConvertSession: null,
	RDFService: null,

	// backups are placed in profileDir/sessionstore-backups folder by default, where all other session-related backups are saved
	get backupsPath() {
		delete this.backupsPath;
		let profileDir = OS.Constants.Path.profileDir;
		this.backupsPath = OS.Path.join(profileDir, "sessionstore-backups");
		return this.backupsPath;
	},

	get alldataCheckbox() { return $('paneSession-backup-alldata'); },
	get alldata() { return this.alldataCheckbox.checked; },

	get backupBtn() { return $('paneSession-backup-button'); },
	get importBtn() { return $('paneSession-import-button'); },
	get loadFromFile() { return $('paneSession-load-from-file'); },
	get backups() { return $('paneSession-load-menu'); },

	get clearBtn1() { return $('paneSession-clear-button-1'); },
	get clearBtn2() { return $('paneSession-clear-button-2'); },
	get clearBtn3() { return $('paneSession-clear-button-3'); },

	get tabList() { return $('paneSession-restore-tabList'); },
	get invalidNotice() { return $('paneSession-restore-invalid'); },
	get importfinishedNotice() { return $('paneSession-restore-finished'); },
	get autoloadedNotice() { return $('paneSession-backup-autoloaded'); },
	get clearChecklist() { return $('paneSession-clear-checklist'); },

	handleEvent: function(e) {
		switch(e.type) {
			case 'command':
				switch(e.target) {
					case this.alldataCheckbox:
						$('paneSession-backup-warning').hidden = !this.alldata;
						break;

					case this.backupBtn:
						this.backup();
						break;

					case this.loadFromFile:
						this.loadBackup();
						break;

					case this.importBtn:
						this.importSelected();
						break;

					case this.clearBtn1:
					case this.clearBtn2:
					case this.clearBtn3:
						this.clearData();
						break;
				}
				break;

			// tree handlers
			case 'keydown':
				switch(e.key) {
					case " ":
						// Don't scroll the page when un/checking an item.
						e.preventDefault();
						// no break; continue to "Enter"

					case "Enter":
						this.toggleRowChecked(this.tabList.currentIndex);
						break;
				}
				break;

			case 'click':
			case 'dblclick':
				if(e.button != 0) { break; }

				let id = (e.type == 'click') ? "paneSession-restore-restore" : "paneSession-restore-title";
				let cell = treeView.treeBox.getCellAt(e.clientX, e.clientY);
				if(cell.col && cell.col.id == id) {
					this.toggleRowChecked(cell.row);
				}
				break;

			case 'popupshowing':
				this.buildBackupsMenu();
				break;
		}
	},

	init: function() {
		Listeners.add(this.alldataCheckbox, 'command', this);
		Listeners.add(this.backupBtn, 'command', this);
		Listeners.add(this.loadFromFile, 'command', this);
		Listeners.add(this.backups, 'popupshowing', this);
		Listeners.add(this.importBtn, 'command', this);
		Listeners.add(this.clearBtn1, 'command', this);
		Listeners.add(this.clearBtn2, 'command', this);
		Listeners.add(this.clearBtn3, 'command', this);
		Listeners.add(this.tabList, 'keydown', this, true);
		Listeners.add(this.tabList, 'click', this);
		Listeners.add(this.tabList, 'dblclick', this);
	},

	uninit: function() {
		Timers.cancel('resetClear');

		Listeners.remove(this.alldataCheckbox, 'command', this);
		Listeners.remove(this.backupBtn, 'command', this);
		Listeners.remove(this.loadFromFile, 'command', this);
		Listeners.remove(this.backups, 'popupshowing', this);
		Listeners.remove(this.importBtn, 'command', this);
		Listeners.remove(this.clearBtn1, 'command', this);
		Listeners.remove(this.clearBtn2, 'command', this);
		Listeners.remove(this.clearBtn3, 'command', this);
		Listeners.remove(this.tabList, 'keydown', this, true);
		Listeners.remove(this.tabList, 'click', this);
		Listeners.remove(this.tabList, 'dblclick', this);
	},

	backup: function() {
		controllers.showFilePicker(Ci.nsIFilePicker.modeSave, this.filestrings.manual, (aFile) => {
			let state = SessionStore.getCurrentState();
			let save;

			// if backing up all session data it's simple, just save everything
			if(this.alldata) {
				save = (new TextEncoder()).encode(JSON.stringify(state));
			}
			// otherwise we'll need to build a new object containing only the relevant information
			else {
				// We'll skip closed windows and tabs, at least for now, I think this will work for most use cases though.
				let saveData = {
					version: [ objName, 1 ],
					session: state.session,
					windows: []
				};

				let anonGroupId = 0;
				if(state.windows) {
					for(let win of state.windows) {
						let winData = {
							tabs: [],
							extData: {}
						};

						if(Array.isArray(win.tabs)) {
							for(let tab of win.tabs) {
								try {
									// don't save tab history, only the latest (current) visible entry
									let i = tab.index -1;
									let current = tab.entries[i];

									let saveTab = {
										entries: [ {
											url: current.url,
											title: current.title,
											charset: current.charset,
											ID: current.ID,
											persist: current.persist
										} ],
										lastAccessed: "0",
										hidden: tab.hidden,
										attributes: {},
										extData: {},
										index: 1
									};

									if(tab.lastAccessed) {
										saveTab.lastAccessed = tab.lastAccessed;
									}
									if(tab.pinned) {
										saveTab.pinned = tab.pinned;
									}
									if(tab.extData) {
										for(let x in tab.extData) {
											saveTab.extData[x] = tab.extData[x];
										}
									}
									if(tab.attributes) {
										for(let x in tab.attributes) {
											saveTab.attributes[x] = tab.attributes[x];
										}
									}
									if(tab.image) {
										saveTab.image = tab.image;
									}

									winData.tabs.push(saveTab);
								}
								catch(ex) { Cu.reportError(ex); }
							}
						}

						if(win.extData) {
							if(win.extData[Storage.kGroupIdentifier]) {
								winData.extData[Storage.kGroupIdentifier] = win.extData[Storage.kGroupIdentifier];
							}
							if(win.extData[Storage.kGroupsIdentifier]) {
								winData.extData[Storage.kGroupsIdentifier] = win.extData[Storage.kGroupsIdentifier];
							}
						}

						saveData.windows.push(winData);
					}
				}

				save = (new TextEncoder()).encode(JSON.stringify(saveData));
			}

			OS.File.open(aFile.path, { truncate: true }).then((ref) => {
				ref.write(save).then(() => {
					ref.close();

					// Load the newly created file in the Restore Tab Groups block,
					// so that the user can confirm all the tabs and groups were backed up properly.
					// We read from the newly created file so that we're sure to show the info that was actually saved,
					// and not the info that's still in memory.
					this.loadSessionFile(aFile, false);
				});
			});
		}, this.backupsPath);
	},

	// If at any point this fails, it simply doesn't add the corresponding item to the menu
	// (if it fails here it's unlikely it will work when actually loading groups from these files anyway).
	buildBackupsMenu: function() {
		// Reject any pending tasks, we'll reschedule these ops again.
		// There's no need to clear afterwards, rejecting the promise removes it from the Set.
		for(let deferred of this._deferredPromises) {
			deferred.resolve();
		}
		this._quickaccess = new Set();

		// Always clean up old entries.
		let child = this.backups.firstChild;
		while(child) {
			let next = child.nextSibling;
			if(!child.id) {
				child.remove();
			} else if(child != this.loadFromFile) {
				child.hidden = true;
			}
			child = next;
		}

		let profileDir = OS.Constants.Path.profileDir;

		if(Services.vc.compare(Services.appinfo.version, "52.0a1") < 0) {
			// if Firefox created its migration backup when it updated to 45, we can add an item to load it directly,
			// so users can import back their groups from that point easily
			this.deferredPromise((deferred) => {
				// the migration backup is placed in the profile folder
				let path = OS.Path.join(profileDir, "tabgroups-session-backup.json");
				OS.File.exists(path).then((exists) => {
					if(exists) {
						this.checkRecoveryFile(deferred, path, 'groupsMigrationBackup', 'upgrade');
					}
				});
			});
		}

		// Don't throw immediately if any iteration fails, run all it can to add all the possible (valid) items.
		let exn = null;

		// iterate through all files in sessionstore-backups folder and add an item for each (valid) one
		let iterator;
		let iterating;
		try {
			iterator = new OS.File.DirectoryIterator(this.backupsPath);
			iterating = iterator.forEach((file) => {
				// a copy of the current session, for crash-protection
				if(this.filenames.recovery.test(file.name)) {
					this.deferredPromise((deferred) => {
						this.checkRecoveryFile(deferred, file.path, 'sessionRecovery', 'recovery');
					});
				}
				// another crash-protection of the current session
				else if(this.filenames.recoveryBackup.test(file.name)) {
					this.deferredPromise((deferred) => {
						this.checkRecoveryFile(deferred, file.path, 'recoveryBackup', 'recovery');
					});
				}
				// the previous session
				else if(this.filenames.previous.test(file.name)) {
					this.deferredPromise((deferred) => {
						this.checkRecoveryFile(deferred, file.path, 'previousSession', 'recovery');
					});
				}
				// backups made when Firefox updates itself
				else if(this.filenames.upgrade.test(file.name)) {
					this.deferredPromise((deferred) => {
						this.checkRecoveryFile(deferred, file.path, 'upgradeBackup', 'upgrade');
					});
				}
				// backups created when the add-on is updated
				else if(this.filenames.update.test(file.name)) {
					this.deferredPromise((deferred) => {
						this.checkRecoveryFile(deferred, file.path, 'addonUpdateBackup', 'upgrade');
					});
				}
				// this could be one of the backups manually created by the user, try to load it and see if we recognize it
				else if(this.filenames.manual.test(file.name)) {
					this.deferredPromise((deferred) => {
						this.checkRecoveryFile(deferred, file.path, 'manualBackup', 'manual');
					});
				}
			});
		}
		catch(ex) {
			exn = exn || ex;
		}
		finally {
			if(iterating) {
				iterating.then(
					function() { iterator.close(); },
					function(reason) { iterator.close(); throw reason; }
				);
			}
		}

		// Let's look for Session Manager's session backups as well, since we can also import from those.
		AddonManager.getAddonByID('{1280606b-2510-4fe0-97ef-9b5a22eafe30}', (addon) => {
			if(addon && addon.isActive) {
				let smiterator;
				let smiterating;
				if(!this.SessionIo) {
					Cu.import("chrome://sessionmanager/content/modules/session_file_io.jsm", this);
					Cu.import("chrome://sessionmanager/content/modules/utils.jsm", this);
					Cu.import("resource://gre/modules/FileUtils.jsm", this);
				}
				let smdir = this.SessionIo.getSessionDir();
				let smsessions = this.SessionIo.getSessions();
				for(let session of smsessions) {
					let path = OS.Path.join(smdir.path, session.fileName);
					this.checkSessionManagerFile(session, path);
				}
			}
		});

		// Let's look for Tab Mix Plus's sessions and try to import from those as well.
		AddonManager.getAddonByID('{dc572301-7619-498c-a57d-39143191b318}', (addon) => {
			if(addon && addon.isActive) {
				if(!this.TabmixSessionManager) {
					this.TabmixSessionManager = gWindow.TabmixSessionManager;
					this.TabmixConvertSession = gWindow.TabmixConvertSession;
					this.RDFService = Cc["@mozilla.org/rdf/rdf-service;1"].getService(Ci.nsIRDFService);
				}

				let tmpiterator;
				let tmpiterating;
				let tmpdir = OS.Path.join(profileDir, "sessionbackups");
				try {
					tmpiterator = new OS.File.DirectoryIterator(tmpdir);
					tmpiterating = tmpiterator.forEach((file) => {
						if(this.filenames.tabMixPlus.test(file.name)) {
							this.checkTabMixPlusFile(file);
						}
					});
				}
				catch(ex) {
					exn = exn || ex;
				}
				finally {
					if(tmpiterating) {
						tmpiterating.then(
							function() { tmpiterator.close(); },
							function(reason) { tmpiterator.close(); throw reason; }
						);
					}
				}
			}
		});

		if(exn) { throw exn; }
	},

	// Constructs a deferred promise object to be stored in a Set() that either self-removes or can be rejected and cleaned from the outside.
	// The executor is passed this deferred object as its single argument.
	deferredPromise: function(executor) {
		// This is the basis of this deferred object, with accessor methods for resolving and rejecting its promise.
		let deferred = {
			resolve: function() {
				paneSession._deferredPromises.delete(this);
				this._resolve();
			},

			reject: function(r) {
				paneSession._deferredPromises.delete(this);
				this._reject(r);
			}
		};

		// Init the actual promise.
		deferred.promise = new Promise((resolve, reject) => {
			// Store the resolve and reject methods in the deferred object.
			deferred._resolve = resolve;
			deferred._reject = reject;

			// Pass the deferred object to the executor, so it can resolve itself as well.
			executor(deferred);
		});

		// Add this deferred promise to the Set() so we can keep track of it.
		this._deferredPromises.add(deferred);

		return deferred;
	},

	checkRecoveryFile: function(aDeferred, aPath, aName, aWhere) {
		OS.File.open(aPath, { read: true }).then((ref) => {
			ref.read().then((savedState) => {
				ref.close();

				let state = JSON.parse((new TextDecoder()).decode(savedState));
				this.verifyState(aDeferred, state, aPath, aName, aWhere);
			});
		});
	},

	checkSessionManagerFile: function(session, path) {
		this.deferredPromise((deferred) => {
			let file = new this.FileUtils.File(path);
			this.SessionIo.readSessionFile(file, false, (state) => {
				state = this.getStateForSessionManagerData(session, state);
				this.verifyState(deferred, state, { file, session }, 'sessionManager', 'sessionManager');
			});
		});
	},

	checkTabMixPlusFile: function(aFile) {
		let tmpDATASource;

		try {
			tmpDATASource = this.TabmixSessionManager.DATASource;

			let path = OS.Path.toFileURI(aFile.path);
			this.TabmixSessionManager.DATASource = this.RDFService.GetDataSourceBlocking(path);

			// Each TMP file can hold several sessions.
			let sessions = this.TabmixSessionManager.getSessionList();
			for(let x of sessions.path) {
				let session = x;
				this.deferredPromise((deferred) => {
					let state = this.getStateForTabMixPlusData(session);
					this.verifyState(deferred, state, { path, session }, 'tabMixPlus', 'tabMixPlus');
				});
			}
		}
		catch(ex) {
			Cu.reportError(ex);
		}
		// Always make sure we restore TMP's current session state if there's one.
		finally {
			if(tmpDATASource) {
				this.TabmixSessionManager.DATASource = tmpDATASource;
			}
		}
	},

	getStateForSessionManagerData: function(session, data) {
		data = data.split("\n")[4];
		data = this.Utils.decrypt(data);
		if(data) {
			data = this.Utils.JSON_decode(data);
			if(data && !data._JSON_decode_failed) {
				// Use the timestamp from the session file header as the lastUpdate property for these files.
				// It's more accurate (and some session files don't actually have a lastUpdate property.
				if(!data.session) { data.session = {}; }
				data.session.lastUpdate = session.timestamp;
				return data;
			}
		}
		return null;
	},

	getStateForTabMixPlusData: function(session) {
		let state = this.TabmixConvertSession.getSessionState(session);
		if(!state.tabsCount) { return state; }

		// TMP doesn't retrieve a lastUpdate value here, we need to get it ourselves
		let node = this.RDFService.GetResource(session);
		state.session = {
			lastUpdate: this.TabmixSessionManager.getLiteralValue(node, "timestamp", 0)
		};
		if(!state.session.lastUpdate) {
			let container = this.TabmixSessionManager.initContainer(node);
			let windowEnum = container.GetElements();
			while(windowEnum.hasMoreElements()) {
				let windowNode = windowEnum.getNext();
				let timestamp = this.TabmixSessionManager.getLiteralValue(windowNode, "timestamp", 0);
				state.session.lastUpdate = Math.max(state.session.lastUpdate, timestamp);
			}
		}

		return state;
	},

	verifyState: function(aDeferred, aState, aFile, aName, aWhere) {
		if(aState.session) {
			// Some sessions may not be modified between files, so they're essentially duplicates spread out over several files.
			// There's no need to show these in the quick access menu.
			let stateStr = JSON.stringify(aState);
			if(!this._quickaccess.has(stateStr)) {
				let date = aState.session.lastUpdate;
				this.createBackupEntry(aFile, aName, date, aWhere);
				this._quickaccess.add(stateStr);
			}
		}
		aDeferred.resolve();
	},

	createBackupEntry: function(aPath, aName, aDate, aWhere) {
		let date = new Date(aDate).toLocaleString();

		let item = document.createElement('menuitem');
		item.setAttribute('label', Strings.get('options', aName, [ [ '$date', date ] ]));
		item._date = aDate;
		item.handleEvent = (e) => {
			this.loadSessionFile(aPath, true, aWhere);
		};
		item.addEventListener('command', item);

		// make sure we unhide the separator for this category of backup entries
		let sibling = $('paneSession-load-separator-'+aWhere);
		sibling.hidden = false;

		// try to sort by date desc within this category
		while(sibling.previousSibling) {
			if(sibling.previousSibling.nodeName == 'menuseparator' || aDate <= sibling.previousSibling._date) { break; }
			sibling = sibling.previousSibling;
		}

		this.backups.insertBefore(item, sibling);
	},

	loadBackup: function() {
		controllers.showFilePicker(Ci.nsIFilePicker.modeOpen, null, (aFile) => {
			this.loadSessionFile(aFile, true);
		}, this.backupsPath);
	},

	loadSessionFile: function(aFile, aManualAction, aSpecial) {
		if(aSpecial == 'sessionManager') {
			this.SessionIo.readSessionFile(aFile.file, false, (state) => {
				this.manualAction = aManualAction;

				state = this.getStateForSessionManagerData(aFile.session, state);
				this.readState(state);
			});
			return;
		}

		if(aSpecial == 'tabMixPlus') {
			let tmpDATASource;
			try {
				tmpDATASource = this.TabmixSessionManager.DATASource;
				this.TabmixSessionManager.DATASource = this.RDFService.GetDataSourceBlocking(aFile.path);

				let state = this.getStateForTabMixPlusData(aFile.session);
				this.readState(state);
			}
			catch(ex) {
				Cu.reportError(ex);
			}
			// Always make sure we restore TMP's current session state if there's one.
			finally {
				if(tmpDATASource) {
					this.TabmixSessionManager.DATASource = tmpDATASource;
				}
			}
			return;
		}

		OS.File.open(aFile.path || aFile, { read: true }).then((ref) => {
			ref.read().then((savedState) => {
				ref.close();

				this.manualAction = aManualAction;

				let state;
				try {
					state = this.getStateForData(savedState);
				}
				catch(ex) {
					Cu.reportError(ex);

					this.invalidNotice.hidden = false;
					this.tabList.hidden = true;
					return;
				}
				this.readState(state);
			});
		});
	},

	getStateForData: function(data) {
		return JSON.parse((new TextDecoder()).decode(data));
	},

	readState: function(state) {
		let pinnedGroupIdx = 0;
		let tabGroupIdx = 0;

		treeView.data = [];
		for(let win of state.windows) {
			if(!win.tabs) { continue; }

			let groups;
			let activeGroupId;
			try {
				let winGroups = JSON.parse(win.extData[Storage.kGroupsIdentifier]);
				groups = JSON.parse(win.extData[Storage.kGroupIdentifier]);
				if(winGroups.activeGroupId in groups) {
					activeGroupId = winGroups.activeGroupId;
				}
				// create a group specific for tabs without groups information (if any)
				else {
					let newGroupId = 1;
					while(newGroupId in groups) {
						newGroupId++;
					}
					activeGroupId = newGroupId;
					groups[activeGroupId] = { id: activeGroupId };
				}
			}
			catch(ex) {
				console.log(ex.name+': '+ex.message);

				// groups data is corrupted or missing, consider the whole window its own group
				activeGroupId = 1;
				groups = {
					1: { id: 1 }
				};
			}

			let pinned = [];
			let tabs = [];
			for(let tab of win.tabs) {
				if(tab.pinned) {
					pinned.push(tab);
				} else {
					try {
						tab._tabData = JSON.parse(tab.extData[Storage.kTabIdentifier]);
						if(!tab._tabData.groupID || !(tab._tabData.groupID in groups)) {
							// if the stored groupID does not exist in within the groups, default to the active group
							throw "Tab has an invalid groupID attached!";
						}
					}
					catch(ex) {
						console.log(ex.name+': '+ex.message);

						// I think it's possible that tabs created while TabView is closed could somehow skip the group registration.
						// Even if not, we squeeze in any ungrouped tabs into the "current" group of that window,
						// as that's the most likely case, or at least the most logical step to take in their case.
						tab._tabData = { groupID: activeGroupId };
					}
					tabs.push(tab);
				}
			}

			// show pinned tabs as if they had their own group
			if(pinned.length) {
				let label = Strings.get('TabView', 'restorePinned', [
					[ '$idx', ++pinnedGroupIdx ],
					[ '$tabs', pinned.length ]
				], pinned.length);
				let groupData = this.createGroupItem(pinnedGroupIdx, label);
				for(let tab of pinned) {
					this.createTabItem(groupData, tab);
				}
				treeView.data.push(groupData);
				for(let tab of groupData.tabs) {
					treeView.data.push(tab);
				}
			}

			// now divide the existing tab data into their own groups
			if(tabs.length) {
				for(let groupId in groups) {
					let groupTabs = tabs.filter(function(tab) {
						return !tab.pinned && tab._tabData.groupID == groupId;
					});
					// we only show group items for groups that actually have tabs
					if(groupTabs.length) {
						++tabGroupIdx;
						let group = groups[groupId];
						let label = group.title;
						if(label) {
							label = Strings.get('TabView', 'restoreNamedGroup', [
								[ '$name', label ],
								[ '$tabs', groupTabs.length ]
							], groupTabs.length);
						} else {
							label = Strings.get('TabView', 'restoreUnnamedGroup', [
								[ '$idx', tabGroupIdx ],
								[ '$tabs', groupTabs.length ]
							], groupTabs.length);
						}
						let groupData = this.createGroupItem(tabGroupIdx, label, group);
						for(let tab of groupTabs) {
							this.createTabItem(groupData, tab);
						}
						treeView.data.push(groupData);
						for(let tab of groupData.tabs) {
							treeView.data.push(tab);
						}
					}
				}
			}
		}

		if(treeView.data.length) {
			this.invalidNotice.hidden = true;
			this.tabList.hidden = false;
			this.importBtn.hidden = false;
			this.tabList.view = treeView;
			this.tabList.view.selection.select(0);
			if(this.manualAction) {
				this.tabList.scrollIntoView();
			}
		}
		else {
			this.invalidNotice.hidden = false;
			this.tabList.hidden = true;
			this.importBtn.hidden = true;
		}
		this.autoloadedNotice.hidden = this.manualAction;
		this.importfinishedNotice.hidden = true;
	},

	createGroupItem: function(aIdx, aLabel, aGroup) {
		let group = {
			label: aLabel,
			open: true,
			checked: this.manualAction,
			ix: aIdx,
			tabs: []
		};
		if(!aGroup) {
			group.pinned = true;
		} else {
			group._group = aGroup;
		}
		return group;
	},

	createTabItem: function(groupData, tab) {
		let entry = tab.entries && tab.entries[tab.index -1];
		if(!entry) { return; }

		let iconURL = tab.image || null;
		// don't initiate a connection just to fetch a favicon (see bug 462863)
		if(/^https?:/.test(iconURL)) {
			iconURL = "moz-anno:favicon:" + iconURL;
		}
		groupData.tabs.push({
			label: entry.title || entry.url,
			checked: this.manualAction,
			src: iconURL,
			_tab: tab,
			parent: groupData
		});
	},

	importSelected: function() {
		let importGroups = treeView.data.filter(function(item, idx) { return treeView.isContainer(idx) && item.checked !== false; });

		// no items are selected, no-op
		if(!importGroups.length) { return; }

		// first make sure the TabView frame isn't initialized, we don't want it interfering
		gWindow[objName].TabView._deinitFrame();

		// If TMP is initialized, it could reverse the order of the imported tabs, we flip its preference temporarily to make sure it doesn't.
		let restoreTMP = Prefs.openTabNext;
		if(restoreTMP) {
			Prefs.openTabNext = false;
		}

		// initialize window if necessary, just in case
		Storage._scope.SessionStoreInternal.onLoad(gWindow);

		// get the next id to be used for the imported groups
		let groupItems = Storage.readGroupItemsData(gWindow) || {};
		if(!groupItems.nextID) {
			groupItems.nextID = 1;
		}
		if(!groupItems.totalNumber) {
			groupItems.totalNumber = 0;
		}

		for(let group of importGroups) {
			// pinned tabs are direct, just append and restore
			if(group.pinned) {
				for(let tab of group.tabs) {
					if(!tab.checked) { continue; }

					// these tabs are pinned, so they can't be hidden, make sure this is respected
					tab._tab.pinned = true;
					tab._tab.hidden = false;

					this.restoreTab(gWindow, tab._tab);
				}
				continue;
			}

			let groupID = groupItems.nextID++;
			let groupData = group._group;
			groupData.id = groupID;

			// first append the imported group into the session data
			Storage.saveGroupItem(gWindow, groupData);
			groupItems.totalNumber++;

			for(let tab of group.tabs) {
				if(!tab.checked) { continue; }

				// we are creating a new id for this group, make sure its tabs know this
				tab._tab._tabData.groupID = groupID;

				// force these tabs hidden, since they belong to newly creative (inactive) groups
				delete tab._tab.pinned;
				tab._tab.hidden = true;

				this.restoreTab(gWindow, tab._tab);
			}
		}

		// don't forget to insert back the updated data
		Storage.saveGroupItemsData(gWindow, {
			nextID: groupItems.nextID,
			activeGroupId: groupItems.activeGroupId || null,
			totalNumber: groupItems.totalNumber
		});

		// We can restore TMP's preferences now if it was flipped before.
		if(restoreTMP) {
			Prefs.openTabNext = true;
		}

		this.autoloadedNotice.hidden = true;
		this.invalidNotice.hidden = true;
		this.tabList.hidden = true;
		this.importBtn.hidden = true;
		this.importfinishedNotice.hidden = false;
		this.importfinishedNotice.scrollIntoView();
	},

	restoreTab: function(win, tabData) {
		if(!tabData.extData) {
			tabData.extData = {};
		}
		tabData.extData[Storage.kTabIdentifier] = JSON.stringify(tabData._tabData);
		delete tabData._tabData;

		let tab = win.gBrowser.addTab("about:blank", { skipAnimation: true, forceNotRemote: true, });
		Storage._scope.SessionStoreInternal.restoreTab(tab, tabData);
	},

	toggleRowChecked: function(aIx) {
		let isChecked = function(aItem) { return aItem.checked; }

		let item = treeView.data[aIx];
		item.checked = !item.checked;
		treeView.treeBox.invalidateRow(aIx);

		if(treeView.isContainer(aIx)) {
			// (un)check all tabs of this window as well
			for(let tab of item.tabs) {
				tab.checked = item.checked;
				treeView.treeBox.invalidateRow(treeView.data.indexOf(tab));
			}
		}
		else {
			// update the window's checkmark as well (0 means "partially checked")
			item.parent.checked = item.parent.tabs.every(isChecked) ? true : item.parent.tabs.some(isChecked) ? 0 : false;
			treeView.treeBox.invalidateRow(treeView.data.indexOf(item.parent));
		}
	},

	clearData: function() {
		let phase = this.clearChecklist.getAttribute('phase');
		switch(phase) {
			case '1':
				setAttribute(this.clearChecklist, 'phase', '2');
				this.resetClear();
				break;

			case '2':
				setAttribute(this.clearChecklist, 'phase', '3');
				this.resetClear();
				break;

			case '3':
				Timers.cancel('resetClear');

				let state = SessionStore.getBrowserState();
				try {
					state = JSON.parse(state);
				}
				catch(ex) {
					Cu.reportError(ex);
					return;
				}
				if(state.windows) {
					for(let win of state.windows) {
						this.eraseDataFromWindow(win);
					}
				}
				if(state._closedWindows) {
					for(let win of state._closedWindows) {
						this.eraseDataFromWindow(win);
					}
				}
				state = JSON.stringify(state);

				// The current window can't be closed, otherwise the new session data for other opened windows wouldn't be properly saved.
				// (http://mxr.mozilla.org/mozilla-central/source/browser/components/sessionstore/SessionStore.jsm -> SessionStoreInternal.setBrowserState())
				// Instead, we'll force an unloaded state of all tabs, since they will be forced to reload when reselected (we don't do this, SessionRestore does).
				for(let tab of gWindow.gBrowser.tabs) {
					if(!tab.pinned) {
						let browser = tab.linkedBrowser;
						// Browser freezes when trying to load a uri into a locked tab with TMP enabled;
						// see http://tabmixplus.org/forum/viewtopic.php?f=2&t=19506&sid=84a9d8b600b8df0b83196f70e547a75e&p=70286#p70286
						if(gWindow.Tabmix) {
							browser.tabmix_allowLoad = true;
						}
						browser.loadURI("about:blank");
					}
				}

				let wins = [];
				Windows.callOnAll(function(win) {
					// don't close the current window
					if(win != gWindow) {
						wins.unshift(win);
					}
				}, 'navigator:browser');

				// close all windows including the current one, otherwise its tabs would technically be "pending" even though their contents were already loaded
				for(let win of wins) {
					win.close();
				}

				SessionStore.setBrowserState(state);
				break;
		}
	},

	// reset the clear block after a few seconds, to ensure the user actually wants to clear the data
	resetClear: function() {
		Timers.init('resetClear', () => {
			setAttribute(this.clearChecklist, 'phase', '1');
		}, 10000);
	},

	eraseDataFromWindow: function(win) {
		let activeGroupId;
		if(win.extData) {
			try {
				let groupData = JSON.parse(win.extData[Storage.kGroupsIdentifier]);
				activeGroupId = groupData.activeGroupId;
			}
			catch(ex) { /* don't care, just consider all hidden tabs as belonging to non-active groups and remove them */ }

			delete win.extData[Storage.kGroupsIdentifier];
			delete win.extData[Storage.kGroupIdentifier];
			delete win.extData[Storage.kUIIdentifier];
		}

		if(win.tabs) {
			for(let tab of win.tabs.concat()) {
				if(!this.eraseDataFromTab(activeGroupId, tab, win.tabs)) {
					this.removeTabFromWindow(tab, win.tabs, win);
				}
			}
		}

		if(win._closedTabs) {
			for(let tab of win._closedTabs.concat()) {
				if(!this.eraseDataFromTab(activeGroupId, tab, win._closedTabs)) {
					this.removeTabFromWindow(tab, win._closedTabs);
				}
			}
		}
	},

	eraseDataFromTab: function(activeGroupId, tab, tabs) {
		if(!tab.pinned && tab.hidden) {
			if(!activeGroupId) {
				return false;
			}

			if(tab.extData) {
				let tabGroupId;
				try {
					let tabData = JSON.parse(tab.extData[Storage.kTabIdentifier]);
					tabGroupId = tabData.groupID;
				}
				catch(ex) { /* don't care, just consider all hidden tabs as belonging to non-active groups and remove them */ }

				if(!tabGroupId || tabGroupId != activeGroupId) {
					return false;
				}
			}

			// we're keeping this tab around, so make sure it's visible
			tab.hidden = false;
		}

		if(tab.extData) {
			delete tab.extData[Storage.kTabIdentifier];
		}
		return true;
	},

	removeTabFromWindow: function(tab, tabs, win) {
		let i = tabs.indexOf(tab);

		// if we're removing a tab before the currently selected tab, we need to make sure the window's selected index is updated,
		// so that when it's reopened, it selectes the correct tab.
		// We should never remove the selected tab (likely the tab groups preferences tab), because if it's selected then it's in the current group, which is never removed.
		// (remember the array index is 0-based and win.selected is 1-based)
		if(win && i < win.selected) {
			win.selected--;
		}

		tabs.splice(i, 1);
	}
};

// adapted from http://mxr.mozilla.org/mozilla-central/source/browser/components/sessionstore/content/aboutSessionRestore.js
this.treeView = {
	data: [],
	treeBox: null,
	selection: null,

	get rowCount() { return this.data.length; },
	setTree: function(treeBox) { this.treeBox = treeBox; },
	getCellText: function(idx, column) { return this.data[idx].label; },
	isContainer: function(idx) { return "open" in this.data[idx]; },
	getCellValue: function(idx, column) { return this.data[idx].checked; },
	isContainerOpen: function(idx) { return this.data[idx].open; },
	isContainerEmpty: function(idx) { return false; },
	isSeparator: function(idx) { return false; },
	isSorted: function() { return false; },
	isEditable: function(idx, column) { return false; },
	canDrop: function(idx, orientation, dt) { return false; },
	getLevel: function(idx) { return this.isContainer(idx) ? 0 : 1; },

	getParentIndex: function(idx) {
		if(!this.isContainer(idx)) {
			for(let t = idx -1; t >= 0; t--) {
				if(this.isContainer(t)) {
					return t;
				}
			}
		}
		return -1;
	},

	hasNextSibling: function(idx, after) {
		let thisLevel = this.getLevel(idx);
		for(let t = after +1; t < this.data.length; t++) {
			if(this.getLevel(t) <= thisLevel) {
				return this.getLevel(t) == thisLevel;
			}
		}
		return false;
	},

	toggleOpenState: function(idx) {
		if(!this.isContainer(idx)) { return; }

		let item = this.data[idx];
		if(item.open) {
			// remove this group's tab rows from the view
			let thisLevel = this.getLevel(idx);
			let t;
			for(t = idx +1; t < this.data.length && this.getLevel(t) > thisLevel; t++);
			let deletecount = t -idx -1;
			this.data.splice(idx +1, deletecount);
			this.treeBox.rowCountChanged(idx +1, -deletecount);
		}
		else {
			// add this group's tab rows to the view
			let toinsert = this.data[idx].tabs;
			for(let i = 0; i < toinsert.length; i++) {
				this.data.splice(idx +i +1, 0, toinsert[i]);
			}
			this.treeBox.rowCountChanged(idx +1, toinsert.length);
		}
		item.open = !item.open;
		this.treeBox.invalidateRow(idx);
	},

	getCellProperties: function(idx, column) {
		if(column.id == "paneSession-restore-restore" && this.isContainer(idx) && this.data[idx].checked === 0) {
			return "partial";
		}
		if(column.id == "paneSession-restore-title") {
			return this.getImageSrc(idx, column) ? "icon" : "noicon";
		}
		return "";
	},

	getRowProperties: function(idx) {
		let groupState = this.data[idx].parent || this.data[idx];
		if(groupState.ix % 2 != 0) {
			return "alternate";
		}

		return "";
	},

	getImageSrc: function(idx, column) {
		if(column.id == "paneSession-restore-title") {
			return this.data[idx].src || null;
		}
		return null;
	},

	getProgressMode: function(idx, column) {},
	cycleHeader: function(column) {},
	cycleCell: function(idx, column) {},
	selectionChanged: function() {},
	performAction: function(action) {},
	performActionOnCell: function(action, index, column) {},
	getColumnProperties: function(column) { return ""; }
};


Modules.LOADMODULE = function() {
	paneSession.init();
};

Modules.UNLOADMODULE = function() {
	paneSession.uninit();
};
