#!/usr/bin/env bash
# agent/run-sweep.sh — the unattended sweep runner. Strategy (a)-optimized: N+1 full captures
# (one baseline + one after each item), reusing after(N-1) as before(N) while prices are FROZEN.
#
# Two holes this runner closes:
#   HOLE 1 — a revert breaks the chain: after ANY revert/INDETERMINATE we re-capture a fresh baseline
#            before the next item, so a stale after-capture is never reused as a baseline.
#   HOLE 2 — the freeze window is ~6pm-2am MT, not "overnight": we verify frozen prices EMPIRICALLY at
#            startup and every 3 iterations, and fall back to 2N (fresh before each item) if prices move.
#
# THE ONE RULE (the trap): a capture failure is NEVER a code failure. A RATE_LIMITED / environmental
# capture is INDETERMINATE — retry the CAPTURE first, never revert code on it, never count it toward the
# consecutive-fail halt.
#
# Safety: never merges (commits to its own branch only); aborts on a dirty tree; writes an UNDO.txt that
# discards the whole night in one line; does not touch analyze.js / capture.js / snapshot-diff.js / app.
#
# TEST HOOKS (all default OFF; production never sets them): MOCK_AGENT, MOCK_CAPTURE, TEST_FROZEN,
# FROZEN_WAIT, PAIRS_LIMIT, TEST_REGRESS_ITERS, MAX_ITER, BUDGET_USD, BASE_BRANCH.
set -uo pipefail

# ── paths (ALL QUOTED — the & in EasyM&A splits unquoted) ───────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$SCRIPT_DIR"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CAPTURE_JS="$ROOT/tools/sweep-analyzer/capture.js"
ANALYZE_JS="$ROOT/tools/sweep-analyzer/analyze.js"
DIFF_JS="$ROOT/tools/snapshot-diff.js"
QUEUE="$AGENT_DIR/QUEUE.md"
PROMPT="$AGENT_DIR/ITERATION_PROMPT.md"
CALIB="$AGENT_DIR/calibration.csv"
DECISIONS="$AGENT_DIR/DECISIONS.md"
STOP_FILE="$AGENT_DIR/STOP"
RAW="/tmp/sweep_v2_raw"                        # capture.js hardcodes this output dir

# ── config (env-overridable) ────────────────────────────────────────────────────────────────────────
MAX_ITER="${MAX_ITER:-999}"
MAX_TURNS="${MAX_TURNS:-60}"                   # raised 40->60: run 20260815-150838 hit the 40-turn cap mid-fix after its STEP-0 EDGAR fetch was denied
BUDGET_USD="${BUDGET_USD:-50}"
GAP_MS="${GAP_MS:-12000}"                      # rate-safe inter-pair spacing for capture.js
PAIRS_LIMIT="${PAIRS_LIMIT:-0}"               # 0 = all 50; >0 caps pairs (tests)
FROZEN_WAIT="${FROZEN_WAIT:-60}"
ITER_TIMEOUT="${ITER_TIMEOUT:-2700}"           # per-iteration wall-clock cap (45 min); --max-turns does NOT bound a permission-prompt hang
BASE_URL="${BASE_URL:-http://localhost:3001}"
APP_PORT="${BASE_URL##*:}"                      # port the app server (and capture.js) listen on — parsed from BASE_URL
BASE_BRANCH="${BASE_BRANCH:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)}"
RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
RUN_DIR="$AGENT_DIR/runs/$RUN_ID"
SERVER_LOG="/tmp/server-$RUN_ID.log"           # the restarted app server's stdout/stderr (Part 1)
SERVER_PID=""                                   # PID of the server WE start (kill only our own + the port holder)

log()  { local l; l="$(printf '[%s] %s' "$(date +%H:%M:%S)" "$*")"; printf '%s\n' "$l"; if [[ -n "${RUN_DIR:-}" ]]; then mkdir -p "$RUN_DIR" 2>/dev/null; printf '%s\n' "$l" >> "$RUN_DIR/loop.log"; fi; }  # tee to stdout AND runs/<id>/loop.log (appended live, per call)
die()  { printf '[FATAL] %s\n' "$*" >&2; exit 1; }
gitr() { git -C "$ROOT" "$@"; }

