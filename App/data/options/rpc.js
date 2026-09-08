'use strict';

var model = [];          // working copy: array of server objects
var defaultId = null;    // id of the default server
var openIds = {};         // which rows are expanded

function msg(key, fallback) {
	return browser.i18n.getMessage(key) || fallback;
}

function flash(text) {
	var s = document.getElementById('status');
	s.textContent = text;
	setTimeout(function () { s.textContent = ''; }, 750);
}

function labelFor(s) {
	return (s.name && s.name.trim()) || ((s.host || '') + ':' + (s.port || '')) || msg('OP_rpcDefault', 'Server');
}

var FIELDS = [
	['name', 'OP_rpcServerName', 'Name'],
	['protocol', 'OP_protocol', 'Protocol'],
	['host', 'OP_host', 'Host'],
	['port', 'OP_port', 'Port'],
	['interf', 'OP_interface', 'Interface'],
	['token', 'OP_token', 'Token'],
	['path', 'OP_defaultPath', 'Default Download Path']
];

function render() {
	var list = document.getElementById('serverList');
	list.textContent = '';

	model.forEach(function (s, idx) {
		var card = document.createElement('div');
		card.className = 'server' + (openIds[s.id] ? ' open' : '');

		var row = document.createElement('div');
		row.className = 'row';

		var radio = document.createElement('input');
		radio.type = 'radio';
		radio.name = 'defaultServer';
		radio.checked = (s.id === defaultId);
		radio.title = msg('OP_rpcSetDefault', 'Default');
		radio.addEventListener('change', function () { defaultId = s.id; });

		var title = document.createElement('span');
		title.className = 'title';
		title.textContent = labelFor(s);
		title.addEventListener('click', function () {
			openIds[s.id] = !openIds[s.id];
			render();
		});

		var up = document.createElement('button');
		up.className = 'mini plain';
		up.textContent = '↑';
		up.title = msg('OP_rpcMoveUp', 'Move up');
		up.disabled = (idx === 0);
		up.addEventListener('click', function () { swap(idx, idx - 1); });

		var down = document.createElement('button');
		down.className = 'mini plain';
		down.textContent = '↓';
		down.title = msg('OP_rpcMoveDown', 'Move down');
		down.disabled = (idx === model.length - 1);
		down.addEventListener('click', function () { swap(idx, idx + 1); });

		var del = document.createElement('button');
		del.className = 'mini';
		del.textContent = '×';
		del.title = msg('OP_rpcRemove', 'Remove');
		del.addEventListener('click', function () { removeRow(s.id); });

		row.appendChild(radio);
		row.appendChild(title);
		row.appendChild(up);
		row.appendChild(down);
		row.appendChild(del);
		card.appendChild(row);

		var body = document.createElement('div');
		body.className = 'body';
		var table = document.createElement('table');
		FIELDS.forEach(function (f) {
			var key = f[0], mkey = f[1], fallback = f[2];
			var tr = document.createElement('tr');
			var tdL = document.createElement('td');
			tdL.style.width = '30%';
			tdL.textContent = msg(mkey, fallback);
			var tdR = document.createElement('td');
			var inp = document.createElement('input');
			inp.type = 'text';
			inp.value = s[key] || '';
			if (key === 'name') inp.placeholder = msg('OP_rpcServerNamePlaceholder', 'optional — defaults to host:port');
			inp.addEventListener('input', function () {
				s[key] = inp.value;
				if (key === 'name' || key === 'host' || key === 'port') title.textContent = labelFor(s);
			});
			tdR.appendChild(inp);
			tr.appendChild(tdL);
			tr.appendChild(tdR);
			table.appendChild(tr);
		});
		body.appendChild(table);

		var testBtn = document.createElement('button');
		testBtn.className = 'mini';
		testBtn.style.marginTop = '8px';
		testBtn.textContent = msg('OP_rpcTest', 'Test connection');
		var testOut = document.createElement('span');
		testOut.className = 'testResult';
		testBtn.addEventListener('click', function () {
			testOut.className = 'testResult';
			testOut.textContent = '…';
			browser.runtime.sendMessage({
				get: 'testServer',
				server: { protocol: s.protocol, host: s.host, port: s.port, interf: s.interf, token: s.token }
			}).then(function (r) {
				if (r && r.ok) {
					testOut.className = 'testResult ok';
					testOut.textContent = msg('OP_rpcTestOk', 'Reachable');
				} else {
					testOut.className = 'testResult fail';
					testOut.textContent = msg('OP_rpcTestFail', 'Unreachable') + (r && r.error ? ' (' + r.error + ')' : '');
				}
			});
		});
		body.appendChild(testBtn);
		body.appendChild(testOut);

		card.appendChild(body);
		list.appendChild(card);
	});
}

function swap(a, b) {
	if (b < 0 || b >= model.length) return;
	var tmp = model[a];
	model[a] = model[b];
	model[b] = tmp;
	render();
}

function removeRow(id) {
	if (model.length <= 1) {
		showErrors([msg('OP_rpcLastServer', 'At least one server is required.')]);
		return;
	}
	if (!window.confirm(msg('OP_rpcRemoveConfirm', 'Remove this server? Its path history will be discarded.'))) return;
	model = model.filter(function (s) { return s.id !== id; });
	if (defaultId === id) defaultId = model[0].id;
	delete openIds[id];
	showErrors([]);
	render();
}

function addRow() {
	var s = Object.assign({}, SERVER_DEFAULTS, { id: newServerId() });
	model.push(s);
	openIds[s.id] = true;
	render();
}

function showErrors(errs) {
	var box = document.getElementById('errors');
	box.textContent = '';
	if (!errs.length) return;
	var ul = document.createElement('ul');
	errs.forEach(function (e) {
		var li = document.createElement('li');
		li.textContent = e;
		ul.appendChild(li);
	});
	box.appendChild(ul);
}

function save() {
	var errs = validateServers(model);
	if (!model.some(function (s) { return s.id === defaultId; })) {
		errs.push(msg('OP_rpcSetDefault', 'Default') + ': select a default server.');
	}
	if (errs.length) { showErrors(errs); return; }
	showErrors([]);

	saveServers(model.map(function (s) {
		return {
			id: s.id, name: (s.name || '').trim(), protocol: s.protocol.trim(), host: s.host.trim(),
			port: String(s.port).trim(), interf: s.interf.trim(), token: s.token, path: s.path
		};
	}))
		.then(function () { return setDefaultServer(defaultId); })
		.then(function () { return browser.storage.local.set({ initialize: true }); })
		.then(function () {
			browser.runtime.sendMessage({ get: 'loadSettings' });
			flash(msg('OP_saveComplete', 'Saved'));
		});
}

function init() {
	document.querySelectorAll('[data-message]').forEach(function (n) {
		n.textContent = browser.i18n.getMessage(n.dataset.message);
	});
	document.body.style = 'direction: ' + browser.i18n.getMessage('direction');

	Promise.all([getServers(), getDefaultServer()]).then(function (r) {
		model = r[0].map(function (s) { return Object.assign({}, s); });
		if (model.length === 0) {
			model = [Object.assign({}, SERVER_DEFAULTS, { id: newServerId() })];
		}
		defaultId = (r[1] && r[1].id) || model[0].id;
		openIds[model[0].id] = true;
		render();
	});

	document.getElementById('addServer').addEventListener('click', addRow);
	document.getElementById('save').addEventListener('click', save);
}

document.addEventListener('DOMContentLoaded', init);
