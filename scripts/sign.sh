#!/usr/bin/env bash
#
# Route 1: submit App/ to addons.mozilla.org on the "unlisted" channel for
# automated signing, then download the Mozilla-signed .xpi into dist/.
# The signed .xpi installs permanently on release Firefox
# (about:addons -> gear -> Install Add-on From File...).
#
# Credentials come from the environment - never commit them:
#   AMO_JWT_ISSUER   "JWT issuer" from addons.mozilla.org -> Manage API Keys
#   AMO_JWT_SECRET   "JWT secret" from the same page
#
# Provide them either by exporting in the shell:
#   AMO_JWT_ISSUER=user:12345:67 AMO_JWT_SECRET=abcd... scripts/sign.sh
# or by putting them in an (uncommitted, gitignored) .env at the repo root:
#   AMO_JWT_ISSUER=user:12345:67
#   AMO_JWT_SECRET=abcd...
# Variables already set in the environment take precedence over .env.
#
# Bump "version" in App/manifest.json before each run - AMO rejects a
# version string it has already signed for this add-on ID.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/App"

# Optionally load credentials from .env at the repo root. Anything already
# exported in the environment wins; .env only fills in what is unset.
if [ -f "$REPO_ROOT/.env" ]; then
	set -a
	while IFS= read -r _line || [ -n "$_line" ]; do
		case "$_line" in
			''|'#'*) continue ;;
		esac
		_key="${_line%%=*}"
		_key="${_key#export }"
		_key="$(printf '%s' "$_key" | tr -d '[:space:]')"
		[ -n "$_key" ] || continue
		if [ -z "${!_key:-}" ]; then
			eval "$_line"
		fi
	done < "$REPO_ROOT/.env"
	set +a
	unset _line _key
fi

: "${AMO_JWT_ISSUER:?set AMO_JWT_ISSUER (export it or add it to .env / Manage API Keys)}"
: "${AMO_JWT_SECRET:?set AMO_JWT_SECRET (export it or add it to .env / Manage API Keys)}"

VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_DIR/manifest.json" | head -n1)"

# web-ext is invoked via npx so no global install is needed.
npx --yes web-ext@latest sign \
	--source-dir "$APP_DIR" \
	--channel unlisted \
	--api-key "$AMO_JWT_ISSUER" \
	--api-secret "$AMO_JWT_SECRET" \
	--artifacts-dir "$REPO_ROOT/dist"

# web-ext names the signed file with an opaque hash; give it a stable name.
SIGNED="$(ls -t "$REPO_ROOT"/dist/*.xpi | head -n1)"
DEST="$REPO_ROOT/dist/aria2-integration-ng-$VERSION.xpi"
if [ "$SIGNED" != "$DEST" ]; then
	mv -f "$SIGNED" "$DEST"
fi
echo "==> signed xpi: $DEST"
