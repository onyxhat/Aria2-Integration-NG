# Aria2 Integration NG

A personal fork of [Aria2 Download Manager Integration](https://github.com/RossWang/Aria2-Integration)
(by Ross Wang), maintained by Isaac Springer at
<https://github.com/onyxhat/Aria2-Integration-NG>. Self-signed and distributed
as an unlisted add-on (not on AMO). Extension ID `aria2-integration-ng@springer`.
Upstream release history is preserved below.

## 0.5.3 (NG) — 2026-09-08

First signed build since 0.4.5; folds in the dynamic RPC server work
(0.5.0–0.5.2, previously unreleased) plus the new routing rules engine.

### Features

* **Dynamic RPC servers.** The three fixed server slots — each on its own
  options page behind a pop-out submenu — are replaced by one
  **Options → RPC Servers** page managing any number of servers as an
  expandable list: add, rename, reorder, remove, mark one default, and test a
  connection inline. Per-download server choice (download pop-up drop-down and
  the *Download with Aria2* context-menu submenu) is kept; the default server
  is used for auto-captured downloads and *Open AriaNg*. Servers are stored as
  a UUID-keyed array (`servers`, `defaultServerId`, `schemaVersion: 2`);
  existing 0.4.5 settings — including per-slot **Path History** — migrate
  automatically on first run, and the old flat connection keys are removed.
* **Download routing rules.** New **Options → Routing Rules** page: an ordered
  list of rules that send a download to a specific server and/or folder based
  on its attributes — download URL, URL host, URL path, file name, file
  extension, MIME type, or file size — combined with ALL / ANY logic and
  operators including `contains`, `does not contain`, `equals`,
  `starts` / `ends with`, `is one of`, `matches regex`, and numeric size
  comparisons (`100MB`, `2GiB`, `500000`, …). A rule's action sets the target
  server (or keeps the default) and the folder — an absolute path, or a
  subfolder appended to the server's default path. Rules are evaluated on both
  auto paths (intercepted downloads and *Download with Aria2*) **before** the
  download pop-up: the first enabled matching rule sends straight to aria2 and
  skips the pop-up; the pop-up is shown only when no rule matches. An explicit
  context-menu server choice still wins over a rule's server. MIME type and
  file size are unknown for context-menu downloads, so rules keyed on them
  only affect intercepted downloads. No new permissions; stored in a new
  additive `rules` key (no schema-version change).
* **Preferences button** in the toolbar pop-up, next to *Details* — opens the
  add-on's options page.
* Live Aria2 connection status on **Options → About**.

### Changed

* "Download Completed Sound" moved from the RPC settings page to
  **Options → General**.
* The *Download with Aria2* context menu shows a per-server submenu only when
  more than one server is configured.
* Bundled **AriaNg updated to 1.3.14**; `App/data/ariang/.ariang-version`
  now records the bundled release.
* `applications.gecko.strict_min_version` `58.0` → `61.0`.

### Build tooling

* `scripts/update-ariang.sh [version]` — refresh the bundled AriaNg release
  artifact under `App/data/ariang/` (never edit it by hand).
* `tests/` — dependency-free `node --test` suites
  (`tests/rpc-servers.test.js`, `tests/rules-engine.test.js`) with an
  in-memory `browser.storage.local` stub. Run `node --test tests/`.

> The next signed build must bump `version` in `App/manifest.json` — AMO
> rejects a version string it has already signed for this add-on ID.

## 0.4.5 (NG) — 2026-09-05

First NG build, signed via the AMO unlisted channel.

### Features

* Download pop-up **File Path** field is now a combobox with per-RPC-server
  history — pre-fills the most recent path, drop-down of previous paths, free
  text entry. Custom drop-down styled to match the pop-up (replaces the native
  `<datalist>`). History is capped at 10 paths per server, newest first; only
  the aria2 *Download* action records a path.
* New **Options → Path History** page — add paths manually, remove individual
  entries, clear a server's list.

### Changed

* Renamed to **Aria2 Integration NG**; localized name updated in all four
  locales.
* Extension ID `{e2488817-…}` → `aria2-integration-ng@springer`. Firefox treats
  this as a new add-on, so existing `storage.local` settings do not carry over.
* `applications.gecko.strict_min_version` `57.0` → `58.0` (AMO minimum).
* Removed `homepage_url` (AMO disallows linking to `addons.mozilla.org`).

### Build tooling

* `scripts/package.sh` — build an unsigned `.xpi` for Developer Edition / ESR
  test installs.
* `scripts/sign.sh` — submit `App/` to the AMO unlisted channel for signing;
  reads `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` from the environment.

> The next signed build must bump `version` in `App/manifest.json` — AMO rejects
> a version string it has already signed for this add-on ID.

---

## [0.4.5](https://github.com/RossWang/Aria2-Integration/compare/0.4.4...0.4.5) (2019-06-14)


### Bug Fixes

* fix a issue with Aggressive Mode ([8cc77c1](https://github.com/RossWang/Aria2-Integration/commit/8cc77c1))


### Features

* update AriaNg to 1.1.1 ([15451d1](https://github.com/RossWang/Aria2-Integration/commit/15451d1))



## [0.4.4](https://github.com/RossWang/Aria2-Integration/compare/0.4.3...0.4.4) (2019-04-05)



## [0.4.3](https://github.com/RossWang/Aria2-Integration/compare/0.4.2...0.4.3) (2019-04-05)


### Bug Fixes

* Fix a file name parsing issue ([098091f](https://github.com/RossWang/Aria2-Integration/commit/098091f)), closes [#53](https://github.com/RossWang/Aria2-Integration/issues/53)



## [0.4.2](https://github.com/RossWang/Aria2-Integration/compare/0.4.1...0.4.2) (2019-03-19)


### Bug Fixes

* Fix a display issue ([4398338](https://github.com/RossWang/Aria2-Integration/commit/4398338))


### Features

* Update AriaNg to Version 1.0.1 ([9d42f8e](https://github.com/RossWang/Aria2-Integration/commit/9d42f8e))
* Update jschardet to Version 2.1.0 ([9370b78](https://github.com/RossWang/Aria2-Integration/commit/9370b78))



## [0.4.1](https://github.com/RossWang/Aria2-Integration/compare/0.4.0...0.4.1) (2018-12-22)


### Bug Fixes

* Fix an encoding issue ([#8](https://github.com/RossWang/Aria2-Integration/issues/8)) ([5210146](https://github.com/RossWang/Aria2-Integration/commit/5210146))



# [0.4.0](https://github.com/RossWang/Aria2-Integration/compare/0.3.6...0.4.0) (2018-12-20)


### Bug Fixes

* automatically close browser action popup ([#47](https://github.com/RossWang/Aria2-Integration/issues/47)) ([2a7a4cd](https://github.com/RossWang/Aria2-Integration/commit/2a7a4cd))
* Download url not urlencoding parentheses ([a8fbdf3](https://github.com/RossWang/Aria2-Integration/commit/a8fbdf3)), closes [#36](https://github.com/RossWang/Aria2-Integration/issues/36)
* Fix a file name encoding issue ([989912b](https://github.com/RossWang/Aria2-Integration/commit/989912b)), closes [#8](https://github.com/RossWang/Aria2-Integration/issues/8)
* Fix link in about page ([311701f](https://github.com/RossWang/Aria2-Integration/commit/311701f)), closes [#38](https://github.com/RossWang/Aria2-Integration/issues/38)
* It will no longer trigger notification from other sources ([cf9660e](https://github.com/RossWang/Aria2-Integration/commit/cf9660e)), closes [#42](https://github.com/RossWang/Aria2-Integration/issues/42)


### Features

* Downloads trigger from context menu can now display the file name ([#45](https://github.com/RossWang/Aria2-Integration/issues/45)) ([383280e](https://github.com/RossWang/Aria2-Integration/commit/383280e))
* update AriaNg to 1.0.0 ([ccb10aa](https://github.com/RossWang/Aria2-Integration/commit/ccb10aa))



## [0.3.6](https://github.com/RossWang/Aria2-Integration/compare/0.3.5...0.3.6) (2018-07-17)


### Bug Fixes

* filter setting cannot be saved([#31](https://github.com/RossWang/Aria2-Integration/issues/31)) ([6957f35](https://github.com/RossWang/Aria2-Integration/commit/6957f35))
* Fix a file name encoding issue on baidupcs.com ([#8](https://github.com/RossWang/Aria2-Integration/issues/8)) ([b675908](https://github.com/RossWang/Aria2-Integration/commit/b675908))


### Features

* Add Aria2 Status in About Page ([#22](https://github.com/RossWang/Aria2-Integration/issues/22)) ([a253dd9](https://github.com/RossWang/Aria2-Integration/commit/a253dd9))
* Optionally Skip Confirmation Window ([#30](https://github.com/RossWang/Aria2-Integration/issues/30)) ([b1eaa3e](https://github.com/RossWang/Aria2-Integration/commit/b1eaa3e))



## [0.3.5](https://github.com/RossWang/Aria2-Integration/compare/0.3.4...0.3.5) (2018-06-27)


### Bug Fixes

* filter setting cannot be saved([#31](https://github.com/RossWang/Aria2-Integration/issues/31)) ([1a37956](https://github.com/RossWang/Aria2-Integration/commit/1a37956))



## [0.3.4](https://github.com/RossWang/Aria2-Integration/compare/0.3.3...0.3.4) (2018-03-10)


### Bug Fixes

* Fix an issue that prevents triggering the download([#22](https://github.com/RossWang/Aria2-Integration/issues/22)) ([3bedcd2](https://github.com/RossWang/Aria2-Integration/commit/3bedcd2))


### Features

* update AriaNg to 0.4.0 ([3fafaf1](https://github.com/RossWang/Aria2-Integration/commit/3fafaf1))



## [0.3.3](https://github.com/RossWang/Aria2-Integration/compare/0.3.2...0.3.3) (2018-02-24)


### Bug Fixes

* Fix a mistake that make https and wss protocols unusable ([9db649e](https://github.com/RossWang/Aria2-Integration/commit/9db649e)), closes [#20](https://github.com/RossWang/Aria2-Integration/issues/20)


### Features

* Context menu now has sub-menu to select the RPC server. ([06687f9](https://github.com/RossWang/Aria2-Integration/commit/06687f9))



## [0.3.2](https://github.com/RossWang/Aria2-Integration/compare/0.3.1...0.3.2) (2018-01-24)


### Bug Fixes

* Fix "Save" and "Save as" buttons. ([1728fc2](https://github.com/RossWang/Aria2-Integration/commit/1728fc2))
* parameterized-uri --> false(force) ([ec035d4](https://github.com/RossWang/Aria2-Integration/commit/ec035d4)), closes [#12](https://github.com/RossWang/Aria2-Integration/issues/12)



## [0.3.1](https://github.com/RossWang/Aria2-Integration/compare/0.3.0...0.3.1) (2018-01-22)


### Bug Fixes

* Fix a problem that prevents the download from Context Menu when "Display Download Panel" in settings turn off. ([2e76e0b](https://github.com/RossWang/Aria2-Integration/commit/2e76e0b))



# [0.3.0](https://github.com/RossWang/Aria2-Integration/compare/0.2.4...0.3.0) (2018-01-22)


### Bug Fixes

* RSS will not trigger the download anymore ([ab6ff78](https://github.com/RossWang/Aria2-Integration/commit/ab6ff78)), closes [#15](https://github.com/RossWang/Aria2-Integration/issues/15)


### Features

* Exception Support ([01f8902](https://github.com/RossWang/Aria2-Integration/commit/01f8902))
* Incognito Download Support ([1bc9483](https://github.com/RossWang/Aria2-Integration/commit/1bc9483))
* Simple Multiple Server Support ([19d4b4f](https://github.com/RossWang/Aria2-Integration/commit/19d4b4f)), closes [#2](https://github.com/RossWang/Aria2-Integration/issues/2)
* User Agent Support ([bd335a7](https://github.com/RossWang/Aria2-Integration/commit/bd335a7))
* User-Agent Settings ([2eb03df](https://github.com/RossWang/Aria2-Integration/commit/2eb03df))



## [0.2.4](https://github.com/RossWang/Aria2-Integration/compare/0.2.3...0.2.4) (2017-12-13)


### Bug Fixes

* Fix a font-size issue on Linux ([feecd9b](https://github.com/RossWang/Aria2-Integration/commit/feecd9b)), closes [#9](https://github.com/RossWang/Aria2-Integration/issues/9)
* Verify the file name before download. ([463db18](https://github.com/RossWang/Aria2-Integration/commit/463db18)), closes [#10](https://github.com/RossWang/Aria2-Integration/issues/10)



## [0.2.3](https://github.com/RossWang/Aria2-Integration/compare/0.2.2...0.2.3) (2017-12-02)


### Bug Fixes

* Fix a mistake about the download completed sound ([1f386ed](https://github.com/RossWang/Aria2-Integration/commit/1f386ed))



## [0.2.2](https://github.com/RossWang/Aria2-Integration/compare/0.2.1...0.2.2) (2017-11-22)


### Bug Fixes

* Fix A File Name Parsing Issue ([98c07f5](https://github.com/RossWang/Aria2-Integration/commit/98c07f5))


### Features

* 'Authorization' Header Support For Auto Observer ([3cff2a2](https://github.com/RossWang/Aria2-Integration/commit/3cff2a2))
* Add an option to disable Download Panel for the context menu downloads. ([b4e6a40](https://github.com/RossWang/Aria2-Integration/commit/b4e6a40)), closes [#7](https://github.com/RossWang/Aria2-Integration/issues/7)
* Add download complete notification ([628bfc5](https://github.com/RossWang/Aria2-Integration/commit/628bfc5))
* Close notifications after two seconds ([3acedbc](https://github.com/RossWang/Aria2-Integration/commit/3acedbc))
* Display Changelog After Update ([71ffefd](https://github.com/RossWang/Aria2-Integration/commit/71ffefd))



## [0.2.1](https://github.com/RossWang/Aria2-Integration/compare/0.2.0...0.2.1) (2017-11-17)


### Bug Fixes

* fix "AriaNg's RPC config lost after clear browser history" ([b5e8dd8](https://github.com/RossWang/Aria2-Integration/commit/b5e8dd8)), closes [#4](https://github.com/RossWang/Aria2-Integration/issues/4)


### Features

* Add cookie support for context menu download ([6437d01](https://github.com/RossWang/Aria2-Integration/commit/6437d01)), closes [#5](https://github.com/RossWang/Aria2-Integration/issues/5)
* Add WebSocket Support ([3ed829f](https://github.com/RossWang/Aria2-Integration/commit/3ed829f))



# [0.2.0](https://github.com/RossWang/Aria2-Integration/compare/426de63...0.2.0) (2017-11-01)


### Bug Fixes

* exclude xhtml ([426de63](https://github.com/RossWang/Aria2-Integration/commit/426de63))
* fix for addons.mozilla.org ([7c03ef3](https://github.com/RossWang/Aria2-Integration/commit/7c03ef3))



