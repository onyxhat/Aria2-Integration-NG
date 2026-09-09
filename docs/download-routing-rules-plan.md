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
- [ ] Write `tests/rules-engine.test.js` first (failing) — see the case list in
  the design doc §4 / the approved plan's Verification section.
- [ ] Implement `App/lib/rules.js`:
  - `RULE_DEFAULTS`, `RULE_FIELDS`, `RULE_STRING_OPS`, `RULE_NUMBER_OPS`, `newRuleId()`
  - `parseHumanSize(v)` — base-1024, `NaN` on failure
  - `buildMeta({ url, filename, mime, size, baseServerId })` — `URL` in try/catch;
    `ext` from filename then path; `mime` lowercased + param-stripped; `size`
    coerced to int or `null`
  - `evaluateRules(meta, rules, servers)` — ordered, first enabled match wins;
    unknown string attr never matches; `resolveDir` for off/absolute/append;
    server override only if present in `servers`; returns `{serverId, dir}` with
    `null` where unset, or `null`
  - `validateRules(rules, servers?)` — English literal strings
  - `getRules()` (coerce → `[]`), `saveRules(rules)`
  - `module.exports` shim
- [ ] `node --test tests/` green (new file + existing `rpc-servers.test.js`)
- Commit: `test: add rules-engine unit tests` + `feat: add download routing rules engine module`

### Task 3: `App/manifest.json` load order
- [ ] `background.scripts`: `"config.js", "/lib/tools.js", "/lib/rules.js", "common.js", "/lib/aria.js", "/lib/polygoat.js"`
- Commit: `feat: load rules.js in background`

### Task 4: `App/common.js` background wiring
- [ ] Add `var rulesCache = [];` and `var serversCache = [];` near the top globals.
- [ ] `loadSettings()`: append `getRules().then(r => rulesCache = r);` and
  `getServers().then(s => serversCache = s);`
- [ ] `prepareDownload(d)`: after `details.fileSize = getFileSize(d)`, capture
  raw `Content-Type` → `details.mime` and raw `Content-Length` →
  `details.sizeBytes` (`d.responseHeaders.findIndex`). In the non-panel branch,
  `buildMeta` → `evaluateRules(meta, rulesCache, serversCache)` →
  `sendTo(url, fileName, res && res.dir != null ? res.dir : "", header, (res && res.serverId) || baseSid)`.
- [ ] `cmCallback` → `dispatch()` non-panel branch: `buildMeta` with `mime:""`,
  `size:null`, `filename:getFileNameURL(url)`; `evaluateRules`;
  `sid = serverId || (res && res.serverId) || baseSid`;
  `dir = res && res.dir != null ? res.dir : ""`.
- [ ] `onInstalled` fresh-install branch: add `rules: []` to the `storage.local.set`.
- [ ] `node --test tests/` still green (regression).
- Commit: `feat: route auto downloads through the rules engine`

### Task 5: i18n — `App/_locales/en/messages.json`
- [ ] Add the `OP_rules*` keys (full list in design doc §4). Match the file's
  tab indentation and `"message"` / `"description"` shape.
- [ ] `node -e "JSON.parse(require('fs').readFileSync('App/_locales/en/messages.json'))"` OK
- Commit: `feat: add routing rules i18n strings (en)`

### Task 6: Options nav — `menu.html` / `menu.js`
- [ ] `menu.html`: `<li id="rules"><a data-message="OP_rules" href="#rules">Routing Rules</a></li>` after `#rpc`.
- [ ] `menu.js`: add `document.querySelector('#rules').className = "";` to the clear list.
- Commit: `feat: add Routing Rules options nav entry`

### Task 7: `App/data/options/rules.html`
- [ ] Clone `rpc.html`; adapt `<style>` (`.rule`, `.rule.open .body`,
  `.condition` flex row, `select`); body = intro / `#ruleList` / `#addRule` /
  `#errors` / `#status` + `#save`; scripts `/config.js`, `/lib/tools.js`,
  `/lib/rules.js`, `rules.js`.
- Commit: `feat: add Routing Rules options page markup`

### Task 8: `App/data/options/rules.js`
- [ ] Clone `rpc.js` structure. Reuse `msg`, `flash`, `showErrors`, `swap`,
  `[data-message]` sweep, `DOMContentLoaded` wiring.
- [ ] `render()` — rule card (header: enabled checkbox, title, ↑/↓, ×; body:
  name, match select, conditions sub-list with add/remove + field/op/value
  selects, action row with server select + folder mode select + folder input).
- [ ] `addRule()`, `removeRow()` (confirm, no last-row guard), `save()`
  (`validateRules(model, serverOptions)` → `saveRules` →
  `sendMessage({get:'loadSettings'})` → `flash`), `init()` (`getServers()` →
  `serverOptions`, `getRules()` → `model`).
- Commit: `feat: add Routing Rules options page logic`

### Task 9: Lint + manual verification
- [ ] `lint` skill (`web-ext lint` over `App/`) → 0 errors
- [ ] Manual pass — see design doc §4 / approved plan Verification (Manual)
- [ ] Flip both docs' Status to `implemented`
- Commit: `docs: mark routing rules design + plan implemented`
