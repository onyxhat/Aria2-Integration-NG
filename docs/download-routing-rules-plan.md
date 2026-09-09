# Download Routing Rules — Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking. One Conventional Commit per task.

**Goal:** A user-configurable, ordered list of routing rules that override the
target RPC server and/or destination folder for auto-triggered downloads
(context-menu clicks and webRequest interception). No rule matches → behaviour
unchanged.

**Spec:** `docs/download-routing-rules-design.md`

**Tech stack:** Plain ES5/ES2017 JS, Firefox WebExtension manifest v2, no build
step. Tests: Node's built-in `node:test` + `node:assert`, in-memory
`browser.storage.local` stub (`tests/helpers/browser-stub.js`), run with
`node --test tests/`.

## Global constraints

- No build step. `App/` loaded as-is. Plain HTML/JS only.
- Edit only NG files. Never touch `App/data/ariang/**`, `App/lib/aria.js`,
  `App/lib/polygoat.js`, `App/lib/jschardet.min.js`, `Bin/**`.
- Feature work: do **not** bump `manifest.json` `version`, edit `CHANGELOG.md`,
  or sign. Branch touches `App/`, `tests/`, `docs/` only.
- i18n: new keys in `App/_locales/en/messages.json` only.
- No new manifest permissions. Additive storage, no `schemaVersion` bump.

## Storage schema (added)

```
rules: [
  {
    id: "r-<base36>-<base36>", name: "", enabled: true, match: "all",  // "all" | "any"
    conditions: [ { field, op, value }, ... ],   // non-empty
    action: { serverId: "", folderMode: "off", folder: "" }  // folderMode: off | absolute | append
  },
  ...
]
```

Missing key ⇒ `getRules()` returns `[]` ⇒ feature is off.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `App/lib/rules.js` | Rule engine: `buildMeta`, `evaluateRules`, `parseHumanSize`, `validateRules`, `getRules`/`saveRules`, constants, export shim | **Create** |
| `tests/rules-engine.test.js` | Unit tests for the pure + storage logic | **Create** |
| `App/manifest.json` | `background.scripts` load order | Modify — add `/lib/rules.js` after `/lib/tools.js`, before `common.js` |
| `App/common.js` | Background wiring | Modify — `rulesCache`/`serversCache` globals; refresh in `loadSettings()`; `evaluateRules` in `prepareDownload` (+ thread MIME/size) and `cmCallback`; seed `rules: []` on fresh install |
| `App/data/options/menu.html` / `menu.js` | Options shell + nav | Modify — add `#rules` nav entry + className-clear line |
| `App/data/options/rules.html` / `rules.js` | The Routing Rules page | **Create** — clone of `rpc.html` / `rpc.js`; nested conditions sub-list + action row |
| `App/_locales/en/messages.json` | English strings | Modify — new `OP_rules*` keys |

---

### Task 1: Design + plan docs
- [x] Create `docs/download-routing-rules-design.md`
- [x] Create `docs/download-routing-rules-plan.md`
- Commit: `docs: add download routing rules design + plan`

### Task 2: `App/lib/rules.js` + `tests/rules-engine.test.js` (TDD)
- [x] Write `tests/rules-engine.test.js` first (failing) — see the case list in
  the design doc §4 / the approved plan's Verification section.
- [x] Implement `App/lib/rules.js`:
  - `RULE_DEFAULTS`, `RULE_FIELDS`, `RULE_STRING_OPS`, `RULE_NUMBER_OPS`, `newRuleId()`
  - `parseHumanSize(v)` — base-1024, `NaN` on failure
  - `buildMeta({ url, filename, mime, size, baseServerId })` — `URL` in try/catch;
    `ext` from filename then path; `mime` lowercased + param-stripped; `size`
    coerced to int or `null`
  - `evaluateRules(meta, rules, servers, opts)` — ordered, first enabled match
    wins; unknown string attr never matches; `resolveDir` for
    off/absolute/append; server override only if present in `servers` and not
    locked by `opts.lockServerId`; returns `{serverId, dir}` with `null` where
    unset, or `null`
  - `validateRules(rules, servers?)` — English literal strings
  - `getRules()` (coerce → `[]`), `saveRules(rules)`
  - `module.exports` shim
- [x] `node --test tests/` green — 50 pass (new file + existing `rpc-servers.test.js`)
- Commits: `feat: add download routing rules engine module` (test + module together)

### Task 3: `App/manifest.json` load order
- [x] `background.scripts`: `"config.js", "/lib/tools.js", "/lib/rules.js", "common.js", "/lib/aria.js", "/lib/polygoat.js"`
- Commit: folded into Task 4's `feat: route auto downloads through the rules engine`

### Task 4: `App/common.js` background wiring
- [x] `var rulesCache = [];` / `var serversCache = [];` near the top globals.
- [x] `loadSettings()`: `getRules().then(r => rulesCache = r);` +
  `getServers().then(s => serversCache = s);`
- [x] `prepareDownload(d)`: capture raw `Content-Type` → `details.mime` and
  `Content-Length` → `details.sizeBytes`; non-panel branch `buildMeta` →
  `evaluateRules(meta, rulesCache, serversCache)` → `sendTo` with resolved
  dir/serverId.
- [x] `cmCallback` → `dispatch()` non-panel branch: `buildMeta` (`mime:""`,
  `size:null`); `evaluateRules(meta, …, serverId ? {lockServerId: serverId} : null)`;
  `sid = serverId || res?.serverId || baseSid`.
- [x] `onInstalled` fresh-install branch: `rules: []` added to `storage.local.set`.
- [x] `node --test tests/` still green.
- Commit: `feat: route auto downloads through the rules engine`

### Task 5: i18n — `App/_locales/en/messages.json`
- [x] Added the `OP_rules*` keys; JSON validates (157 keys).
- Commit: `feat: add routing rules i18n strings (en)`

### Task 6: Options nav — `menu.html` / `menu.js`
- [x] `menu.html`: `#rules` `<li>` added after `#rpc`.
- [x] `menu.js`: `#rules` added to the className-clear list.
- Commit: `feat: add Routing Rules options nav entry`

### Task 7 + 8: `App/data/options/rules.html` + `rules.js`
- [x] `rules.html` cloned from `rpc.html` (adapted `<style>`, script order).
- [x] `rules.js` — `render()` rule cards (enable toggle, title, ↑/↓, ×; name,
  match select, conditions sub-list, action rows), `addRule` / `removeRow` /
  `save` / `normalize` / `init`.
- Commit: `feat: add Routing Rules options page`

### Task 9: Lint + manual verification
- [x] `web-ext lint` over `App/` → 0 errors; no new warnings/notices from this
  feature (remaining warnings are pre-existing manifest/Android-API notices).
- [x] Engine coverage: 50 `node:test` cases + an end-to-end simulation of both
  `common.js` call sites.
- [ ] Interactive Firefox smoke test (temporary add-on + running aria2) — see
  design doc §4 / approved plan Verification (Manual). **Pending — needs a
  Firefox + aria2 environment.**
- Commit: `docs: mark routing rules design + plan implemented`
