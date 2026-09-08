'use strict';

function msg(key, fallback) {
	return browser.i18n.getMessage(key) || fallback;
}

function flash(text) {
	var s = document.getElementById('status');
	s.textContent = text;
	setTimeout(function () { s.textContent = ''; }, 750);
}

var servers = [];

function labelFor(s) {
	return (s.name && s.name.trim()) || (s.host + ':' + s.port);
}

function buildSections() {
	var root = document.getElementById('sections');
	root.textContent = '';
	servers.forEach(function (s) {
		var h = document.createElement('h2');
		h.textContent = labelFor(s);

		var addRow = document.createElement('div');
		addRow.className = 'addRow';
		var input = document.createElement('input');
		input.type = 'text';
		input.className = 'addInput';
		input.dataset.server = s.id;
		input.placeholder = '/path/to/download/folder';
		var addBtn = document.createElement('button');
		addBtn.className = 'addBtn';
		addBtn.dataset.server = s.id;
		addBtn.textContent = msg('OP_add', 'Add');
		addRow.appendChild(input);
		addRow.appendChild(addBtn);

		var ul = document.createElement('ul');
		ul.className = 'paths';
		ul.id = 'list-' + s.id;

		var clearBtn = document.createElement('button');
		clearBtn.className = 'clearBtn';
		clearBtn.dataset.server = s.id;
		clearBtn.textContent = msg('OP_clear', 'Clear');

		root.appendChild(h);
		root.appendChild(addRow);
		root.appendChild(ul);
		root.appendChild(clearBtn);
	});
}

function render(rp) {
	servers.forEach(function (s) {
		var ul = document.getElementById('list-' + s.id);
		if (!ul) return;
		ul.textContent = '';
		var paths = rp[s.id] || [];
		if (paths.length === 0) {
			var li = document.createElement('li');
			li.className = 'empty';
			li.textContent = msg('OPN_pathHistoryEmpty', 'No saved paths');
			ul.appendChild(li);
			return;
		}
		paths.forEach(function (p) {
			var li = document.createElement('li');
			var span = document.createElement('span');
			span.textContent = p;
			span.title = p;
			var btn = document.createElement('button');
			btn.className = 'removeBtn';
			btn.textContent = '×';
			btn.title = msg('OP_remove', 'Remove');
			btn.dataset.server = s.id;
			btn.dataset.path = p;
			li.appendChild(span);
			li.appendChild(btn);
			ul.appendChild(li);
		});
	});
}

function refresh() {
	readRecentPaths().then(render);
}

function commit() {
	refresh();
	browser.runtime.sendMessage({ get: 'loadSettings' });
	flash(msg('OP_saveComplete', 'Done'));
}

function addFromInput(serverId) {
	var input = document.querySelector('.addInput[data-server="' + serverId + '"]');
	var val = (input.value || '').trim();
	if (val === '') return;
	addRecentPath(serverId, val).then(function () {
		input.value = '';
		commit();
	});
}

function onClick(ev) {
	var t = ev.target;
	if (t.classList.contains('removeBtn')) {
		removeRecentPath(t.dataset.server, t.dataset.path).then(commit);
	} else if (t.classList.contains('clearBtn')) {
		clearRecentPaths(t.dataset.server).then(commit);
	} else if (t.classList.contains('addBtn')) {
		addFromInput(t.dataset.server);
	}
}

function onKeydown(ev) {
	if (ev.key === 'Enter' && ev.target.classList.contains('addInput')) {
		ev.preventDefault();
		addFromInput(ev.target.dataset.server);
	}
}

function init() {
	document.querySelectorAll('[data-message]').forEach(function (n) {
		n.textContent = browser.i18n.getMessage(n.dataset.message);
	});
	document.body.style = 'direction: ' + browser.i18n.getMessage('direction');
	document.addEventListener('click', onClick);
	document.addEventListener('keydown', onKeydown);

	getServers().then(function (list) {
		servers = list;
		buildSections();
		refresh();
	});
}

document.addEventListener('DOMContentLoaded', init);
