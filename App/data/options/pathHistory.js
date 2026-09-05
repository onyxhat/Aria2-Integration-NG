'use strict';

const SERVERS = ["1", "2", "3"];

function flash(msg) {
	const status = document.getElementById('status');
	status.textContent = msg;
	setTimeout(() => {
		status.textContent = '';
	}, 750);
}

function render(rp) {
	SERVERS.forEach((s) => {
		const ul = document.getElementById('list' + s);
		ul.textContent = '';
		const paths = rp[s] || [];
		if (paths.length == 0) {
			const li = document.createElement('li');
			li.className = 'empty';
			li.textContent = browser.i18n.getMessage("OPN_pathHistoryEmpty") || 'No saved paths';
			ul.appendChild(li);
			return;
		}
		paths.forEach((p) => {
			const li = document.createElement('li');
			const span = document.createElement('span');
			span.textContent = p;
			span.title = p;
			const btn = document.createElement('button');
			btn.className = 'removeBtn';
			btn.textContent = '×';
			btn.title = browser.i18n.getMessage("OP_remove") || 'Remove';
			btn.dataset.server = s;
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

function notifyBackground() {
	browser.runtime.sendMessage({ get: "loadSettings" });
}

function commit() {
	refresh();
	notifyBackground();
	flash(browser.i18n.getMessage("OP_saveComplete") || 'Done');
}

function addFromInput(server) {
	const input = document.getElementById('add' + server);
	const val = (input.value || '').trim();
	if (val == '') {
		return;
	}
	addRecentPath(server, val).then(() => {
		input.value = '';
		commit();
	});
}

function onClick(ev) {
	const t = ev.target;
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
	document.querySelectorAll('[data-message]').forEach(n => {
		n.textContent = browser.i18n.getMessage(n.dataset.message);
	});
	document.body.style = "direction: " + browser.i18n.getMessage("direction");
	document.addEventListener('click', onClick);
	document.addEventListener('keydown', onKeydown);
	refresh();
}

document.addEventListener('DOMContentLoaded', init);
