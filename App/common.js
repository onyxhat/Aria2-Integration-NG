
'use strict';
var request = [];
var globalD = [];
var aggressive = false;
var fileSizeLimit = 0;
var fileTypeFilterA = "";
var urlFilterA = "";
var fileTypeFilterB = "";
var urlFilterB = "";
var mon;
var rulesCache = [];
var serversCache = [];

function sendTo(url, fileName, filePath, header, serverId) {
	browser.storage.local.get("initialize", function (init) {
		if (!init.initialize || (init.initialize == undefined)) {
			browser.runtime.openOptionsPage();
			notify(browser.i18n.getMessage("error_setConfig"));
			return;
		}
		getServer(serverId).then(function (s) { return s ? s : getDefaultServer(); }).then(function (item) {
			if (!item) {
				browser.runtime.openOptionsPage();
				notify(browser.i18n.getMessage("error_setConfig"));
				return;
			}

			var proto = (item.protocol || "").toLowerCase();
			var sec = proto == "https" || proto == "wss";
			var options = {
				host: item.host,
				port: item.port,
				secure: sec,
				secret: item.token,
				path: "/" + item.interf,
			};
			var aria2 = new Aria2(options);
			browser.storage.local.get(["auto", "shutdown"], function (flags) {
				isRunning({ protocol: item.protocol, auto: flags.auto, shutdown: flags.shutdown }, aria2);
			});

			filePath = filePath.replace(/\\/g, '\\\\');
			var settingPath = (item.path || "").replace(/\\/g, '\\\\');
			var params = {};
			if (header != "[]") params.header = header;
			params.out = fileName;
			params["parameterized-uri"] = "false";
			if (filePath != "") params.dir = filePath;
			else if (settingPath != "") params.dir = settingPath;

			function ok(res) {
				monitor(options, res);
				notify(browser.i18n.getMessage("success_connect", fileName) + "\n\n" + url);
				aria2.close();
			}
			function okHttp() {
				notify(browser.i18n.getMessage("success_connect", fileName) + "\n\n" + url);
			}
			function fail(err) {
				console.log('Error', err);
				notify(browser.i18n.getMessage("error_connect"));
			}

			if (proto == "ws" || proto == "wss") {
				aria2.open().then(
					function () {
						aria2.addUri([url], params).then(ok, function () {
							setTimeout(function () {
								aria2.addUri([url], params).then(ok, function (err) { fail(err); aria2.close(); });
							}, 3000);
						});
					},
					function () {
						setTimeout(function () {
							aria2.open().then(function () {
								aria2.addUri([url], params).then(ok, function (err) { fail(err); aria2.close(); });
							}, function (err) { fail(err); });
						}, 3000);
					}
				);
			} else {
				aria2.addUri([url], params).then(okHttp, function () {
					setTimeout(function () {
						aria2.addUri([url], params).then(okHttp, fail);
					}, 3000);
				});
			}
		});
	});
}

function testServer(s) {
	var proto = (s.protocol || "").toLowerCase();
	var sec = proto == "https" || proto == "wss";
	var aria2 = new Aria2({ host: s.host, port: s.port, secure: sec, secret: s.token, path: "/" + s.interf });
	var isWs = proto == "ws" || proto == "wss";
	var probe = isWs
		? aria2.open().then(function () { aria2.close(); })
		: aria2.getVersion();
	return probe.then(
		function () { return { ok: true }; },
		function (e) { return { ok: false, error: String((e && e.message) || e || "unreachable") }; }
	);
}

function save(url, fileName, filePath, header, as, wid, incog) {
	if (fileName != "") {
		var downloading = browser.downloads.download({
			//conflictAction: "prompt",  //not work
			filename: fileName,
			incognito: incog,  //not work under 57
			saveAs: as,
			url: url,
		});
	} 
	else {
		var downloading = browser.downloads.download({
			//conflictAction: "prompt",  //not work
			incognito: incog,  //not work under 57
			saveAs: as,
			url: url,
		});
	}
	
	// close download panel
	if (wid != 0) downloading.then(id => {
		browser.windows.remove(wid)
	}, (e) => {
		notify(e)
	});
	else downloading.then(() => {}, (e) => {
		notify(e)
	});
}

function tmpopen(url, fileName, header) {
	var downloading = browser.downloads.download({
		filename: "%temp%",
		//headers: header,
		url: url
	});
	downloading.then(id => {
		var opening = browser.downloads.open(id);
		opening.then(() => {}, (e) => {
			console.log(e)
		})
	}, (e) => {
		console.log(e)
	});
}

