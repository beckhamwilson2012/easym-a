#!/usr/bin/env bash
# Stage 11-C standing no-op A/B driver.
#
# Proves a fix is a no-op on the price-PRESENT path: builds the edited tree, captures the deck,
# stashes the edits, rebuilds the un-edited tree, captures again, restores, and byte-diffs.
#
# CRITICAL: each capture rebuilds first. A stale bundle would make the diff pass vacuously, so the
# script prints the CRA content-hash of each build — bundle A and bundle B MUST differ.
#
# Usage:  tools/noop-ab/ab.sh "src/App.js" "src/lib/deckModel.js" ...   # files to stash (the edits)
# If no files are passed, defaults to the four Stage 11-C files.
set -euo pipefail
cd "$(dirname "$0")/../.."   # -> ma-app root

FILES=("$@")
if [ ${#FILES[@]} -eq 0 ]; then
  FILES=(src/App.js src/lib/deckModel.js src/utils/dealCalc.js \
         src/components/deck/sections/SectionRelativeContribution.js)
fi

hash() { basename "$(ls build/static/js/main.*.js)"; }
build() { CI= npm run build >/tmp/noop_build.log 2>&1 || { echo "BUILD FAILED"; tail -20 /tmp/noop_build.log; exit 1; }; }

echo "### Run A — current working tree (edited)"
build; HA=$(hash); echo "bundle A: $HA"
RUN_LABEL=A OUT=/tmp/noop_A.json node tools/noop-ab/run.js

echo "### Stash edits -> rebuild -> Run B (un-edited)"
git stash push -- "${FILES[@]}"
build; HB=$(hash); echo "bundle B: $HB"
RUN_LABEL=B OUT=/tmp/noop_B.json node tools/noop-ab/run.js

echo "### Restore edits -> rebuild"
git stash pop
build; HA2=$(hash); echo "bundle A-restored: $HA2"

echo "### Bundle hashes"
echo "  A=$HA  B=$HB  A-restored=$HA2"
[ "$HA" = "$HB" ] && { echo "WARNING: A and B hashes identical — stash had no build effect, diff is vacuous"; exit 1; }

echo "### Section diff"
node tools/noop-ab/diff.js /tmp/noop_A.json /tmp/noop_B.json
