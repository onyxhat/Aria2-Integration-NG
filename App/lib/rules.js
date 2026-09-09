
'use strict';

///////////////////////////////////////////////////////////////////////////
// Download routing rules engine.                                         //
//                                                                       //
// A user-configurable, ordered list of rules. Each rule matches on       //
// attributes of a download; on the first enabled match it overrides the  //
// target RPC server and/or the destination folder. No match => the       //
// caller's own server / folder choice is kept unchanged.                 //
//                                                                       //
// evaluateRules() is pure and synchronous — the background caches the    //
// `rules` and `servers` lists and passes them in. Storage helpers and a  //
// CommonJS export shim (inert in the extension) live at the bottom.      //
///////////////////////////////////////////////////////////////////////////

var RULE_FIELDS = [
	{ key: 'url', type: 'string' },
	{ key: 'host', type: 'string' },
	{ key: 'path', type: 'string' },
	{ key: 'filename', type: 'string' },
	{ key: 'ext', type: 'string' },
	{ key: 'mime', type: 'string' },
	{ key: 'size', type: 'number' },
];

var RULE_STRING_OPS = ['contains', 'notContains', 'equals', 'startsWith', 'endsWith', 'inList', 'regex'];
var RULE_NUMBER_OPS = ['gt', 'gte', 'lt', 'lte', 'eq'];

var RULE_DEFAULTS = {
	name: '', enabled: true, match: 'all',
	conditions: [],
	action: { serverId: '', folderMode: 'off', folder: '' },
};

