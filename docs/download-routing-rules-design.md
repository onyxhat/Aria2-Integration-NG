# Design — Download Routing Rules Engine

**Branch:** `feature/rules-engine`
**Date:** 2026-09-08
**Status:** approved design, pending implementation

## Problem

Every auto-triggered aria2 download goes to one fixed target: the **default** RPC
server, into that server's configured default folder (`sendTo()` in
`common.js`). Sending a download elsewhere means manually picking a server from
the context-menu submenu or the Download Panel dropdown, and typing a folder
into the panel every time. There is no way to say "ISOs always go to the NAS
under `/isos`" or "anything over 2 GB goes to the seedbox".

## Goal

A user-configurable, **ordered** list of routing rules. Each rule matches on
attributes of the download; on the **first enabled match**, it overrides the
target RPC server and/or the destination folder. No rule matches → behaviour is
identical to today.

## Decisions

| Question | Decision |
|---|---|
| Match attributes | Download URL, URL host, URL path, filename, file extension, MIME type, file size (bytes). **Not** page/referrer host, **not** container/incognito. |
| Where rules apply | The two **auto** paths only: context-menu clicks (`cmCallback`) and webRequest interception (`prepareDownload`). The Download Panel path is untouched — it stays fully manual. |
| MIME / size on the context-menu path | Unknown there (no response headers). Conditions on `mime` / `size` simply never match for context-menu downloads. Documented in the page intro. |
| Precedence | First **enabled** rule whose conditions pass wins. Conditions within a rule combine with **ALL** (AND) or **ANY** (OR). |
| Explicit server pick vs. rule | An explicit `dl:`/`dv:` context-menu server choice **wins** over a rule's server override. The rule's *folder* action still applies (relative to the explicitly chosen server). |
| Module placement | New standalone `App/lib/rules.js`. **Not** folded into `tools.js` (already large, just took the server refactor; the engine is a cohesive unit with its own test file). |
| Evaluation | `evaluateRules()` is **pure and synchronous**. Background caches `rules` + `servers` in globals, refreshed in `loadSettings()`. |
| `sendTo` signature | **Unchanged.** Rules resolve upstream to `{serverId, dir}` and pass in via the existing `serverId` / `filePath` args. |
| Storage | Additive — new `rules: []` key. **No `schemaVersion` bump** (orthogonal to the server schema; `runMigration()` guard untouched). |
| Options UI | New `Routing Rules` section, cloned from the RPC Servers page (`rpc.html` / `rpc.js`) — same collapsible-card / reorder / single-Save pattern. |
| i18n | New `OP_rules*` keys in `en` only; `de` / `zh_CN` / `zh_TW` fall back via WebExtension i18n and the `msg(key, fallback)` helper. |

## Rejected approaches

- **Widen `sendTo` to carry a `meta` object and evaluate rules inside it.**
  Entangles the transport sink with routing policy; callers must still assemble
  `meta`, so no code is saved.
- **Fold the engine into `tools.js`.** Churns the file that just absorbed the
  dynamic-servers refactor; the engine wants its own `node --test` file
  (mirroring `tests/rpc-servers.test.js`).
- **`declarativeNetRequest` / `downloads.onDeterminingFilename` based routing.**
  The extension is manifest v2 and routes through `webRequest`; this would be a
  rewrite for no in-scope benefit.

---

## Section 1 — `App/lib/rules.js`

### Stored `rules` array — one element

```
{
  id:      "r-<base36time>-<base36rand>",     // newRuleId()
  name:    "",                                // optional label
  enabled: true,
  match:   "all",                             // "all" | "any"  (anything else => "all")
  conditions: [ { field, op, value }, ... ],  // MUST be non-empty; empty => invalid, skipped
  action: {
    serverId:   "",        // "" => keep caller's server; else a server uuid
    folderMode: "off",     // "off" | "absolute" | "append"
    folder:     ""         // absolute path, or subfolder name for "append"
  }
}
```

