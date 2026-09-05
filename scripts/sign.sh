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
# e.g.:
#   AMO_JWT_ISSUER=user:12345:67 AMO_JWT_SECRET=abcd... scripts/sign.sh
#
# Bump "version" in App/manifest.json before each run - AMO rejects a
# version string it has already signed for this add-on ID.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/App"

: "${AMO_JWT_ISSUER:?set AMO_JWT_ISSUER (addons.mozilla.org -> Manage API Keys)}"
: "${AMO_JWT_SECRET:?set AMO_JWT_SECRET (addons.mozilla.org -> Manage API Keys)}"

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
