# Design — Dynamic RPC Servers

**Branch:** `feature/server-mgr`
**Date:** 2026-09-08
**Status:** approved design, pending implementation plan

## Problem

RPC server management today is rigid and awkward:

- Exactly **three** server slots, hard-coded.
- Each slot edited on its **own options page** (`rpc.html`, `rpc2.html`,
  `rpc3.html`), reached through a CSS pop-out `<ul>` submenu under the `#rpc`
  nav item in `menu.html` — poor UX.
- Slot 1 is special: its storage keys are unsuffixed (`host`, `port`, …) and it
  also carries every non-server setting; slots 2/3 use `host2`/`host3` etc.
- `sendTo()` in `common.js` branches `if (server=="1") … else if "2" … else if
  "3"` with three near-identical ~100-line copies of the aria2 connection block.
- Path history (NG feature) is keyed positionally: `recentPaths: {"1":[], "2":[],
  "3":[]}`.

## Goal

A single **RPC Servers** options page managing a **dynamic number** of servers,
each a valid per-download target, with stable identity so path history and
selections survive add / remove / reorder.

## Decisions

| Question | Decision |
|---|---|
| Per-download server selection | **Keep the per-download picker** (DownloadPanel dropdown + context-menu submenu). One server marked *default*. |
| Storage refactor scope | **Approach A** — consolidate the six connection fields into a `servers` array; leave all non-connection settings where they are. |
| Server identity | **Random UUID** (`crypto.randomUUID()`, with a `Date.now()`+random fallback). |
| Existing config on upgrade | **Migrate on upgrade** — build `servers` from the old keys, remap path history, delete old keys. Guarded by `schemaVersion`. |
| Page layout | **Expandable rows** — compact row per server, click to expand fields. One page-level Save. |
| Server names | **Editable, optional.** Blank → fall back to `host:port` everywhere. |
| Per-row controls | Set-as-default, Reorder (↑/↓), Remove (confirm; not the last), **Test connection** (new capability). |
| "Download Completed Sound" | **Move to the General page** (unchanged single global `sound` key). |
| Spec location | `docs/dynamic-rpc-servers-design.md` (repo `docs/` convention). |

## Rejected approaches

- **B — one structured `settings` object.** Cleaner long-term but rewrites every
  `storage.local.get(config.command.guess, …)` call site across `common.js`,
  `tools.js`, and all options pages. Large regression surface, no benefit this
  feature needs. YAGNI.
- **C — dynamic flat keys (`host1..hostN` + `serverCount`).** No array, but keeps
  the stringly-typed pain and breaks stable identity on removal (renumber →
  orphaned path history, or leave holes). Strictly worse than A.

---

## Section 1 — storage schema & migration

### New schema

```
servers:         [{ id: <uuid>, name: "", protocol: "ws", host: "127.0.0.1",
                    port: "6800", interf: "jsonrpc", token: "", path: "" }, …]
defaultServerId: <uuid>
recentPaths:     { <uuid>: [ "…", … capped at 10, newest first ], … }
schemaVersion:   2
```

### `config.js`

- `config.command.guess`: **remove** `path`, `protocol`, `host`, `port`,
  `interf`, `token`, and the `recentPaths` seed. Keep everything else
  (`sound`, `zoom`, `menu`, `aggressive`, filters, `dpWidth`, …).
- **Delete** `config.command.s2` and `config.command.s3`.
- **Add** `config.command.serverDefaults` — the field template with no `id`:
  `{ name:"", protocol:"ws", host:"127.0.0.1", port:"6800", interf:"jsonrpc", token:"", path:"" }`.

### `lib/tools.js` — new helpers (co-located with the existing `recentPaths` helpers)

- `newServerId()` — `crypto.randomUUID()` when available, else
  `Date.now().toString(36) + Math.random().toString(36).slice(2)`.
- `getServers()` → `Promise<Array>`
- `getServer(id)` → `Promise<server | undefined>`
- `getDefaultServer()` → `Promise<server>` (falls back to `servers[0]` if
  `defaultServerId` is stale)
- `saveServers(arr)` — also prunes `recentPaths` keys not present in `arr`
- `setDefaultServer(id)`
- `removeServer(id)` — refuses when `servers.length === 1`; if `id` was the
  default, promotes `servers[0]` of the remainder.

Existing `recentPaths` helpers (`readRecentPaths`, `getRecentPaths(server)`,
`addRecentPath(server, p)`, `removeRecentPath`, `clearRecentPaths`) are unchanged
in body — the `server` argument is now a uuid string instead of `"1"`.

### Migration

Pure function `migrateSchema(raw)` — input the full `storage.local` blob, output
`{ servers, defaultServerId, recentPaths }`. Unit-testable with no browser.