function handleMessage(request, sender, sendResponse) {
	//console.log("Message from the content script: " +request.get);
	switch (request.get) {
		case "all":
			var d = globalD.pop();
			//var tmp = d.responseHeaders.find(x => x.name === 'Content-Type').value;
			sendResponse({
				response: "all",
				url: d.url,
				fileName: d.fileName,
				fileSize: d.fileSize,
				//fileType: tmp,
				header: d.requestHeaders,
			});
			break;
		case "download":
			sendTo(request.url, request.fileName, request.filePath, request.header, request.server);
			sendResponse({
				response: "send success"
			});
			break;
		case "save":
			save(request.url, request.fileName, request.filePath, request.header, false,
				false, request.incognito);
			sendResponse({
				response: "send success"
			});
			break;
		case "saveas":
			save(request.url, request.fileName, request.filePath, request.header, true,
				request.wid, request.incognito)
			sendResponse({
				response: "saveas create"
			});
			break;
		case "tmpopen":
			tmpopen(request.url, request.fileName, request.header);
			sendResponse({
				response: "send success"
			});
			break;
		case "changeState":
			changeState(request.checked);
			sendResponse({
				response: "send success"
			});
			break;
		case "loadSettings":
			loadSettings();
			sendResponse({
				response: "send success"
			});
			break;
		case "testServer":
			return testServer(request.server);
		default:
			console.log("Message from the content script: " + request.get);
			sendResponse({
				response: "Response from background script"
			});
	}
}

