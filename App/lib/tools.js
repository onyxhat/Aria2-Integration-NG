
'use strict';
async function verifyFileName(name) {
	var tmp = [];
	await browser.runtime.getPlatformInfo().then( (e) => {
		if (name.match(/[<>:"\/\\|?*\x00-\x1F]/g) != null) {
			tmp = name.match(/[<>:"\/\\|?*\x00-\x1F]/g);
		}
		if (e.os == "win") {
			if (name.search(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i) != -1)
				tmp = tmp.concat(name);
			if (name[name.length - 1] == ' ' || name[name.length - 1] == '.')
				tmp = tmp.concat("Filenames cannot end in a space or dot.");
		}
	});
	console.log(tmp);
	return tmp;
}

async function correctFileName(name) {
	var tmp = name;
	await browser.runtime.getPlatformInfo().then( (e) => {
		tmp = tmp.replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_');
		if (e.os == "win") {
			if (tmp.search(/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i) != -1)
				tmp = '_' + tmp;
			if (tmp[tmp.length - 1] == ' ' || tmp[tmp.length - 1] == '.')
				tmp = tmp.slice(0, tmp.length - 1);
		}
	});
	console.log(tmp);
	return tmp;
}

function monitor(options, gid) {
	if (mon == undefined) {
		mon = new Worker("/lib/worker.js");
		mon.onmessage = function(e) {
			console.log(e.data);
			browser.storage.local.get(config.command.guess, function(item) {
				if (e.data[0] == "complete") {
					notify(browser.i18n.getMessage("download_complete", e.data[1] ));
					if (item.sound != "0") {
						var audio = new Audio('/data/Sound/complete' + item.sound + '.wav');
						audio.play();
					}
				}
				else if (e.data[0] == "badge" && item.badge){
					if(e.data[1] == 0){
						browser.browserAction.setBadgeText({text: ""});
						mon = null;
					}
					else {
						browser.browserAction.setBadgeText({text: e.data[1].toString()});
					}
				}
				else if (e.data[0] == "error"){
					notify(browser.i18n.getMessage("download_error", e.data[1] ));
				}
			});
		}
	}
	mon.postMessage([options, gid]);
}

function notify(message) {
	browser.notifications.create({
		type: 'basic',
		iconUrl: '/data/icons/48.png',
		title: browser.i18n.getMessage("extensionName"),
		message: message.message || message
	}).then((id) => { 
		setTimeout(() => {
			browser.notifications.clear(id.toString());
		}, 2000);
	});
}

function humanFileSize(bytes, si) {
    var thresh = si ? 1000 : 1024;
    if(Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }
    var units = si
        ? ['kB','MB','GB','TB','PB','EB','ZB','YB']
        : ['KiB','MiB','GiB','TiB','PiB','EiB','ZiB','YiB'];
    var u = -1;
    do {
        bytes /= thresh;
        ++u;
    } while(Math.abs(bytes) >= thresh && u < units.length - 1);
    return bytes.toFixed(1)+' '+units[u];
}

function isRunning(item, aria2) {
	//check whether aria2 is runnning
	var xhttp = new XMLHttpRequest();
	var url = "aria2://"
	if (item.shutdown)
		url += "stop-with-process";
	if (item.protocol.toLowerCase() == "ws" || item.protocol.toLowerCase() == "wss") {
		aria2.open().then(
			function (res) {
				aria2.close();
			},
			function (err) {
				if (item.auto) {
					var creating = browser.windows.create({
						url: url,
						type: "popup",
						width: 50,
						height: 50,
					});
					creating.then(windowInfo => {
						browser.windows.remove(windowInfo.id);
					}, () => {});
				}
			}
		);
	}
	else {
		aria2.getVersion().then(
			function (res) {
				console.log('result', res);
			},
			function (err) {
				if (item.auto) {
					var creating = browser.windows.create({
						url: url,
						type: "popup",
						width: 50,
						height: 50,
					});
					creating.then(windowInfo => {
						browser.windows.remove(windowInfo.id);
					}, () => {});
				}
			}
		);
	}
}

function downloadPanel(d) {
	globalD.push(d);
	//get incognito
	var getting = browser.windows.getCurrent();
	getting.then((windowInfo) => {
		browser.storage.local.get(['dpTop', 'dpLeft', 'dpWidth', 'dpHeight'], item1 => {
			var creating = browser.windows.create({
				top: item1.dpTop,
				left: item1.dpLeft,
				url: "data/DownloadPanel/index.html",
				type: "popup",
				width: 412 + parseInt((screen.width / 5000) * parseInt(item1.dpWidth || 0)),
				height: 200 + parseInt(33 * window.devicePixelRatio + (screen.height / 5000) * parseInt(item1.dpHeight || 0)) ,
				incognito: windowInfo.incognito,
				//titlePreface: "Aria2",
				//state: "fullscreen",
			});
			creating.then((wInfo) => {
				function handleZoomed(zoomChangeInfo){
					browser.storage.local.get(config.command.guess, (item) => {
						if (zoomChangeInfo.tabId == wInfo.tabs[0].id) {
							var updating = browser.windows.update(wInfo.id, {
								focused: true,
								top: item1.dpTop,
								left: item1.dpLeft,
								width: parseInt(412 * zoomChangeInfo.newZoomFactor * item.zoom 
													+ (screen.width / 5000) * parseInt(item1.dpWidth || 0)),
								height: parseInt(200 * zoomChangeInfo.newZoomFactor * item.zoom
													+ 33 * window.devicePixelRatio 
													+ (screen.height / 5000) * parseInt(item1.dpHeight || 0)),
							});
							browser.tabs.onZoomChange.removeListener(handleZoomed);
						}
					});
				}
				browser.tabs.onZoomChange.addListener(handleZoomed);
			}, () => {});
		});
	}, () => {});
}

///////////////////////////////////////
// File Path history (per RPC server) //
///////////////////////////////////////
const MAX_RECENT_PATHS = 10;

///////////////////////////////////////
// RPC servers (dynamic list)         //
///////////////////////////////////////
const SERVER_DEFAULTS = {
	name: "", protocol: "ws", host: "127.0.0.1", port: "6800", interf: "jsonrpc", token: "", path: "",
};

function newServerId() {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return "s-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// Pure: old storage blob -> { servers, defaultServerId, recentPaths }. No `browser` use.
function migrateSchema(raw, opts) {
	raw = raw || {};
	opts = opts || {};
	var makeId = opts.makeId || newServerId;
	var names = opts.names || { s1: "Default Server", s2: "RPC Server 2", s3: "RPC Server 3" };
	var rp = (raw.recentPaths && typeof raw.recentPaths === "object") ? raw.recentPaths : {};

	function build(name, suffix) {
		return {
			id: makeId(),
			name: name,
			protocol: raw["protocol" + suffix] || SERVER_DEFAULTS.protocol,
			host: raw["host" + suffix] || SERVER_DEFAULTS.host,
			port: raw["port" + suffix] || SERVER_DEFAULTS.port,
			interf: raw["interf" + suffix] || SERVER_DEFAULTS.interf,
			token: raw["token" + suffix] || SERVER_DEFAULTS.token,
			path: raw["path" + suffix] || SERVER_DEFAULTS.path,
		};
	}

	var servers = [];
	var recentPaths = {};

	var s1 = build(names.s1, "");
	servers.push(s1);
	recentPaths[s1.id] = Array.isArray(rp["1"]) ? rp["1"].slice(0, MAX_RECENT_PATHS) : [];

	[["2", names.s2], ["3", names.s3]].forEach(function (pair) {
		var n = pair[0];
		if (!Object.prototype.hasOwnProperty.call(raw, "host" + n)) return;
		var s = build(pair[1], n);
		servers.push(s);
		if (Array.isArray(rp[n])) recentPaths[s.id] = rp[n].slice(0, MAX_RECENT_PATHS);
	});

	return { servers: servers, defaultServerId: s1.id, recentPaths: recentPaths };
}

// Storage-backed helpers (Promise-returning; read/write via browser.storage.local).

function getServers() {
	return browser.storage.local.get("servers").then(function (item) {
		return Array.isArray(item.servers) ? item.servers : [];
	});
}

function getServer(id) {
	return getServers().then(function (servers) {
		return servers.filter(function (s) { return s.id === id; })[0];
	});
}

function getDefaultServer() {
	return Promise.all([getServers(), browser.storage.local.get("defaultServerId")]).then(function (r) {
		var servers = r[0], defaultServerId = r[1].defaultServerId;
		if (servers.length === 0) return undefined;
		return servers.filter(function (s) { return s.id === defaultServerId; })[0] || servers[0];
	});
}

function setDefaultServer(id) {
	return browser.storage.local.set({ defaultServerId: id });
}

function saveServers(servers) {
	return browser.storage.local.get("recentPaths").then(function (item) {
		var rp = (item.recentPaths && typeof item.recentPaths === "object") ? item.recentPaths : {};
		var ids = {};
		servers.forEach(function (s) { ids[s.id] = true; });
		var pruned = {};
		Object.keys(rp).forEach(function (k) { if (ids[k]) pruned[k] = rp[k]; });
		return browser.storage.local.set({ servers: servers, recentPaths: pruned });
	});
}

function validateServers(servers) {
	var errors = [];
	if (!Array.isArray(servers) || servers.length === 0) {
		errors.push("At least one server is required.");
		return errors;
	}
	servers.forEach(function (s, i) {
		var label = (s.name && s.name.trim()) || ((s.host || "") + ":" + (s.port || "")) || ("Server " + (i + 1));
		if (!s.protocol || !s.protocol.trim()) errors.push(label + ": protocol is required.");
		if (!s.host || !s.host.trim()) errors.push(label + ": host is required.");
		if (!s.port || !String(s.port).trim()) errors.push(label + ": port is required.");
		else if (!/^\d+$/.test(String(s.port).trim())) errors.push(label + ": port must be numeric.");
		if (!s.interf || !s.interf.trim()) errors.push(label + ": interface is required.");
	});
	return errors;
}

function runMigration() {
	return browser.storage.local.get(null).then(function (raw) {
		if (Array.isArray(raw.servers) && raw.schemaVersion >= 2) return undefined;
		var out = migrateSchema(raw, { names: {
			s1: browser.i18n.getMessage("OP_rpcDefault") || "Default Server",
			s2: browser.i18n.getMessage("OP_rpc2") || "RPC Server 2",
			s3: browser.i18n.getMessage("OP_rpc3") || "RPC Server 3",
		} });
		return browser.storage.local.set({
			servers: out.servers,
			defaultServerId: out.defaultServerId,
			recentPaths: out.recentPaths,
			schemaVersion: 2,
		}).then(function () {
			return browser.storage.local.remove([
				"path", "protocol", "host", "port", "interf", "token",
				"path2", "protocol2", "host2", "port2", "interf2", "token2",
				"path3", "protocol3", "host3", "port3", "interf3", "token3",
			]);
		});
	});
}

function readRecentPaths() {
	return new Promise(function (resolve) {
		browser.storage.local.get("recentPaths", function (item) {
			var rp = item.recentPaths;
			if (!rp || typeof rp != "object") rp = {};
			resolve(rp);
		});
	});
}

function getRecentPaths(server) {
	return readRecentPaths().then((rp) => rp[server] || []);
}

function addRecentPath(server, p) {
	p = (p || "").trim();
	if (p == "")
		return Promise.resolve();
	return readRecentPaths().then((rp) => {
		var list = (rp[server] || []).filter((x) => x !== p);
		list.unshift(p);
		rp[server] = list.slice(0, MAX_RECENT_PATHS);
		return browser.storage.local.set({ recentPaths: rp });
	});
}

function removeRecentPath(server, p) {
	return readRecentPaths().then((rp) => {
		rp[server] = (rp[server] || []).filter((x) => x !== p);
		return browser.storage.local.set({ recentPaths: rp });
	});
}

function clearRecentPaths(server) {
	return readRecentPaths().then((rp) => {
		rp[server] = [];
		return browser.storage.local.set({ recentPaths: rp });
	});
}

// CommonJS export shim — no effect in the extension (no `module`), lets tests require() this file.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		MAX_RECENT_PATHS, SERVER_DEFAULTS, newServerId, migrateSchema, runMigration,
		getServers, getServer, getDefaultServer, saveServers, setDefaultServer, validateServers,
		readRecentPaths, getRecentPaths, addRecentPath, removeRecentPath, clearRecentPaths,
	};
}