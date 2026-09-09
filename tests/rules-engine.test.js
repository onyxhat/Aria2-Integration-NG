'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeBrowserStub } = require('./helpers/browser-stub');

// rules.js reads the global `browser` at call time (storage helpers only).
global.browser = makeBrowserStub();
const R = require('../App/lib/rules.js');

function loadRulesWith(initial) {
	global.browser = makeBrowserStub(initial);
	delete require.cache[require.resolve('../App/lib/rules.js')];
	return require('../App/lib/rules.js');
}

// ---- fixtures -------------------------------------------------------------

const SERVERS = [
	{ id: 's1', path: '/base' },
	{ id: 's2', path: '/srv2' },
	{ id: 's3', path: '' },
];

function meta(over) {
	return Object.assign({
		url: 'https://h.example.com/a/b/file.iso?x=1',
		host: 'h.example.com',
		path: '/a/b/file.iso',
		filename: 'file.iso',
		ext: 'iso',
		mime: 'application/x-iso9660-image',
		size: 734003200,
		baseServerId: 's1',
	}, over || {});
}

function rule(over) {
	const r = Object.assign({
		id: 'r1', name: '', enabled: true, match: 'all',
		conditions: [{ field: 'host', op: 'contains', value: 'example.com' }],
		action: { serverId: '', folderMode: 'off', folder: '' },
	}, over || {});
	if (over && over.action) r.action = Object.assign({ serverId: '', folderMode: 'off', folder: '' }, over.action);
	return r;
}

const ev = (m, rules, servers) => R.evaluateRules(m, rules, servers === undefined ? SERVERS : servers);

// ---- evaluateRules: guards ---------------------------------------------------

test('evaluateRules: no rules / non-array rules => null', () => {
	assert.equal(ev(meta(), []), null);
	assert.equal(ev(meta(), undefined), null);
	assert.equal(ev(meta(), null), null);
});

test('evaluateRules: no matching rule => null', () => {
	assert.equal(ev(meta(), [rule({ conditions: [{ field: 'host', op: 'equals', value: 'other.com' }] })]), null);
});

// ---- evaluateRules: string operators --------------------------------------

test('contains — case-insensitive substring, both directions', () => {
	assert.ok(ev(meta({ host: 'h.EXAMPLE.com' }), [rule({ conditions: [{ field: 'host', op: 'contains', value: 'example' }], action: { serverId: 's2' } })]));
	assert.equal(ev(meta(), [rule({ conditions: [{ field: 'host', op: 'contains', value: 'nope' }] })]), null);
});

test('notContains — true when absent, false when present, false when attribute unknown', () => {
	assert.ok(ev(meta(), [rule({ conditions: [{ field: 'host', op: 'notContains', value: 'zzz' }], action: { serverId: 's2' } })]));
	assert.equal(ev(meta(), [rule({ conditions: [{ field: 'host', op: 'notContains', value: 'example' }] })]), null);
	// unknown mime must NOT satisfy notContains
	assert.equal(ev(meta({ mime: '' }), [rule({ conditions: [{ field: 'mime', op: 'notContains', value: 'zip' }] })]), null);
});

test('equals — exact only', () => {
	assert.ok(ev(meta(), [rule({ conditions: [{ field: 'host', op: 'equals', value: 'H.Example.com' }], action: { serverId: 's2' } })]));
	assert.equal(ev(meta(), [rule({ conditions: [{ field: 'host', op: 'equals', value: 'example.com' }] })]), null);
});

test('startsWith / endsWith', () => {
	assert.ok(ev(meta(), [rule({ conditions: [{ field: 'path', op: 'startsWith', value: '/a/b' }], action: { serverId: 's2' } })]));
	assert.equal(ev(meta(), [rule({ conditions: [{ field: 'path', op: 'startsWith', value: '/z' }] })]), null);
	assert.ok(ev(meta(), [rule({ conditions: [{ field: 'filename', op: 'endsWith', value: '.ISO' }], action: { serverId: 's2' } })]));
	assert.equal(ev(meta(), [rule({ conditions: [{ field: 'filename', op: 'endsWith', value: '.zip' }] })]), null);
});

test('inList — comma / newline separated, trimmed, any token', () => {
	assert.ok(ev(meta({ ext: 'iso' }), [rule({ conditions: [{ field: 'ext', op: 'inList', value: 'zip, iso ,dmg' }], action: { serverId: 's2' } })]));
	assert.ok(ev(meta({ ext: 'dmg' }), [rule({ conditions: [{ field: 'ext', op: 'inList', value: 'zip\niso\ndmg' }], action: { serverId: 's2' } })]));
	assert.equal(ev(meta({ ext: 'png' }), [rule({ conditions: [{ field: 'ext', op: 'inList', value: 'zip, iso, dmg' }] })]), null);
});

