#!/usr/bin/env bash
#
# Package the WebExtension in App/ into an unsigned .xpi for manual install.
#
# Route 2 (unsigned side-load) works only on Firefox Developer Edition,
# Nightly, or ESR, with about:config -> xpinstall.signatures.required = false.
# Regular release Firefox refuses unsigned extensions.
#
# Usage:
#   scripts/package.sh            # build dist/aria2-integration-<version>.xpi
#   scripts/package.sh -o out.xpi # build to a specific path
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/App"
MANIFEST="$APP_DIR/manifest.json"

OUT=""
while [ $# -gt 0 ]; do
	case "$1" in
		-o|--output) OUT="$2"; shift 2 ;;
		-h|--help) sed -n '2,17p' "$0"; exit 0 ;;
		*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done

[ -f "$MANIFEST" ] || { echo "manifest not found: $MANIFEST" >&2; exit 1; }
command -v zip >/dev/null || { echo "'zip' is required but not installed" >&2; exit 1; }

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" | head -n1)"
[ -n "$VERSION" ] || { echo "could not read \"version\" from $MANIFEST" >&2; exit 1; }

if [ -z "$OUT" ]; then
	OUT="$REPO_ROOT/dist/aria2-integration-ng-$VERSION.xpi"
fi
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

# Optional sanity check if web-ext happens to be installed.
if command -v web-ext >/dev/null; then
	echo "==> web-ext lint"
	web-ext lint --source-dir "$APP_DIR" --warnings-as-errors=false || true
fi

# Build from inside App/ so manifest.json sits at the archive root.
echo "==> packaging App/ -> $OUT"
( cd "$APP_DIR" && zip -q -r -X -FS "$OUT" . \
	-x '.*' -x '*/.*' -x '*.DS_Store' -x '__MACOSX/*' )

SIZE="$(du -h "$OUT" | cut -f1)"
echo "==> built $OUT ($SIZE, v$VERSION)"
echo
echo "Install (Developer Edition / Nightly / ESR only):"
echo "  1. about:config -> xpinstall.signatures.required = false"
echo "  2. about:addons -> gear icon -> Install Add-on From File... -> select the .xpi"