### `meta` — built by `buildMeta({ url, filename, mime, size, baseServerId })`

| field | derivation | unknown |
|---|---|---|
| `url` | as-is | — |
| `host` | `new URL(url).hostname`, lowercased | `""` (unparseable URL — `try/catch`) |
| `path` | `new URL(url).pathname` | `""` |
| `filename` | resolved name (may be empty) | `""` |
| `ext` | last dot-segment of `filename`, else of `path` basename; lowercased, no dot | `""` |
| `mime` | `String(mime).toLowerCase().split(";")[0].trim()` | `""` (context-menu path) |
| `size` | `Number.isFinite(+size) ? Math.trunc(+size) : null` | `null` (context-menu path) |
| `baseServerId` | server the caller would use with no rule | — |

### Operator matrix

**String fields** — `url`, `host`, `path`, `filename`, `ext`, `mime`. Both sides
lowercased.

| op | semantics |
|---|---|
| `contains` | substring present |
| `notContains` | substring absent |
| `equals` | exact string equality |
| `startsWith` | prefix |
| `endsWith` | suffix |
| `inList` | `value` split on `,` and newline, trimmed; match if the attribute equals any token |
| `regex` | `new RegExp(rawValue, "i").test(rawAttr)` in `try/catch` — invalid pattern → no match, no throw |

**Unknown-attribute rule:** when the resolved string attribute is `""`, *every*
string operator returns `false`. Unknown never matches — this prevents a
`notContains` condition from acting as a catch-all on context-menu downloads.

**Number field** — `size`. Ops: `gt`, `gte`, `lt`, `lte`, `eq`.
`meta.size === null` → `false`. `value` parsed by `parseHumanSize()`:

- accepts `100MB`, `1.5MB`, `2 GiB`, `500000`, plain integers
- **base 1024 for every unit** (`KB` == `KiB` — deliberate simplification)
- unit map: `"" → 1`, `k → 1024`, `m → 1024²`, `g → 1024³`, `t → 1024⁴`, `p → 1024⁵`
- unparseable → `NaN` → the condition is `false`

### Folder action — `resolveDir(rule, effectiveServer)`

`effectiveServer` = the rule's server override if valid, else the caller's base
server.

