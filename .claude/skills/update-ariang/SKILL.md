---
name: update-ariang
description: Refresh the bundled AriaNg web UI in App/data/ariang/ from an official GitHub release via scripts/update-ariang.sh. Use when bumping the vendored AriaNg version.
disable-model-invocation: true
---

Refresh `App/data/ariang/` from an official AriaNg release. `$ARGUMENTS` is an
optional target version (e.g. `1.3.14`); omit it for the latest release.

1. Check `git status` is clean under `App/data/ariang/`. If there are local
   changes there, stop and report — the script does `rm -rf` on that directory.
2. Run `scripts/update-ariang.sh $ARGUMENTS` from the repo root.
3. Review the result:
   - `git diff --stat App/data/ariang/` and `git status --porcelain App/data/ariang/`
     (new hashed bundle names show as adds + deletes — that's normal).
   - `git grep -n "aria-ng-\|plugins-\|moment-with-locales" -- 'App/*.js' 'App/data/action' 'App/data/DownloadPanel' 'App/data/options'`
     to confirm no NG code hardcodes an old bundle filename. NG code should only
     reference `data/ariang/index.html` and `#!/...` routes.
4. Run the `/lint` skill (`web-ext lint --source-dir App`). Expect **0 errors**;
   `UNSAFE_VAR_ASSIGNMENT` / `DANGEROUS_EVAL` warnings inside `data/ariang/**` are
   vendor-bundle noise, not actionable.
5. If the set of bundled third-party libraries changed materially, update
   `THIRDPARTY.md`.
6. Do NOT bump `App/manifest.json` version or edit `CHANGELOG.md` — that's the
   `/release` step. Stage the change as its own commit, e.g.
   `feat: update AriaNg to <version>` (matches repo history).
