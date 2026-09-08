---
name: new-feature
description: Start a new NG feature on its own feature/<slug> branch, cut from an up-to-date master. Use when beginning work on a new extension feature.
disable-model-invocation: true
---

Start a new feature branch. `$ARGUMENTS` is the feature slug (e.g. `path-history-export`).

1. If `$ARGUMENTS` is empty, ask for a short kebab-case slug.
2. Check `git status` is clean. If not, stop and report — don't stash or discard.
3. `git fetch origin` then `git switch master && git pull --ff-only origin master`.
4. `git switch -c feature/$ARGUMENTS`.
5. Remind the scope for this branch:
   - Edit only NG code under `App/` (see CLAUDE.md "Editable vs. vendored").
   - Do **not** touch `App/data/ariang/**`, the minified libs, or `Bin/**`.
   - Do **not** bump `App/manifest.json` version or edit `CHANGELOG.md` — that's
     the `/release` step, done separately once the feature is merged.
6. Confirm the branch is created and hand back to the user to describe the feature.
