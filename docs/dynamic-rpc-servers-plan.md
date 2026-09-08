# Dynamic RPC Servers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed three-slot RPC server model with a dynamic list of servers managed on one options page, each a valid per-download target.

**Architecture:** Approach A from the spec — consolidate the six per-server connection fields into a `servers` array in `browser.storage.local` (`servers`, `defaultServerId`, `schemaVersion`), keyed by random UUID; re-key `recentPaths` from positional `"1"/"2"/"3"` to those UUIDs; leave every non-connection setting where it is. All new server/migration logic lands in `App/lib/tools.js` (already the home of the path-history helpers and already loaded by every relevant page) so it is unit-testable with a stubbed `browser`. `sendTo()`'s three near-identical branches collapse to one lookup.

**Tech Stack:** Plain ES5/ES2017 JavaScript, Firefox WebExtension manifest v2, no build step. Tests: Node's built-in `node:test` + `node:assert` (Node ≥ 18; dev box has v26), no dependencies, with an in-memory `browser.storage.local` stub.

**Spec:** `docs/dynamic-rpc-servers-design.md`

## Global Constraints

- **No build step / no bundler / no transpile.** `App/` is loaded as-is. Plain HTML/JS only.
- **Edit only NG files:** `App/config.js`, `App/common.js`, `App/lib/tools.js`, `App/data/action/`, `App/data/DownloadPanel/`, `App/data/options/`, `App/_locales/*/messages.json`. Never touch `App/data/ariang/**`, `App/lib/jschardet.min.js`, `App/lib/aria.js`, `App/lib/polygoat.js`, or `Bin/**`.
- **This is feature work:** do **not** bump `App/manifest.json` `version`, edit `CHANGELOG.md`, or run signing. Feature branch `feature/server-mgr` touches `App/` and `tests/` only.
- **`strict_min_version` is `"58.0"`** but this is a personal unlisted build; `crypto.randomUUID()` (Firefox 95+) is used with a `Date.now()`-based fallback, so the floor is a non-issue.
- **i18n:** add new message keys to `App/_locales/en/messages.json` **only**. WebExtension `i18n` falls back to `default_locale` (en); de / zh_CN / zh_TW stay functional untranslated. Do not edit the other three locale files.
- **Commits:** Conventional Commits (`feat:` / `refactor:` / `test:`). One commit per task.
- **Tests live in `/tests`** at the repo root (new directory). Never save test or scratch files to the repo root.

## Storage schema (target)

```
servers:         [{ id: <uuid-string>, name: "", protocol: "ws", host: "127.0.0.1",
                    port: "6800", interf: "jsonrpc", token: "", path: "" }, …]
defaultServerId: <uuid-string>
recentPaths:     { <uuid-string>: [ "…", … capped at 10, newest first ], … }
schemaVersion:   2
```

Old keys removed by migration: `path`, `protocol`, `host`, `port`, `interf`, `token`, and the `*2` / `*3` variants of each.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `App/lib/tools.js` | Server list + migration + path-history helpers | Modify — add `SERVER_DEFAULTS`, `newServerId`, `migrateSchema`, `runMigration`, `getServers`, `getServer`, `getDefaultServer`, `saveServers`, `setDefaultServer`, `removeServer`, `validateServers`; de-hardcode `readRecentPaths`/`addRecentPath`/`removeRecentPath`/`clearRecentPaths`; add a CommonJS export shim |
| `App/common.js` | Background: migration bootstrap, `sendTo`, context menu, message routing | Modify — call `runMigration()` at init; rewrite `sendTo()`; auto-download uses default server; rewrite `contextMenus()`/`cmCallback()`; add `testServer()` + `handleMessage` case |
| `App/config.js` | Default-settings templates | Modify (last) — delete `config.command.s2`/`s3`; remove `path`/`protocol`/`host`/`port`/`interf`/`token`/`recentPaths` from `config.command.guess` |
| `App/data/options/menu.html` / `menu.js` | Options shell + nav | Modify — remove the RPC Servers pop-out `<ul>` and its hash special-casing |
| `App/data/options/rpc.html` / `rpc.js` | The single RPC Servers page | Rewrite — expandable-row list with add / remove / reorder / set-default / test / save |
| `App/data/options/rpc2.html` `rpc2.js` `rpc3.html` `rpc3.js` | Old per-slot pages | Delete |
| `App/data/options/general.html` / `general.js` | General settings page | Modify — host the "Download Completed Sound" radio group |
| `App/data/options/pathHistory.html` / `pathHistory.js` | Path History management page | Modify — render one section per current server |
| `App/data/DownloadPanel/index.html` / `index.js` | Download pop-up | Modify — populate the target-server `<select>` dynamically |
| `App/data/action/index.js` | Toolbar popup ("Open AriaNg") | Modify — build the AriaNg RPC URL from the default server |
| `App/_locales/en/messages.json` | English strings | Modify — new `OP_rpc*` keys |
| `tests/helpers/browser-stub.js` | In-memory `browser.storage.local` for tests | Create |
| `tests/rpc-servers.test.js` | Unit tests for the pure/storage logic | Create |

---

### Task 1: Test harness + `migrateSchema()` + `newServerId()` + `SERVER_DEFAULTS`

**Files:**
- Create: `tests/helpers/browser-stub.js`
- Create: `tests/rpc-servers.test.js`
- Modify: `App/lib/tools.js` (append new constants/functions before the closing of the file; add export shim at the very end)

**Interfaces:**
- Produces:
  - `SERVER_DEFAULTS` → `{ name:"", protocol:"ws", host:"127.0.0.1", port:"6800", interf:"jsonrpc", token:"", path:"" }`
  - `newServerId()` → `string` (UUID when available, else `"s-" + base36 time + "-" + base36 random`)
  - `migrateSchema(raw, opts?)` → `{ servers: Array, defaultServerId: string, recentPaths: object }`. `opts.makeId` overrides the id generator (for deterministic tests); `opts.names` overrides `{ s1, s2, s3 }` display names (defaults `"Default Server"` / `"RPC Server 2"` / `"RPC Server 3"`).
  - `makeBrowserStub(initial?)` → `{ storage: { local: { get, set, remove, clear, _dump } } }` where `get` supports `null` (all), a string key, an array of keys, or an object of defaults, and works both as `get(keys) → Promise` and `get(keys, cb)`.

