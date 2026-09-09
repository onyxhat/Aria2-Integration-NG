# Aria2 Integration NG

A Firefox add-on that integrates the browser's downloads with an [Aria2][aria2]
RPC server, bundling the [AriaNg][ariang] web UI.

**NG** is a personal fork of [Aria2 Download Manager Integration][upstream]
(by Ross Wang), maintained by Isaac Springer. It is **not published on AMO** —
it is signed through Mozilla's unlisted channel and installed manually (see
*Build & install* below).

- Source / homepage: <https://github.com/onyxhat/Aria2-Integration-NG>
- Extension ID: `aria2-integration-ng@springer`

## What NG changes

- **Dynamic RPC servers.** The three fixed server slots — each on its own
  options page, reached through a pop-out submenu — are replaced by one
  **RPC Servers** page that manages any number of servers as an expandable
  list: add, rename, reorder, remove, mark one as default, and test a
  connection inline. The download pop-up and the *Download with Aria2* context
  menu still let you choose the target server per download; the default server
  is used for auto-captured downloads and *Open AriaNg*. Existing 0.4.5
  settings migrate automatically on first run.
- **Download routing rules.** **Options → Routing Rules** holds an ordered
  list of rules that pick a target server and/or destination folder for a
  download from its attributes — URL, host, path, file name, extension, MIME
  type, or size — with ALL/ANY logic and `contains` / `equals` /
  `starts` / `ends with` / `is one of` / `matches regex` / numeric-size
  (`100MB`, `2GiB`, …) operators. A rule's action sets the target server (or
  keeps the default) and the folder — an absolute path, or a subfolder
  appended to the server's default path. Rules run on intercepted downloads
  and *Download with Aria2* clicks **before** the download pop-up: the first
  enabled matching rule sends straight to aria2 and skips the pop-up, which is
  shown only when nothing matches. An explicit context-menu server choice
  still wins over a rule's server. MIME type and file size are unknown for
  context-menu downloads, so rules keyed on them only affect intercepted ones.
- **File Path history in the download pop-up.** The *File Path* field is a
  combobox: it pre-fills with the most recently used directory, offers a
  drop-down of previous paths, and still accepts a freshly typed path. History
  is kept per RPC server, capped at 10 entries, newest first. Only the aria2
  *Download* action records a path. The drop-down is a custom control styled to
  match the pop-up (not the native `<datalist>`).
- **Options → Path History.** A page to manage that history: add a path
  manually, remove an individual entry, or clear a server's list.
- **"Download Completed Sound"** moved from the RPC settings page to
  **Options → General**.
- **Toolbar pop-up** gains a **Preferences** button (next to *Details*) that
  opens the options page; **Options → About** shows live Aria2 connection
  status.

Otherwise it tracks upstream. See [CHANGELOG.md](CHANGELOG.md).

## Build & install

The extension source lives in [`App/`](App/). There is no build step — it is
plain HTML/JS loaded as-is.

| Command | Result |
| --- | --- |
| `scripts/package.sh` | `dist/aria2-integration-ng-<version>.xpi` — **unsigned**. Installs only on Firefox Developer Edition / Nightly / ESR with `about:config` → `xpinstall.signatures.required = false`. Also handy for `web-ext lint`. |
| `scripts/sign.sh` | Submits `App/` to addons.mozilla.org on the **unlisted** channel, downloads the Mozilla-signed `dist/aria2-integration-ng-<version>.xpi`. Installs on **release** Firefox. |

`scripts/sign.sh` needs AMO API credentials in the environment (never commit them):

```bash
AMO_JWT_ISSUER='user:...:...' \
AMO_JWT_SECRET='...' \
scripts/sign.sh
```

Generate the pair at addons.mozilla.org → **Manage API Keys**. Bump `version`
in [`App/manifest.json`](App/manifest.json) before every sign — AMO rejects a
version string it has already signed for this add-on ID.

**Install the `.xpi`:** Firefox → `about:addons` → gear icon →
*Install Add-on From File…* → pick the file from `dist/`.

For a throw-away test without packaging, load `App/manifest.json` via
`about:debugging` → *This Firefox* → *Load Temporary Add-on* (cleared on
restart, and its `storage.local` does not persist).

The bundled [AriaNg][ariang] UI under `App/data/ariang/` is a built release
artifact — refresh it only with `scripts/update-ariang.sh [version]`, never by
hand. `App/data/ariang/.ariang-version` records the bundled release.

## Tests

The RPC-server and routing-rules logic have dependency-free unit tests
(`tests/`, using Node's built-in `node:test` with an in-memory
`browser.storage.local` stub). Run:

```bash
node --test tests/
```

## Reference

- Aria2 — <https://github.com/aria2/aria2>
- AriaNg — <https://github.com/mayswind/AriaNg>

[aria2]: https://github.com/aria2/aria2
[ariang]: https://github.com/mayswind/AriaNg
[upstream]: https://github.com/RossWang/Aria2-Integration