test('regex — valid matches; invalid pattern never matches and never throws', () => {
	assert.ok(ev(meta(), [rule({ conditions: [{ field: 'filename', op: 'regex', value: '\\.iso$' }], action: { serverId: 's2' } })]));
	assert.doesNotThrow(() => ev(meta(), [rule({ conditions: [{ field: 'filename', op: 'regex', value: '(' }] })]));
	assert.equal(ev(meta(), [rule({ conditions: [{ field: 'filename', op: 'regex', value: '(' }] })]), null);
});

test('unknown string attribute never matches, for every operator', () => {
	for (const op of ['contains', 'equals', 'startsWith', 'endsWith', 'inList', 'regex']) {
		assert.equal(ev(meta({ mime: '' }), [rule({ conditions: [{ field: 'mime', op, value: 'x' }] })]), null, op);
	}
});

// ---- evaluateRules: number operator (size) --------------------------------

test('size — gt / gte / lt / lte / eq boundaries', () => {
	const big = meta({ size: 200 * 1024 * 1024 });
	assert.ok(ev(big, [rule({ conditions: [{ field: 'size', op: 'gt', value: '100MB' }], action: { serverId: 's2' } })]));
	assert.equal(ev(meta({ size: 50 * 1024 * 1024 }), [rule({ conditions: [{ field: 'size', op: 'gt', value: '100MB' }] })]), null);
	assert.ok(ev(meta({ size: 100 * 1024 * 1024 }), [rule({ conditions: [{ field: 'size', op: 'gte', value: '100MB' }], action: { serverId: 's2' } })]));
	assert.ok(ev(meta({ size: 100 * 1024 * 1024 }), [rule({ conditions: [{ field: 'size', op: 'lte', value: '100MB' }], action: { serverId: 's2' } })]));
	assert.equal(ev(meta({ size: 100 * 1024 * 1024 }), [rule({ conditions: [{ field: 'size', op: 'lt', value: '100MB' }] })]), null);
	assert.ok(ev(meta({ size: 500000 }), [rule({ conditions: [{ field: 'size', op: 'eq', value: '500000' }], action: { serverId: 's2' } })]));
});

test('size — unknown size (null) fails every op; unparseable target fails', () => {
	assert.equal(ev(meta({ size: null }), [rule({ conditions: [{ field: 'size', op: 'gt', value: '1MB' }] })]), null);
	assert.equal(ev(meta({ size: 10 }), [rule({ conditions: [{ field: 'size', op: 'gt', value: 'banana' }] })]), null);
});

// ---- parseHumanSize -----------------------------------------------------------

test('parseHumanSize — units are base 1024; bare numbers pass; junk => NaN', () => {
	assert.equal(R.parseHumanSize('1KB'), 1024);
	assert.equal(R.parseHumanSize('1MB'), 1048576);
	assert.equal(R.parseHumanSize('1.5MB'), 1572864);
	assert.equal(R.parseHumanSize('2 GiB'), 2147483648);
	assert.equal(R.parseHumanSize('500000'), 500000);
	assert.equal(R.parseHumanSize(500000), 500000);
	assert.ok(Number.isNaN(R.parseHumanSize('banana')));
	assert.ok(Number.isNaN(R.parseHumanSize('')));
});

// ---- evaluateRules: rule-level semantics --------------------------------------

test('match "all" vs "any"', () => {
	const conds = [{ field: 'host', op: 'equals', value: 'nope' }, { field: 'ext', op: 'equals', value: 'iso' }];
	assert.ok(ev(meta(), [rule({ match: 'any', conditions: conds, action: { serverId: 's2' } })]));
	assert.equal(ev(meta(), [rule({ match: 'all', conditions: conds })]), null);
});

test('unknown match mode is treated as "all"', () => {
	const conds = [{ field: 'host', op: 'contains', value: 'example' }, { field: 'ext', op: 'equals', value: 'nope' }];
	assert.equal(ev(meta(), [rule({ match: 'garbage', conditions: conds })]), null);
});

test('first enabled matching rule wins', () => {
	const a = rule({ id: 'a', conditions: [{ field: 'host', op: 'contains', value: 'example' }], action: { serverId: 's2' } });
	const b = rule({ id: 'b', conditions: [{ field: 'host', op: 'contains', value: 'example' }], action: { serverId: 's3' } });
	assert.equal(ev(meta(), [a, b]).serverId, 's2');
});