- [ ] **Step 1: Write `tests/helpers/browser-stub.js`**

```js
'use strict';

// Minimal in-memory stand-in for the parts of the WebExtension `browser`
// API that App/lib/tools.js touches. Supports promise and callback styles.
function makeBrowserStub(initial) {
	let data = clone(initial || {});

	function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

	function pick(keys) {
		if (keys === null || keys === undefined) return clone(data);
		if (typeof keys === 'string') keys = [keys];
		const out = {};
		if (Array.isArray(keys)) {
			for (const k of keys) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = clone(data[k]);
		} else {
			for (const k of Object.keys(keys)) {
				out[k] = Object.prototype.hasOwnProperty.call(data, k) ? clone(data[k]) : keys[k];
			}
		}
		return out;
	}

	const local = {
		get(keys, cb) { const r = pick(keys); if (typeof cb === 'function') { cb(r); return; } return Promise.resolve(r); },
		set(obj, cb) { Object.assign(data, clone(obj)); if (typeof cb === 'function') { cb(); return; } return Promise.resolve(); },
		remove(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => { delete data[k]; }); if (typeof cb === 'function') { cb(); return; } return Promise.resolve(); },
		clear(cb) { data = {}; if (typeof cb === 'function') { cb(); return; } return Promise.resolve(); },
		_dump() { return clone(data); },
	};

	return {
		storage: { local },
		i18n: { getMessage: (k) => k },
	};
}

module.exports = { makeBrowserStub };
```

- [ ] **Step 2: Write the failing tests in `tests/rpc-servers.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeBrowserStub } = require('./helpers/browser-stub');

// tools.js reads the global `browser` at call time; set a default so require() is safe.
global.browser = makeBrowserStub();
global.crypto = global.crypto || {};
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
```

- [ ] **Step 3: Run the tests, verify they fail**

Run: `node --test tests/`
Expected: FAIL — `tools.SERVER_DEFAULTS` / `tools.newServerId` / `tools.migrateSchema` are `undefined` (`TypeError: tools.migrateSchema is not a function`).

- [ ] **Step 4: Implement in `App/lib/tools.js`**

Immediately **after** line `const MAX_RECENT_PATHS = 10;` (currently line 187), insert:

```js

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
```

At the **very end of the file**, append:

```js

// CommonJS export shim — no effect in the extension (no `module`), lets tests require() this file.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		MAX_RECENT_PATHS, SERVER_DEFAULTS, newServerId, migrateSchema,
		readRecentPaths, getRecentPaths, addRecentPath, removeRecentPath, clearRecentPaths,
	};
}
```

- [ ] **Step 5: Run the tests, verify they pass**

Run: `node --test tests/`
Expected: PASS (7 passing).

- [ ] **Step 6: Commit**

```bash
git add tests/ App/lib/tools.js
git commit -m "test: add rpc-server test harness; feat: schema migration helper"
```

---

### Task 2: Server storage helpers + de-hardcode path history

**Files:**
- Modify: `App/lib/tools.js`
- Modify: `tests/rpc-servers.test.js` (add cases)

**Interfaces:**
- Consumes: `SERVER_DEFAULTS`, `migrateSchema`, `MAX_RECENT_PATHS` (Task 1); global `browser` (real in extension, stub in tests).
- Produces (all Promise-returning):
  - `getServers()` → `server[]` (`[]` if unset)
  - `getServer(id)` → `server | undefined`
  - `getDefaultServer()` → `server | undefined` (stored default, else `servers[0]`, else `undefined`)
  - `saveServers(servers)` → writes `servers`; prunes `recentPaths` keys not in `servers`
  - `setDefaultServer(id)` → writes `defaultServerId`
  - `removeServer(id)` → rejects if only one server; if `id` was default, promotes `servers[0]` of the remainder; persists both keys
  - `validateServers(servers)` → `string[]` of human-readable errors (`[]` when valid)
  - `runMigration()` → if `servers` array already present **and** `schemaVersion >= 2`, resolves without writing; otherwise runs `migrateSchema` on the full blob, writes `servers`/`defaultServerId`/`recentPaths`/`schemaVersion:2`, then removes the 18 legacy keys. Idempotent.
  - `getRecentPaths(serverId)` / `addRecentPath(serverId, p)` / `removeRecentPath(serverId, p)` / `clearRecentPaths(serverId)` — unchanged names/signatures, now uuid-keyed and safe for unknown keys.

- [ ] **Step 1: Add failing tests to `tests/rpc-servers.test.js`**

```js
function loadToolsWith(initial) {
	global.browser = makeBrowserStub(initial);
	delete require.cache[require.resolve('../App/lib/tools.js')];
	return require('../App/lib/tools.js');
}

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

test('removeServer promotes first remaining server when the default is removed', async () => {
	const t = loadToolsWith({ servers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], defaultServerId: 'b', recentPaths: { b: ['/gone'] } });
	await t.removeServer('b');
	const d = global.browser.storage.local._dump();
	assert.deepEqual(d.servers.map((s) => s.id), ['a', 'c']);
	assert.equal(d.defaultServerId, 'a');
	assert.equal('b' in d.recentPaths, false);
});

test('removeServer refuses to remove the last server', async () => {
	const t = loadToolsWith({ servers: [{ id: 'only' }], defaultServerId: 'only' });
	await assert.rejects(() => t.removeServer('only'), /last server/i);
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
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `node --test tests/`
Expected: FAIL — `t.getServers` / `t.saveServers` / `t.removeServer` / `t.validateServers` / `t.runMigration` undefined.

- [ ] **Step 3: Implement in `App/lib/tools.js`**

Add these functions in the "RPC servers" section (after `migrateSchema`):

```js
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

