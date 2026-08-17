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
# FROZEN_WAIT, PAIRS_LIMIT, TEST_REGRESS_ITERS, MAX_ITER, BUDGET_USD, BASE_BRANCH, SWEEP_LOCK.
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
# ── settings config (dashboard Settings page) — a CFG_*=VALUE file the runner reads as DEFAULTS. Precedence:
#    env var > sweep.settings > hardcoded fallback. Changes only WHERE a default comes from, never behavior.
SWEEP_SETTINGS="${SWEEP_SETTINGS:-$AGENT_DIR/sweep.settings}"
[[ -f "$SWEEP_SETTINGS" ]] && source "$SWEEP_SETTINGS" 2>/dev/null || true
MAX_ITER="${MAX_ITER:-${CFG_MAX_ITER:-999}}"
MAX_TURNS="${MAX_TURNS:-${CFG_MAX_TURNS:-60}}"  # raised 40->60: run 20260815-150838 hit the 40-turn cap mid-fix after its STEP-0 EDGAR fetch was denied
BUDGET_USD="${BUDGET_USD:-${CFG_BUDGET_USD:-50}}"
GAP_MS="${GAP_MS:-12000}"                      # rate-safe inter-pair spacing for capture.js
PAIRS_LIMIT="${PAIRS_LIMIT:-${CFG_PAIRS_LIMIT:-0}}"   # 0 = all 50; >0 caps pairs (tests)
FROZEN_WAIT="${FROZEN_WAIT:-60}"
ITER_TIMEOUT="${ITER_TIMEOUT:-2700}"           # per-iteration wall-clock cap (45 min); --max-turns does NOT bound a permission-prompt hang
BUILD_TIMEOUT="${BUILD_TIMEOUT:-300}"          # cap on `npm run build` (measured ~7s); an unattended runner must never hang here
BASE_URL="${BASE_URL:-http://localhost:3001}"
APP_PORT="${BASE_URL##*:}"                      # port the app server (and capture.js) listen on — parsed from BASE_URL
BASE_BRANCH="${BASE_BRANCH:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)}"
RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
RUN_DIR="$AGENT_DIR/runs/$RUN_ID"
SERVER_LOG="/tmp/server-$RUN_ID.log"           # the restarted app server's stdout/stderr (Part 1)
BUILD_LOG="/tmp/build-$RUN_ID.log"             # `npm run build` stdout/stderr (Part 2)
SERVER_PID=""                                   # PID of the server WE start (kill only our own + the port holder)
LOCK_FILE="${SWEEP_LOCK:-$AGENT_DIR/runs/.sweep.lock}"  # single-runner mutex; runs/ is gitignored so `git clean -fd` cannot eat it
LOCK_HELD=0                                     # 1 once WE own the lock — release_lock refuses to delete another run's

log()  { local l; l="$(printf '[%s] %s' "$(date +%H:%M:%S)" "$*")"; printf '%s\n' "$l"; if [[ -n "${RUN_DIR:-}" ]]; then mkdir -p "$RUN_DIR" 2>/dev/null; printf '%s\n' "$l" >> "$RUN_DIR/loop.log"; fi; }  # tee to stdout AND runs/<id>/loop.log (appended live, per call)
die()  { printf '[FATAL] %s\n' "$*" >&2; exit 1; }
gitr() { git -C "$ROOT" "$@"; }

# ── single-runner lock (Part 1) ──────────────────────────────────────────────────────────────────────
# Runs 20260816-165919 and 20260816-165953 launched 34s apart. Both called restart_server, so the second
# KILLED the first's server and the first then ran its entire 88-minute baseline against the second's
# process. Worse, both swept 50 pairs through one 500-req/15-min limiter at ~83 requests/pair, so 33 of 50
# decks failed to build and BOTH runs reported an identical, meaningless "68 defects". Two sweeps on one
# machine cannot produce one honest measurement — the second must refuse to start.
#
# The lock is a PID + RUN_ID, not a bare flag: a runner killed with SIGKILL (or a machine that lost power)
# can never run its trap, and a bare flag would then wedge every future run until someone deleted it by
# hand. A lock whose PID is gone is STALE — reclaimed with a log line, never treated as a permanent block.
lock_read() {                                  # echoes "<pid> <run_id>" from the lockfile, or nothing
  [[ -f "$LOCK_FILE" ]] && head -1 "$LOCK_FILE" 2>/dev/null
}
acquire_lock() {
  mkdir -p "$(dirname "$LOCK_FILE")" 2>/dev/null || true
  local held pid rid
  # `set -o noclobber` makes the create atomic: two runners racing here, exactly one wins the redirect.
  if ( set -o noclobber; printf '%s %s\n' "$$" "$RUN_ID" > "$LOCK_FILE" ) 2>/dev/null; then
    LOCK_HELD=1; return 0
  fi
  held="$(lock_read)"; pid="${held%% *}"; rid="${held#* }"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    die "another sweep is already running: run $rid (pid $pid). Refusing to start.
       Two concurrent sweeps share :$APP_PORT and one rate-limit budget — the second kills the first's
       server and both measurements become garbage (see runs/20260816-165919 vs -165953).
       Wait for run $rid to finish, or stop it and delete $LOCK_FILE."
  fi
  # stale: the owner is gone (SIGKILL / crash / reboot). Reclaim, loudly.
  log "stale lock from run ${rid:-<unknown>} (pid ${pid:-<none>} not running) — reclaiming"
  rm -f "$LOCK_FILE"
  if ( set -o noclobber; printf '%s %s\n' "$$" "$RUN_ID" > "$LOCK_FILE" ) 2>/dev/null; then
    LOCK_HELD=1; return 0
  fi
  die "could not acquire $LOCK_FILE after clearing a stale lock (raced by another runner?)"
}
release_lock() {                               # only ever removes a lock WE own (pid match) — never another run's
  [[ "$LOCK_HELD" -eq 1 ]] || return 0
  local held; held="$(lock_read)"
  [[ "${held%% *}" == "$$" ]] && rm -f "$LOCK_FILE"
  LOCK_HELD=0
}
# EXIT covers normal exit AND die(); INT/TERM cover Ctrl-C and `kill`. SIGKILL is untrappable by design —
# that is exactly the case the stale-PID check above handles, so the lock can never wedge permanently.
trap release_lock EXIT INT TERM