test('disabled rule is skipped', () => {
	const a = rule({ id: 'a', enabled: false, conditions: [{ field: 'host', op: 'contains', value: 'example' }], action: { serverId: 's2' } });
	const b = rule({ id: 'b', conditions: [{ field: 'host', op: 'contains', value: 'example' }], action: { serverId: 's3' } });
	assert.equal(ev(meta(), [a, b]).serverId, 's3');
});

test('rule with empty conditions is skipped, next rule still evaluated', () => {
	const a = rule({ id: 'a', conditions: [] });
	const b = rule({ id: 'b', conditions: [{ field: 'host', op: 'contains', value: 'example' }], action: { serverId: 's2' } });
	assert.equal(ev(meta(), [a, b]).serverId, 's2');
});

test('opts.lockServerId — rule server override ignored; folder resolves against the locked server', () => {
	const r = rule({ action: { serverId: 's2', folderMode: 'append', folder: 'isos' } });
	// no lock: append resolves against the override server s2
	assert.deepEqual(
		R.evaluateRules(meta({ baseServerId: 's1' }), [r], SERVERS),
		{ serverId: 's2', dir: '/srv2/isos' }
	);
	// locked to s1 (an explicit context-menu pick): serverId null, folder against s1
	assert.deepEqual(
		R.evaluateRules(meta({ baseServerId: 's1' }), [r], SERVERS, { lockServerId: 's1' }),
		{ serverId: null, dir: '/base/isos' }
	);
});

test('server override to a deleted server falls back to null; folder action still applies', () => {
	const r = rule({ action: { serverId: 'ghost', folderMode: 'append', folder: 'x' } });
	const out = R.evaluateRules(meta({ baseServerId: 's1' }), [r], [{ id: 's1', path: '/base' }]);
	assert.equal(out.serverId, null);
	assert.equal(out.dir, '/base/x');
});

// ---- evaluateRules: folder resolution ---------------------------------------

test('folderMode "off" => dir null', () => {
	assert.equal(ev(meta(), [rule({ action: { serverId: 's2', folderMode: 'off' } })]).dir, null);
});

test('folderMode "absolute" => folder verbatim, no escaping', () => {
	assert.equal(ev(meta(), [rule({ action: { folderMode: 'absolute', folder: 'D:\\ISO' } })]).dir, 'D:\\ISO');
	assert.equal(ev(meta(), [rule({ action: { folderMode: 'absolute', folder: '' } })]).dir, null);
});

test('folderMode "append" — join against effective server path, normalise slashes', () => {
	assert.equal(ev(meta(), [rule({ action: { serverId: 's2', folderMode: 'append', folder: 'iso' } })]).dir, '/srv2/iso');
	assert.equal(ev(meta({ baseServerId: 's1' }), [rule({ action: { folderMode: 'append', folder: 'iso' } })]).dir, '/base/iso');
	assert.equal(ev(meta({ baseServerId: 's3' }), [rule({ action: { folderMode: 'append', folder: 'iso' } })]).dir, 'iso');
	assert.equal(
		ev(meta({ baseServerId: 's1' }), [rule({ action: { folderMode: 'append', folder: '/iso' } })], [{ id: 's1', path: '/base/' }]).dir,
		'/base/iso'
	);
});

test('result shape — server-only vs folder-only override', () => {
	assert.deepEqual(ev(meta(), [rule({ action: { serverId: 's2', folderMode: 'off' } })]), { serverId: 's2', dir: null });
	assert.deepEqual(ev(meta(), [rule({ action: { serverId: '', folderMode: 'absolute', folder: '/x' } })]), { serverId: null, dir: '/x' });
});

test('context-menu meta (mime "", size null) — ext/host/url rules still match, mime/size rules do not', () => {
	const cm = meta({ mime: '', size: null });
	assert.ok(ev(cm, [rule({ conditions: [{ field: 'ext', op: 'equals', value: 'iso' }], action: { serverId: 's2' } })]));
	assert.equal(ev(cm, [rule({ conditions: [{ field: 'mime', op: 'contains', value: 'iso' }] })]), null);
	assert.equal(ev(cm, [rule({ conditions: [{ field: 'size', op: 'gt', value: '1MB' }] })]), null);
});

// ---- buildMeta -------------------------------------------------------------

test('buildMeta — host/path from full URL, host lowercased', () => {
	const m = R.buildMeta({ url: 'https://Foo.Example.COM/x/y/z.bin?q=1' });
	assert.equal(m.host, 'foo.example.com');
	assert.equal(m.path, '/x/y/z.bin');
});

test('buildMeta — unparseable URL yields empty host/path, no throw', () => {
	assert.doesNotThrow(() => R.buildMeta({ url: 'not a url' }));
	const m = R.buildMeta({ url: 'not a url' });
	assert.equal(m.host, '');
	assert.equal(m.path, '');
});

