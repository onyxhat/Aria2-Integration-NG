---
name: lint
description: Run web-ext lint over App/ to catch manifest errors, invalid permissions, and deprecated WebExtension APIs. Use after changing extension code or manifest.json, and before packaging or signing.
---

1. Run from the repo root:
   `npx --yes web-ext@latest lint --source-dir App --warnings-as-errors=false`
2. Summarise errors and warnings. Errors must be fixed before `/release`;
   warnings are judgement calls — surface them, don't auto-fix.
3. Ignore findings inside `App/data/ariang/**` and the minified libs — that's
   vendored code (see CLAUDE.md). Focus on NG code and `App/manifest.json`.
4. First run downloads web-ext via npx; that's expected.
