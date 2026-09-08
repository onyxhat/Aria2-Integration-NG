#!/usr/bin/env bash
#
# Refresh the bundled AriaNg web UI in App/data/ariang/ from an official
# GitHub release (https://github.com/mayswind/AriaNg/releases).
#
# AriaNg ships its built site only as a release zip - the source repo has no
# committed dist/ - so this downloads AriaNg-<version>.zip, verifies it, and
# replaces App/data/ariang/ wholesale. No build step, no submodule.
#
# Usage:
#   scripts/update-ariang.sh              # latest release
#   scripts/update-ariang.sh 1.3.14      # a specific version (with or without "v")
#
# Needs: curl, unzip. Review `git diff App/data/ariang/` afterwards and run
# `web-ext lint --source-dir App` (or the /lint skill) before packaging.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$REPO_ROOT/App/data/ariang"
REPO="mayswind/AriaNg"

VERSION=""
while [ $# -gt 0 ]; do
	case "$1" in
		-h|--help) sed -n '2,16p' "$0"; exit 0 ;;
		-*) echo "unknown argument: $1" >&2; exit 2 ;;
		*) VERSION="$1"; shift ;;
	esac
done

command -v curl  >/dev/null || { echo "'curl' is required but not installed" >&2; exit 1; }
command -v unzip >/dev/null || { echo "'unzip' is required but not installed" >&2; exit 1; }

# Resolve "latest" to a concrete tag via the GitHub API (no auth needed).
if [ -z "$VERSION" ]; then
	echo "==> resolving latest AriaNg release"
	VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
		| sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
	[ -n "$VERSION" ] || { echo "could not resolve the latest release tag" >&2; exit 1; }
fi
VERSION="${VERSION#v}"

CURRENT="$(cat "$DEST/.ariang-version" 2>/dev/null || echo "unknown")"
echo "==> current: $CURRENT   ->   target: $VERSION"
[ "$CURRENT" = "$VERSION" ] && echo "    (already at $VERSION - re-extracting anyway)"

URL="https://github.com/$REPO/releases/download/$VERSION/AriaNg-$VERSION.zip"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> downloading $URL"
curl -fSL --retry 3 -o "$TMP/ariang.zip" "$URL"

echo "==> verifying archive"
unzip -tqq "$TMP/ariang.zip" >/dev/null || { echo "downloaded file is not a valid zip" >&2; exit 1; }
unzip -q "$TMP/ariang.zip" -d "$TMP/extracted"

# The AriaNg release zip is flat, but tolerate a single wrapping directory.
SRC="$TMP/extracted"
entries=( "$SRC"/* )
if [ "${#entries[@]}" -eq 1 ] && [ -d "${entries[0]}" ]; then
	SRC="${entries[0]}"
fi
[ -f "$SRC/index.html" ] || { echo "no index.html in archive - unexpected layout" >&2; exit 1; }

echo "==> replacing $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC"/. "$DEST"/
printf '%s\n' "$VERSION" > "$DEST/.ariang-version"

echo
echo "==> AriaNg updated to $VERSION"
echo "    review:  git diff --stat App/data/ariang/"
echo "    lint:    web-ext lint --source-dir App   (or the /lint skill)"
echo "    if the bundled third-party file set changed, update THIRDPARTY.md"