# ── repro pairs (Part C) ─────────────────────────────────────────────────────────────────────────────
# Every open QUEUE.md item names the pair its defect REPRODUCES on. The capture set used to be the
# alphabetically-first PAIRS_LIMIT pairs off disk, which contained almost none of them: run 20260815-150838
# captured AAPL/VZ ABNB/EXPE AMT/CCI AMZN/MSFT ARM/SNPS while working item 1, whose repro pair is
# GOOGL/AMZN — so the gate compared 8 defects to 8 on five decks that never contained the bug, and a no-op
# scored as a pass. Repro pairs are therefore MANDATORY in the capture set; PAIRS_LIMIT caps only the filler.
#
# EXTRACTION IS LITERAL — never inferred. Two accepted forms, in priority order:
#   1. a `pair:` label      — `- pair: GOOGL/AMZN · observed: …`      (QUEUE.md's documented shape)
#   2. the title STARTING with the pair — `**KO/NSRGY — comps from CNBC**`  (the dashboard's shape)
# A free scan of the whole block is deliberately NOT done: item 1's title carries "GATE-2A root:
# GP/COGS-crossSurface", which a greedy scan reads as the pair GP/COGS. An item with no parseable pair
# yields "-" and is BLOCKED at its iteration — a repro pair is never guessed.
repro_pair() {                                 # $1 = "queue" ($2=QUEUE.md → one line per open item) | "block" ($2=item text)
  node -e '
    const fs=require("fs");
    const TICK="[A-Z][A-Z0-9.]{0,5}";
    const LABEL=new RegExp("\\bpair\\s*:\\s*("+TICK+")\\s*/\\s*("+TICK+")");
    const TITLE=new RegExp("^("+TICK+")\\s*/\\s*("+TICK+")\\b");
    const of=blk=>{
      const lines=String(blk).split("\n"); let m;
      if((m=String(blk).match(LABEL))) return m[1].toUpperCase()+"/"+m[2].toUpperCase();
      const title=(lines[0]||"").replace(/^\s*- \[[^\]]\]\s*/,"").replace(/\*\*/g,"").replace(/^\d+[.)]\s*/,"").trim();
      if((m=title.match(TITLE))) return m[1].toUpperCase()+"/"+m[2].toUpperCase();
      return "-";
    };
    const [mode,arg]=process.argv.slice(1);
    if(mode==="block"){ console.log(of(arg)); process.exit(0); }
    const t=fs.readFileSync(arg,"utf8");
    const open=(t.split(/^## Open/m)[1]||"").split(/^## /m)[0]; const L=open.split("\n");
    for(let i=0;i<L.length;i++){
      if(!/^- \[ \] /.test(L[i])) continue;
      const b=[L[i]]; for(let j=i+1;j<L.length;j++){ if(/^- \[/.test(L[j])||/^## /.test(L[j])) break; b.push(L[j]); }
      console.log(of(b.join("\n")));
    }' "$1" "$2"
}
pair_capture_state() {                         # $1 = snapshot dir, $2 = PAIR → "OK" | "MISSING" | "FAILED:<reason>"
  node -e '
    const fs=require("fs"); const [dir,pair]=process.argv.slice(1);
    let j; try{ j=JSON.parse(fs.readFileSync(dir+"/"+pair.replace("/","_")+".json","utf8")); }
    catch(e){ process.stdout.write("MISSING"); process.exit(0); }
    process.stdout.write(j.ok===true?"OK":("FAILED:"+(j.reason||j.stage||"UNKNOWN")));
  ' "$1" "$2"
}

# ── capture: clear RAW, run capture.js (or MOCK_CAPTURE), snapshot into $1 ───────────────────────────
PAIRS_JSON=""; REPRO_PAIRS=""
build_pairs_json() {
  # repro pairs FIRST and uncapped (they are what the run is measured on); the on-disk pair list is filler.
  REPRO_PAIRS="$(repro_pair queue "$QUEUE" | grep -v '^-$' | sort -u | tr '\n' ' ')"
  PAIRS_JSON="$(REPRO="$REPRO_PAIRS" node -e '
    const fs=require("fs"),p=process.argv[1],lim=+process.argv[2]||0;
    const seed=fs.readdirSync(p).filter(f=>f.endsWith(".json"))
      .map(f=>{try{return JSON.parse(fs.readFileSync(p+"/"+f)).pair}catch(e){return null}}).filter(Boolean);
    const seen=new Set(), out=[];
    for(const x of (process.env.REPRO||"").trim().split(/\s+/).filter(Boolean)) if(!seen.has(x)){seen.add(x);out.push(x);}
    let filler=seed.filter(x=>!seen.has(x));
    if(lim>0) filler=filler.slice(0,lim);       // PAIRS_LIMIT caps the FILLER only — never a repro pair
    for(const x of filler) if(!seen.has(x)){seen.add(x);out.push(x);}
    process.stdout.write(JSON.stringify(out.map(x=>{const i=x.indexOf("/");return [x.slice(0,i),x.slice(i+1),null];})));
  ' "$ROOT/docs/sweep-v2/captures" "$PAIRS_LIMIT")"
}
do_capture() {                                 # $1 = dest snapshot dir, $2 = phase label; rc 2 = capture failed
  local dest="$1" phase="$2" t0; t0="$(date +%s)"
  log "capture START · $phase · ${NPAIRS:-?} decks (per-deck progress follows — a silent capture is the runner working, not a hang)"
  rm -rf "$RAW"; mkdir -p "$RAW" "$dest"
  if [[ -n "${MOCK_CAPTURE:-}" ]]; then
    bash "$MOCK_CAPTURE" "$RAW" "$phase" "$RUN_ID" || return 2
  else
    # LOOP_LOG + CAPTURE_PHASE → capture.js appends one line per deck to loop.log (Part 1); stdout stays /dev/null
    GAP_MS="$GAP_MS" LOOP_LOG="$RUN_DIR/loop.log" CAPTURE_PHASE="$phase" node "$CAPTURE_JS" "$PAIRS_JSON" >/dev/null 2>&1 \
      || { log "capture END · $phase · FAILED after $(( ($(date +%s) - t0) / 60 ))m"; return 2; }
  fi
  cp "$RAW"/*.json "$dest"/ 2>/dev/null || true
  local n ok
  n="$(ls "$dest"/*.json 2>/dev/null | wc -l | tr -d ' ')"
  ok="$(node -e 'const fs=require("fs"),d=process.argv[1];let k=0;for(const f of fs.readdirSync(d)){if(!f.endsWith(".json"))continue;try{if(JSON.parse(fs.readFileSync(d+"/"+f)).ok)k++}catch(e){}}process.stdout.write(String(k))' "$dest" 2>/dev/null || echo '?')"
  log "capture END · $phase · $n decks captured ($ok ok) · $(( ($(date +%s) - t0) / 60 ))m"
  [[ -n "$(ls -A "$dest" 2>/dev/null)" ]] || return 2
  return 0
}

# ── server lifecycle: restart :APP_PORT BEFORE every capture (Part 1) ─────────────────────────────────
# capture.js grades the persistent server at $BASE_URL. That process never reloads, so a server-side fix
# (server.js / ltmCalc.js) is invisible to the after-capture unless we restart — the root cause of run
# 20260815-150838 committing an unmeasurable no-op. rc 0 = up & accepting; rc 1 = failed to boot, and the
# CALLER MUST NOT proceed to capture (a non-booting server = 0 analyzable pairs = a false defect drop).
# ── frontend build (Part 2): the graders read the BUNDLE, never src/ ─────────────────────────────────
# server.js:2624 serves build/ via express.static, and capture.js drives http://localhost:$APP_PORT. The
# runner restarted node but NEVER rebuilt, so build/ sat at Aug 14 18:34 while src/ moved on — every
# client-side fix an agent made was invisible to BOTH graders, permanently. bcda19a's server-side half
# (ltmCalc.js) scored; its client-side half (SectionStandalonePL.js) could not, which is why GOOGL/AMZN
# gross profit resolved and cost of revenue did not. The gate was silently grading a stale bundle.
#
# THE TRAP: `npm run build` exiting 0 is NOT proof of a fresh bundle. A build that dies late leaves the
# PREVIOUS build/ in place, and the capture then grades stale code exactly as it did before this fix —
# indistinguishable from success. So we verify the artifact, not the exit code.
build_frontend() {
  [[ -n "${MOCK_CAPTURE:-}" ]] && return 0       # tests mock the capture; there is no bundle to build
  local t0 rc pid waited main_js mt before after idx_ref el
  before="$(ls -t "$ROOT/build/static/js/"main.*.js 2>/dev/null | head -1)"; before="${before##*/}"
  t0="$(date +%s)"
  # CI=false pinned: react-scripts turns lint WARNINGS into build ERRORS when CI is truthy, so a stray
  # CI=1 in the launchd/cron environment would fail every build on pre-existing warnings and halt the run.
  ( cd "$ROOT" && CI=false npm run build ) > "$BUILD_LOG" 2>&1 &
  pid=$!; waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [[ "$waited" -ge "$BUILD_TIMEOUT" ]]; then
      kill_tree "$pid"; wait "$pid" 2>/dev/null
      log "build FAILED: exceeded ${BUILD_TIMEOUT}s — killed (see $BUILD_LOG)"; return 1
    fi
    sleep 1; waited=$(( waited + 1 ))
  done
  wait "$pid"; rc=$?; el=$(( $(date +%s) - t0 ))
  if [[ "$rc" -ne 0 ]]; then
    log "build FAILED: npm run build rc=$rc after ${el}s (see $BUILD_LOG). Last lines:"
    tail -5 "$BUILD_LOG" 2>/dev/null | sed 's/^/      | /'
    return 1
  fi
  # 1. the bundle must EXIST
  main_js="$(ls -t "$ROOT/build/static/js/"main.*.js 2>/dev/null | head -1)"
  [[ -n "$main_js" ]] || { log "build FAILED: rc=0 but no build/static/js/main.*.js on disk (see $BUILD_LOG)"; return 1; }
  # 2. the bundle must have been WRITTEN BY THIS BUILD — mtime, deliberately NOT the content hash. A fix
  #    that is server-side only (ltmCalc.js, server.js) legitimately produces a byte-identical bundle with
  #    the SAME hash; gating on a hash change would fail exactly the iterations that are working correctly.
  #    mtime older than t0 means the build never rewrote it => the old bundle survived => stale. Refuse.
  mt="$(stat -f %m "$main_js" 2>/dev/null || stat -c %Y "$main_js" 2>/dev/null || echo 0)"
  [[ "$mt" -ge "$t0" ]] || { log "build FAILED: ${main_js##*/} was not rewritten (mtime $mt < build start $t0) — stale bundle survived a rc=0 build; refusing to capture"; return 1; }
  # 3. the bundle must be COMPLETE — index.html has to reference a main chunk that is actually on disk.
  #    Catches a half-written build that left index.html pointing at a hash that no longer exists.
  idx_ref="$(grep -o 'static/js/main\.[A-Za-z0-9]*\.js' "$ROOT/build/index.html" 2>/dev/null | head -1)"
  [[ -n "$idx_ref" ]] || { log "build FAILED: build/index.html references no main bundle (partial build?)"; return 1; }
  [[ -f "$ROOT/build/$idx_ref" ]] || { log "build FAILED: build/index.html points at $idx_ref which is not on disk (partial build)"; return 1; }
  after="${main_js##*/}"
  if [[ "$before" == "$after" ]]; then
    log "build OK · ${el}s · bundle $after (byte-identical — no client-side change this iteration)"
  else
    log "build OK · ${el}s · bundle ${before:-<none>} -> $after"
  fi
  return 0
}

restart_server() {
  [[ -n "${MOCK_CAPTURE:-}" ]] && return 0       # tests mock the capture; there is no real server to cycle
  # Part 2: rebuild BEFORE touching the port. Order matters — a failed build returns here with the old
  # server still up and untouched, rather than leaving us with no server AND a stale bundle.
  build_frontend || { log "restart_server: frontend build failed — port left alone, NOT capturing"; return 1; }
  local i p holders
  # 1. kill STRICTLY by PID (Part 8): the server WE started + whatever holds :$APP_PORT right now. NEVER by
  #    process name — the dashboard on :3002 is ALSO `node server.js`, and a name-based kill terminated it
  #    mid-run (17:05, run 20260816). `lsof -ti tcp:$APP_PORT` can only ever return a :$APP_PORT holder, so
  #    the dashboard is structurally out of the kill set.
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
# .result) — a non-empty diff is NOT a verdict. The token set matches ITERATION_PROMPT.md's OUTPUT FORMAT
# exactly — DONE | RESOLVED_UPSTREAM | PARTIAL | BLOCKED | FAILED — NOT PASS/FAIL.
agent_verdict() {                              # $1 = agent json → "OK <TOKEN>" | "NO_VERDICT <reason>"
  node -e '
    const fs=require("fs"); let j;
    try{ j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }
    catch(e){ process.stdout.write("NO_VERDICT unreadable-envelope"); process.exit(0); }
    if(j.is_error===true){ process.stdout.write("NO_VERDICT error-envelope:"+(j.subtype||j.terminal_reason||"unknown")); process.exit(0); }
    const t=(typeof j.result==="string")?j.result:"";
    const m=t.match(/^\s*STATUS:\s*(DONE|RESOLVED_UPSTREAM|PARTIAL|BLOCKED|FAILED)/mi);
    if(!m){ process.stdout.write("NO_VERDICT no-status-token"); process.exit(0); }
    process.stdout.write("OK "+m[1].toUpperCase());
  ' "$1"
}
# The parenthetical argument on a status token — PARTIAL(<resolved> / <remains>), BLOCKED(<reason>), etc.
# Extracted literally, never inferred: for PARTIAL it is the ONLY description of what is left to do, and it
# gets written back into the queue item so the next iteration starts from what this one actually learned.
status_detail() {                              # $1 = agent json → the (…) text, or "" when absent
  node -e '
    const fs=require("fs"); let j;
    try{ j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }catch(e){ process.exit(0); }
    const t=(typeof j.result==="string")?j.result:"";
    const m=t.match(/^\s*STATUS:\s*[A-Z_]+\s*\(([^)]*)\)/mi);
    process.stdout.write(m?m[1].replace(/[\r\n]+/g," ").replace(/<!--|-->/g,"").trim():"");
  ' "$1"
}
agent_changed() { [[ -n "$(gitr status --porcelain)" ]]; }   # true if the agent left uncommitted edits (runs/ is gitignored)

# ── agent error envelope (Part B) ─────────────────────────────────────────────────────────────────────
# calibration.csv used to record ONLY status/turns/cost, so run 20260815-150838's row reads DONE even
# though the agent returned is_error:true / subtype:error_max_turns. These three fields go into the
# ledger so a row can never again look like a success when the agent actually died. NOTE: json_field()
# stringifies a MISSING key as the literal "undefined", which would corrupt the CSV — hence a dedicated
# reader that emits ABSENT and strips CSV-hostile characters. terminal_reason is read as the fallback for
# subtype (same "why did it end" fact; subtype is the more specific of the two when both are present).
agent_envelope() {                             # $1 = agent json → "is_error<TAB>subtype<TAB>terminal_reason"
  node -e '
    const fs=require("fs"); let j={};
    try{ j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }catch(e){}
    const s=v=>(v===undefined||v===null||v==="")?"ABSENT":String(v).replace(/[",\r\n\t]/g," ").trim();
    const e=j.is_error===true?"true":(j.is_error===false?"false":"ABSENT");
    process.stdout.write([e,s(j.subtype),s(j.terminal_reason)].join("\t"));
  ' "$1"
}

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
# Annotate the first OPEN item WITHOUT checking it off (Part 4). PARTIAL needs the item to stay actionable
# while recording what this iteration resolved and what is left — a checkbox change would close it.
queue_note() {                                 # $1 = note text → appends an indented line under FIRST "- [ ]"
  node -e '
    const fs=require("fs"); const [file,note]=process.argv.slice(1);
    let t=fs.readFileSync(file,"utf8"); let done=false;
    const L=t.split("\n"); const i=L.findIndex(l=>/^- \[ \] /.test(l));
    if(i<0) process.exit(3);
    // insert AFTER the item block (title + its indented detail lines), so got/want/why stay contiguous
    let j=i+1; while(j<L.length && !/^- \[/.test(L[j]) && !/^## /.test(L[j]) && L[j].trim()!=="") j++;
    L.splice(j,0,"    "+note); done=true;
    fs.writeFileSync(file,L.join("\n")); process.exit(done?0:3);' "$QUEUE" "$1"
}

# ── revert / bookkeeping ─────────────────────────────────────────────────────────────────────────────
revert_to() {                                  # $1 = checkpoint sha — discard the agent's work, keep the runner's log
  # Preserve runner-owned bookkeeping across the revert: a decide()/finalize note written this iteration
  # must survive `reset --hard` + `clean` (the AGENT's code changes are what we discard, not our own log).
  #
  # EVIDENCE IS BOOKKEEPING, NOT WORK (Part 3). agent/diagnosis/ is preserved here for the same reason.
  # The NO_VERDICT branch copied the agent envelope into agent/diagnosis/ and logged "save envelope to
  # diagnosis/", then called revert_to three lines later — and `git clean -fd` deleted the copy, because a
  # new file in a tracked directory is untracked. agent/diagnosis/ has been EMPTY after every NO_VERDICT
  # while the log claimed otherwise. The same deletion silently destroyed the agent's OWN diagnosis .md,
  # which ITERATION_PROMPT.md calls "the durable record whether the item ends DONE, BLOCKED, or FAILED" —
  # on every revert path (NO_VERDICT / REGRESSION / TIMEOUT / NO_CHANGE). We discard the agent's CODE, not
  # its findings: a reverted iteration is exactly the one whose write-up we most need to read afterwards.
  [[ -f "$DECISIONS" ]] && cp "$DECISIONS" "$RUN_DIR/.decisions.bak"
  [[ -f "$CALIB" ]] && cp "$CALIB" "$RUN_DIR/.calib.bak"
  rm -rf "$RUN_DIR/.diagnosis.bak"
  [[ -d "$AGENT_DIR/diagnosis" ]] && cp -R "$AGENT_DIR/diagnosis" "$RUN_DIR/.diagnosis.bak" 2>/dev/null
  gitr reset --hard "$1" >/dev/null 2>&1
  gitr clean -fd >/dev/null 2>&1               # remove new untracked files; gitignored (.env, runs/) survive
  [[ -f "$RUN_DIR/.decisions.bak" ]] && cp "$RUN_DIR/.decisions.bak" "$DECISIONS"
  [[ -f "$RUN_DIR/.calib.bak" ]] && cp "$RUN_DIR/.calib.bak" "$CALIB"
  if [[ -d "$RUN_DIR/.diagnosis.bak" ]]; then
    mkdir -p "$AGENT_DIR/diagnosis" 2>/dev/null
    cp -R "$RUN_DIR/.diagnosis.bak/." "$AGENT_DIR/diagnosis/" 2>/dev/null || true
  fi
}
decide() {                                     # $1 = plain-English statement (not a question)
  [[ -f "$DECISIONS" ]] || printf '# Sweep decisions log\n\nPlain-English statements of tripwire-worthy changes. Logged, not gated.\n' > "$DECISIONS"
  printf '\n- [%s · run %s · iter %s] %s\n' "$(date +%H:%M:%S)" "$RUN_ID" "${CUR_ITER:-?}" "$1" >> "$DECISIONS"
}
calib_hdr() { [[ -f "$CALIB" ]] || echo "run_id,iter,item,status,wall_sec,turns,cost_usd,defects_before,defects_after,capture_mode,forced_recapture,agent_is_error,agent_subtype,agent_status_token" > "$CALIB"; }
finalize() {                                   # $1=status $2=marker (x=done · ~=parked · o=leave OPEN) $3=forced
  calib_hdr
  [[ "$2" == "x" || "$2" == "~" ]] && { queue_mark "$2" "$1 run $RUN_ID" || true; }   # "o" ⇒ leave the item OPEN (Parts 2/3: NO_VERDICT/BUILD_BROKEN/UNVERIFIED/NO_CHANGE)
  printf '%s,%s,"%s",%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$RUN_ID" "$CUR_ITER" "$ITEM_TITLE" "$1" "$WALL" "$TURNS" "$COST" "$DEF_BEFORE" "$DEF_AFTER" "$CAP_MODE" "$3" \
    "${AGENT_IS_ERROR:-ABSENT}" "${AGENT_SUBTYPE:-ABSENT}" "${STATUS_TOKEN:-ABSENT}" >> "$CALIB"
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
    # env -u ANTHROPIC_API_KEY (Part 9): strip the key so a hand-launched run from a shell that sourced .env
    # can NEVER silently switch to per-token API billing. No-op when the key is absent (the normal case).
    ( cd "$ROOT" && { cat "$PROMPT"; printf '\n\nITEM: %s\n' "$ITEM"; } | \
      env -u ANTHROPIC_API_KEY claude -p --output-format json --max-turns "$MAX_TURNS" --permission-mode acceptEdits ) > "$AGENT_OUT" 2>"$AGENT_OUT.err" || true
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
    # heartbeat every 60s (Part 1): claude -p returns NOTHING until it finishes, so an elapsed-time tick is
    # the only honest liveness signal during the agent phase — no fake progress, just "still working, Nm in".
    [[ $(( waited % 60 )) -eq 0 ]] && log "  claude -p working… $(( waited / 60 ))m elapsed (Claude Code returns nothing until it finishes)"
  done
  wait "$pid" 2>/dev/null; return 0
}

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# SETUP
# ════════════════════════════════════════════════════════════════════════════════════════════════════
command -v node >/dev/null || die "node not found"
[[ -f "$CAPTURE_JS" && -f "$ANALYZE_JS" && -f "$DIFF_JS" ]] || die "grader/collector missing"
acquire_lock                                   # Part 1: FIRST — before we touch the port, the tree, or the tag
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
NREPRO="$(printf '%s' "$REPRO_PAIRS" | wc -w | tr -d ' ')"
NOPAIR="$(repro_pair queue "$QUEUE" | grep -c '^-$' || true)"
log "capture set: $NPAIRS pairs = $NREPRO mandatory repro + filler (PAIRS_LIMIT=$PAIRS_LIMIT caps filler only)"
log "repro pairs (forced): ${REPRO_PAIRS:-<none>}"
[[ "$NOPAIR" -gt 0 ]] && log "WARNING: $NOPAIR open item(s) name no repro pair — each is BLOCKED at its iteration (never guessed)"
log "START $(date '+%Y-%m-%d %H:%M:%S')  →  PROJECTED END ~$END_HUMAN  (${SWEEPS} sweeps × ~${PER_SWEEP_S}s + agent)"

log "baseline capture ($NPAIRS pairs)…"
BASE_DIR="$RUN_DIR/cap/baseline"
restart_server || die "frontend build or server boot FAILED at baseline (HEAD may not build/run) — see $BUILD_LOG and $SERVER_LOG"
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
  # Part 3: strip the trailing HTML comment FIRST, then allow 120 chars. The 58-char cut was there to stop
  # item 1's long <!-- REOPENED: … --> annotation flooding calibration.csv, but it amputated every title
  # ("1. Leg-availability / LTM gross-profit blanking — 32 pai"). Dropping the comment removes the reason
  # for a narrow cut; 120 fits all five open items whole, including their GATE-2A root, which is the part
  # that makes a row diagnosable. Commas → ';' and '"' → "'" still keep the CSV field safe.
  ITEM_TITLE="$(printf '%s' "$ITEM" | head -1 | sed 's/^- \[ \] //; s/<!--.*$//; s/\*\*//g; s/,/;/g; s/"/'"'"'/g; s/[[:space:]]*$//' | cut -c1-120)"
  WALL=0; TURNS=0; COST=0; DEF_AFTER="$DEF_BEFORE"
  # Part B: reset the envelope columns each iteration so a TIMEOUT / pre-agent INDETERMINATE row cannot
  # inherit the previous iteration's agent state. ABSENT = "we never got a readable envelope".
  AGENT_IS_ERROR=ABSENT; AGENT_SUBTYPE=ABSENT; AGENT_TERMINAL=ABSENT; STATUS_TOKEN=ABSENT
  log "── iter $CUR_ITER · $ITEM_TITLE"

  # ── REPRO GATE half 1 (Part C): an item that names no repro pair has nothing to measure against. Blocked
  #    HERE, before any capture or agent time is spent. BLOCKED is a PARK, not a code failure — it reverts
  #    nothing and does not count toward the consecutive-fail breaker.
  ITEM_PAIR="$(repro_pair block "$ITEM")"
  if [[ -z "$ITEM_PAIR" || "$ITEM_PAIR" == "-" ]]; then
    log "BLOCKED: item names no repro pair (needs a 'pair: A/B' line, or a title starting 'A/B — …') — not worked"
    decide "iter $CUR_ITER BLOCKED: queue item names no parseable repro pair, so no measurement is possible; parked without agent work."
    finalize BLOCKED "~" false; continue
  fi

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
    restart_server || die "frontend build or server boot FAILED before before-capture at iter $CUR_ITER — see $BUILD_LOG and $SERVER_LOG"
    if ! do_capture "$CUR_BEFORE_DIR" "before-$CUR_ITER"; then
      log "before-capture failed → INDETERMINATE (capture ≠ code); skip item, no fail-count"
      finalize INDETERMINATE "~" true; PENDING_FRESH_BASELINE=1; continue
    fi
    DEF_BEFORE="$(measure_defects "$CUR_BEFORE_DIR")" || die "analyzer CRASHED on before-capture"
    PENDING_FRESH_BASELINE=0
  fi

  # ── REPRO GATE half 2 (Part C): the item's repro pair must be PRESENT and analyzable in the snapshot the
  #    gate will actually score against. Working an item whose repro deck was never captured is exactly what
  #    let run 20260815-150838 read a no-op as "8->8 clear": the deck carrying the defect was not in the
  #    window at all, so neither grader could ever see the fix — or its absence.
  PAIR_STATE="$(pair_capture_state "$CUR_BEFORE_DIR" "$ITEM_PAIR")"
  if [[ "$PAIR_STATE" != "OK" ]]; then
    log "BLOCKED: repro pair $ITEM_PAIR is $PAIR_STATE in $(basename "$CUR_BEFORE_DIR") — unmeasurable, not worked"
    decide "iter $CUR_ITER BLOCKED: repro pair $ITEM_PAIR failed to capture ($PAIR_STATE); the defect's own deck is absent from the measurement window, so no verdict is possible — parked without agent work."
    finalize BLOCKED "~" "$FORCED"; continue
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
  # Part B: read the agent's own error envelope alongside turns/cost, for calibration.csv and the log.
  IFS=$'\t' read -r AGENT_IS_ERROR AGENT_SUBTYPE AGENT_TERMINAL <<< "$(agent_envelope "$AGENT_OUT")"
  [[ "$AGENT_SUBTYPE" == "ABSENT" && "$AGENT_TERMINAL" != "ABSENT" ]] && AGENT_SUBTYPE="$AGENT_TERMINAL"
  [[ "$AGENT_IS_ERROR" == "true" ]] && log "agent envelope: is_error=true subtype=$AGENT_SUBTYPE terminal_reason=$AGENT_TERMINAL turns=$TURNS"

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
  VERDICT="$(agent_verdict "$AGENT_OUT")"
  # Only an OK verdict yields a real token; on NO_VERDICT the suffix is a REASON, not a token, and must
  # not be written into calibration.csv's agent_status_token column as if it were one.
  if [[ "$VERDICT" == OK\ * ]]; then STATUS_TOKEN="${VERDICT#OK }"; else STATUS_TOKEN=ABSENT; fi
  if [[ "$VERDICT" != OK\ * ]]; then
    log "NO_VERDICT (${VERDICT#NO_VERDICT }) — untrustworthy agent result; revert, leave item OPEN, save envelope to diagnosis/"
    # Part 3: the envelope lands in TWO places on purpose.
    #   $AGENT_DIR/diagnosis — the durable, committed record; survives the revert below via revert_to's
    #                          preserve list, and finalize's `gitr add -A` then commits it.
    #   $RUN_DIR             — gitignored, so it survives regardless of what git does. $AGENT_OUT already
    #                          lives here as agent-N.json; the named copy makes it findable by run+iter
    #                          without knowing the runner's internal filename.
    mkdir -p "$AGENT_DIR/diagnosis" 2>/dev/null || true
    cp "$AGENT_OUT" "$AGENT_DIR/diagnosis/agent-$RUN_ID-iter$CUR_ITER.json" 2>/dev/null || true
    cp "$AGENT_OUT" "$RUN_DIR/envelope-iter$CUR_ITER.json" 2>/dev/null || true
    [[ -s "$AGENT_OUT.err" ]] && { cp "$AGENT_OUT.err" "$AGENT_DIR/diagnosis/agent-$RUN_ID-iter$CUR_ITER.err" 2>/dev/null || true; cp "$AGENT_OUT.err" "$RUN_DIR/envelope-iter$CUR_ITER.err" 2>/dev/null || true; }
    decide "iter $CUR_ITER NO_VERDICT: agent envelope error/absent or no {DONE,RESOLVED_UPSTREAM,BLOCKED,FAILED} token (${VERDICT#NO_VERDICT }); reverted, item left OPEN."
    revert_to "$CHECKPOINT"; WALL=$(( $(date +%s) - ITER_T0 )); finalize NO_VERDICT "o" "$FORCED"; PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
    log "NO_VERDICT · consecutive fail = $CONSEC_FAIL"; continue
  fi
  log "verdict: agent returned $STATUS_TOKEN"

  # ── PARTIAL (Part 4): the item's defect class SPLIT — some of it resolved, the rest did not ──────────
  # STEP 0 offered exactly three exits: reproduces / RESOLVED_UPSTREAM / BLOCKED(repro-drifted). None
  # describes what item 1 actually became. bcda19a fixed the gross-profit half of GP/COGS-crossSurface and
  # not the cost-of-revenue half, so on run 20260816-165919 the agent found GP already correct at turn 39
  # (6 minutes in, "The repro does not reproduce — §7 now renders"), had no legal way to report a half-
  # resolved class, kept investigating for another 22 turns, and died on the turn cap at 61. Run -165953
  # repeated it exactly. Two full nights and ~$9 bought zero verdicts because the vocabulary was missing.
  #
  # PARTIAL is a REPORT, not a failure: the agent states what resolved and what remains, then stops. So it
  # does NOT touch the consecutive-fail breaker — the breaker exists to stop a wrong premise, and a correct
  # report of a split defect class is the opposite of that. The item stays OPEN, carrying what was learned.
  if [[ "$STATUS_TOKEN" == "PARTIAL" ]]; then
    PARTIAL_DETAIL="$(status_detail "$AGENT_OUT")"
    log "PARTIAL: ${PARTIAL_DETAIL:-<no detail given>}"
    # The agent's contract for PARTIAL is report-and-stop, so any edits are out of contract. Revert them:
    # we are deliberately skipping the after-capture (there is no claimed fix to measure), and keeping
    # unmeasured edits would silently poison the next iteration's before-snapshot.
    if agent_changed; then
      log "PARTIAL: agent left edits despite report-and-stop — reverting them UNMEASURED (see $RUN_DIR/agent-$CUR_ITER.json)"
      decide "iter $CUR_ITER PARTIAL returned edits, which its contract forbids; reverted unmeasured rather than committing work no capture scored."
    fi
    decide "iter $CUR_ITER PARTIAL: ${PARTIAL_DETAIL:-agent reported a split defect class with no detail}; item left OPEN with the remaining half recorded, breaker untouched."
    revert_to "$CHECKPOINT"
    # ORDER MATTERS: QUEUE.md is TRACKED, so it is not on revert_to's preserve list — annotating before the
    # revert would hand the note straight to `reset --hard`. Write it after, so finalize's `gitr add -A`
    # commits it. (This is the same ordering finalize/queue_mark already relies on.)
    [[ -n "$PARTIAL_DETAIL" ]] && { queue_note "<!-- PARTIAL run $RUN_ID iter $CUR_ITER: $PARTIAL_DETAIL -->" || log "PARTIAL: could not annotate the queue item"; }
    WALL=$(( $(date +%s) - ITER_T0 )); finalize PARTIAL "o" "$FORCED"; PENDING_FRESH_BASELINE=1
    log "PARTIAL · consecutive fail unchanged = $CONSEC_FAIL · next item"; continue
  fi

  # ── rebuild the bundle + restart :$APP_PORT on the AGENT'S code before the after-capture (Parts 1-2).
  #    BUILD_BROKEN is checked HERE, before the defect comparison: a server that will not boot captures 0
  #    analyzable pairs, which would false-read as a defect drop and auto-commit — the reward-breakage
  #    hazard (GATE_SPEC §3). Since Part 2 restart_server also rebuilds build/, so a client-side edit that
  #    does not compile is caught here too, and is never graded against the previous iteration's bundle.
  if ! restart_server; then
    log "BUILD_BROKEN: frontend build failed or :$APP_PORT did not boot on the agent's changes → revert + HALT (never scored as an improvement)"
    decide "iter $CUR_ITER BUILD_BROKEN: the frontend bundle would not build, or the server would not boot, on the agent's edits; reverted to checkpoint and halted before any defect comparison."
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