test('buildMeta — ext from filename, then from path, else empty', () => {
	assert.equal(R.buildMeta({ url: 'http://x/a', filename: 'a.TAR.GZ' }).ext, 'gz');
	assert.equal(R.buildMeta({ url: 'http://x/a/b.zip', filename: '' }).ext, 'zip');
	assert.equal(R.buildMeta({ url: 'http://x/a/', filename: '' }).ext, '');
	assert.equal(R.buildMeta({ url: 'http://x/noext', filename: 'noext' }).ext, '');
});

test('buildMeta — mime lowercased and stripped of parameters', () => {
	assert.equal(R.buildMeta({ url: 'http://x/a', mime: 'Application/ZIP; charset=x' }).mime, 'application/zip');
	assert.equal(R.buildMeta({ url: 'http://x/a' }).mime, '');
});

test('buildMeta — size coerced to int or null', () => {
	assert.equal(R.buildMeta({ url: 'http://x/a', size: '12345' }).size, 12345);
	assert.equal(R.buildMeta({ url: 'http://x/a', size: 734003200 }).size, 734003200);
	assert.equal(R.buildMeta({ url: 'http://x/a', size: '' }).size, null);
	assert.equal(R.buildMeta({ url: 'http://x/a', size: 'abc' }).size, null);
	assert.equal(R.buildMeta({ url: 'http://x/a' }).size, null);
});

test('buildMeta — baseServerId passed through', () => {
	assert.equal(R.buildMeta({ url: 'http://x/a', baseServerId: 's9' }).baseServerId, 's9');
	assert.equal(R.buildMeta({ url: 'http://x/a' }).baseServerId, '');
});

// ---- validateRules ---------------------------------------------------------

test('validateRules — empty list is valid; non-array is one error', () => {
	assert.deepEqual(R.validateRules([]), []);
	assert.equal(R.validateRules('nope').length, 1);
});

test('validateRules — flags structural problems', () => {
	assert.match(R.validateRules([rule({ conditions: [] })])[0], /add at least one condition/);
	assert.match(R.validateRules([rule({ conditions: [{ field: 'nope', op: 'contains', value: 'x' }] })])[0], /unknown match field/);
	assert.match(R.validateRules([rule({ conditions: [{ field: 'size', op: 'contains', value: '1' }] })])[0], /operator not valid/);
	assert.match(R.validateRules([rule({ conditions: [{ field: 'host', op: 'contains', value: '' }] })])[0], /value is empty/);
	assert.match(R.validateRules([rule({ conditions: [{ field: 'filename', op: 'regex', value: '(' }] })])[0], /invalid regular expression/);
	assert.match(R.validateRules([rule({ conditions: [{ field: 'size', op: 'gt', value: 'banana' }] })])[0], /is not a valid size/);
	assert.match(R.validateRules([rule({ action: { folderMode: 'absolute', folder: '' } })])[0], /enter a folder/);
	assert.match(R.validateRules([rule({ action: { folderMode: 'sideways', folder: '' } })])[0], /invalid folder mode/);
});

test('validateRules — folderMode "off" with empty folder is fine', () => {
	assert.deepEqual(R.validateRules([rule({ action: { folderMode: 'off', folder: '' } })]), []);
});

test('validateRules — target server existence only checked when servers passed', () => {
	assert.match(R.validateRules([rule({ action: { serverId: 'ghost', folderMode: 'off' } })], [{ id: 's1' }])[0], /target server no longer exists/);
	assert.deepEqual(R.validateRules([rule({ action: { serverId: 'ghost', folderMode: 'off' } })]), []);
});

test('validateRules — a fully valid rule passes', () => {
	const r = rule({
		name: 'ISOs',
		conditions: [{ field: 'ext', op: 'inList', value: 'iso, img' }],
		action: { serverId: 's2', folderMode: 'append', folder: 'isos' },
	});
	assert.deepEqual(R.validateRules([r], SERVERS), []);
});

// ---- storage helpers -----------------------------------------------------------

test('getRules — missing key or non-array yields []', async () => {
	assert.deepEqual(await loadRulesWith({}).getRules(), []);
	assert.deepEqual(await loadRulesWith({ rules: 'x' }).getRules(), []);
});

test('saveRules / getRules round-trip', async () => {
	const t = loadRulesWith({});
	const rules = [rule({ name: 'r', action: { serverId: 's2', folderMode: 'append', folder: 'x' } })];
	await t.saveRules(rules);
	assert.deepEqual(await t.getRules(), rules);
});