Logic:

1. Always create a server from slot 1 (`raw.protocol`/`host`/`port`/`interf`/
   `token`/`path`; any field absent falls back to `serverDefaults`, so a
   fresh install yields one pre-seeded default server), `name` = message
   `OP_rpcDefault`.
2. Create slot 2 **iff** `"host2" in raw` (i.e. `rpc2.js` `save()` ever ran);
   `name` = `OP_rpc2`. Same for slot 3 (`"host3" in raw`, `OP_rpc3`).
3. New `recentPaths`: `"1" → slot1.id`; `"2" → slot2.id` and `"3" → slot3.id`
   only when those slots migrated. Drop the rest.
4. `defaultServerId = slot1.id`.

Driver in `common.js` (on load / `onInstalled`), runs when `servers` is absent
or `schemaVersion < 2`:

```
raw = await storage.local.get(null)
{servers, defaultServerId, recentPaths} = migrateSchema(raw)
await storage.local.set({servers, defaultServerId, recentPaths, schemaVersion: 2})
await storage.local.remove([
  "path","protocol","host","port","interf","token",
  "path2","protocol2","host2","port2","interf2","token2",
  "path3","protocol3","host3","port3","interf3","token3",
])
```

Idempotent — the `schemaVersion` guard makes re-runs a no-op.

---

## Section 2 — background (`common.js`; `lib/aria.js` untouched)

### `sendTo(url, fileName, filePath, header, serverId)`

Collapses the three-way branch to one path:

1. `server = await getServer(serverId)` — if missing (stale/removed id), use
   `getDefaultServer()`.
2. Build `options` from that one server, one `new Aria2(options)`, one
   open/addUri/retry/monitor block. ~200 lines net deleted.

### Auto-captured downloads (`common.js` ~L619)

The enclosing `storage.local.get` gains `servers`/`defaultServerId`; the call
`sendTo(details.url, …, "1")` becomes `sendTo(details.url, …, defaultServerId)`.

### Context menu — `contextMenus()` + `cmCallback()`

- `contextMenus()` becomes async and reads `servers`/`defaultServerId`/`menu`/
  `cmDownPanel` itself. Callers (`loadSettings`, `changeState`, init) `await` it.
- Menu-item id scheme: `A1/A2/A3` + `B1/B2/B3` → `dl:<uuid>` children under the
  existing `open-link` / `open-video` parents.
- When `!cmDownPanel`:
  - `servers.length === 1` → **no submenu**; clicking the parent sends to that
    server.
  - `servers.length > 1` → one child per server, title = `name || host:port`, in
    list order.
- `cmCallback()`: `serverId` = `info.menuItemId.slice(3)` when it starts with
  `dl:`, else `defaultServerId` (single-server parent click). `cmDownPanel`-on
  behaviour (open the panel) unchanged.

### "Open AriaNg" (`data/action/index.js`, `detail()`)

`storage.local.get(config.command.guess, …)` → get `servers`/`defaultServerId`;
build the `#!/settings/rpc/set/<protocol>/<host>/<port>/<interf>/<btoa(token)>`
URL from the **default server**.

### New message handler

`handleMessage` gains `get: "testServer"` — payload carries a server's current
field values; opens then closes an `Aria2`, replies `{ ok: bool, error?: string }`.
Keeps `lib/aria.js` out of the options pages.

---

## Section 3 — options: RPC Servers page, nav, General page

### `menu.html` / `menu.js`

- `#rpc` `<li>` loses its nested `<ul>` pop-out; `href="#"` → `href="#rpc"`.
- `menu.js`: delete the `location.hash == "#rpc" || "#rpc2" || "#rpc3"`
  special-case — every nav item is now 1:1 with a page.

### `rpc.html` / `rpc.js` (rebuilt; still loaded in the shell iframe)

- Keep the existing help / highlight blurb.
- `<div id="serverList">` + **Add server** button + one page-level **Save**
  button + `<span id="status">`.
- `rpc.js` renders one **expandable row** per `servers` entry:
  - **Collapsed header:** default radio · name-or-`host:port` · ↑ / ↓ · Remove
    (×) · expander caret.
  - **Expanded body:** Name, Protocol, Host, Port, Interface, Token, Default
    Download Path · **Test connection** button · per-row result line.
- **Add server**: append a row from `serverDefaults` + `newServerId()`, expanded,
  not default.
- **Remove**: confirm prompt; disabled at one row; if it was default, top
  remaining row becomes default; its `recentPaths[id]` dropped on Save.
