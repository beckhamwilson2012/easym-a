#!/usr/bin/env bash
# MOCK AGENT — deterministic stand-in for `claude -p`, for the executor selftest.
# Called by execute.js as: bash mock.sh <phaseJson> <envelopeOut> <root>
#
# Behaviour comes from MOCK_BEHAVIOR_<phaseNumber>, else MOCK_BEHAVIOR, else "noop".
# Every behaviour below exists to drive ONE executor gate to its REJECTING side; the
# accepting side is driven by the same runner with a different behaviour, so a gate can
# never be shown passing without also being shown failing.
set -uo pipefail
PHASE_JSON="$1"; ENVELOPE="$2"; ROOT="$3"
N="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).number))' "$PHASE_JSON")"
VAR="MOCK_BEHAVIOR_$N"; B="${!VAR:-${MOCK_BEHAVIOR:-noop}}"
S="$ROOT/planrunner/examples/sandbox"
STATUS="DONE"; FILES=""; ERR=false; SUBTYPE=success

case "$B" in
  noop)        FILES="(none)" ;;
  fix-coerce)  printf "%s\n" "'use strict';" "// FIXED: absent stays absent; a real zero stays zero." \
                 "function normalize(v) { return (v === null || v === undefined) ? null : v; }" \
                 "module.exports = { normalize };" > "$S/coerce.js"; FILES="planrunner/examples/sandbox/coerce.js" ;;
  create-health) printf "%s\n" "'use strict';" "function health() { return { ok: true, status: 'up' }; }" \
                 "module.exports = { health };" > "$S/health.js"; FILES="planrunner/examples/sandbox/health.js" ;;
  cosmetic)    printf "%s\n" "// touched by the mock agent; behaviour unchanged" >> "$S/coerce.js"; FILES="planrunner/examples/sandbox/coerce.js" ;;
  cosmetic-safe) printf "%s\n" "// touched by the mock agent; behaviour unchanged" >> "$S/safe.js"; FILES="planrunner/examples/sandbox/safe.js" ;;
  fake-done)   printf "%s\n" "// claims to fix it and does not" >> "$S/coerce.js"; FILES="planrunner/examples/sandbox/coerce.js" ;;
  stray)       printf "%s\n" "// written OUTSIDE the phase's declared touches" > "$S/stray.js"; FILES="planrunner/examples/sandbox/stray.js" ;;
  break-safe)  printf "%s\n" "'use strict';" "// BROKEN: null now coerces to 0 again." \
                 "function normalize(v) { return v || 0; }" "module.exports = { normalize };" > "$S/safe.js"; FILES="planrunner/examples/sandbox/safe.js" ;;
  tamper)      printf "%s\n" "console.log('VERIFY:ASSERTED 1'); process.exit(0);" > "$ROOT/planrunner/examples/checks/null-not-zero.js"; FILES="planrunner/examples/checks/null-not-zero.js" ;;
  slow)        printf "%s\n" "'use strict';" "function normalize(v) { return (v === null || v === undefined) ? null : v; }" \
                 "module.exports = { normalize };" > "$S/coerce.js"; FILES="planrunner/examples/sandbox/coerce.js"; sleep 120 ;;
  blocked)     STATUS="BLOCKED(needs a file outside touches)"; FILES="(none)" ;;
  cutoff)      printf "%s\n" "// half-written work, agent died before reporting" >> "$S/coerce.js"; ERR=true; SUBTYPE=error_max_turns ;;
  *)           echo "mock: unknown behaviour $B" >&2; exit 3 ;;
esac

RESULT="PHASE: $N
FILES: $FILES
STATUS: $STATUS"
[ "$ERR" = true ] && RESULT=""
IS_ERROR="$ERR" SUBTYPE="$SUBTYPE" RESULT="$RESULT" node -e '
  const fs=require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    is_error: process.env.IS_ERROR === "true",
    subtype: process.env.SUBTYPE,
    num_turns: 3,
    total_cost_usd: 0.01,
    session_id: "mock",
    result: process.env.RESULT
  }, null, 2));' "$ENVELOPE"
exit 0
