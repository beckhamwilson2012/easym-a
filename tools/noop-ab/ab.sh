#!/usr/bin/env bash
# Standing no-op A/B driver.
#
# Proves a change is a no-op: builds the edited tree, captures the deck, stashes the edits, rebuilds
# the un-edited tree, captures again, restores, and byte-diffs.
#
# Runs BOTH fixtures by default, because neither alone covers the whole deck:
#   STAGE_11F_PUBLIC_NOOP_INPUTS.json   17 sections, public shape (replayed network fixture)
#   STAGE_11E_PRIVATE_NOOP_INPUTS.json  16 sections, private shape (no network at all)
# The private path suppresses equity / analyst / exchangeratio; the public path never renders
# privatevaluation / creditstats. Together: all 20 registered sections.
# Override with NOOP_FIXTURES="a.json b.json".
#
# CRITICAL: each capture rebuilds first. A stale bundle would make the diff pass vacuously, so the
# script prints the CRA content-hash of each build — bundle A and bundle B MUST differ.
#
# A server must be serving the build on http://localhost:3001 (node server.js); override BASE_URL.
#
# Usage:  tools/noop-ab/ab.sh src/components/deck/deckRegistry.js src/components/deck/DeckShell.js
set -euo pipefail
cd "$(dirname "$0")/../.."   # -> ma-app root

FILES=("$@")
if [ ${#FILES[@]} -eq 0 ]; then
  echo "usage: tools/noop-ab/ab.sh <file to stash> [more files...]" >&2
  echo "  Name the files your change edited. (This used to default to the four Stage 11-C files;" >&2
  echo "  that default was removed — stashing the wrong files yields a vacuous or misleading diff.)" >&2
  exit 2
fi

FIXTURES=(STAGE_11F_PUBLIC_NOOP_INPUTS.json STAGE_11E_PRIVATE_NOOP_INPUTS.json)
if [ -n "${NOOP_FIXTURES:-}" ]; then read -r -a FIXTURES <<< "$NOOP_FIXTURES"; fi

hash() { basename "$(ls build/static/js/main.*.js)"; }
build() { CI= npm run build >/tmp/noop_build.log 2>&1 || { echo "BUILD FAILED"; tail -20 /tmp/noop_build.log; exit 1; }; }
capture() {  # $1 = run label (A|B), $2 = fixture filename
  local lbl="$1" fx="$2" tag
  tag="$(basename "$fx" .json)"
  RUN_LABEL="$lbl" INPUTS="$PWD/$fx" OUT="/tmp/noop_${lbl}_${tag}.json" node tools/noop-ab/run.js
}

echo "### Run A — current working tree (edited)"
build; HA=$(hash); echo "bundle A: $HA"
for fx in "${FIXTURES[@]}"; do capture A "$fx"; done

echo "### Stash edits -> rebuild -> Run B (un-edited)"
git stash push -- "${FILES[@]}"
build; HB=$(hash); echo "bundle B: $HB"
for fx in "${FIXTURES[@]}"; do capture B "$fx"; done

echo "### Restore edits -> rebuild"
git stash pop
build; HA2=$(hash); echo "bundle A-restored: $HA2"

echo "### Bundle hashes"
echo "  A=$HA  B=$HB  A-restored=$HA2"
if [ "$HA" = "$HB" ]; then
  echo "WARNING: A and B hashes identical — stash had no build effect, diff is vacuous" >&2
  exit 1
fi

echo "### Section diffs"
rc=0
for fx in "${FIXTURES[@]}"; do
  tag="$(basename "$fx" .json)"
  echo "--- $tag ---"
  node tools/noop-ab/diff.js "/tmp/noop_A_${tag}.json" "/tmp/noop_B_${tag}.json" || rc=1
done
if [ "$rc" -ne 0 ]; then echo "RESULT: at least one fixture drifted — NOT a no-op." >&2; fi
exit "$rc"
