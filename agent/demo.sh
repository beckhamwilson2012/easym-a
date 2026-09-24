#!/bin/bash
# agent/demo.sh — DEMO MODE. A short, bounded sweep you can run in front of people: 5 pairs, 1 iteration,
# in the foreground, with the loop log on screen. Everything it does, the nightly runner already does; the
# only differences are SWEEP_PAIRS and SWEEP_MAX_ITER (agent/run-sweep.sh), which cap the capture set and
# the iteration count. It never touches the LaunchAgent — a demo you cannot see start is not a demo.
#
#   bash agent/demo.sh              # 5 pairs, 1 iteration
#   bash agent/demo.sh --pairs 3    # fewer pairs when the room is impatient
#
# Exit codes are the runner's own: 0 = a real run, 1 = die(), 2 = completed with zero analyzable decks.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="$ROOT/agent"
PAIRS=5
APP_PORT="${SWEEP_APP_PORT:-3001}"
DASH_PORT="${SWEEP_DASH_PORT:-3002}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pairs) PAIRS="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}" | cut -c3-; exit 0 ;;
    *) echo "demo.sh: unknown argument '$1' (try --pairs N)" >&2; exit 2 ;;
  esac
done
[[ "$PAIRS" =~ ^[1-9][0-9]*$ ]] || { echo "demo.sh: --pairs needs a positive number, got '$PAIRS'" >&2; exit 2; }

# ── pre-flight ───────────────────────────────────────────────────────────────────────────────────────
# Every check below is something that has actually stopped a run: a dirty tree (the runner dies at its
# DIRTY guard), a leftover STOP (the loop halts after the baseline and nothing is demonstrated), a dead
# app server (every deck fails at stage start), a dead dashboard (nothing to show), a missing browser.
fails=0
chk() { # chk <label> <ok?> <what to do about it>
  if [[ "$2" == "ok" ]]; then printf '  ok    %s\n' "$1"
  else printf '  FAIL  %s\n        → %s\n' "$1" "$3"; fails=$((fails+1)); fi
}
echo "pre-flight"
[[ -z "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]] \
  && chk "working tree is clean" ok \
  || chk "working tree is clean" no "commit or stash first — the runner refuses to start on a dirty tree:$(printf '\n          %s' "$(git -C "$ROOT" status --porcelain | head -5)")"
[[ ! -f "$AGENT_DIR/STOP" ]] \
  && chk "no STOP sentinel" ok \
  || chk "no STOP sentinel" no "delete $AGENT_DIR/STOP — with it present the loop halts right after the baseline"
curl -sf -o /dev/null --max-time 4 "http://localhost:$APP_PORT/" \
  && chk "app server on :$APP_PORT" ok \
  || chk "app server on :$APP_PORT" no "start it: node server.js   (the runner restarts it too, but a demo should not begin with a boot)"
curl -sf -o /dev/null --max-time 4 "http://localhost:$DASH_PORT/" \
  && chk "dashboard on :$DASH_PORT" ok \
  || chk "dashboard on :$DASH_PORT" no "start it: bash agent/dashboard/open-dashboard.sh"
command -v node > /dev/null \
  && chk "node ($(node -v 2>/dev/null))" ok \
  || chk "node" no "install node, or fix PATH"
CHROME="$(node -e 'const fs=require("fs");const m=fs.readFileSync(process.argv[1],"utf8").match(/^const CHROME *= *(["\x27])(.*?)\1/m);process.stdout.write(m?m[2]:"")' "$ROOT/tools/sweep-analyzer/capture.js" 2>/dev/null)"
[[ -n "$CHROME" && -x "$CHROME" ]] \
  && chk "Chrome at $CHROME" ok \
  || chk "Chrome" no "capture.js:8 points at '$CHROME', which is not executable — install Chrome there or fix the constant"
[[ "$fails" -eq 0 ]] || { echo; echo "demo.sh: $fails pre-flight check(s) failed — not starting."; exit 1; }

# ── the run ──────────────────────────────────────────────────────────────────────────────────────────
echo
# The runner tees every log line to stdout AND runs/<id>/loop.log, so running it in the foreground IS
# the tail — a second `tail -f` would only print each line twice.
echo "starting: $PAIRS pairs, 1 iteration, foreground.  Ctrl-C stops it cleanly (the runner traps INT)."
BEFORE_HEAD="$(git -C "$ROOT" rev-parse HEAD)"
BEFORE_RUNS="$(ls -1 "$AGENT_DIR/runs" 2>/dev/null | wc -l | tr -d ' ')"
T0=$(date +%s)

# caffeinate -i: a demo machine that idle-sleeps mid-capture kills the browser and the run with it.
SWEEP_PAIRS="$PAIRS" SWEEP_MAX_ITER=1 caffeinate -i bash "$AGENT_DIR/run-sweep.sh"
RC=$?

ELAPSED=$(( $(date +%s) - T0 ))
RUN_DIR="$(ls -dt "$AGENT_DIR"/runs/*/ 2>/dev/null | head -1)"
RUN_ID="$(basename "${RUN_DIR:-none}")"

# ── what happened ────────────────────────────────────────────────────────────────────────────────────
echo
echo "───────────────────────────────────────────────────────────────────────"
printf 'demo run %s — exit %d — %dm %02ds\n' "$RUN_ID" "$RC" $((ELAPSED/60)) $((ELAPSED%60))
[[ "$BEFORE_RUNS" == "$(ls -1 "$AGENT_DIR/runs" 2>/dev/null | wc -l | tr -d ' ')" ]] && echo "  (no new run directory — the runner exited before creating one; see the message above)"

if [[ -f "$RUN_DIR/loop.log" ]]; then
  echo "  capture:"
  grep -E "capture END" "$RUN_DIR/loop.log" | sed 's/^/    /'
  for phase in baseline after; do
    d="$RUN_DIR/cap/$phase"
    [[ -d "$d" ]] || continue
    node -e '
      const fs=require("fs"),d=process.argv[1],p=process.argv[2];let ok=0,bad=0,st={};
      for(const f of fs.readdirSync(d)){ if(!f.endsWith(".json"))continue;
        try{const j=JSON.parse(fs.readFileSync(d+"/"+f));if(j.ok)ok++;else{bad++;const k=(j.stage||"?")+"/"+(j.reason||"?");st[k]=(st[k]||0)+1}}catch(e){} }
      console.log("    "+p+": "+ok+" ok, "+bad+" failed"+(bad?"  ["+Object.entries(st).map(([k,v])=>v+"x "+k).join(", ")+"]":""));
    ' "$d" "$phase"
  done
  echo "  defects:"
  grep -E "defects across" "$RUN_DIR/loop.log" | sed 's/^/    /' | cut -c1-160
  echo "  gate + halt:"
  grep -E "^\[[0-9:]+\] (GATE|COMMITTED|UNVERIFIED|NO_CHANGE|halt:|RUN .*(COMPLETE|FAILED))" "$RUN_DIR/loop.log" | tail -6 | sed 's/^/    /'
fi

echo "  iteration commit:"
NEW="$(git -C "$ROOT" log --oneline "$BEFORE_HEAD"..HEAD 2>/dev/null | head -3)"
if [[ -n "$NEW" ]]; then printf '    %s\n' "$NEW"
else echo "    none — the iteration produced no commit (the gate reverted it, or the agent left no edits; see GATE above)"; fi
echo "  branch: $(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
echo "  dashboard: http://localhost:$DASH_PORT/  (run $RUN_ID)"
echo "───────────────────────────────────────────────────────────────────────"
exit $RC