- **Reorder** ↑/↓: swap in the in-memory array (drag optional later).
- **Save**: read rows → validate (host & port non-empty, port numeric, ≥1
  server, exactly one default) → `saveServers()` + `setDefaultServer()` →
  `browser.runtime.sendMessage({ get: "loadSettings" })` so the background
  rebuilds the context menu. Add/remove/reorder persist only on Save
  (consistent with the other options pages).
- **Test connection**: `rpc.js` posts `{ get:"testServer", server:{…row fields…} }`
  to the background and shows the `{ok,error}` reply on the row.

### `general.html` / `general.js`

Add the "Download Completed Sound" radio group moved from `rpc.html`. Still the
single top-level `sound` key: `general.js` `save()`/`restore()` gain the four
radios; `rpc.js` no longer touches `sound`; `config.command.guess` keeps `sound`.

---

## Section 4 — DownloadPanel & Path History page

### `DownloadPanel/index.html` / `index.js`

- `<select class="s1">` loses its three hard-coded `<option>`s → empty select.
- `init()`: before `loadPathHistory()`, fetch `servers`/`defaultServerId`, add
  one `<option value="<uuid>">name-or-host:port</option>` per server (list
  order), preselect `defaultServerId`.
- Downstream (`loadPathHistory()`, `download()` `server: rpc`,
  `addRecentPath(rpc, fp)`) already treats `.s1.value` as opaque — works once
  it's a uuid.
- If opened carrying a now-removed server id → select the default.

### `options/pathHistory.html` / `pathHistory.js`

- Drop `const SERVERS = ["1","2","3"]` and the hard-coded `#list1/#list2/#list3`.
- Render **one section per current server**, headed by name-or-`host:port`,
  iterating `getServers()`. Empty servers still show an (empty) section.
- Add/remove/clear handlers already carry the server key in a `data-` attribute
  — now a uuid.
- `recentPaths` entries whose uuid is not in `servers` are ignored on render and
  pruned on the next `saveServers()`.

---

## Section 5 — i18n, files, testing, error handling

### i18n

New keys in `App/_locales/en/messages.json` **only** — WebExtension `i18n` falls
back to `default_locale` (en), so de / zh_CN / zh_TW stay functional
untranslated (mirroring is a cheap optional follow-up, not this branch):

`OP_rpcAddServer`, `OP_rpcServerName`, `OP_rpcSetDefault`, `OP_rpcRemove`,
`OP_rpcRemoveConfirm`, `OP_rpcTest`, `OP_rpcTestOk`, `OP_rpcTestFail`,
`OP_rpcMoveUp`, `OP_rpcMoveDown`.

Kept: `OP_rpcServer` (nav + page title); `OP_rpcDefault` / `OP_rpc2` / `OP_rpc3`
(now only migration name seeds).

### Files

| Action | Files |
|---|---|
| Edit | `App/config.js`, `App/common.js`, `App/lib/tools.js`, `App/data/options/{menu.html,menu.js,rpc.html,rpc.js,general.html,general.js,pathHistory.html,pathHistory.js}`, `App/data/DownloadPanel/{index.html,index.js}`, `App/data/action/index.js`, `App/_locales/en/messages.json` |
| Delete | `App/data/options/{rpc2.html,rpc2.js,rpc3.html,rpc3.js}` |
| New | `tests/rpc-servers.test.js` |

### Testing

Repo has no test framework today; this feature adds a dependency-free
`node --test` file with an in-memory `browser.storage.local` stub:

- `migrateSchema(raw)` → correct output for: slot-1-only, all-three-slots,
  slot-1 + slot-3 (gap at 2), already-migrated (no-op).
- `removeServer(id)` promotes the top remaining server when the default is
  removed; refuses the last server.
- `addRecentPath` still caps at 10 / newest-first with uuid keys.
- reorder swap preserves ids.

Manual checklist (temporary add-on): add / remove / reorder / set-default /
Save; Test connection both outcomes; DownloadPanel dropdown and Path History
sections reflect the list; context menu shows N entries and collapses to no
submenu at one server; auto-captured download uses the default; "Open AriaNg"
uses the default; upgrade from a real 0.4.5 profile migrates cleanly.

### Error handling

- `sendTo` with an unknown id → fall back to default, no throw.
- Save validation blocks empty host/port, non-numeric port, zero servers, or no
  default server.
- `crypto.randomUUID` — available Firefox 95+; manifest `strict_min_version` is
  58, but this is a personal unlisted build. `newServerId()` carries a trivial
  fallback so the version floor is a non-issue.

## Out of scope

- Translating the new keys into de / zh_CN / zh_TW.
- Drag-and-drop reorder (↑/↓ is the baseline; drag can come later).
- Import/export of server config.
- Per-server completion sound.
