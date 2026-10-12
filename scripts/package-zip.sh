#!/bin/sh
# Build a self-contained zip of the workbench for a machine with no internet:
#   sh scripts/package-zip.sh            -> meridian-<short-sha>.zip in the current directory
# Contents: the static app only (no tests, no media, no node_modules). Unzip anywhere and
# serve the folder over http://localhost with any static server; see docs/AIRGAPPED.md.
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
sha="$(git rev-parse --short HEAD 2>/dev/null || echo local)"
out="${PWD}/meridian-${sha}.zip"
[ -n "$1" ] && out="$1"
git archive --format=zip --prefix=meridian/ -o "$out" HEAD   app.html index.html terms.html privacy.html one-pager.html dna.html   favicon.png favicon.svg apple-touch-icon.png app LICENSE README.md USER-GUIDE.md MIGRATION.md docs deploy
echo "wrote $out"
