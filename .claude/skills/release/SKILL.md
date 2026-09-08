---
name: release
description: Run the deliberate NG release checklist — version bump, CHANGELOG entry, package, and AMO unlisted signing. Use only when cutting a release, not during feature work.
disable-model-invocation: true
---

Cut an NG release. `$ARGUMENTS` is the target version (e.g. `0.4.6`).

1. If `$ARGUMENTS` is empty, ask for the new version. It MUST be greater than the
   current `version` in `App/manifest.json` — AMO rejects any string already
   signed for this add-on ID.
2. Confirm you're on `master` with a clean tree and the features for this release
   are merged in. If not, stop and report.
3. Bump `version` in `App/manifest.json` to `$ARGUMENTS`.
4. Add a `CHANGELOG.md` entry at the top of the NG section:
   `## $ARGUMENTS (NG) — <today's date>`, followed by `### Features` /
   `### Changed` / `### Build tooling` subsections as applicable. Summarise what
   merged since the last entry (use `git log` for the range). Leave upstream
   history below untouched.
5. Commit as two commits, matching repo convention:
   `version $ARGUMENTS` then `CHANGELOG $ARGUMENTS`.
6. Build the unsigned xpi for a sanity check: `scripts/package.sh`.
7. Sign via AMO unlisted: `scripts/sign.sh`. This needs `AMO_JWT_ISSUER` and
   `AMO_JWT_SECRET` in the environment — if they're not set, tell the user to
   run `scripts/sign.sh` themselves with the credentials (via `! scripts/sign.sh`
   or their own shell). Never ask for or echo the secrets.
8. Report the final `dist/aria2-integration-ng-$ARGUMENTS.xpi` path.
