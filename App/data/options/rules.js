'use strict';

// Working copy of the rules list. Persisted only on Save (like the RPC page).
var model = [];
var openIds = {};          // which cards are expanded
var serverOptions = [];    // from getServers(), for the target-server <select>

function msg(key, fallback) {
	return browser.i18n.getMessage(key) || fallback;
}

function flash(text) {
	var s = document.getElementById('status');
	s.textContent = text;
	setTimeout(function () { s.textContent = ''; }, 750);
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

var FIELD_MSG = {
	url: ['OP_rulesFieldUrl', 'Download URL'],
	host: ['OP_rulesFieldHost', 'URL host'],
	path: ['OP_rulesFieldPath', 'URL path'],
	filename: ['OP_rulesFieldFilename', 'File name'],
	ext: ['OP_rulesFieldExt', 'File extension'],
	mime: ['OP_rulesFieldMime', 'MIME type'],
	size: ['OP_rulesFieldSize', 'File size'],
};

var OP_MSG = {
	contains: ['OP_rulesOpContains', 'contains'],
	notContains: ['OP_rulesOpNotContains', 'does not contain'],
	equals: ['OP_rulesOpEquals', 'equals'],
	startsWith: ['OP_rulesOpStartsWith', 'starts with'],
	endsWith: ['OP_rulesOpEndsWith', 'ends with'],
	inList: ['OP_rulesOpInList', 'is one of (comma-separated)'],
	regex: ['OP_rulesOpRegex', 'matches regex'],
	gt: ['OP_rulesOpGt', 'greater than'],
	gte: ['OP_rulesOpGte', 'greater than or equal'],
	lt: ['OP_rulesOpLt', 'less than'],
	lte: ['OP_rulesOpLte', 'less than or equal'],
	eq: ['OP_rulesOpEq', 'equals'],
};

function titleFor(r, idx) {
	return (r.name && r.name.trim()) || (msg('OP_rules', 'Rule') + ' ' + (idx + 1));
}

function opsForField(fieldKey) {
	return fieldType(fieldKey) === 'number' ? RULE_NUMBER_OPS : RULE_STRING_OPS;
}

function mkSelect(options, current, onChange) {
	var sel = document.createElement('select');
	options.forEach(function (o) {
		var opt = document.createElement('option');
		opt.value = o.value;
		opt.textContent = o.label;
		if (o.value === current) opt.selected = true;
		sel.appendChild(opt);
	});
	sel.addEventListener('change', function () { onChange(sel.value); });
	return sel;
}

function fieldLabel(el, mkey, fallback) {
	el.className = 'field';
	el.textContent = msg(mkey, fallback);
	return el;
}

function render() {
	var list = document.getElementById('ruleList');
	list.textContent = '';

	model.forEach(function (r, idx) {
		var card = document.createElement('div');
		card.className = 'rule' + (openIds[r.id] ? ' open' : '');

		// ---- header row ----
		var row = document.createElement('div');
		row.className = 'row' + (r.enabled === false ? ' disabled' : '');

		var chk = document.createElement('input');
		chk.type = 'checkbox';
		chk.checked = r.enabled !== false;
		chk.title = msg('OP_rulesEnabled', 'Enabled');
		chk.addEventListener('change', function () { r.enabled = chk.checked; render(); });

		var title = document.createElement('span');
		title.className = 'title';
		title.textContent = titleFor(r, idx);
		title.addEventListener('click', function () { openIds[r.id] = !openIds[r.id]; render(); });

		var up = document.createElement('button');
		up.className = 'mini plain';
		up.textContent = '↑';
		up.title = msg('OP_rulesMoveUp', 'Move up');
		up.disabled = (idx === 0);
		up.addEventListener('click', function () { swap(idx, idx - 1); });

		var down = document.createElement('button');
		down.className = 'mini plain';
		down.textContent = '↓';
		down.title = msg('OP_rulesMoveDown', 'Move down');
		down.disabled = (idx === model.length - 1);
		down.addEventListener('click', function () { swap(idx, idx + 1); });

		var del = document.createElement('button');
		del.className = 'mini';
		del.textContent = '×';
		del.title = msg('OP_rulesRemove', 'Remove rule');
		del.addEventListener('click', function () { removeRow(r.id); });

		row.appendChild(chk);
		row.appendChild(title);
		row.appendChild(up);
		row.appendChild(down);
		row.appendChild(del);
		card.appendChild(row);

		// ---- body ----
		var body = document.createElement('div');
		body.className = 'body';

		body.appendChild(fieldLabel(document.createElement('div'), 'OP_rulesRuleName', 'Name'));
		var nameIn = document.createElement('input');
		nameIn.type = 'text';
		nameIn.className = 'name-in';
		nameIn.value = r.name || '';
		nameIn.placeholder = msg('OP_rulesRuleNamePlaceholder', 'optional label');
		nameIn.addEventListener('input', function () {
			r.name = nameIn.value;
			title.textContent = titleFor(r, idx);
		});
		body.appendChild(nameIn);

		var matchSel = mkSelect([
			{ value: 'all', label: msg('OP_rulesMatchAll', 'Match ALL conditions') },
			{ value: 'any', label: msg('OP_rulesMatchAny', 'Match ANY condition') },
		], r.match === 'any' ? 'any' : 'all', function (v) { r.match = v; });
		var matchWrap = document.createElement('div');
		matchWrap.className = 'field';
		matchWrap.appendChild(matchSel);
		body.appendChild(matchWrap);

		// ---- conditions ----
		if (!Array.isArray(r.conditions)) r.conditions = [];
		r.conditions.forEach(function (c) { body.appendChild(condRow(r, c)); });

		var addCond = document.createElement('button');
		addCond.className = 'mini plain';
		addCond.textContent = msg('OP_rulesAddCondition', 'Add condition');
		addCond.addEventListener('click', function () {
			r.conditions.push({ field: 'url', op: 'contains', value: '' });
			render();
		});
		body.appendChild(addCond);

		// ---- action: target server ----
		body.appendChild(fieldLabel(document.createElement('div'), 'OP_rulesActionServer', 'Target server'));
		var serverRow = document.createElement('div');
		serverRow.className = 'action-row';
		serverRow.appendChild(mkSelect(
			[{ value: '', label: msg('OP_rulesKeepServer', 'Keep default / selected') }].concat(
				serverOptions.map(function (s) {
					return { value: s.id, label: (s.name && s.name.trim()) || (s.host + ':' + s.port) };
				})
			),
			r.action.serverId || '',
			function (v) { r.action.serverId = v; }
		));
		body.appendChild(serverRow);

		// ---- action: folder ----
		body.appendChild(fieldLabel(document.createElement('div'), 'OP_rulesFolderMode', 'Folder'));
		var folderRow = document.createElement('div');
		folderRow.className = 'action-row';

		var folderIn = document.createElement('input');
		folderIn.type = 'text';
		folderIn.value = r.action.folder || '';
		folderIn.placeholder = msg('OP_rulesFolderPlaceholder', 'e.g. D:\\Downloads\\ISO or a subfolder name');
		folderIn.disabled = !r.action.folderMode || r.action.folderMode === 'off';
		folderIn.addEventListener('input', function () { r.action.folder = folderIn.value; });

		folderRow.appendChild(mkSelect([
			{ value: 'off', label: msg('OP_rulesFolderOff', 'Do not change') },
			{ value: 'absolute', label: msg('OP_rulesFolderAbsolute', 'Set to') },
			{ value: 'append', label: msg('OP_rulesFolderAppend', 'Append to server default') },
		], r.action.folderMode || 'off', function (v) { r.action.folderMode = v; render(); }));
		folderRow.appendChild(folderIn);
		body.appendChild(folderRow);

		card.appendChild(body);
		list.appendChild(card);
	});
}

function condRow(r, c) {
	var wrap = document.createElement('div');
	wrap.className = 'condition';

	var fieldSel = mkSelect(RULE_FIELDS.map(function (f) {
		return { value: f.key, label: msg(FIELD_MSG[f.key][0], FIELD_MSG[f.key][1]) };
	}), c.field, function (v) {
		var prevType = fieldType(c.field);
		c.field = v;
		if (fieldType(v) !== prevType) c.op = opsForField(v)[0];
		render();
	});

	var opSel = mkSelect(opsForField(c.field).map(function (op) {
		return { value: op, label: msg(OP_MSG[op][0], OP_MSG[op][1]) };
	}), c.op, function (v) { c.op = v; render(); });

	var valIn = document.createElement('input');
	valIn.type = 'text';
	valIn.value = c.value || '';
	if (c.field === 'size') valIn.placeholder = msg('OP_rulesSizeHint', 'e.g. 100MB, 2GB, 500000');
	else if (c.op === 'inList') valIn.placeholder = msg('OP_rulesInListHint', 'value1, value2, value3');
	valIn.addEventListener('input', function () { c.value = valIn.value; });

	var rm = document.createElement('button');
	rm.className = 'mini';
	rm.textContent = '×';
	rm.addEventListener('click', function () {
		var i = r.conditions.indexOf(c);
		if (i >= 0) r.conditions.splice(i, 1);
		render();
	});

	wrap.appendChild(fieldSel);
	wrap.appendChild(opSel);
	wrap.appendChild(valIn);
	wrap.appendChild(rm);
	return wrap;
}

function swap(a, b) {
	if (b < 0 || b >= model.length) return;
	var tmp = model[a];
	model[a] = model[b];
	model[b] = tmp;
	render();
}

function removeRow(id) {
	if (!window.confirm(msg('OP_rulesRemoveConfirm', 'Remove this rule?'))) return;
	model = model.filter(function (r) { return r.id !== id; });
	delete openIds[id];
	showErrors([]);
	render();
}

function addRule() {
	var r = JSON.parse(JSON.stringify(RULE_DEFAULTS));
	r.id = newRuleId();
	r.conditions = [{ field: 'url', op: 'contains', value: '' }];
	model.push(r);
	openIds[r.id] = true;
	render();
}

function normalize(r) {
	r = r || {};
	if (!r.id) r.id = newRuleId();
	if (typeof r.name !== 'string') r.name = '';
	if (r.enabled === undefined) r.enabled = true;
	r.match = r.match === 'any' ? 'any' : 'all';
	if (!Array.isArray(r.conditions)) r.conditions = [];
	r.conditions = r.conditions.map(function (c) {
		c = c || {};
		return {
			field: typeof c.field === 'string' ? c.field : 'url',
			op: c.op || 'contains',
			value: c.value == null ? '' : String(c.value),
		};
	});
	var a = r.action || {};
	r.action = {
		serverId: a.serverId || '',
		folderMode: ['off', 'absolute', 'append'].indexOf(a.folderMode) !== -1 ? a.folderMode : 'off',
		folder: a.folder == null ? '' : String(a.folder),
	};
	return r;
}

function save() {
	var errs = validateRules(model, serverOptions);
	if (errs.length) { showErrors(errs); return; }
	showErrors([]);
	saveRules(model).then(function () {
		browser.runtime.sendMessage({ get: 'loadSettings' });
		flash(msg('OP_saveComplete', 'Saved'));
	});
}

function init() {
	document.querySelectorAll('[data-message]').forEach(function (n) {
		n.textContent = browser.i18n.getMessage(n.dataset.message);
	});
	document.body.style = 'direction: ' + browser.i18n.getMessage('direction');

	getServers().then(function (s) {
		serverOptions = Array.isArray(s) ? s : [];
		return getRules();
	}).then(function (r) {
		model = (Array.isArray(r) ? r : []).map(function (x) {
			return normalize(JSON.parse(JSON.stringify(x)));
		});
		if (model.length) openIds[model[0].id] = true;
		render();
	});

	document.getElementById('addRule').addEventListener('click', addRule);
	document.getElementById('save').addEventListener('click', save);
}

document.addEventListener('DOMContentLoaded', init);
