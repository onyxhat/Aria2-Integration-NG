'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeBrowserStub } = require('./helpers/browser-stub');

// tools.js reads the global `browser` at call time; set a default so require() is safe.
global.browser = makeBrowserStub();
const tools = require('../App/lib/tools.js');

// deterministic id generator for migration tests
function counter() { let n = 0; return () => 'id-' + (++n); }

// Re-require tools.js with a fresh browser stub per test (busts the require cache).
function loadToolsWith(initial) {
	global.browser = makeBrowserStub(initial);
	delete require.cache[require.resolve('../App/lib/tools.js')];
	return require('../App/lib/tools.js');
}

test('SERVER_DEFAULTS shape', () => {
	assert.deepEqual(tools.SERVER_DEFAULTS, {
		name: '', protocol: 'ws', host: '127.0.0.1', port: '6800', interf: 'jsonrpc', token: '', path: '',
	});
});

test('newServerId returns a non-empty unique string', () => {
	const a = tools.newServerId();
	const b = tools.newServerId();
	assert.equal(typeof a, 'string');
	assert.ok(a.length > 0);
	assert.notEqual(a, b);
});

test('migrateSchema: slot-1 only, no rpc2/rpc3 keys present', () => {
	const raw = {
		protocol: 'wss', host: 'box', port: '6801', interf: 'jsonrpc', token: 'sekret', path: '/dl',
		recentPaths: { '1': ['/dl', '/tmp'], '2': [], '3': [] },
		zoom: '1', // unrelated key is ignored
	};
	const out = tools.migrateSchema(raw, { makeId: counter() });
	assert.equal(out.servers.length, 1);
	assert.deepEqual(out.servers[0], {
		id: 'id-1', name: 'Default Server', protocol: 'wss', host: 'box', port: '6801',
		interf: 'jsonrpc', token: 'sekret', path: '/dl',
	});
	assert.equal(out.defaultServerId, 'id-1');
	assert.deepEqual(out.recentPaths, { 'id-1': ['/dl', '/tmp'] });
});

test('migrateSchema: all three slots configured', () => {
	const raw = {
		protocol: 'ws', host: 'h1', port: '6800', interf: 'jsonrpc', token: '', path: '',
		protocol2: 'ws', host2: 'h2', port2: '6802', interf2: 'jsonrpc', token2: 't2', path2: '/two',
		protocol3: 'wss', host3: 'h3', port3: '6803', interf3: 'rpc', token3: '', path3: '',
		recentPaths: { '1': ['/a'], '2': ['/two'], '3': [] },
	};
	const out = tools.migrateSchema(raw, { makeId: counter() });
	assert.deepEqual(out.servers.map((s) => [s.id, s.name, s.host, s.port]), [
		['id-1', 'Default Server', 'h1', '6800'],
		['id-2', 'RPC Server 2', 'h2', '6802'],
		['id-3', 'RPC Server 3', 'h3', '6803'],
	]);
	assert.deepEqual(out.recentPaths, { 'id-1': ['/a'], 'id-2': ['/two'], 'id-3': [] });
});

test('migrateSchema: gap — slot 1 and slot 3, no slot 2', () => {
	const raw = {
		host: 'h1', port: '6800', protocol: 'ws', interf: 'jsonrpc', token: '', path: '',
		host3: 'h3', port3: '6803', protocol3: 'ws', interf3: 'jsonrpc', token3: '', path3: '',
		recentPaths: { '1': [], '3': ['/three'] },
	};
	const out = tools.migrateSchema(raw, { makeId: counter() });
	assert.equal(out.servers.length, 2);
	assert.deepEqual(out.servers.map((s) => s.host), ['h1', 'h3']);
	assert.deepEqual(out.recentPaths, { 'id-1': [], 'id-2': ['/three'] });
});