function getFileName(d) {
	// get file name
	var fileName = "";
	var id = 0;
	id = d.responseHeaders.findIndex(x => x.name.toLowerCase() === "content-disposition");
	if (id >= 0) {
		var PARAM_REGEXP = /;[\x09\x20]*([!#$%&'*+.0-9A-Z^_`a-z|~-]+)[\x09\x20]*=[\x09\x20]*("(?:[\x20!\x23-\x5b\x5d-\x7e\x80-\xff]|\\[\x20-\x7e])*"|[!#$%&'*+.0-9A-Z^_`a-z|~-]+)[\x09\x20]*/g;
		var EXT_VALUE_REGEXP = /^([A-Za-z0-9!#$%&+\-^_`{}~]+)'(?:[A-Za-z]{2,3}(?:-[A-Za-z]{3}){0,3}|[A-Za-z]{4,8}|)'((?:%[0-9A-Fa-f]{2}|[A-Za-z0-9!#$&+.^_`|~-])+)$/;
		var QESC_REGEXP = /\\([\u0000-\u007f])/g;

		var string = d.responseHeaders[id].value;

		var key;
		var value;

		var match = PARAM_REGEXP.exec(string);
		if (!match) {
			fileName = getFileNameURL(d.url);
			return fileName;
		}

		key = match[1].toLowerCase();
		value = match[2];

		if (key.indexOf('*') + 1 === key.length) {
			var match = EXT_VALUE_REGEXP.exec(value)
			if (!match) {
				fileName = getFileNameURL(d.url);
				return fileName;
			}
			else {
				value = match[2];
			}
		}

		if (value[0] === '"') {
			// remove quotes and escapes
			value = value.substr(1, value.length - 2).replace(QESC_REGEXP, '$1');
		}
		fileName = value;

	}
	else {
		fileName = getFileNameURL(d.url);
	}
	return fileName;
}

function getFileNameURL(url) {
	var fileName = "";
	var id = url.lastIndexOf("/");
	if (id >= 0) {
		var id1 = url.lastIndexOf("?");
		if (id1 == -1) {
			fileName = url.slice(id + 1);
		}
		else {
			fileName = url.slice(id + 1, id1);
		}
	}
	return fileName;
}

function getFileSize(d){
	var fileSize = "";
	var id = 0;
	id = d.responseHeaders.findIndex(x => x.name.toLowerCase() === "content-length");
	if (id >= 0) {
		fileSize = humanFileSize(d.responseHeaders[id].value, true);
	}
	return fileSize;
}

function getRequestHeaders(d, ua) {
	// create header
	var id1;
	var requestHeaders = [];
	if (ua){
		var getheader = ['Referer', 'Cookie', 'Cookie2', 'Authorization', 'User-Agent'];
	}
	else {
		var getheader = ['Referer', 'Cookie', 'Cookie2', 'Authorization'];
	}
	for (var i = 0; i < getheader.length; i++) {
		id1 = d.requestHeaders.findIndex(x => x.name === getheader[i]);
		if (id1 >= 0) {
			requestHeaders[i] = d.requestHeaders[id1].name + ": " +
				d.requestHeaders[id1].value;
		}
	}
	return requestHeaders;
}

function isException(d) {
	// check Exception
	var id = d.responseHeaders.findIndex(x => x.name.toLowerCase() === "content-length");
	if(id != -1) {
		if(Number(d.responseHeaders[id].value) < Number(fileSizeLimit)){
			return true;
		}
	}
	var id2 = d.responseHeaders.findIndex(x => x.name.toLowerCase() === 'content-type');
	if(id2 != -1) {
		if(!RegExp(fileTypeFilterA).test(d.responseHeaders[id2].value)){
			return true;
		}
		if(!RegExp(urlFilterA).test(d.url)){
			return true;
		}
		if(fileTypeFilterB != "" && RegExp(fileTypeFilterB).test(d.responseHeaders[id2].value)){
			return true;
		}
		if(urlFilterB != "" && RegExp(urlFilterB).test(d.url)){
			return true;
		}
	}
	return false;
}

async function prepareDownload(d) {
	var details = {};
	details.url = d.url;
	
	// get request item
	var id = request.findIndex(x => x.requestId === d.requestId);
	const reqFound = { ...request[id] };
	if (id >= 0) {
		// create header
		var get = browser.storage.local.get(config.command.guess);
		await get.then(item => {
			details.requestHeaders = getRequestHeaders(reqFound, item.ua);
		});
		// delete request item
		request.splice(id, 1);
	}
	else {
		details.requestHeaders = ""
	}
	
	// process file name
	details.fileName = getFileName(d);
	
	// decode URI Component
	details.fileName = decodeURIComponent(details.fileName);

	// issue #8
	try {
		details.fileName = decodeURI(escape(details.fileName));
	} catch (e){}

	// file name cannot have ""
	details.fileName = details.fileName.replace('\";', '');
	details.fileName = details.fileName.replace('\"', '');
	details.fileName = details.fileName.replace('\"', '');
	
	// correct File Name
	var getting = correctFileName(details.fileName);
	await getting.then ((name) => {
		details.fileName = name;
		}
	);
	
	// get file size
	details.fileSize = getFileSize(d);

	// raw MIME type + byte size for the routing rules engine
	var ctId = d.responseHeaders.findIndex(x => x.name.toLowerCase() === "content-type");
	details.mime = ctId >= 0 ? d.responseHeaders[ctId].value : "";
	var clId = d.responseHeaders.findIndex(x => x.name.toLowerCase() === "content-length");
	details.sizeBytes = clId >= 0 ? Number(d.responseHeaders[clId].value) : null;

	// create download panel
	browser.storage.local.get(config.command.guess, item => {
		if (item.downPanel) {
			downloadPanel(details);
		}
		else {
			getDefaultServer().then(function (s) {
				var baseSid = s && s.id;
				var meta = buildMeta({
					url: details.url, filename: details.fileName,
					mime: details.mime, size: details.sizeBytes, baseServerId: baseSid
				});
				var res = evaluateRules(meta, rulesCache, serversCache);
				var sid = (res && res.serverId) || baseSid;
				var dir = (res && res.dir != null) ? res.dir : "";
				sendTo(details.url, details.fileName, dir, details.requestHeaders, sid);
			});
		}
	});
	
	// avoid blank new tab
	var getting = browser.tabs.query({
		active: true,
		lastFocusedWindow: true,
		//url: "about:blank", // not allowed
		windowType: "normal"
	});
	getting.then(tabsInfo => {
		if (tabsInfo[0].url == "about:blank")
			browser.tabs.remove(tabsInfo[0].id)
	}, (e) => {console.log(e);});
}

function observeRequest(d) {
	request.push(d);
}

function observeResponse(d) {
	//console.log(d.responseHeaders);
	// bug0001: goo.gl
	if (d.statusCode == 200 || aggressive) {
		if (d.responseHeaders.find(x => x.name.toLowerCase() === 'content-disposition') != undefined) {
			var contentDisposition = d.responseHeaders.find(x => x.name.toLowerCase() ===
				'content-disposition').value.toLowerCase();
			if (contentDisposition.slice(0, 10) == "attachment" || aggressive) {
				//console.log(contentDisposition);
				if (isException(d))
					return {cancel: false};
				prepareDownload(d);
				return {cancel: true};
			}
		}
		if (d.responseHeaders.find(x => x.name.toLowerCase() === 'content-type') != undefined) {
			var contentType = d.responseHeaders.find(x => x.name.toLowerCase() === 'content-type').value
				.toLowerCase();
			if (contentType.slice(0, 11) == "application" 
				&& contentType.slice(12, 15) != "pdf" 
				&& contentType.slice(12, 17) != "xhtml" 
				&& contentType.slice(12, 23) != "x-xpinstall"
				&& contentType.slice(12, 29) != "x-shockwave-flash" 
				&& contentType.slice(12, 15) != "rss"
				&& contentType.slice(12, 16) != "json" ) {
				//console.log(contentType);
				if (isException(d))
					return {cancel: false};
				prepareDownload(d);
				return {cancel: true};
			}
			else if (aggressive) {
				if (contentType.slice(0, 5) == "image" ) {
					//console.log(contentType);
					if (isException(d))
						return {cancel: false};
					prepareDownload(d);
					return {cancel: true};
				}
				else if (contentType.slice(0, 4) == "text" && contentType.slice(5, 9) != "html") {
					//console.log(contentType);
					if (isException(d))
						return {cancel: false};
					prepareDownload(d);
					return {cancel: true};
				} 
				else if (contentType.slice(0, 5) == "video") {
					//console.log(contentType);
					if (isException(d))
						return {cancel: false};
					prepareDownload(d);
					return {cancel: true};
				}
				else if (contentType.slice(0, 5) == "audio") {
					//console.log(contentType);
					if (isException(d))
						return {cancel: false};
					prepareDownload(d);
					return {cancel: true};
				}
			}	
		}
	}
	// get request item and delete
	var id = request.findIndex(x => x.requestId === d.requestId);
	if (id >= 0) {
		request.splice(id, 1);
	}
	return false;
}

function requestError (d) {
	var id = request.findIndex(x => x.requestId === d.requestId);
	if (id >= 0) {
		request.splice(id, 1);
	}
	//console.log(d.error);
	return;
}

function tabRemoved (tabId, removeInfo) {
	var id = request.findIndex(x => x.tabId === tabId);
	while (id >= 0) {
		request.splice(id, 1);
		id = request.findIndex(x => x.tabId === tabId);
		//console.log("removed");
	}
	//console.log(tabId);
	return;
}

function changeState(enabled) {
	if (enabled) {
		var types = ["main_frame", "sub_frame"]
		browser.webRequest.onSendHeaders.addListener(observeRequest, {
			urls: ["<all_urls>"],
			types: types
		}, ["requestHeaders"]);
		browser.webRequest.onHeadersReceived.addListener(observeResponse, {
			urls: ["<all_urls>"],
			types: types
		}, ["blocking", "responseHeaders"]);
		browser.webRequest.onErrorOccurred.addListener(requestError, {
			urls: ["<all_urls>"],
			types: types
		});
		browser.tabs.onRemoved.addListener(tabRemoved);
		browser.storage.local.set({
			enabled: true
		});
		
	}
	else {
		browser.webRequest.onHeadersReceived.removeListener(observeResponse);
		browser.webRequest.onSendHeaders.removeListener(observeRequest);
		browser.webRequest.onErrorOccurred.removeListener(requestError);
		browser.tabs.onRemoved.removeListener(tabRemoved);
		request.splice(0, request.length);
		browser.storage.local.set({
			enabled: false
		});
	}
	browser.browserAction.setIcon({
		path: {
			'16': 'data/icons/' + (enabled ? '' : 'disabled/') + '16.png',
			'32': 'data/icons/' + (enabled ? '' : 'disabled/') + '32.png',
			'64': 'data/icons/' + (enabled ? '' : 'disabled/') + '64.png',
			'128': 'data/icons/' + (enabled ? '' : 'disabled/') + '128.png',
			'256': 'data/icons/' + (enabled ? '' : 'disabled/') + '256.png',
		}
	});
	browser.browserAction.setTitle({
		title: browser.i18n.getMessage("extensionName") + 
		` "${enabled ? browser.i18n.getMessage("enabled") : browser.i18n.getMessage("disabled")}"`
	});
}
function cmCallback (info, tab) {
	var id = info.menuItemId;
	var serverId = null;
	if (id.indexOf('dl:') === 0 || id.indexOf('dv:') === 0) serverId = id.slice(3);

	var isVideo = (info.parentMenuItemId === 'open-video' || id === 'open-video' || id.indexOf('dv:') === 0);
	var url = isVideo ? info.srcUrl : info.linkUrl;
	if (!url) {
		notify(browser.i18n.getMessage("error_notSupported"));
		return;
	}

	function dispatch(requestHeaders) {
		var d = {
			url: url,
			fileName: getFileNameURL(url),
			fileSize: "",
			requestHeaders: requestHeaders
		};
		browser.storage.local.get(config.command.guess, function (item) {
			if (item.cmDownPanel) {
				downloadPanel(d);
			} else {
				(serverId ? Promise.resolve(serverId) : getDefaultServer().then(function (s) { return s && s.id; }))
					.then(function (baseSid) {
						var meta = buildMeta({
							url: url, filename: getFileNameURL(url),
							mime: "", size: null, baseServerId: baseSid
						});
						// an explicit dl:/dv: context-menu server choice wins over a rule's server
						// override; a matching rule may still set the folder (resolved against the
						// chosen server, which is baseSid here).
						var res = evaluateRules(meta, rulesCache, serversCache,
							serverId ? { lockServerId: serverId } : null);
						var sid = serverId || (res && res.serverId) || baseSid;
						var dir = (res && res.dir != null) ? res.dir : "";
						sendTo(url, "", dir, requestHeaders, sid);
					});
			}
		});
	}

	browser.cookies.getAll({ url: url }).then(function (cookies) {
		var requestHeaders = [];
		requestHeaders[0] = ("Referer: " + info.pageUrl + "\"");
		requestHeaders[1] = ("Cookie: ");
		for (var i = 0; i < cookies.length; i++) {
			requestHeaders[1] += cookies[i].name + "=" + cookies[i].value + "; ";
		}
		dispatch(requestHeaders);
	}, function () {
		var requestHeaders = "[\"Referer: " + info.pageUrl + "\"]";
		dispatch(requestHeaders);
	});
}
function contextMenus (enabled, cmDownPanel){
	function build(servers) {
		browser.contextMenus.removeAll();
		browser.contextMenus.onClicked.removeListener(cmCallback);
		if (!enabled) return;

		var cmTitle = browser.i18n.getMessage("CM_title");
		browser.contextMenus.create({
			id: 'open-link', title: cmTitle, contexts: ['link'], documentUrlPatterns: ['*://*/*']
		});
		browser.contextMenus.create({
			id: 'open-video', title: cmTitle, contexts: ['video', 'audio'], documentUrlPatterns: ['*://*/*']
		});

		if (!cmDownPanel && servers.length > 1) {
			servers.forEach(function (s) {
				var title = (s.name && s.name.trim()) || (s.host + ":" + s.port);
				browser.contextMenus.create({
					id: 'dl:' + s.id, title: title, contexts: ['link'],
					parentId: 'open-link', documentUrlPatterns: ['*://*/*']
				});
				browser.contextMenus.create({
					id: 'dv:' + s.id, title: title, contexts: ['video', 'audio'],
					parentId: 'open-video', documentUrlPatterns: ['*://*/*']
				});
			});
		}

		browser.contextMenus.onClicked.addListener(cmCallback);
	}

	getServers().then(build, function (e) { console.log("contextMenus", e); build([]); });
}

(function(callback) {
	browser.runtime.onInstalled.addListener(callback);
	//browser.runtime.onStartup.addListener(callback);
})(function(d) {
	browser.storage.local.get("initialize", item => {
		if(item.initialize == undefined) {
			browser.runtime.openOptionsPage();
			changeState(true);
			browser.storage.local.set({
				initialize: false,
				rules: []
			});
		}
		else {
			browser.storage.local.get(config.command.guess, item => {
				if (d.reason == "update" && item.chgLog == true){
					browser.tabs.create({
						url: "https://github.com/onyxhat/Aria2-Integration-NG/blob/master/CHANGELOG.md"
					});
				}
			});
		}
	});
	
});

function loadSettings() {
	browser.storage.local.get(config.command.guess, (item) => {
		aggressive = item.aggressive;
		contextMenus(item.menu, item.cmDownPanel);
		fileSizeLimit = item.fileSizeLimit;
		fileTypeFilterA = item.typeFilterA;
		urlFilterA = item.urlFilterA;
		fileTypeFilterB = item.typeFilterB;
		urlFilterB = item.urlFilterB;
	});
	// `rules` / `servers` live outside config.command.guess — refresh their caches
	// so evaluateRules() stays synchronous on the download hot path.
	getRules().then(function (r) { rulesCache = r; });
	getServers().then(function (s) { serversCache = s; });
}

(function() {
	runMigration().catch(function (e) { console.log("migration error", e); }).then(function () {
		browser.storage.local.get("enabled", function(item) {
			changeState(item.enabled);
		});
		browser.browserAction.setBadgeBackgroundColor({color: [0,0,0,100]});
		loadSettings();
		browser.runtime.onMessage.addListener(handleMessage);
	});
})();


