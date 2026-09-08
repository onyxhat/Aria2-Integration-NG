'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeBrowserStub } = require('./helpers/browser-stub');

// tools.js reads the global `browser` at call time; set a default so require() is safe.
global.browser = makeBrowserStub();
const tools = require('../App/lib/tools.js');

// deterministic id generator for migration tests
function counter() { let n = 0; return () => 'id-' + (++n); }

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