test('migrateSchema: fresh install (no connection keys) yields one default server', () => {
	const out = tools.migrateSchema({}, { makeId: counter() });
	assert.equal(out.servers.length, 1);
	assert.deepEqual(
		{ ...out.servers[0], id: undefined },
		{ id: undefined, name: 'Default Server', protocol: 'ws', host: '127.0.0.1', port: '6800', interf: 'jsonrpc', token: '', path: '' },
	);
	assert.deepEqual(out.recentPaths, { 'id-1': [] });
});

test('migrateSchema: caps migrated path lists at 10', () => {
	const eleven = Array.from({ length: 11 }, (_, i) => '/p' + i);
	const out = tools.migrateSchema({ host: 'h', port: '1', protocol: 'ws', interf: 'jsonrpc', recentPaths: { '1': eleven } }, { makeId: counter() });
	assert.equal(out.recentPaths['id-1'].length, 10);
	assert.equal(out.recentPaths['id-1'][0], '/p0');
});

test('getServers / getServer / getDefaultServer', async () => {
	const t = loadToolsWith({ servers: [{ id: 'a', host: 'h1' }, { id: 'b', host: 'h2' }], defaultServerId: 'b' });
	assert.equal((await t.getServers()).length, 2);
	assert.equal((await t.getServer('b')).host, 'h2');
	assert.equal(await t.getServer('zzz'), undefined);
	assert.equal((await t.getDefaultServer()).id, 'b');
});

test('getDefaultServer falls back to first server on stale id', async () => {
	const t = loadToolsWith({ servers: [{ id: 'a' }, { id: 'b' }], defaultServerId: 'gone' });
	assert.equal((await t.getDefaultServer()).id, 'a');
	const empty = loadToolsWith({});
	assert.equal(await empty.getDefaultServer(), undefined);
});

test('saveServers prunes orphaned recentPaths keys', async () => {
	const t = loadToolsWith({ recentPaths: { a: ['/x'], b: ['/y'], c: ['/z'] } });
	await t.saveServers([{ id: 'a' }, { id: 'c' }]);
	assert.deepEqual(global.browser.storage.local._dump().recentPaths, { a: ['/x'], c: ['/z'] });
});

test('validateServers flags missing host, missing/non-numeric port, empty list', () => {
	const t = loadToolsWith({});
	assert.deepEqual(t.validateServers([]), ['At least one server is required.']);
	const errs = t.validateServers([
		{ name: 'ok', protocol: 'ws', host: 'h', port: '6800', interf: 'jsonrpc' },
		{ name: 'bad', protocol: 'ws', host: '', port: 'abc', interf: 'jsonrpc' },
	]);
	assert.ok(errs.some((e) => /bad: host is required/.test(e)));
	assert.ok(errs.some((e) => /bad: port must be numeric/.test(e)));
	assert.equal(errs.some((e) => /^ok:/.test(e)), false);
});

test('addRecentPath works for a server id with no existing history and caps at 10', async () => {
	const t = loadToolsWith({ recentPaths: {} });
	for (let i = 0; i < 12; i++) await t.addRecentPath('newid', '/p' + i);
	const list = await t.getRecentPaths('newid');
	assert.equal(list.length, 10);
	assert.equal(list[0], '/p11'); // newest first
});

test('runMigration converts a legacy blob and is idempotent', async () => {
	const t = loadToolsWith({
		initialize: true,
		protocol: 'ws', host: 'h1', port: '6800', interf: 'jsonrpc', token: '', path: '',
		protocol2: 'ws', host2: 'h2', port2: '6802', interf2: 'jsonrpc', token2: '', path2: '',
		recentPaths: { '1': ['/a'], '2': ['/b'], '3': [] },
	});
	await t.runMigration();
	let d = global.browser.storage.local._dump();
	assert.equal(d.schemaVersion, 2);
	assert.equal(d.servers.length, 2);
	assert.equal('host2' in d, false);
	assert.equal('path' in d, false);
	const firstId = d.servers[0].id;
	assert.deepEqual(d.recentPaths[firstId], ['/a']);

	await t.runMigration(); // second run is a no-op
	assert.deepEqual(global.browser.storage.local._dump().servers.map((s) => s.id), d.servers.map((s) => s.id));
});