function removeServer(id) {
	return Promise.all([getServers(), browser.storage.local.get("defaultServerId")]).then(function (r) {
		var servers = r[0], defaultServerId = r[1].defaultServerId;
		if (servers.length <= 1) return Promise.reject(new Error("Cannot remove the last server."));
		var next = servers.filter(function (s) { return s.id !== id; });
		if (defaultServerId === id) defaultServerId = next[0].id;
		return saveServers(next).then(function () {
			return browser.storage.local.set({ defaultServerId: defaultServerId });
		});
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
```

Replace `readRecentPaths` (currently lines 189-202) with:

```js
function readRecentPaths() {
	return new Promise(function (resolve) {
		browser.storage.local.get("recentPaths", function (item) {
			var rp = item.recentPaths;
			if (!rp || typeof rp != "object") rp = {};
			resolve(rp);
		});
	});
}
```

In `addRecentPath`, change `var list = rp[server].filter(...)` to:

```js
		var list = (rp[server] || []).filter(function (x) { return x !== p; });
```

In `removeRecentPath`, change `rp[server] = rp[server].filter(...)` to:

```js
		rp[server] = (rp[server] || []).filter(function (x) { return x !== p; });
```

`clearRecentPaths` already assigns `rp[server] = []` — leave it.

Extend the export shim's object with the new names:

```js
	module.exports = {
		MAX_RECENT_PATHS, SERVER_DEFAULTS, newServerId, migrateSchema, runMigration,
		getServers, getServer, getDefaultServer, saveServers, setDefaultServer, removeServer, validateServers,
		readRecentPaths, getRecentPaths, addRecentPath, removeRecentPath, clearRecentPaths,
	};
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `node --test tests/`
Expected: PASS (16 passing).

- [ ] **Step 5: Commit**

```bash
git add tests/ App/lib/tools.js
git commit -m "feat: dynamic RPC server storage helpers + migration runner"
```

---

### Task 3: Bootstrap migration in the background init

**Files:**
- Modify: `App/common.js` (the trailing init IIFE, currently lines ~939-943)

**Interfaces:**
- Consumes: `runMigration()` (Task 2).

- [ ] **Step 1: Wrap the init IIFE so migration completes first**

Current (bottom of `common.js`):

```js
(function() {
	browser.storage.local.get("enabled", function(item) {
		changeState(item.enabled);
	});
	browser.browserAction.setBadgeBackgroundColor({color: [0,0,0,100]});
	loadSettings();
	browser.runtime.onMessage.addListener(handleMessage);
})();
```

Replace with:

```js
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
```

- [ ] **Step 2: Verify the unit suite still passes**

Run: `node --test tests/`
Expected: PASS (16 passing — no code under test changed, this is a guard).

- [ ] **Step 3: Manual verification (temporary add-on)**

1. `about:debugging` → This Firefox → Load Temporary Add-on → `App/manifest.json`.
2. Open the console for the extension (Inspect). In it, seed a legacy profile:

```js
await browser.storage.local.clear();
await browser.storage.local.set({
  initialize: true,
  protocol: "ws", host: "127.0.0.1", port: "6800", interf: "jsonrpc", token: "", path: "/legacy1",
  protocol2: "ws", host2: "10.0.0.9", port2: "6800", interf2: "jsonrpc", token2: "t2", path2: "/legacy2",
  recentPaths: { "1": ["/legacy1"], "2": ["/legacy2"], "3": [] },
  menu: false, cmDownPanel: true, sound: "3",
});
```

3. Reload the extension (the reload button in `about:debugging`).
4. In the console:

```js
await browser.storage.local.get(null);
```

Expected: `servers` is a 2-element array with uuid `id`s and hosts `127.0.0.1` / `10.0.0.9`; `defaultServerId` equals `servers[0].id`; `recentPaths` is keyed by those two uuids with `["/legacy1"]` / `["/legacy2"]`; `schemaVersion` is `2`; **no** `host` / `host2` / `path2` / etc. keys remain; `menu` / `cmDownPanel` / `sound` untouched.
5. Reload once more, re-check `get(null)` → identical `servers` ids (idempotent).

- [ ] **Step 4: Commit**

```bash
git add App/common.js
git commit -m "feat: run RPC schema migration on background startup"
```

---

### Task 4: Collapse `sendTo()` to a single server lookup

**Files:**
- Modify: `App/common.js` — replace the entire body of `sendTo` (currently lines 13-339).

**Interfaces:**
- Consumes: `getServer(id)`, `getDefaultServer()` (Task 2); existing `Aria2`, `isRunning`, `monitor`, `notify`.
- Produces: `sendTo(url, fileName, filePath, header, serverId)` — `serverId` is a uuid; unknown/`undefined` id falls back to the default server.

- [ ] **Step 1: Replace the function**

Replace lines 13-339 (the whole `function sendTo(...) { ... }`) with:

```js
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
			isRunning(item, aria2);

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
```

- [ ] **Step 2: Static check — no leftover slot references in `sendTo`**

Run: `sed -n '1,120p' App/common.js | grep -n 'server ==\|config.command.s2\|config.command.s3\|item.host2\|item.path2' || echo "clean"`
Expected: `clean`

- [ ] **Step 3: Lint**

Run: `npx --yes web-ext@latest lint --source-dir App --warnings-as-errors=false 2>&1 | grep -E "^(Errors|.*[0-9]+ error)" || echo "no errors line"`
Expected: `0` errors (warnings unchanged — see Task 14 for the full check).

- [ ] **Step 4: Manual verification (needs a running aria2)**

1. Start aria2 locally (`aria2c --enable-rpc --rpc-listen-all` on `:6800`).
2. Load the temp add-on; open Options → RPC Servers is not built yet, so seed via console:

```js
await browser.storage.local.set({
  servers: [{ id: "s1", name: "local", protocol: "ws", host: "127.0.0.1", port: "6800", interf: "jsonrpc", token: "", path: "" }],
  defaultServerId: "s1", schemaVersion: 2, initialize: true,
});
```

3. On any page, right-click a direct file link → "Download with Aria2" (context menu still the old code here; that's fine) → confirm the file is queued in aria2 (`aria2.tellActive` via AriaNg or the aria2 log).
4. In the console, exercise the fallback: `browser.runtime.sendMessage({ get: "download", url: "https://speed.hetzner.de/100MB.bin", fileName: "100MB.bin", filePath: "", header: "[]", server: "does-not-exist" })` → still queues (fell back to default `s1`).

- [ ] **Step 5: Commit**

```bash
git add App/common.js
git commit -m "refactor: collapse sendTo() three-slot branch into one server lookup"
```

---

### Task 5: Auto-captured downloads and "Open AriaNg" use the default server

**Files:**
- Modify: `App/common.js` (auto-download call, currently ~line 619)
- Modify: `App/data/action/index.js` (`detail()`)

**Interfaces:**
- Consumes: `getDefaultServer()` (Task 2).

- [ ] **Step 1: `common.js` — auto-download branch**

Current (inside `prepareDownload`, ~lines 614-620):

```js
	browser.storage.local.get(config.command.guess, item => {
		if (item.downPanel) {
			downloadPanel(details);
		}
		else {
			sendTo(details.url,details.fileName,"",details.requestHeaders,"1");
		}
	});
```

Replace with:

```js
	browser.storage.local.get(config.command.guess, item => {
		if (item.downPanel) {
			downloadPanel(details);
		}
		else {
			getDefaultServer().then(function (s) {
				sendTo(details.url, details.fileName, "", details.requestHeaders, s && s.id);
			});
		}
	});
```

- [ ] **Step 2: `action/index.js` — build the AriaNg URL from the default server**

Current `detail()` inner block:

```js
		else {
			browser.storage.local.get(config.command.guess, function(item) {
				var ariangUrl = "../../data/ariang/index.html"
				if (item.autoSet) {
					ariangUrl += "#!/settings/rpc/set/";
					ariangUrl += (item.protocol + "/" + item.host + "/" + item.port + "/" + 
					item.interf + "/" + btoa(item.token));
				}
				browser.tabs.create({
					url: ariangUrl
				});
				window.close();
			});
		}
```

Replace with:

```js
		else {
			Promise.all([
				browser.storage.local.get("autoSet"),
				getDefaultServer(),
			]).then(function (r) {
				var autoSet = r[0].autoSet, s = r[1];
				var ariangUrl = "../../data/ariang/index.html";
				if (autoSet && s) {
					ariangUrl += "#!/settings/rpc/set/";
					ariangUrl += (s.protocol + "/" + s.host + "/" + s.port + "/" + s.interf + "/" + btoa(s.token));
				}
				browser.tabs.create({ url: ariangUrl });
				window.close();
			});
		}
```

Add `<script src="/lib/tools.js"></script>` to `App/data/action/index.html` **before** `<script ... index.js>` (check the file; `config.js` is already included — put tools.js right after it).

- [ ] **Step 3: Unit suite regression check**

Run: `node --test tests/`
Expected: PASS (16 passing).

- [ ] **Step 4: Manual verification**

1. With the single seeded server (`s1`) and aria2 running, toggle Options → General → uncheck "Display Download Panel", check "Aria2 Auto Start" as needed.
2. Click a captured download (e.g. a `.zip` link the observer picks up) → it queues on `s1`.
3. Click the toolbar icon → "..." / details button → an AriaNg tab opens with `#!/settings/rpc/set/ws/127.0.0.1/6800/jsonrpc/<base64>` in the URL.
4. Seed a second server and set it default (`defaultServerId`), repeat 2-3 → both now target the second server.

- [ ] **Step 5: Commit**

```bash
git add App/common.js App/data/action/index.js App/data/action/index.html
git commit -m "feat: auto-downloads and Open AriaNg use the default RPC server"
```

---

### Task 6: Dynamic context menu + `testServer` message handler

**Files:**
- Modify: `App/common.js` — `contextMenus()` (currently ~832-900), `cmCallback()` (currently ~776-831), `handleMessage()` switch (~389), add `testServer()`.

**Interfaces:**
- Consumes: `getServers()`, `getDefaultServer()` (Task 2); existing `Aria2`, `downloadPanel`, `sendTo`, `getFileNameURL`.
- Produces: context-menu items `dl:<id>` (link) / `dv:<id>` (video/audio) when the panel is off and there is more than one server; `handleMessage` case `"testServer"` returning `Promise<{ ok: boolean, error?: string }>`.

- [ ] **Step 1: Rewrite `contextMenus()`**

Replace the whole function with:

```js
function contextMenus (enabled, cmDownPanel){
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

	if (!cmDownPanel) {
		getServers().then(function (servers) {
			if (servers.length > 1) {
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
		});
	} else {
		browser.contextMenus.onClicked.addListener(cmCallback);
	}
}
```

- [ ] **Step 2: Rewrite `cmCallback()`**

Replace the whole function with:

```js
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
					.then(function (sid) { sendTo(url, "", "", requestHeaders, sid); });
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
```

- [ ] **Step 3: Add the `testServer` handler**

In `handleMessage`, add a case before `default:`:

```js
		case "testServer":
			return testServer(request.server);
```

(Returning a Promise from an `onMessage` listener is how Firefox delivers the async reply; the other `case`s keep using `sendResponse` synchronously.)

Add the function near `sendTo`:

```js
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
```

- [ ] **Step 4: Static check**

Run: `grep -n "menuItemId.slice(1)\|id: 'A1'\|id: 'B1'\|seD\|se2\|se3" App/common.js || echo "old menu code gone"`
Expected: `old menu code gone`

- [ ] **Step 5: Unit suite regression check**

Run: `node --test tests/`
Expected: PASS (16 passing).

- [ ] **Step 6: Manual verification**

1. Seed two servers, `menu: true`, `cmDownPanel: false`; reload.
2. Right-click a link → "Download with Aria2" shows a submenu with **two** entries (names or `host:port`), in list order. Click one → queues on that server (verify in aria2).
3. Set `servers` back to one; reload → right-click shows "Download with Aria2" with **no** submenu; clicking it queues on that server.
4. Set `cmDownPanel: true`; reload → clicking "Download with Aria2" opens the Download Panel (unchanged).
5. Console: `await browser.runtime.sendMessage({ get: "testServer", server: { protocol:"ws", host:"127.0.0.1", port:"6800", interf:"jsonrpc", token:"" } })` → `{ ok: true }` with aria2 up, `{ ok: false, error: ... }` with it down.

- [ ] **Step 7: Commit**

```bash
git add App/common.js
git commit -m "feat: dynamic context-menu server list + testServer RPC probe"
```

---

### Task 7: New i18n keys

**Files:**
- Modify: `App/_locales/en/messages.json`

- [ ] **Step 1: Add keys**

Insert these entries (anywhere valid; grouping them after the existing `OP_rpc3` block keeps the diff readable). Match the file's existing formatting (tabs, `"message"` + `"description"`):

```json
	"OP_rpcAddServer": {
		"message": "Add server",
		"description": "Button on the RPC Servers options page"
	},
	"OP_rpcServerName": {
		"message": "Name",
		"description": "Optional per-server label field"
	},
	"OP_rpcServerNamePlaceholder": {
		"message": "optional — defaults to host:port",
		"description": "Placeholder for the server name field"
	},
	"OP_rpcSetDefault": {
		"message": "Default",
		"description": "Radio label marking the default RPC server"
	},
	"OP_rpcRemove": {
		"message": "Remove",
		"description": "Remove-server button on the RPC Servers page"
	},
	"OP_rpcRemoveConfirm": {
		"message": "Remove this server? Its path history will be discarded.",
		"description": "Confirm prompt before removing a server"
	},
	"OP_rpcTest": {
		"message": "Test connection",
		"description": "Button that probes the aria2 RPC endpoint"
	},
	"OP_rpcTestOk": {
		"message": "Reachable",
		"description": "Test connection succeeded"
	},
	"OP_rpcTestFail": {
		"message": "Unreachable",
		"description": "Test connection failed"
	},
	"OP_rpcMoveUp": {
		"message": "Move up",
		"description": "Reorder control on the RPC Servers page"
	},
	"OP_rpcMoveDown": {
		"message": "Move down",
		"description": "Reorder control on the RPC Servers page"
	},
	"OP_rpcLastServer": {
		"message": "At least one server is required.",
		"description": "Shown when the user tries to remove the only server"
	},
```

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('App/_locales/en/messages.json','utf8')); console.log('valid JSON')"`
Expected: `valid JSON`

- [ ] **Step 3: Commit**

```bash
git add App/_locales/en/messages.json
git commit -m "feat: i18n strings for the dynamic RPC Servers page"
```

---

### Task 8: Options nav — remove the RPC Servers pop-out submenu

**Files:**
- Modify: `App/data/options/menu.html`
- Modify: `App/data/options/menu.js`

- [ ] **Step 1: `menu.html` — flatten the `#rpc` item**

Replace:

```html
          <li id="rpc">
            <a data-message="OP_rpcServer" href="#">RPC Servers</a>
            <ul>
              <li>
                <a data-message="OP_rpcDefault" href="#rpc">Default Server</a>
              </li>
              <li>
                <a data-message="OP_rpc2" href="#rpc2">RPC Server 2</a>
              </li>
              <li>
                <a data-message="OP_rpc3" href="#rpc3">RPC Server 3</a>
              </li>
            </ul>
          </li>
```

with:

```html
          <li id="rpc">
            <a data-message="OP_rpcServer" href="#rpc">RPC Servers</a>
          </li>
```

- [ ] **Step 2: `menu.js` — drop the `#rpc2`/`#rpc3` hash special-case**

Replace the body of `hashHandler` from the `if (location.hash != '' ...)` block. Current:

```js
	if (location.hash != '' && location.hash != '#') {
		document.querySelector('.iframe').src = location.hash.slice(1) + ".html";
		document.querySelector('#general').className = "";
		document.querySelector('#rpc').className = "";
		document.querySelector('#exception').className = "";
		document.querySelector('#pathHistory').className = "";
		document.querySelector('#about').className = "";
		if (location.hash == "#rpc" || location.hash == "#rpc2" || location.hash == "#rpc3")
			document.querySelector("#rpc").className = "active";
		else
			document.querySelector(location.hash).className = "active";
	}
```

with:

```js
	if (location.hash != '' && location.hash != '#') {
		document.querySelector('.iframe').src = location.hash.slice(1) + ".html";
		document.querySelector('#general').className = "";
		document.querySelector('#rpc').className = "";
		document.querySelector('#exception').className = "";
		document.querySelector('#pathHistory').className = "";
		document.querySelector('#about').className = "";
		var active = document.querySelector(location.hash);
		if (active) active.className = "active";
	}
```

- [ ] **Step 3: Manual verification**

1. Reload the temp add-on, open Options.
2. The left nav shows "RPC Servers" with **no** fly-out on hover. Clicking it loads `rpc.html` in the iframe and highlights the item.
3. General / Exceptions / Path History / About still switch correctly.

- [ ] **Step 4: Commit**

```bash
git add App/data/options/menu.html App/data/options/menu.js
git commit -m "feat: single RPC Servers nav entry, no pop-out submenu"
```

---

### Task 9: Rewrite the RPC Servers options page

**Files:**
- Rewrite: `App/data/options/rpc.html`
- Rewrite: `App/data/options/rpc.js`
- Delete: `App/data/options/rpc2.html`, `App/data/options/rpc2.js`, `App/data/options/rpc3.html`, `App/data/options/rpc3.js`

**Interfaces:**
- Consumes: `getServers`, `saveServers`, `setDefaultServer`, `removeServer`, `validateServers`, `getDefaultServer`, `SERVER_DEFAULTS`, `newServerId` (Task 2); `browser.runtime.sendMessage({ get: "testServer", server })` and `{ get: "loadSettings" }` (Tasks 6, existing).

- [ ] **Step 1: Write `App/data/options/rpc.html`**

```html
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Options Page</title>
	<style type="text/css">
		body { font-family: sans-serif; font-size: 16px; background: #f9f9fa; }
		p { margin: 3px; }
		.note { font-size: 80%; color: rgb(127, 127, 127); }
		.highlight { font-size: 80%; border: solid 2px #D22222; padding: 7px; margin-bottom: 10px; }
		button { border-style: none; border-radius: 2px; background-color: rgb(44, 173, 255);
			color: #fff; text-shadow: rgb(0, 64, 91) 0px 0px 0.5px; cursor: pointer; }
		#save { width: 80px; height: 30px; margin-top: 20px; font-size: 18px; }
		#addServer { height: 28px; padding: 0 12px; font-size: 14px; margin-top: 10px; }
		.server { border: 1px solid #d7d8da; border-radius: 3px; margin: 8px 0; background: #fff; max-width: 640px; }
		.server .row { display: flex; align-items: center; padding: 8px 10px; gap: 8px; }
		.server .row .title { flex: 1; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.server .body { display: none; padding: 4px 10px 12px 10px; border-top: 1px solid #eee; }
		.server.open .body { display: block; }
		.server .body table { width: 100%; }
		.server .body input[type=text] { width: 100%; margin-top: 4px; }
		.server .mini { height: 24px; padding: 0 8px; font-size: 13px; }
		.server .mini.plain { background: #eee; color: #333; text-shadow: none; }
		.testResult { font-size: 80%; margin-left: 8px; }
		.testResult.ok { color: #1a7f37; }
		.testResult.fail { color: #D22222; }
		#errors { color: #D22222; font-size: 85%; max-width: 640px; }
		#errors ul { margin: 4px 0; padding-left: 18px; }
	</style>
</head>
<body>
	<div class="highlight">
		<p data-message="OP_message1">You need to download and start Aria2 by youself, complete at least
		"Protocol," "Host," "Port" and "Interface" below and then click the "Save" button.</p>
		<a data-message="OP_message3" href="https://github.com/RossWang/Aria2-Integration/tree/master/Bin">You can find the sample files here.</a>
	</div>

	<div id="serverList"></div>
	<button id="addServer" data-message="OP_rpcAddServer">Add server</button>

	<div id="errors"></div>
	<div align="right" style="max-width: 640px;">
		<span id="status"></span>
		<button data-message="OP_save" id="save">Save</button>
	</div>

	<script src="/config.js"></script>
	<script src="/lib/tools.js"></script>
	<script src="rpc.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `App/data/options/rpc.js`**

```js
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
```

- [ ] **Step 3: Delete the old per-slot pages**

```bash
git rm App/data/options/rpc2.html App/data/options/rpc2.js App/data/options/rpc3.html App/data/options/rpc3.js
```

- [ ] **Step 4: Static check — nothing still references the deleted pages**

Run: `grep -rn "rpc2\|rpc3" App/ || echo "no rpc2/rpc3 references"`
Expected: `no rpc2/rpc3 references` (the `OP_rpc2`/`OP_rpc3` message keys were already removed from `menu.html` in Task 8 and remain only as migration seeds referenced by string in `tools.js`/`common.js` — those are fine; if the grep shows only `_locales` entries and `runMigration`/`migrateSchema` name seeds, that is expected — confirm no `.html`/page references).

- [ ] **Step 5: Unit suite regression check**

Run: `node --test tests/`
Expected: PASS (16 passing).

- [ ] **Step 6: Manual verification**

1. Reload temp add-on. Options → RPC Servers.
2. One row shows (migrated default), expanded, radio checked. Header shows name or `host:port`, updating live as you edit Name/Host/Port.
3. "Add server" appends an expanded blank row. Fill Host/Port. Click its radio → default moves.
4. ↑/↓ reorder; end rows have the relevant arrow disabled.
5. "Test connection" with aria2 up → "Reachable" (green); with it down → "Unreachable (…)" (red).
6. Remove a row → confirm prompt; removing the only row is refused with the error line.
7. Save with an empty Host or non-numeric Port → error list, nothing persisted. Fix, Save → "Saved"; console `browser.storage.local.get(["servers","defaultServerId"])` reflects the list and default.
8. After Save, the DownloadPanel dropdown and context-menu submenu (Tasks 11/6) reflect the new list without reloading the extension.

- [ ] **Step 7: Commit**

```bash
git add App/data/options/rpc.html App/data/options/rpc.js
git commit -m "feat: single RPC Servers page with add/remove/reorder/default/test"
```

---

### Task 10: Move "Download Completed Sound" to the General page

**Files:**
- Modify: `App/data/options/general.html`
- Modify: `App/data/options/general.js`

**Interfaces:**
- The single global `sound` key is unchanged; only which page's form reads/writes it moves. `config.command.guess` keeps `sound`.

- [ ] **Step 1: `general.html` — add the radio group**

Immediately before `<tr><td><br></td></tr>` that precedes the "Download Panel width offset" row (currently ~line 166), insert:

```html
		<tr>
			<td data-message="OP_sound">Downlod Completed Sound:</td>
		</tr>
		<tr>
			<td>
				<input id="sound0" style="margin-top: 5px;" type="radio" name="sound">
				<label data-message="OP_sound0" for="sound0">None</label>
				<input id="sound1" style="margin-top: 5px;" type="radio" name="sound">
				<label data-message="OP_sound1" for="sound1">Sound 1</label>
				<input id="sound2" style="margin-top: 5px;" type="radio" name="sound">
				<label data-message="OP_sound2" for="sound2">Sound 2</label>
				<input id="sound3" style="margin-top: 5px;" type="radio" name="sound">
				<label data-message="OP_sound3" for="sound3">Sound 3</label>
			</td>
		</tr>
```

- [ ] **Step 2: `general.js` — persist and restore `sound`**

In `save()`, after `const dpWidth = ...;` add:

```js
	var sound = "3";
	if (document.getElementById('sound0').checked) sound = "0";
	else if (document.getElementById('sound1').checked) sound = "1";
	else if (document.getElementById('sound2').checked) sound = "2";
	else if (document.getElementById('sound3').checked) sound = "3";
```

Add `sound,` to the object passed to `browser.storage.local.set({ ... })`.

In `restore()`, inside the first `browser.storage.local.get(Object.assign(config.command.guess), prefs => { ... })` callback, add:

```js
		document.getElementById('sound' + (prefs.sound || "3")).checked = true;
```

- [ ] **Step 3: Manual verification**

1. Reload; Options → General shows the sound radios near the bottom.
2. Change to "Sound 1", Save, reopen General → "Sound 1" still selected; console `browser.storage.local.get("sound")` → `{ sound: "1" }`.
3. Options → RPC Servers no longer shows a sound control.
4. Complete a download → the selected sound plays (unchanged `monitor()` path in `tools.js`).

- [ ] **Step 4: Commit**

```bash
git add App/data/options/general.html App/data/options/general.js
git commit -m "feat: move Download Completed Sound to the General options page"
```

---

### Task 11: DownloadPanel — dynamic target-server dropdown

**Files:**
- Modify: `App/data/DownloadPanel/index.html`
- Modify: `App/data/DownloadPanel/index.js`

**Interfaces:**
- Consumes: `getServers`, `getDefaultServer`, `getRecentPaths`, `addRecentPath` (Task 2 / existing).

- [ ] **Step 1: `index.html` — empty the `<select>`**

Replace:

```html
		<select class="s1">
			<option data-message="OP_rpcDefault" value="1">Default Server</option>
			<option data-message="OP_rpc2" value="2">RPC Server 2</option>
			<option data-message="OP_rpc3" value="3">RPC Server 3</option>
		</select>
```

with:

```html
		<select class="s1"></select>
```

- [ ] **Step 2: `index.js` — populate it in `init()`**

In `init()`, replace the line `loadPathHistory();` with:

```js
	populateServers().then(loadPathHistory);
```

Add the function (near `loadPathHistory`):

```js
function populateServers() {
	return Promise.all([getServers(), getDefaultServer()]).then(function (r) {
		var servers = r[0], def = r[1];
		var sel = document.querySelector('.s1');
		sel.textContent = '';
		servers.forEach(function (s) {
			var opt = document.createElement('option');
			opt.value = s.id;
			opt.textContent = (s.name && s.name.trim()) || (s.host + ':' + s.port);
			sel.appendChild(opt);
		});
		if (def) sel.value = def.id;
		else if (servers.length) sel.value = servers[0].id;
	});
}
```

`loadPathHistory()`, `download()` (`const rpc = document.querySelector(".s1").value`), and `addRecentPath(rpc, fp)` already treat the value as an opaque string — no further change.

- [ ] **Step 3: Manual verification**

1. Ensure ≥ 2 servers saved, second one default.
2. Trigger the Download Panel (context menu with `cmDownPanel: true`, or a captured download with the panel on).
3. Click "Advanced" (`adv()`) to reveal the server `<select>` → it lists all servers by name/`host:port`; the default is preselected.
4. Pick a non-default server, enter a path, Download → queues on that server (verify in aria2); reopen the panel with that server selected → the path appears in the File Path history dropdown (per-server).
5. Remove that server on the options page, Save, reopen the panel → the `<select>` no longer lists it; selection falls back to the default.

- [ ] **Step 4: Commit**

```bash
git add App/data/DownloadPanel/index.html App/data/DownloadPanel/index.js
git commit -m "feat: DownloadPanel target-server dropdown is built from the server list"
```

---

### Task 12: Path History page — one section per current server

**Files:**
- Modify: `App/data/options/pathHistory.html`
- Modify: `App/data/options/pathHistory.js`

**Interfaces:**
- Consumes: `getServers`, `readRecentPaths`, `addRecentPath`, `removeRecentPath`, `clearRecentPaths` (Task 2 / existing).

- [ ] **Step 1: `pathHistory.html` — replace the three hard-coded sections with a container**

Replace the block from `<h2 data-message="OP_rpcDefault">Default Server</h2>` through the third `<button class="clearBtn" data-server="3" ...>` (currently lines 91-113) with:

```html
	<div id="sections"></div>
```

Leave the `<style>`, the intro `<p>`, the trailing `<div align="right"><span id="status"></span></div>`, and the three `<script>` tags unchanged.

- [ ] **Step 2: `pathHistory.js` — build sections from the server list**

Replace the whole file with:

```js
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
```

- [ ] **Step 3: Manual verification**

1. Reload; Options → Path History.
2. One `<h2>` section per saved server, labelled by name/`host:port`; empty ones show "No saved paths".
3. Add a path under a server → appears newest-first, capped at 10; the DownloadPanel dropdown for that server offers it.
4. Remove one entry / Clear a server → reflected immediately.
5. Rename or remove a server on the RPC Servers page, Save, reopen Path History → sections track the current server list; a removed server's history is gone.

- [ ] **Step 4: Commit**

```bash
git add App/data/options/pathHistory.html App/data/options/pathHistory.js
git commit -m "feat: Path History page renders one section per current server"
```

---

### Task 13: Trim `config.js`

**Files:**
- Modify: `App/config.js`

- [ ] **Step 1: Remove the per-slot templates and dead `guess` fields**

In `config.command.guess`, delete these lines:

```js
			path: "",
			recentPaths: { "1": [], "2": [], "3": [] },
			protocol: "ws",
			host: "127.0.0.1",
			port: "6800",
			interf: "jsonrpc",
			token: "",
```

Keep everything else in `guess` (`zoom`, `sound`, `menu`, `shutdown`, `aggressive`, `windowLoc`, `auto`, `autoSet`, `chgLog`, `badge`, `cmDownPanel`, `downPanel`, `ua`, `fileSizeLimit`, `typeFilterA`, `urlFilterA`, `typeFilterB`, `urlFilterB`).

Delete the entire `get s2() { ... }` and `get s3() { ... }` getters (and the comma after `guess`'s closing brace becomes the end of the object — ensure the object literal stays valid: `guess` getter is now the only member).

Resulting shape:

```js
'use strict';
var config = {};
config.command = {
	get guess() {
		return {
			zoom: "1",
			sound: "3",
			menu: false,
			shutdown: false,
			aggressive: false,
			windowLoc: false,
			auto: true,
			autoSet: true,
			chgLog: true,
			badge: true,
			cmDownPanel: true,
			downPanel: true,
			ua: false,
			fileSizeLimit: 0,
			typeFilterA: "",
			urlFilterA: "",
			typeFilterB: "",
			urlFilterB: "",
		};
	}
};
```

- [ ] **Step 2: Static check — no remaining consumers of the removed members**

Run:

```bash
grep -rn "config.command.s2\|config.command.s3" App/ || echo "s2/s3 gone"
grep -rn "\bitem\.host\b\|\bitem\.port\b\|prefs\.protocol\b\|prefs\.host\b" App/ || echo "no slot-field reads"
```

Expected: `s2/s3 gone`; the second grep should return nothing from `common.js`/options JS (only possible hit is inside `App/data/ariang/**` which is vendored and irrelevant — if so, re-run scoped: `grep -rn ... App/common.js App/data/options App/data/DownloadPanel App/data/action App/lib`).

- [ ] **Step 3: Full unit suite + lint**

Run: `node --test tests/`
Expected: PASS (16 passing).

Run: `npx --yes web-ext@latest lint --source-dir App --output=json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('errors',j.errors.length)})"`
Expected: `errors 0`

- [ ] **Step 4: Commit**

```bash
git add App/config.js
git commit -m "refactor: drop the fixed three-slot RPC config templates"
```

---

### Task 14: Integration verification pass

**Files:** none (verification + final commit only)

- [ ] **Step 1: Unit suite**

Run: `node --test tests/`
Expected: PASS, 16 tests, 0 failures.

- [ ] **Step 2: `web-ext lint`**

Run: `npx --yes web-ext@latest lint --source-dir App --output=json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('errors',j.errors.length,'warnings',j.warnings.length)})"`
Expected: `errors 0`. Warning count is at or below the pre-feature baseline (27) — any *new* warning must be in NG code you wrote; investigate before proceeding.

- [ ] **Step 3: Full manual regression (temporary add-on, aria2 running)**

Walk the spec §5 checklist end to end:
1. Fresh install (`storage.local.clear()` then reload) → one default server pre-seeded; Options → RPC Servers usable.
2. Upgrade path: seed the legacy blob from Task 3 Step 3, reload → migrated to `servers`/`defaultServerId`/`schemaVersion:2`, path history preserved by server, old keys gone.
3. Add / rename / reorder / set-default / remove servers; Save; validation blocks bad input.
4. Test connection: reachable + unreachable.
5. DownloadPanel dropdown lists servers, default preselected, path history per server, download queues on the chosen server.
6. Context menu: N entries with >1 server, no submenu with exactly 1, panel path when `cmDownPanel` on.
7. Auto-captured download → default server. "Open AriaNg" → default server's RPC params in the URL.
8. Path History page: one section per server, add/remove/clear, tracks server list changes.
9. General page: sound radios present, persist, playback on completion.
10. Nav: single "RPC Servers" entry, no fly-out.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "test: integration verification for dynamic RPC servers" --allow-empty
```

(If Steps 1-3 surfaced fixes, commit those with `fix:` messages instead; the `--allow-empty` is only to mark the verification checkpoint if nothing changed.)

---

## Self-review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §1 schema (`servers`/`defaultServerId`/`schemaVersion`/re-keyed `recentPaths`) | 1, 2, 13 |
| §1 `config.js` changes | 13 (add `SERVER_DEFAULTS` relocated to `tools.js` — see deviation below) |
| §1 `tools.js` helpers | 2 |
| §1 migration (pure fn + driver, idempotent, key removal) | 1 (`migrateSchema`), 2 (`runMigration`), 3 (bootstrap) |
| §2 `sendTo` collapse + unknown-id fallback | 4 |
| §2 auto-download → default | 5 |
| §2 context menu dynamic + `dl:`/`dv:` ids + single-server no-submenu | 6 |
| §2 "Open AriaNg" → default | 5 |
| §2 `testServer` message handler | 6 |
| §3 `menu.html`/`menu.js` de-nest | 8 |
| §3 `rpc.html`/`rpc.js` expandable rows + add/remove/reorder/default/test/save | 9 |
| §3 `general.html`/`general.js` sound move | 10 |
| §4 DownloadPanel dynamic select + fallback | 11 |
| §4 `pathHistory.html`/`pathHistory.js` per-server sections | 12 |
| §5 i18n keys (en only) | 7 |
| §5 file inventory (edits + deletes + new test file) | 9 (deletes), 1 (new) |
| §5 testing (node --test, stub, listed cases) | 1, 2, 14 |
| §5 error handling (fallback, save validation, uuid fallback) | 2 (`validateServers`, `newServerId`), 4, 9 |
| §5 out of scope (other locales, drag reorder, import/export, per-server sound) | not planned — correct |

**Deviation from spec:** the spec places `serverDefaults` in `config.js`; the plan puts `SERVER_DEFAULTS` in `App/lib/tools.js` instead, because that is the only file the migration and the options page both already load and it is the unit under test. Functionally identical; `config.js` still loses `s2`/`s3` and the six `guess` fields (Task 13).

**Placeholder scan:** no `TBD`/`TODO`/"add error handling"/"similar to Task N" — every code step carries literal content; every manual step has explicit expected output.

**Type consistency:** `migrateSchema(raw, opts)` with `opts.makeId`/`opts.names` — consistent Tasks 1↔2. `{ ok, error }` shape from `testServer` — consistent Tasks 6↔9. Server object keys `{id,name,protocol,host,port,interf,token,path}` — consistent Tasks 1, 2, 9, 11, 12. `dl:`/`dv:` menu-id prefixes and `slice(3)` — consistent within Task 6. Storage keys `servers` / `defaultServerId` / `schemaVersion` / `recentPaths` — consistent throughout. `browser.storage.local` stub supports the `get` arg forms actually used (`null`, string, array) — consistent Tasks 1↔2.