function newRuleId() {
	return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function fieldType(key) {
	for (var i = 0; i < RULE_FIELDS.length; i++) {
		if (RULE_FIELDS[i].key === key) return RULE_FIELDS[i].type;
	}
	return null;
}

// "100MB" / "1.5 GiB" / "500000" / 500000  ->  bytes (base 1024 for every unit).
// Unparseable -> NaN (callers treat NaN as "no match" / "invalid").
function parseHumanSize(v) {
	if (typeof v === 'number') return isFinite(v) ? v : NaN;
	var s = String(v == null ? '' : v).replace(/[,\s]/g, '');
	var m = /^([0-9]*\.?[0-9]+)([a-zA-Z]*)$/.exec(s);
	if (!m) return NaN;
	var num = parseFloat(m[1]);
	var unit = m[2].toLowerCase().replace(/i?b$/, '');
	var mult = { '': 1, k: 1024, m: 1048576, g: 1073741824, t: 1099511627776, p: 1125899906842624 };
	if (!Object.prototype.hasOwnProperty.call(mult, unit)) return NaN;
	return Math.round(num * mult[unit]);
}

function basename(p) {
	p = String(p || '');
	var i = p.lastIndexOf('/');
	return i >= 0 ? p.slice(i + 1) : p;
}

// Extension without the dot, lowercased. "" for a dotless name or a dotfile.
function extensionOf(name) {
	name = String(name || '');
	var i = name.lastIndexOf('.');
	if (i <= 0) return '';
	return name.slice(i + 1).toLowerCase();
}

// Normalise the raw pieces gathered at a download's entry point into the shape
// evaluateRules() consumes. `mime` / `size` are unknown on the context-menu path
// (pass "" / null); conditions on them then simply never match there.
function buildMeta(input) {
	input = input || {};
	var url = input.url == null ? '' : String(input.url);
	var host = '';
	var path = '';
	try {
		var u = new URL(url);
		host = (u.hostname || '').toLowerCase();
		path = u.pathname || '';
	} catch (e) { /* unparseable — leave host/path empty */ }

	var filename = input.filename == null ? '' : String(input.filename);
	var ext = extensionOf(filename) || extensionOf(basename(path));

	var mime = String(input.mime == null ? '' : input.mime).toLowerCase().split(';')[0].trim();

	var size = null;
	if (input.size != null && input.size !== '' && isFinite(Number(input.size))) {
		size = Math.trunc(Number(input.size));
	}

	return {
		url: url, host: host, path: path, filename: filename, ext: ext,
		mime: mime, size: size, baseServerId: input.baseServerId || '',
	};
}

// ---- condition matching -------------------------------------------------------

function matchString(attrRaw, op, rawValue) {
	if (attrRaw === '' || attrRaw == null) return false; // unknown attribute never matches
	var attr = String(attrRaw).toLowerCase();
	var v = String(rawValue == null ? '' : rawValue);
	var lv = v.toLowerCase();
	switch (op) {
		case 'contains': return attr.indexOf(lv) !== -1;
		case 'notContains': return attr.indexOf(lv) === -1;
		case 'equals': return attr === lv;
		case 'startsWith': return attr.lastIndexOf(lv, 0) === 0;
		case 'endsWith': return lv === '' ? true : attr.slice(-lv.length) === lv;
		case 'inList':
			return v.split(/[,\n]/).map(function (t) { return t.trim().toLowerCase(); })
				.filter(function (t) { return t !== ''; })
				.indexOf(attr) !== -1;
		case 'regex':
			try { return new RegExp(v, 'i').test(String(attrRaw)); } catch (e) { return false; }
		default: return false;
	}
}

function matchNumber(size, op, rawValue) {
	if (size == null) return false;
	var target = parseHumanSize(rawValue);
	if (!isFinite(target)) return false;
	switch (op) {
		case 'gt': return size > target;
		case 'gte': return size >= target;
		case 'lt': return size < target;
		case 'lte': return size <= target;
		case 'eq': return size === target;
		default: return false;
	}
}

function matchCondition(meta, c) {
	if (!c || typeof c.field !== 'string') return false;
	var type = fieldType(c.field);
	if (type === 'string') return matchString(meta[c.field], c.op, c.value);
	if (type === 'number') return matchNumber(meta.size, c.op, c.value);
	return false;
}

function everyCondition(meta, conds) {
	for (var i = 0; i < conds.length; i++) if (!matchCondition(meta, conds[i])) return false;
	return true;
}

function someCondition(meta, conds) {
	for (var i = 0; i < conds.length; i++) if (matchCondition(meta, conds[i])) return true;
	return false;
}

// ---- folder resolution ------------------------------------------------------

function resolveDir(rule, effServer) {
	var action = (rule && rule.action) || {};
	var mode = action.folderMode;
	var folder = action.folder == null ? '' : String(action.folder);
	if (mode === 'absolute') {
		return folder === '' ? null : folder;
	}
	if (mode === 'append') {
		if (folder === '') return null;
		var base = (effServer && effServer.path != null) ? String(effServer.path) : '';
		base = base.replace(/[\/\\]+$/, '');
		var sub = folder.replace(/^[\/\\]+/, '');
		return base === '' ? sub : base + '/' + sub;
	}
	return null; // "off" or anything unrecognised
}

// ---- the engine -----------------------------------------------------------

// evaluateRules(meta, rules, servers) -> { serverId, dir } | null
//   serverId: a server uuid to switch to, or null (keep the caller's server)
//   dir:      a destination path string, or null (keep the caller's folder)
function evaluateRules(meta, rules, servers) {
	if (!Array.isArray(rules)) return null;
	var svs = Array.isArray(servers) ? servers : [];
	meta = meta || {};

	for (var i = 0; i < rules.length; i++) {
		var r = rules[i];
		if (!r || r.enabled === false) continue;
		if (!Array.isArray(r.conditions) || r.conditions.length === 0) continue;

		var mode = r.match === 'any' ? 'any' : 'all';
		var ok = mode === 'any'
			? someCondition(meta, r.conditions)
			: everyCondition(meta, r.conditions);
		if (!ok) continue;

		var overrideId = (r.action && r.action.serverId) || '';
		var validOverride = !!overrideId && svs.some(function (s) { return s && s.id === overrideId; });
		var effId = validOverride ? overrideId : (meta.baseServerId || '');
		var effServer = null;
		for (var j = 0; j < svs.length; j++) {
			if (svs[j] && svs[j].id === effId) { effServer = svs[j]; break; }
		}

		return { serverId: validOverride ? overrideId : null, dir: resolveDir(r, effServer) };
	}
	return null;
}

// ---- validation ----------------------------------------------------------

// Returns literal English strings (rendered raw by the options page, asserted on
// by the tests) — same convention as validateServers() in tools.js.
// `servers` is optional; when omitted the target-server existence check is skipped.
function validateRules(rules, servers) {
	if (!Array.isArray(rules)) return ['Rules must be a list.'];
	var checkServers = Array.isArray(servers);
	var errors = [];

	rules.forEach(function (r, i) {
		var label = (r && r.name && String(r.name).trim()) || ('Rule ' + (i + 1));
		if (!r || typeof r !== 'object') { errors.push(label + ': invalid rule.'); return; }

		if (!Array.isArray(r.conditions) || r.conditions.length === 0) {
			errors.push(label + ': add at least one condition.');
		} else {
			r.conditions.forEach(function (c) {
				var type = (c && typeof c.field === 'string') ? fieldType(c.field) : null;
				if (!type) { errors.push(label + ': unknown match field.'); return; }
				var ops = type === 'number' ? RULE_NUMBER_OPS : RULE_STRING_OPS;
				if (ops.indexOf(c.op) === -1) { errors.push(label + ': operator not valid for that field.'); return; }
				var val = c.value == null ? '' : String(c.value);
				if (val.trim() === '') { errors.push(label + ': condition value is empty.'); return; }
				if (c.op === 'regex') {
					try { new RegExp(val, 'i'); } catch (e) { errors.push(label + ': invalid regular expression: ' + val); }
				}
				if (type === 'number' && !isFinite(parseHumanSize(val))) {
					errors.push(label + ': "' + val + '" is not a valid size.');
				}
			});
		}

		var action = (r && r.action) || {};
		var mode = action.folderMode;
		if (['off', 'absolute', 'append'].indexOf(mode) === -1) {
			errors.push(label + ': invalid folder mode.');
		} else if ((mode === 'absolute' || mode === 'append') &&
			String(action.folder == null ? '' : action.folder).trim() === '') {
			errors.push(label + ': enter a folder or set folder to "Do not change".');
		}

		if (checkServers && action.serverId &&
			!servers.some(function (s) { return s && s.id === action.serverId; })) {
			errors.push(label + ': target server no longer exists.');
		}
	});

	return errors;
}

// ---- storage helpers (Promise-returning; browser.storage.local) -------------

function getRules() {
	return browser.storage.local.get('rules').then(function (item) {
		return Array.isArray(item.rules) ? item.rules : [];
	});
}

function saveRules(rules) {
	return browser.storage.local.set({ rules: rules });
}

// ---- CommonJS export shim — no effect in the extension (no `module`) --------

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		RULE_FIELDS: RULE_FIELDS,
		RULE_STRING_OPS: RULE_STRING_OPS,
		RULE_NUMBER_OPS: RULE_NUMBER_OPS,
		RULE_DEFAULTS: RULE_DEFAULTS,
		newRuleId: newRuleId,
		fieldType: fieldType,
		parseHumanSize: parseHumanSize,
		buildMeta: buildMeta,
		evaluateRules: evaluateRules,
		validateRules: validateRules,
		getRules: getRules,
		saveRules: saveRules,
	};
}