# ── capture: clear RAW, run capture.js (or MOCK_CAPTURE), snapshot into $1 ───────────────────────────
PAIRS_JSON=""
build_pairs_json() {
  PAIRS_JSON="$(node -e '
    const fs=require("fs"),p=process.argv[1],lim=+process.argv[2]||0;
    let ps=fs.readdirSync(p).filter(f=>f.endsWith(".json")).map(f=>JSON.parse(fs.readFileSync(p+"/"+f)).pair);
    if(lim>0) ps=ps.slice(0,lim);
    process.stdout.write(JSON.stringify(ps.map(x=>{const [a,b]=x.split("/");return [a,b,null];})));
  ' "$ROOT/docs/sweep-v2/captures" "$PAIRS_LIMIT")"
}
do_capture() {                                 # $1 = dest snapshot dir, $2 = phase label; rc 2 = capture failed
  local dest="$1" phase="$2"
  rm -rf "$RAW"; mkdir -p "$RAW" "$dest"
  if [[ -n "${MOCK_CAPTURE:-}" ]]; then
    bash "$MOCK_CAPTURE" "$RAW" "$phase" "$RUN_ID" || return 2
  else
    GAP_MS="$GAP_MS" node "$CAPTURE_JS" "$PAIRS_JSON" >/dev/null 2>&1 || return 2
  fi
  cp "$RAW"/*.json "$dest"/ 2>/dev/null || true
  [[ -n "$(ls -A "$dest" 2>/dev/null)" ]] || return 2
  return 0
}

# ── server lifecycle: restart :APP_PORT BEFORE every capture (Part 1) ─────────────────────────────────
# capture.js grades the persistent server at $BASE_URL. That process never reloads, so a server-side fix
# (server.js / ltmCalc.js) is invisible to the after-capture unless we restart — the root cause of run
# 20260815-150838 committing an unmeasurable no-op. rc 0 = up & accepting; rc 1 = failed to boot, and the
# CALLER MUST NOT proceed to capture (a non-booting server = 0 analyzable pairs = a false defect drop).
restart_server() {
  [[ -n "${MOCK_CAPTURE:-}" ]] && return 0       # tests mock the capture; there is no real server to cycle
  local i p holders
  # 1. kill the server WE started (if any) + whatever holds the port right now (incl. one the agent spawned)
  holders="$(lsof -ti "tcp:$APP_PORT" 2>/dev/null || true)"
  for p in $SERVER_PID $holders; do [[ -n "$p" ]] && kill "$p" 2>/dev/null || true; done
  # 2. verify the port is ACTUALLY free with lsof (not sleep-and-hope); escalate to -9, then give up
  i=0
  while [[ -n "$(lsof -ti "tcp:$APP_PORT" 2>/dev/null || true)" ]]; do
    [[ "$i" -eq 10 ]] && for p in $(lsof -ti "tcp:$APP_PORT" 2>/dev/null); do kill -9 "$p" 2>/dev/null || true; done
    [[ "$i" -ge 20 ]] && { log "restart_server: :$APP_PORT would not free after kill"; return 1; }
    sleep 0.5; i=$(( i + 1 ))
  done
  # 3. start fresh — EVERY PATH QUOTED (the & in EasyM&A splits an unquoted path)
  caffeinate -is nohup node "$ROOT/server.js" > "$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  # 4. poll until the port ACCEPTS a connection, 30s cap (bash /dev/tcp — no curl/lsof needed for readiness)
  i=0
  while [[ "$i" -lt 60 ]]; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$APP_PORT") 2>/dev/null; then exec 3>&- 3<&-; log "restart_server: :$APP_PORT up (pid $SERVER_PID · log $SERVER_LOG)"; return 0; fi
    kill -0 "$SERVER_PID" 2>/dev/null || { log "restart_server: node exited during boot (see $SERVER_LOG)"; return 1; }
    sleep 0.5; i=$(( i + 1 ))
  done
  log "restart_server: :$APP_PORT did not accept within 30s (see $SERVER_LOG)"; return 1
}

# ── graders ──────────────────────────────────────────────────────────────────────────────────────────
measure_defects() {                            # $1 = snapshot dir; echoes int; rc 2 = analyzer CRASHED
  local dir="$1" flags="$RUN_DIR/flags-$$.json"
  if ! RAW_DIR="$dir" FLAGS="$flags" EXPECTED="$RUN_DIR/expected-$$.json" node "$ANALYZE_JS" >/dev/null 2>&1; then
    return 2
  fi
  node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1])).length))' "$flags"
}
run_diff() { node "$DIFF_JS" "$1" "$2" --out "$3" 2>/dev/null; }   # $1=before $2=after $3=out.json
json_field() { node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1]))[process.argv[2]]))}catch(e){process.stdout.write(process.argv[3]||"")}' "$1" "$2" "${3:-}"; }
became_not_analyzable() {                       # $1 = diff json, $2 = after dir → "PAIR REASON" lines
  node -e '
    const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1])); const after=process.argv[2];
    for(const [pair,v] of Object.entries(d.pairs||{})){
      if(v.buildStatus && v.buildStatus.transition==="BECAME_NOT_ANALYZABLE"){
        const f=after+"/"+pair.replace("/","_")+".json"; let reason="UNKNOWN";
        try{ reason=JSON.parse(fs.readFileSync(f)).reason||"UNKNOWN"; }catch(e){}
        console.log(pair+" "+reason);
      }
    }' "$1" "$2"
}

# ── agent verdict (Part 2) ────────────────────────────────────────────────────────────────────────────
# The agent must return a CLEAN envelope (is_error:false) AND a status token in its OUTPUT block. A cut-off
# or errored agent leaves real edits behind (run 20260815-150838 committed bcda19a on is_error:true, no
# .result) — a non-empty diff is NOT a verdict. NOTE: the token set matches ITERATION_PROMPT.md:101 exactly
# — DONE | RESOLVED_UPSTREAM | BLOCKED | FAILED — NOT PASS/FAIL, because the prompt is off-limits to edit.
agent_verdict() {                              # $1 = agent json → "OK <TOKEN>" | "NO_VERDICT <reason>"
  node -e '
    const fs=require("fs"); let j;
    try{ j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }
    catch(e){ process.stdout.write("NO_VERDICT unreadable-envelope"); process.exit(0); }
    if(j.is_error===true){ process.stdout.write("NO_VERDICT error-envelope:"+(j.subtype||j.terminal_reason||"unknown")); process.exit(0); }
    const t=(typeof j.result==="string")?j.result:"";
    const m=t.match(/^\s*STATUS:\s*(DONE|RESOLVED_UPSTREAM|BLOCKED|FAILED)/mi);
    if(!m){ process.stdout.write("NO_VERDICT no-status-token"); process.exit(0); }
    process.stdout.write("OK "+m[1].toUpperCase());
  ' "$1"
}
agent_changed() { [[ -n "$(gitr status --porcelain)" ]]; }   # true if the agent left uncommitted edits (runs/ is gitignored)

# ── frozen-price check (empirical, not clock) ────────────────────────────────────────────────────────
frozen_check() {                               # rc 0 = frozen (N+1 ok), 1 = moving (force 2N)
  if [[ -n "${TEST_FROZEN:-}" ]]; then [[ "$TEST_FROZEN" == "1" ]]; return; fi
  local p1 p2
  p1="$(curl -s "$BASE_URL/api/price/AAPL" --max-time 10)"; sleep "$FROZEN_WAIT"
  p2="$(curl -s "$BASE_URL/api/price/AAPL" --max-time 10)"
  [[ -n "$p1" && "$p1" == "$p2" ]]
}

# ── queue helpers ────────────────────────────────────────────────────────────────────────────────────
queue_next() {                                 # prints topmost "- [ ]" item block; exit 3 if none
  node -e '
    const fs=require("fs"); const t=fs.readFileSync(process.argv[1],"utf8");
    const open=(t.split(/^## Open/m)[1]||"").split(/^## /m)[0];
    const L=open.split("\n"); let i=L.findIndex(l=>/^- \[ \] /.test(l));
    if(i<0) process.exit(3);
    const b=[L[i]]; for(let j=i+1;j<L.length;j++){ if(/^- \[/.test(L[j])||/^## /.test(L[j])) break; b.push(L[j]); }
    process.stdout.write(b.join("\n").trim());' "$QUEUE"
}
queue_mark() {                                 # $1 = marker (x|~), $2 = note → mutates FIRST "- [ ]"
  node -e '
    const fs=require("fs"); const [file,mk,note]=process.argv.slice(1);
    let t=fs.readFileSync(file,"utf8"); let done=false;
    t=t.replace(/^- \[ \] (.*)$/m,(m,rest)=>{done=true; return `- [${mk}] ${rest}  <!-- ${note} -->`;});
    fs.writeFileSync(file,t); process.exit(done?0:3);' "$QUEUE" "$1" "$2"
}

# ── revert / bookkeeping ─────────────────────────────────────────────────────────────────────────────
revert_to() {                                  # $1 = checkpoint sha — discard the agent's work, keep the runner's log
  # Preserve runner-owned bookkeeping across the revert: a decide()/finalize note written this iteration
  # must survive `reset --hard` + `clean` (the AGENT's code changes are what we discard, not our own log).
  [[ -f "$DECISIONS" ]] && cp "$DECISIONS" "$RUN_DIR/.decisions.bak"
  [[ -f "$CALIB" ]] && cp "$CALIB" "$RUN_DIR/.calib.bak"
  gitr reset --hard "$1" >/dev/null 2>&1
  gitr clean -fd >/dev/null 2>&1               # remove new untracked files; gitignored (.env, runs/) survive
  [[ -f "$RUN_DIR/.decisions.bak" ]] && cp "$RUN_DIR/.decisions.bak" "$DECISIONS"
  [[ -f "$RUN_DIR/.calib.bak" ]] && cp "$RUN_DIR/.calib.bak" "$CALIB"
}
decide() {                                     # $1 = plain-English statement (not a question)
  [[ -f "$DECISIONS" ]] || printf '# Sweep decisions log\n\nPlain-English statements of tripwire-worthy changes. Logged, not gated.\n' > "$DECISIONS"
  printf '\n- [%s · run %s · iter %s] %s\n' "$(date +%H:%M:%S)" "$RUN_ID" "${CUR_ITER:-?}" "$1" >> "$DECISIONS"
}
calib_hdr() { [[ -f "$CALIB" ]] || echo "run_id,iter,item,status,wall_sec,turns,cost_usd,defects_before,defects_after,capture_mode,forced_recapture" > "$CALIB"; }
finalize() {                                   # $1=status $2=marker (x=done · ~=parked · o=leave OPEN) $3=forced
  calib_hdr
  [[ "$2" == "x" || "$2" == "~" ]] && { queue_mark "$2" "$1 run $RUN_ID" || true; }   # "o" ⇒ leave the item OPEN (Parts 2/3: NO_VERDICT/BUILD_BROKEN/UNVERIFIED/NO_CHANGE)
  printf '%s,%s,"%s",%s,%s,%s,%s,%s,%s,%s,%s\n' "$RUN_ID" "$CUR_ITER" "$ITEM_TITLE" "$1" "$WALL" "$TURNS" "$COST" "$DEF_BEFORE" "$DEF_AFTER" "$CAP_MODE" "$3" >> "$CALIB"
  gitr add -A >/dev/null 2>&1
  gitr commit -q -m "sweep($RUN_ID) iter $CUR_ITER: $ITEM_TITLE [$1] defects $DEF_BEFORE->$DEF_AFTER" >/dev/null 2>&1 || true
}

# ── agent invocation + per-iteration wall-clock timeout ──────────────────────────────────────────────
# --max-turns does NOT bound a permission-prompt hang: a pending prompt consumes no turns and waits
# forever. So the agent runs under a wall-clock watchdog; on expiry we tree-kill it and treat it as
# TIMEOUT (a fail, unlike INDETERMINATE — a timeout means a bad allowlist or a stuck item, both reasons
# to stop). stderr is captured so the morning report shows WHERE it hung.
run_agent() {
  if [[ -n "${MOCK_AGENT:-}" ]]; then
    bash "$MOCK_AGENT" "$ITEM" "$AGENT_OUT" "$ROOT" >/dev/null 2>"$AGENT_OUT.err" || true
  else
    # cd to ROOT so claude reads .claude/settings.local.json (the allowlist) and edits the right tree,
    # regardless of where run-sweep.sh was launched from. Redirects stay absolute (outside the subshell).
    ( cd "$ROOT" && { cat "$PROMPT"; printf '\n\nITEM: %s\n' "$ITEM"; } | \
      claude -p --output-format json --max-turns "$MAX_TURNS" --permission-mode acceptEdits ) > "$AGENT_OUT" 2>"$AGENT_OUT.err" || true
  fi
}
hash_result() { node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1]));process.stdout.write(require("crypto").createHash("sha256").update(JSON.stringify(j.result||"")).digest("hex"))}catch(e){process.stdout.write("ERR")}' "$AGENT_OUT"; }
kill_tree() { local p="$1" c; for c in $(pgrep -P "$p" 2>/dev/null); do kill_tree "$c"; done; kill -KILL "$p" 2>/dev/null; }
run_agent_timed() {                            # $1 = seconds; rc 124 = timed out (tree killed)
  local secs="$1" waited=0 pid
  ( run_agent ) & pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [[ "$waited" -ge "$secs" ]]; then kill_tree "$pid"; wait "$pid" 2>/dev/null; return 124; fi
    sleep 1; waited=$(( waited + 1 ))
  done
  wait "$pid" 2>/dev/null; return 0
}

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# SETUP
# ════════════════════════════════════════════════════════════════════════════════════════════════════
command -v node >/dev/null || die "node not found"
[[ -f "$CAPTURE_JS" && -f "$ANALYZE_JS" && -f "$DIFF_JS" ]] || die "grader/collector missing"
[[ -z "$(gitr status --porcelain)" ]] || die "working tree is DIRTY — commit or stash first, then re-run"

mkdir -p "$RUN_DIR/cap"
echo "$$" > "$RUN_DIR/run.pid"   # liveness marker — the dashboard checks kill -0 on this to tell RUNNING from DIED
build_pairs_json
NPAIRS="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).length))' "$PAIRS_JSON")"
QCOUNT="$(node -e 'const fs=require("fs"),t=fs.readFileSync(process.argv[1],"utf8");const o=(t.split(/^## Open/m)[1]||"").split(/^## /m)[0];process.stdout.write(String((o.match(/^- \[ \] /mg)||[]).length));' "$QUEUE")"

gitr tag "restore/pre-sweep-$RUN_ID" >/dev/null 2>&1 || die "restore tag already exists"
gitr checkout -q -b "sweep/auto-$RUN_ID" || die "could not create branch sweep/auto-$RUN_ID"
cat > "$RUN_DIR/UNDO.txt" <<EOF
# Discard the ENTIRE night's work in one line (run from $ROOT):
git checkout $BASE_BRANCH && git branch -D sweep/auto-$RUN_ID && git tag -d restore/pre-sweep-$RUN_ID
# (if you already left the branch: git reset --hard restore/pre-sweep-$RUN_ID)
EOF

START_EPOCH="$(date +%s)"
if frozen_check; then CAP_MODE="N+1"; else CAP_MODE="2N"; log "WARNING: prices MOVING — 2N fallback"; decide "Prices not frozen at startup; capture mode = 2N."; fi
PER_SWEEP_S=$(( NPAIRS * 12 + 15 ))
if [[ "$CAP_MODE" == "N+1" ]]; then SWEEPS=$(( QCOUNT + 1 )); else SWEEPS=$(( QCOUNT * 2 + 1 )); fi
EST_S=$(( SWEEPS * PER_SWEEP_S + QCOUNT * 120 ))
END_HUMAN="$(date -v +"${EST_S}"S '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -d "+${EST_S} seconds" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo '?')"
log "RUN $RUN_ID · branch sweep/auto-$RUN_ID · $NPAIRS pairs · $QCOUNT open items · mode $CAP_MODE"
log "START $(date '+%Y-%m-%d %H:%M:%S')  →  PROJECTED END ~$END_HUMAN  (${SWEEPS} sweeps × ~${PER_SWEEP_S}s + agent)"

log "baseline capture ($NPAIRS pairs)…"
BASE_DIR="$RUN_DIR/cap/baseline"
restart_server || die "server failed to boot at baseline capture (HEAD may not run) — see $SERVER_LOG"
do_capture "$BASE_DIR" "baseline" || die "baseline capture failed"
DEF_BEFORE="$(measure_defects "$BASE_DIR")" || die "analyzer CRASHED on baseline — aborting (a crash is not a defect)"
log "baseline: $DEF_BEFORE defects across $NPAIRS pairs"

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# ITERATION LOOP
# ════════════════════════════════════════════════════════════════════════════════════════════════════
CUR_BEFORE_DIR="$BASE_DIR"; PENDING_FRESH_BASELINE=0; CONSEC_FAIL=0; COST_TOTAL=0; CUR_ITER=0; PREV_RESULT_HASH=""

while :; do
  CUR_ITER=$(( CUR_ITER + 1 ))
  [[ "$CUR_ITER" -gt "$MAX_ITER" ]] && { log "halt: MAX_ITER reached"; break; }
  [[ -f "$STOP_FILE" ]] && { log "halt: STOP file present"; break; }
  [[ "$CONSEC_FAIL" -ge 3 ]] && { log "halt: 3 consecutive REGRESSION/FAILED"; break; }
  awk "BEGIN{exit !($COST_TOTAL > $BUDGET_USD)}" && { log "halt: budget \$$BUDGET_USD exceeded (\$$COST_TOTAL)"; break; }
  ITEM="$(queue_next)"; [[ $? -eq 3 ]] && { log "halt: queue empty"; break; }
  ITEM_TITLE="$(printf '%s' "$ITEM" | head -1 | sed 's/^- \[ \] //; s/\*\*//g; s/,/;/g; s/"/'"'"'/g' | cut -c1-58)"
  WALL=0; TURNS=0; COST=0; DEF_AFTER="$DEF_BEFORE"
  log "── iter $CUR_ITER · $ITEM_TITLE"

  # freeze re-check every 3 iterations (HOLE 2)
  if [[ "$CAP_MODE" == "N+1" && "$CUR_ITER" -gt 1 && $(( (CUR_ITER-1) % 3 )) -eq 0 ]]; then
    if ! frozen_check; then
      CAP_MODE="2N"; PENDING_FRESH_BASELINE=1
      log "!!! prices STARTED MOVING mid-run — switching N+1 -> 2N from iter $CUR_ITER (completed items retained)"
      decide "Prices started moving at iter $CUR_ITER; switched N+1 -> 2N."
    fi
  fi

  # establish BEFORE snapshot (fresh if 2N, or forced fresh after a prior revert — HOLE 1)
  FORCED=false
  if [[ "$CAP_MODE" == "2N" || "$PENDING_FRESH_BASELINE" -eq 1 ]]; then
    [[ "$PENDING_FRESH_BASELINE" -eq 1 ]] && { FORCED=true; log "forced fresh baseline re-capture (HOLE 1: prior item reverted/indeterminate)"; }
    CUR_BEFORE_DIR="$RUN_DIR/cap/before-$CUR_ITER"
    restart_server || die "server failed to boot before before-capture at iter $CUR_ITER — see $SERVER_LOG"
    if ! do_capture "$CUR_BEFORE_DIR" "before-$CUR_ITER"; then
      log "before-capture failed → INDETERMINATE (capture ≠ code); skip item, no fail-count"
      finalize INDETERMINATE "~" true; PENDING_FRESH_BASELINE=1; continue
    fi
    DEF_BEFORE="$(measure_defects "$CUR_BEFORE_DIR")" || die "analyzer CRASHED on before-capture"
    PENDING_FRESH_BASELINE=0
  fi

  CHECKPOINT="$(gitr rev-parse HEAD)"; ITER_T0="$(date +%s)"; AGENT_OUT="$RUN_DIR/agent-$CUR_ITER.json"

  # run the agent under a wall-clock timeout (bounds a permission-prompt hang that --max-turns cannot)
  run_agent_timed "$ITER_TIMEOUT"; AGENT_RC=$?
  if [[ "$AGENT_RC" -eq 124 ]]; then
    WALL="$ITER_TIMEOUT"; TURNS=0; COST=0; DEF_AFTER="$DEF_BEFORE"
    log "TIMEOUT: agent exceeded ${ITER_TIMEOUT}s (elapsed $(( $(date +%s) - ITER_T0 ))s) — killed. Last agent stderr:"
    if [[ -s "$AGENT_OUT.err" ]]; then tail -3 "$AGENT_OUT.err" | sed 's/^/      | /'; else log "      | (no output captured — likely hung on a permission prompt before producing any)"; fi
    decide "iter $CUR_ITER TIMEOUT after ${ITER_TIMEOUT}s — likely a permission prompt on an unlisted command, or a stuck item."
    revert_to "$CHECKPOINT"; finalize TIMEOUT "~" "$FORCED"; PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
    log "REVERTED (TIMEOUT) · consecutive fail = $CONSEC_FAIL"; continue
  fi
  TURNS="$(json_field "$AGENT_OUT" num_turns 0)"; COST="$(json_field "$AGENT_OUT" total_cost_usd 0)"
  COST_TOTAL="$(awk "BEGIN{print $COST_TOTAL + $COST}")"

  # REPLAY GUARD (duplicate responses have occurred 3× in this project)
  RESULT_HASH="$(hash_result)"
  if [[ -n "$PREV_RESULT_HASH" && "$RESULT_HASH" == "$PREV_RESULT_HASH" && "$RESULT_HASH" != "ERR" ]]; then
    log "REPLAY_SUSPECTED: result byte-identical to previous iteration — revert + retry once"
    decide "Replay suspected at iter $CUR_ITER (identical result payload); reverted and retried once."
    revert_to "$CHECKPOINT"; run_agent_timed "$ITER_TIMEOUT" || true; RESULT_HASH="$(hash_result)"
    if [[ "$RESULT_HASH" == "$PREV_RESULT_HASH" ]]; then
      revert_to "$CHECKPOINT"; WALL=$(( $(date +%s) - ITER_T0 ))
      finalize FAILED "~" false; CONSEC_FAIL=$(( CONSEC_FAIL + 1 )); continue
    fi
  fi
  PREV_RESULT_HASH="$RESULT_HASH"

  # ── VERDICT GATE (Part 2): no clean envelope + status token ⇒ NO_VERDICT. Checked BEFORE the after-capture
  #    so an untrustworthy agent never spends a ~10-min capture, and its edits are reverted, not measured.
  VERDICT="$(agent_verdict "$AGENT_OUT")"; STATUS_TOKEN="${VERDICT#* }"
  if [[ "$VERDICT" != OK\ * ]]; then
    log "NO_VERDICT (${VERDICT#NO_VERDICT }) — untrustworthy agent result; revert, leave item OPEN, save envelope to diagnosis/"
    mkdir -p "$AGENT_DIR/diagnosis" 2>/dev/null || true
    cp "$AGENT_OUT" "$AGENT_DIR/diagnosis/agent-$RUN_ID-iter$CUR_ITER.json" 2>/dev/null || true
    [[ -s "$AGENT_OUT.err" ]] && cp "$AGENT_OUT.err" "$AGENT_DIR/diagnosis/agent-$RUN_ID-iter$CUR_ITER.err" 2>/dev/null || true
    decide "iter $CUR_ITER NO_VERDICT: agent envelope error/absent or no {DONE,RESOLVED_UPSTREAM,BLOCKED,FAILED} token (${VERDICT#NO_VERDICT }); reverted, item left OPEN."
    revert_to "$CHECKPOINT"; WALL=$(( $(date +%s) - ITER_T0 )); finalize NO_VERDICT "o" "$FORCED"; PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
    log "NO_VERDICT · consecutive fail = $CONSEC_FAIL"; continue
  fi
  log "verdict: agent returned $STATUS_TOKEN"

  # ── restart :$APP_PORT on the AGENT'S code before the after-capture (Part 1). BUILD_BROKEN is checked
  #    HERE, before the defect comparison: a server that will not boot captures 0 analyzable pairs, which
  #    would false-read as a defect drop and auto-commit — the reward-breakage hazard (GATE_SPEC §3).
  if ! restart_server; then
    log "BUILD_BROKEN: :$APP_PORT did not boot on the agent's changes → revert + HALT (never scored as an improvement)"
    decide "iter $CUR_ITER BUILD_BROKEN: server would not boot on the agent's edits; reverted to checkpoint and halted before any defect comparison."
    revert_to "$CHECKPOINT"; WALL=$(( $(date +%s) - ITER_T0 )); finalize BUILD_BROKEN "o" "$FORCED"; PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
    log "HALTED (BUILD_BROKEN) · consecutive fail = $CONSEC_FAIL"; break
  fi

  # after-capture (capture failure ≠ code failure → INDETERMINATE)
  AFTER_DIR="$RUN_DIR/cap/after-$CUR_ITER"
  if ! do_capture "$AFTER_DIR" "after-$CUR_ITER"; then
    log "after-capture failed → INDETERMINATE; revert conservatively, no fail-count"
    revert_to "$CHECKPOINT"; WALL=$(( $(date +%s) - ITER_T0 ))
    finalize INDETERMINATE "~" "$FORCED"; PENDING_FRESH_BASELINE=1; continue
  fi
  DIFF_OUT="$RUN_DIR/diff-$CUR_ITER.json"; run_diff "$CUR_BEFORE_DIR" "$AFTER_DIR" "$DIFF_OUT"
  DEF_AFTER="$(measure_defects "$AFTER_DIR")" || die "analyzer CRASHED on after-capture"
  if [[ -n "${TEST_REGRESS_ITERS:-}" && ",${TEST_REGRESS_ITERS}," == *",${CUR_ITER},"* ]]; then DEF_AFTER=$(( DEF_AFTER + 1 )); fi  # TEST-ONLY
  REVERT_SIGNAL="$(json_field "$DIFF_OUT" revert_signal false)"
  WALL=$(( $(date +%s) - ITER_T0 ))

  # ── THE GATE (per GATE_SPEC) ──
  if [[ "$DEF_AFTER" -gt "$DEF_BEFORE" ]]; then
    log "GATE: defects $DEF_BEFORE -> $DEF_AFTER (rose) → REGRESSION"
    revert_to "$CHECKPOINT"; finalize REGRESSION "~" "$FORCED"; PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
    log "REVERTED (REGRESSION) · consecutive fail = $CONSEC_FAIL"
  elif [[ "$REVERT_SIGNAL" == "true" ]]; then
    BNA="$(became_not_analyzable "$DIFF_OUT" "$AFTER_DIR" | head -1)"; BNA_PAIR="${BNA%% *}"; BNA_REASON="${BNA##* }"
    log "GATE: $BNA_PAIR became not-analyzable (reason=$BNA_REASON)"
    if [[ "$BNA_REASON" == "RATE_LIMITED" ]]; then
      log "INDETERMINATE ($BNA_REASON) — retrying the CAPTURE before touching code (THE TRAP)…"
      RETRY_DIR="$RUN_DIR/cap/after-$CUR_ITER-retry"
      if do_capture "$RETRY_DIR" "after-$CUR_ITER-retry" && run_diff "$CUR_BEFORE_DIR" "$RETRY_DIR" "$DIFF_OUT"; then
        RS2="$(json_field "$DIFF_OUT" revert_signal true)"; DA2="$(measure_defects "$RETRY_DIR")" || DA2=$(( DEF_BEFORE + 1 ))
        if [[ "$RS2" == "false" && "$DA2" -le "$DEF_BEFORE" ]]; then
          log "capture retry RECOVERED $BNA_PAIR → normal comparison → COMMIT"
          AFTER_DIR="$RETRY_DIR"; DEF_AFTER="$DA2"
          finalize DONE "x" "$FORCED"; CUR_BEFORE_DIR="$AFTER_DIR"; DEF_BEFORE="$DEF_AFTER"; CONSEC_FAIL=0
        else
          log "capture retry EXHAUSTED → revert conservatively, status INDETERMINATE (NOT a fail)"
          revert_to "$CHECKPOINT"; finalize INDETERMINATE "~" "$FORCED"; PENDING_FRESH_BASELINE=1
          log "INDETERMINATE · consecutive fail unchanged = $CONSEC_FAIL"
        fi
      else
        log "capture retry failed → revert conservatively, INDETERMINATE (NOT a fail)"
        revert_to "$CHECKPOINT"; finalize INDETERMINATE "~" "$FORCED"; PENDING_FRESH_BASELINE=1
        log "INDETERMINATE · consecutive fail unchanged = $CONSEC_FAIL"
      fi
    else
      log "not environmental (reason=$BNA_REASON) → REGRESSION"
      revert_to "$CHECKPOINT"; finalize REGRESSION "~" "$FORCED"; PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
      log "REVERTED (REGRESSION) · consecutive fail = $CONSEC_FAIL"
    fi
  elif [[ "$DEF_AFTER" -lt "$DEF_BEFORE" ]]; then
    # strict improvement + no revert_signal + a verdict is present (Part 2 passed) → COMMIT and CLOSE the item
    log "GATE: defects $DEF_BEFORE->$DEF_AFTER (improved), no revert_signal, verdict $STATUS_TOKEN → COMMIT"
    finalize DONE "x" "$FORCED"; CUR_BEFORE_DIR="$AFTER_DIR"; DEF_BEFORE="$DEF_AFTER"; CONSEC_FAIL=0
    log "COMMITTED (item closed) iter $CUR_ITER"
  elif agent_changed; then
    # equal count + non-empty agent diff → the work MAY be correct but is UNMEASURED (e.g. a server-side fix
    # the 5-pair window can't move). Reverting a no-op discards possibly-correct work; but an unattended loop
    # must not fill a night with unverified commits — so commit it, mark UNVERIFIED, leave the item OPEN, and
    # count it toward the circuit breaker.
    log "GATE: defects $DEF_BEFORE->$DEF_AFTER unchanged + non-empty diff → UNVERIFIED (commit, item stays OPEN)"
    decide "iter $CUR_ITER UNVERIFIED: agent edited files but the defect count did not move ($DEF_BEFORE->$DEF_AFTER) and no revert_signal; committed as UNVERIFIED, queue item left OPEN (not checked off)."
    finalize UNVERIFIED "o" "$FORCED"; CUR_BEFORE_DIR="$AFTER_DIR"; DEF_BEFORE="$DEF_AFTER"; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
    log "UNVERIFIED · consecutive fail = $CONSEC_FAIL"
  else
    # equal count + the agent left NO edits → nothing to commit; leave the item OPEN, count toward the breaker
    log "GATE: defects $DEF_BEFORE->$DEF_AFTER unchanged and agent left no edits → NO_CHANGE (item stays OPEN)"
    decide "iter $CUR_ITER NO_CHANGE: agent returned $STATUS_TOKEN but produced no edits and no defect movement; item left OPEN."
    revert_to "$CHECKPOINT"; finalize NO_CHANGE "o" "$FORCED"; PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
    log "NO_CHANGE · consecutive fail = $CONSEC_FAIL"
  fi
done

log "RUN $RUN_ID COMPLETE · branch sweep/auto-$RUN_ID · undo: $RUN_DIR/UNDO.txt"
