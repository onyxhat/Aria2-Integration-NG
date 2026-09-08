# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Firefox WebExtension (manifest v2), personal fork of "Aria2 Download Manager
Integration" by Ross Wang. Plain HTML/JS — **no build step, no bundler, no
transpile**. `App/` is loaded as-is. Upstream behaviour is kept unchanged except
for documented NG additions; see `README.md` and `CHANGELOG.md`.

## Editable vs. vendored

Edit only the NG/extension code:
- `App/config.js`, `App/common.js` (background), `App/lib/tools.js`, `App/lib/worker.js`
- `App/data/action/`, `App/data/DownloadPanel/`, `App/data/options/`
- `App/_locales/*/messages.json`, `App/manifest.json`

Do **not** edit — third-party / upstream, kept pristine for merges:
- `App/data/ariang/**` (bundled AriaNg UI), `App/lib/jschardet.min.js`,
  `App/lib/aria.js`, `App/lib/polygoat.js` (see `THIRDPARTY.md`)
- `Bin/**` (upstream Windows helper binaries/scripts, not part of the extension)

## Feature workflow

- One branch per feature: `feature/<slug>`, cut from an up-to-date `master`.
  Develop until ready, then merge to `master`. (`master` is the default branch —
  there is no `main`.)
- Feature branches touch `App/` code only. **Do not** bump the manifest version,
  edit `CHANGELOG.md`, or run signing as part of feature work — those are a
  separate, deliberate release step.

## Release (deliberate, not per-feature)

1. Bump `version` in `App/manifest.json` — AMO rejects a version string already
   signed for this add-on ID, so every signed build needs a new one.
2. Add a `CHANGELOG.md` entry: `## x.y.z (NG) — YYYY-MM-DD`, with
   `### Features` / `### Changed` / `### Build tooling` subsections as needed.
   Upstream history stays below, untouched.
3. `scripts/package.sh` → unsigned `dist/*.xpi` (Developer Edition / ESR only).
4. `scripts/sign.sh` → AMO unlisted signing → `dist/aria2-integration-ng-<version>.xpi`.
   Needs `AMO_JWT_ISSUER` / `AMO_JWT_SECRET` in the environment — **never commit them.**

## Conventions

- Commits: Conventional Commits for code (`feat:`, `fix:`); bare `version x.y.z`
  and `CHANGELOG x.y.z` for the release bookkeeping commits.
- Path History feature stores per-RPC-server lists (Default / Server 2 / Server 3),
  capped at 10, newest first; only the aria2 *Download* action records a path.

## Exploring the code

This repo is indexed by **graft** and **zvec-grep (`zg`)**. Use them instead of
grep/broad file reads — one query usually replaces several reads. The bulk of
files under `App/data/ariang/` are minified vendor bundles; ignore them when
searching for NG behaviour.