| `folderMode` | result `dir` |
|---|---|
| `"off"` / unknown | `null` → caller keeps its own dir (`""` → server default, current behaviour) |
| `"absolute"` | `rule.action.folder` verbatim (empty → `null`). Returned **raw** — `sendTo` already escapes `\` → `\\`. |
| `"append"` | `effectiveServer.path` (trailing `/`,`\` stripped) + `"/"` + `folder` (leading slashes stripped). Empty server path → just `folder`. Joined with `/` only (aria2 accepts `/` on Windows); no separator conversion. |

### `evaluateRules(meta, rules, servers) → { serverId, dir } | null`

- `rules` not an array → `null`. `servers` coerced to `[]`.
- Iterate `rules` in order; skip a rule when `enabled === false` or
  `conditions` is empty / not an array.
- `ok = match === "any" ? conditions.some(match) : conditions.every(match)`.
- First `ok` rule — resolve and **return immediately**:
  - server override applied only if `action.serverId` is non-empty **and**
    present in `servers`; otherwise `serverId: null`.
  - `dir` via `resolveDir` against the effective server.
  - `{ serverId: <uuid|null>, dir: <string|null> }`
- No match → `null`.

Caller contract: `serverId === null` → keep your own server; `dir === null` →
keep your own dir.

### `validateRules(rules, servers?) → string[]`

Hard-coded English literal strings (parallel to `validateServers` in
`tools.js`, so the options page renders them raw and node tests assert on them).
`[]` → `[]` (empty ruleset = feature off). Non-array → `["Rules must be a list."]`.
Per rule (`label = name.trim() || "Rule N"`): empty/non-array conditions;
unknown field; operator not valid for the field's type; empty condition value;
invalid regex; invalid size; invalid folder mode; `absolute`/`append` with empty
folder; (only when `servers` passed) `action.serverId` set but not found.

### Exports (`module.exports` shim — inert in-extension)

`RULE_DEFAULTS`, `RULE_FIELDS`, `RULE_STRING_OPS`, `RULE_NUMBER_OPS`,
`newRuleId`, `getRules`, `saveRules`, `buildMeta`, `parseHumanSize`,
`evaluateRules`, `validateRules`.

### Storage helpers

- `getRules()` → `Promise<Array>` — coerces missing / non-array to `[]`.
- `saveRules(rules)` → `Promise` — `browser.storage.local.set({ rules })`.

---

## Section 2 — background (`App/manifest.json`, `App/common.js`)

### Load order

`background.scripts`: `"/lib/rules.js"` inserted **after `/lib/tools.js`, before
`common.js`**. `rules.js` has no dependency on `tools.js`; `common.js` calls
`evaluateRules` / `buildMeta`.

### Caches

New globals in `common.js`: `rulesCache = []`, `serversCache = []`. Refreshed in
`loadSettings()` (`getRules()` / `getServers()`), which already re-runs on
startup and on every options-page Save (`sendMessage({get:'loadSettings'})`).

### `prepareDownload(d)` — interception path

- After `details.fileSize = getFileSize(d)`, also capture the raw
  `Content-Type` → `details.mime` and raw `Content-Length` → `details.sizeBytes`
  (same `d.responseHeaders.findIndex` pattern as `getFileSize`).
- In the non-panel branch: `buildMeta` from
  `{ url, filename, mime, size: sizeBytes, baseServerId }`, `evaluateRules`
  against the caches, then
  `sendTo(url, fileName, res?.dir ?? "", header, res?.serverId || baseSid)`.

### `cmCallback(info, tab)` — context-menu path

- In `dispatch()`'s non-panel branch, after resolving `baseSid`: `buildMeta`
  with `mime: ""`, `size: null`, `filename: getFileNameURL(url)`;
  `evaluateRules`.
- Server: `sid = serverId || res?.serverId || baseSid` — an explicit `dl:`/`dv:`
  choice wins.
- Dir: `res?.dir ?? ""`. "append" resolves against whichever server actually
  ends up used.

### First-run seeding

`onInstalled` fresh-install branch: add `rules: []` to the existing
`storage.local.set`. Upgrades need nothing — `getRules()` coerces a missing key
to `[]`.

---

## Section 3 — options UI

### Nav — `menu.html` / `menu.js`

- `menu.html`: `<li id="rules"><a data-message="OP_rules" href="#rules">Routing Rules</a></li>`
  after the `#rpc` `<li>`.
- `menu.js`: add `#rules` to the `className = ""` clearing list. The active-set
  line is already generic.

### `rules.html` (new — clone `rpc.html`)

`rpc.html`'s `<style>` block plus `.rule` / `.rule.open .body` / `.condition`
(flex row) rules. Body: `.highlight` intro (`OP_rulesIntro`),
`<div id="ruleList">`, `<button id="addRule">`, `<div id="errors">`,
right-aligned `<span id="status">` + `<button id="save">`. Scripts:
`/config.js`, `/lib/tools.js`, `/lib/rules.js`, `rules.js`.

### `rules.js` (new — clone `rpc.js`)

Reused verbatim: `msg()`, `flash()`, `showErrors()`, `swap()`, the
`[data-message]` sweep + `direction` in `init()`, `DOMContentLoaded` wiring.
State: `model` (working copy), `openIds`, `serverOptions` (`getServers()`).

`render()` per rule card:

- **Header:** `enabled` checkbox · clickable title (`name` or `Rule N`) · ↑ / ↓
  (`swap`) · × (`removeRow`, `confirm`; no last-row guard — zero rules is valid).
