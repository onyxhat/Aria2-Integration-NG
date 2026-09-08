---
name: package-xpi
description: Build an unsigned .xpi from App/ for a local dev-install test. Use when the user wants a quick installable build without signing.
---

1. Run `scripts/package.sh` from the repo root.
2. Report the built path (`dist/aria2-integration-ng-<version>.xpi`) and its size
   from the script output.
3. Remind the user this build is **unsigned**: it installs only on Firefox
   Developer Edition / Nightly / ESR with
   `about:config → xpinstall.signatures.required = false`. For release Firefox,
   use `/release` (AMO signing).
4. Do not bump the version or edit `CHANGELOG.md` — packaging is read-only w.r.t.
   source.