- **Body:** Name input; Match `<select>` all/any; **conditions sub-list** — each
  row = field `<select>` (`RULE_FIELDS`; on change, reset `op` to the first op
  of the new field's type) + op `<select>` (string vs number op list) + value
  `<input>` (placeholder: size hint / inList hint where relevant) + ×
  (`splice`); `+ condition` button pushes
  `{ field:'url', op:'contains', value:'' }`.
- **Action row:** Target server `<select>` (first option `""` = "Keep default /
  selected", then one per `serverOptions`); Folder mode `<select>`
  off / absolute / append; Folder `<input>` (disabled when mode `off`).

`addRule()`: deep-copy `RULE_DEFAULTS`, `id = newRuleId()`, seed one blank
condition, expand, `render()`.
`save()`: `validateRules(model, serverOptions)` → `showErrors`, or
`saveRules(model)` → `sendMessage({get:'loadSettings'})` → `flash()`.

---

## Section 4 — i18n, files, testing

### i18n — `App/_locales/en/messages.json` only

`OP_rules`, `OP_rulesIntro`, `OP_rulesAddRule`, `OP_rulesRuleName`,
`OP_rulesRuleNamePlaceholder`, `OP_rulesEnabled`, `OP_rulesMatchAll`,
`OP_rulesMatchAny`, `OP_rulesAddCondition`, `OP_rulesRemove`,
`OP_rulesRemoveConfirm`, `OP_rulesMoveUp`, `OP_rulesMoveDown`,
`OP_rulesFieldUrl`, `OP_rulesFieldHost`, `OP_rulesFieldPath`,
`OP_rulesFieldFilename`, `OP_rulesFieldExt`, `OP_rulesFieldMime`,
`OP_rulesFieldSize`, `OP_rulesOpContains`, `OP_rulesOpNotContains`,
`OP_rulesOpEquals`, `OP_rulesOpStartsWith`, `OP_rulesOpEndsWith`,
`OP_rulesOpInList`, `OP_rulesOpRegex`, `OP_rulesOpGt`, `OP_rulesOpGte`,
`OP_rulesOpLt`, `OP_rulesOpLte`, `OP_rulesOpEq`, `OP_rulesActionServer`,
`OP_rulesKeepServer`, `OP_rulesFolderMode`, `OP_rulesFolderOff`,
`OP_rulesFolderAbsolute`, `OP_rulesFolderAppend`, `OP_rulesFolderPlaceholder`,
`OP_rulesSizeHint`, `OP_rulesInListHint`.

Validation strings are English literals in `rules.js`, not i18n keys.

### Files

| Action | Files |
|---|---|
| New | `App/lib/rules.js`, `App/data/options/rules.html`, `App/data/options/rules.js`, `tests/rules-engine.test.js`, `docs/download-routing-rules-design.md`, `docs/download-routing-rules-plan.md` |
| Edit | `App/manifest.json`, `App/common.js`, `App/_locales/en/messages.json`, `App/data/options/menu.html`, `App/data/options/menu.js` |

### Testing

`tests/rules-engine.test.js` — `node --test`, harness identical to
`tests/rpc-servers.test.js` (`makeBrowserStub`, cache-buster; `URL` is a Node
global). Covers every operator (positive + negative), `parseHumanSize`,
unknown-attribute skipping, ALL/ANY, first-match-wins, disabled-rule skip,
empty-conditions skip, deleted-server fallback, all three folder modes incl.
path normalisation, result shape, context-menu meta, `buildMeta` edge cases,
`validateRules` branches, `getRules`/`saveRules` round-trip. Existing
`tests/rpc-servers.test.js` stays green.

Manual: temporary add-on in Firefox, two RPC servers, rules exercising the
context-menu / interception / MIME / size / explicit-choice / panel-unaffected /
disable-delete paths. `lint` skill (`web-ext lint`) → 0 errors.

## Out of scope

- Page/referrer host, container, incognito as match attributes.
- Applying rules to the Download Panel path.
- Translating the new keys into de / zh_CN / zh_TW.
- Drag-and-drop reordering of rules or conditions (↑/↓ is the baseline).
- Import / export of rules.
- A per-rule "test this URL" preview in the options UI.
