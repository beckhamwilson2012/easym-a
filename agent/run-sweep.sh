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
# RAW is defined AFTER RUN_ID (below) because it is now run-scoped — see RAW_ROOT/RAW there.

# ── config (env-overridable) ────────────────────────────────────────────────────────────────────────
# ── settings config (dashboard Settings page) — a CFG_*=VALUE file the runner reads as DEFAULTS. Precedence:
#    env var > sweep.settings > hardcoded fallback. Changes only WHERE a default comes from, never behavior.
SWEEP_SETTINGS="${SWEEP_SETTINGS:-$AGENT_DIR/sweep.settings}"
[[ -f "$SWEEP_SETTINGS" ]] && source "$SWEEP_SETTINGS" 2>/dev/null || true
# SWEEP_MAX_ITER / SWEEP_PAIRS are the demo-mode overrides (agent/demo.sh): a short, bounded run for a
# meeting. Unset, both resolve to exactly what the runner did before them.
MAX_ITER="${SWEEP_MAX_ITER:-${MAX_ITER:-${CFG_MAX_ITER:-999}}}"
# MAX_TURNS is DELIBERATELY NOT config-backed — no CFG_MAX_TURNS, so sweep.settings cannot raise it and the
# dashboard cannot either. An env var at launch still wins, for supervised terminal runs.
#   40->60 already failed. Run 20260815-150838 died at the 40-turn cap; the cap was raised to 60 and runs
#   20260816-165919 and -165953 then died at 61, both on the SAME item, for reasons more turns cannot fix:
#   STEP 0 had no way to report a half-resolved defect class (fixed by the PARTIAL exit) and the client-side
#   half of the fix was unmeasurable because the runner never rebuilt build/ (fixed by build_frontend).
#   Raising the cap buys a longer, more expensive NO_VERDICT. If an item needs more than 60 turns, the item
#   is wrong — split it, or give STEP 0 the vocabulary to stop early. Change this line, not a settings page.
MAX_TURNS="${MAX_TURNS:-60}"
BUDGET_USD="${BUDGET_USD:-${CFG_BUDGET_USD:-50}}"
GAP_MS="${GAP_MS:-12000}"                      # rate-safe inter-pair spacing for capture.js
PAIRS_LIMIT="${PAIRS_LIMIT:-${CFG_PAIRS_LIMIT:-0}}"   # 0 = all 50; >0 caps pairs (tests)
# SWEEP_PAIRS caps the TOTAL capture set, repro pairs included — PAIRS_LIMIT caps only the filler and so
# can never produce a 5-pair run. 0 = off (the default, i.e. unchanged behaviour). A cap BELOW the repro
# count drops mandatory repro pairs: fine for a demo, wrong for a graded run, so it is announced in the
# log rather than applied silently.
SWEEP_PAIRS="${SWEEP_PAIRS:-0}"
FROZEN_WAIT="${FROZEN_WAIT:-60}"
ITER_TIMEOUT="${ITER_TIMEOUT:-2700}"           # per-iteration wall-clock cap (45 min); --max-turns does NOT bound a permission-prompt hang
BUILD_TIMEOUT="${BUILD_TIMEOUT:-300}"          # cap on `npm run build` (measured ~7s); an unattended runner must never hang here
# ── THE APP PORT — one number, shared by the runner, the server it starts, and the collector ─────────
# Precedence: an explicit BASE_URL wins, else SWEEP_APP_PORT, else 3001. Whatever the source, APP_PORT and
# SWEEP_APP_PORT end up EQUAL and SWEEP_APP_PORT is exported, so capture.js:9 reads the same number the
# runner frees and starts the server on. They could drift before: capture.js hardcoded 3001 while APP_PORT
# came from BASE_URL, and restart_server passed no PORT at all — so BASE_URL=...:3002 freed :3002, started
# a server still listening on :3001, and captured :3001. The kill was always scoped to the port the runner
# COMPUTED; the bug was that the port it USED could be a different one.
BASE_URL="${BASE_URL:-http://localhost:${SWEEP_APP_PORT:-3001}}"
APP_PORT="${BASE_URL##*:}"                      # port the app server (and capture.js) listen on
SWEEP_APP_PORT="$APP_PORT"; export SWEEP_APP_PORT
BASE_BRANCH="${BASE_BRANCH:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)}"
RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
RUN_DIR="$AGENT_DIR/runs/$RUN_ID"
# ── RAW is RUN-SCOPED ────────────────────────────────────────────────────────────────────────────────
# It used to be one directory, /tmp/sweep_v2_raw, shared by every run that ever executed. Run
# 20260816-212606's orphaned capture kept writing failure stubs into it while run -222441 was capturing,
# and -222441's `cp "$RAW"/*.json "$dest"/` swept 15 foreign stubs into its own baseline. That is the
# entire difference between its recorded baseline of 25 and its true baseline of 10 across 5 pairs.
# SWEEP_RAW_DIR carries the scope into capture.js, which is the actual WRITER — scoping only this side
# would have left the writer pointed at the shared directory and changed nothing.
RAW_ROOT="${SWEEP_RAW_ROOT:-/tmp/sweep_v2_raw}"
RAW="$RAW_ROOT/$RUN_ID"
# Worker scratch: repo-local and gitignored (agent/runs/ is in .gitignore), so `git clean -fd` spares it —
# and unlike /tmp it is neither reboot-mortal nor shared between runs. See ITERATION_PROMPT.md.
SCRATCH_DIR="$RUN_DIR/scratch"
SERVER_LOG="/tmp/server-$RUN_ID.log"           # the restarted app server's stdout/stderr (Part 1)
BUILD_LOG="/tmp/build-$RUN_ID.log"             # `npm run build` stdout/stderr (Part 2)
SERVER_PID=""                                   # PID of the server WE start (kill only our own + the port holder)
LOCK_FILE="${SWEEP_LOCK:-$AGENT_DIR/runs/.sweep.lock}"  # single-runner mutex; runs/ is gitignored so `git clean -fd` cannot eat it
LOCK_HELD=0                                     # 1 once WE own the lock — release_lock refuses to delete another run's
CAPTURE_PID=""                                  # PID of the capture.js we are running right now, if any
RUN_PHASE="startup"                             # where we are; named in the ledger row if we die abnormally
RUN_COMPLETED=0                                 # 1 only after the run ends normally — gates finalize_abnormal

log()  { local l; l="$(printf '[%s] %s' "$(date +%H:%M:%S)" "$*")"; printf '%s\n' "$l"; if [[ -n "${RUN_DIR:-}" ]]; then mkdir -p "$RUN_DIR" 2>/dev/null; printf '%s\n' "$l" >> "$RUN_DIR/loop.log"; fi; }  # tee to stdout AND runs/<id>/loop.log (appended live, per call)
# die() also appends to THIS run's loop.log when that file already exists. Run 20261112-000000 died with
# loop.log ending on a normal promote line and the reason only in launchd's sweep.err, so the dashboard
# showed DIED with no cause. Append-only to an existing file: a refused start (lock held) creates nothing.
die()  { printf '[FATAL] %s\n' "$*" >&2; [[ -n "${RUN_DIR:-}" && -f "$RUN_DIR/loop.log" ]] && printf '[%s] FATAL: %s\n' "$(date +%H:%M:%S)" "$*" >> "$RUN_DIR/loop.log"; exit 1; }
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
  # stale: the owner is gone (SIGKILL / crash / reboot). Reclaim, loudly — and reap what it left behind
  # BEFORE we start capturing, or its capture.js competes with ours for :$APP_PORT and the rate limit.
  log "stale lock from run ${rid:-<unknown>} (pid ${pid:-<none>} not running) — reclaiming"
  reap_stale_capture "$rid"
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

# ── orphan reaping ───────────────────────────────────────────────────────────────────────────────────
# Kill a capture.js left behind by a run whose runner is already dead.
#
# TARGETED BY IDENTITY, NEVER BY NAME. A live run's capture.js is byte-identical in `ps` to a zombie one,
# so `pkill -f capture.js` would murder the healthy run this whole mechanism exists to protect. We only
# ever touch the PID the dead run itself recorded in its own run dir, and the command-line check below is
# a PID-REUSE GUARD — proof the pid is still that capture — not the way the process is selected.
reap_stale_capture() {                         # $1 = the stale run's RUN_ID
  local rid="$1" pf cpid cmd
  [[ -n "$rid" && "$rid" != "<unknown>" ]] || return 0
  pf="$AGENT_DIR/runs/$rid/capture.pid"
  [[ -f "$pf" ]] || return 0                   # it exited cleanly and cleared its own pidfile
  cpid="$(head -1 "$pf" 2>/dev/null | tr -dc '0-9')"
  rm -f "$pf" 2>/dev/null || true
  [[ -n "$cpid" ]] || return 0
  kill -0 "$cpid" 2>/dev/null || return 0      # already gone; nothing to reap
  cmd="$(ps -o command= -p "$cpid" 2>/dev/null || true)"
  case "$cmd" in
    *"$CAPTURE_JS"*)
      log "reaping orphaned capture.js (pid $cpid) left by dead run $rid — it would fight us for :$APP_PORT"
      kill_tree "$cpid" ;;
    *)
      log "stale capture.pid $cpid from run $rid is no longer capture.js (pid reused) — left alone" ;;
  esac
}

# Per-run capture dirs are never deleted at the end of a run (they are evidence, and a killed run cannot
# clean up after itself), so without a reaper /tmp accumulates one directory per sweep forever. Age-based
# and bounded to OUR root only — it never touches a directory outside $RAW_ROOT, and never the current run.
RAW_KEEP_DAYS="${RAW_KEEP_DAYS:-3}"
reap_stale_raw() {
  [[ -d "$RAW_ROOT" ]] || return 0
  local d n=0
  while IFS= read -r d; do
    [[ -z "$d" || "$d" == "$RAW" ]] && continue          # never the run we are about to start
    rm -rf "$d" 2>/dev/null && n=$(( n + 1 ))
  done < <(find "$RAW_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+$RAW_KEEP_DAYS" 2>/dev/null)
  [[ "$n" -gt 0 ]] && log "reaped $n capture dir(s) older than ${RAW_KEEP_DAYS}d from $RAW_ROOT"
  return 0
}

# Everything THIS runner spawned, killed on our way out. The app server is deliberately spared: it is not a
# competitor (it is what captures read FROM), leaving it up keeps :$APP_PORT browsable after a run, and the
# next run's restart_server reclaims the port anyway.
cleanup_children() {
  local p
  for p in $(pgrep -P $$ 2>/dev/null); do
    [[ -n "${SERVER_PID:-}" && "$p" == "$SERVER_PID" ]] && continue
    kill_tree "$p"
  done
}

# One handler for every way this process can end. ORDER MATTERS: write the ledger row while the run's state
# is still readable, then kill the children, then release the lock — so the next runner cannot start until
# this one's capture.js is actually dead.
# ── ledger self-commit ───────────────────────────────────────────────────────────────────────────────
# Every ledger row the runner writes has to end up in a commit, because an uncommitted row IS a dirty tree
# and the DIRTY guard then refuses the NEXT run. Run 20260930-193438 halted on `queue empty` before any
# iteration, so finalize() never ran, its start-of-run `decide` row sat unstaged, and the 10-03 and 10-04
# runs both died at the guard having done nothing at all. finalize() still commits per iteration; this is
# the catch-all for rows written when no iteration follows.
#
# SAFETY — it only ever commits on the run's OWN branch. If the run died before `checkout -b` (at the DIRTY
# guard itself, or on a failed lock), HEAD is the operator's branch and the dirt is THEIRS; committing it
# would sweep someone else's work into a sweep commit. Paths are named explicitly, never `add -A`.
# agent/runs/ is gitignored, so its files are not committed here and never make the tree dirty.
commit_ledger() {
  [[ "$(gitr rev-parse --abbrev-ref HEAD 2>/dev/null)" == "sweep/auto-$RUN_ID" ]] || return 0
  local p
  for p in "$CALIB" "$DECISIONS" "$QUEUE"; do
    [[ -e "$p" ]] && { gitr add -- "$p" >/dev/null 2>&1 || true; }
  done
  [[ -d "$AGENT_DIR/diagnosis" ]] && { gitr add -- "$AGENT_DIR/diagnosis" >/dev/null 2>&1 || true; }
  gitr diff --cached --quiet && return 0          # nothing of ours is staged
  if gitr commit -q -m "sweep($RUN_ID): ledger" >/dev/null 2>&1; then
    log "ledger committed: $(gitr rev-parse --short HEAD) — the tree is clean for the next run"
  else
    log "WARNING: ledger commit FAILED — the tree stays dirty and the next run will die at the DIRTY guard"
  fi
}

on_exit() {
  finalize_abnormal
  commit_ledger                                # after finalize_abnormal: it writes the last ledger row
  cleanup_children
  release_lock
}
# EXIT covers normal exit AND die(); INT/TERM cover Ctrl-C and `kill`. SIGKILL is untrappable by design —
# that is the case the stale-PID check and reap_stale_capture() above are for: the NEXT run cleans up what
# a SIGKILLed run could not.
trap on_exit EXIT INT TERM

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
# ── declared test (test-first grading, GATE_SPEC §12) ────────────────────────────────────────────────
# An item may declare ONE test with a `test: agent/tests/<slug>.js` detail line, extracted LITERALLY, the
# same way repro_pair() extracts `pair:`. No `test:` line ⇒ the item is count-graded exactly as before.
# The value is a path, so it is captured as one non-space token rather than to end of line: a trailing
# comment after a path would otherwise become part of the filename.
item_test() {                                  # $1 = item block text → path, or "" if none declared
  # Passed through the ENVIRONMENT, not argv: an item block begins with "- [ ] ", and `node -e SCRIPT "-…"`
  # parses that leading dash as a node OPTION ("node: bad option"). repro_pair() survives the same shape
  # only because its first argv is the mode string. Caught by the rig, which read every item as untested.
  ITEM_BLOCK="$1" node -e '
    const m=String(process.env.ITEM_BLOCK||"").match(/^\s*(?:[-*]\s*)?test\s*:\s*(\S+)\s*$/mi);
    process.stdout.write(m?m[1]:"");'
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
    const cap=+process.env.SWEEP_PAIRS||0;      // SWEEP_PAIRS caps the WHOLE set (demo mode), repro included
    const capped = cap>0 ? out.slice(0,cap) : out;
    process.stdout.write(JSON.stringify(capped.map(x=>{const i=x.indexOf("/");return [x.slice(0,i),x.slice(i+1),null];})));
  ' "$ROOT/docs/sweep-v2/captures" "$PAIRS_LIMIT")"
}
do_capture() {                                 # $1 = dest snapshot dir, $2 = phase label; rc 2 = capture failed
  local dest="$1" phase="$2" t0 rc; t0="$(date +%s)"
  RUN_PHASE="capture:$phase"
  log "capture START · $phase · ${NPAIRS:-?} decks (per-deck progress follows — a silent capture is the runner working, not a hang)"
  rm -rf "$RAW"; mkdir -p "$RAW" "$dest"
  # GUARD 1 — the dir we are about to capture into must be EMPTY. rm -rf can fail silently (permissions,
  # a busy mount), and capturing on top of leftovers is how a baseline acquires decks it never produced.
  if [[ -n "$(ls -A "$RAW" 2>/dev/null)" ]]; then
    log "capture ABORT · $phase · rc=2 (GUARD 1, not a node failure) · $RAW is not empty after clearing — refusing to capture on top of $(ls -1 "$RAW" | wc -l | tr -d ' ') existing file(s)"
    return 2
  fi
  if [[ -n "${MOCK_CAPTURE:-}" ]]; then
    bash "$MOCK_CAPTURE" "$RAW" "$phase" "$RUN_ID" || return 2
  else
    # LOOP_LOG + CAPTURE_PHASE → capture.js appends one line per deck to loop.log (Part 1); stdout stays /dev/null
    #
    # Backgrounded ONLY so the PID can be recorded — `wait` immediately below keeps this synchronous, so
    # control flow is unchanged. The pidfile is how the NEXT run identifies a capture that outlived a killed
    # runner: run 20260816-212606's capture.js survived its parent by 4 minutes and competed with run
    # -222441's baseline for :$APP_PORT and one rate-limit budget, which is why -222441 captured 20 decks
    # with only 5 ok. Identity, not process name — see reap_stale_capture().
    # Capture stdout/stderr land in $RUN_DIR, NEVER /dev/null. Run 20260817-151534 died in under a second
    # on a MODULE_NOT_FOUND for puppeteer-core; the stack went to /dev/null, so loop.log recorded only
    # "FAILED after 0m" and the reason had to be reproduced by hand afterwards. The evidence now survives
    # the run that produced it.
    #
    # Iteration-scoped filenames: do_capture runs once per phase PER ITEM, so an unscoped name lets iter 2
    # overwrite iter 1's evidence — and the overwritten file is exactly the one you need when a late
    # iteration is the one that broke. ${CUR_ITER:-0} because the baseline capture runs before the loop.
    local cout="$RUN_DIR/capture-iter${CUR_ITER:-0}-$phase.out"
    local cerr="$RUN_DIR/capture-iter${CUR_ITER:-0}-$phase.err"
    GAP_MS="$GAP_MS" LOOP_LOG="$RUN_DIR/loop.log" CAPTURE_PHASE="$phase" \
      SWEEP_RAW_DIR="$RAW" SWEEP_STATUS_LOG="$RAW/status.log" node "$CAPTURE_JS" "$PAIRS_JSON" >"$cout" 2>"$cerr" &
    CAPTURE_PID=$!
    printf '%s\n' "$CAPTURE_PID" > "$RUN_DIR/capture.pid" 2>/dev/null || true
    wait "$CAPTURE_PID"; rc=$?
    CAPTURE_PID=""; rm -f "$RUN_DIR/capture.pid" 2>/dev/null || true
    # rc is logged EXPLICITLY. Reaching here means NODE exited non-zero (missing module, syntax error,
    # uncaught rejection) — typically rc=1. A guard in this function aborting logs "capture ABORT … rc=2
    # (guard)" and never reaches this line. Before this change both paths printed the same sentence, so
    # "capture failed" could not be told from "the runner refused to capture".
    [[ "$rc" -eq 0 ]] || {
      log "capture END · $phase · FAILED after $(( ($(date +%s) - t0) / 60 ))m · rc=$rc (node exited non-zero — NOT a guard abort)"
      log "      capture stderr → $cerr"
      log "      $(tail -5 "$cerr" 2>/dev/null | tr '\n' ' ' | cut -c1-400)"
      return 2
    }
  fi
  # GUARD 2 — every deck in RAW must be one WE asked for. Run-scoping should make a foreign deck
  # impossible; this proves it rather than assuming it, and it is the check that would have caught the 15
  # stubs run -222441 inherited. A foreign deck means something else is writing into our scope — fail
  # loudly instead of silently merging it into the baseline.
  local foreign
  foreign="$(PAIRS="$PAIRS_JSON" node -e '
    const fs=require("fs"),d=process.argv[1];
    const want=new Set(JSON.parse(process.env.PAIRS||"[]").map(p=>`${p[0]}_${p[1]}.json`));
    const bad=fs.readdirSync(d).filter(f=>f.endsWith(".json")&&f!=="status.log"&&!want.has(f));
    process.stdout.write(bad.join(" "));' "$RAW" 2>/dev/null || true)"
  if [[ -n "$foreign" ]]; then
    log "capture ABORT · $phase · rc=2 (GUARD 2, not a node failure) · $RAW contains deck(s) this run never requested: $foreign"
    log "      (a concurrent writer is in our run scope — refusing to merge foreign decks into the baseline)"
    decide "iter ${CUR_ITER:-0} capture aborted: foreign decks in $RAW ($foreign) — another process wrote into this run's capture scope."
    return 2
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
  # BUNDLE_IDENTICAL is read by the no-op short-circuit. CRA puts a content hash in the filename, so an
  # unchanged name IS unchanged content for the main chunk.
  if [[ "$before" == "$after" ]]; then
    BUNDLE_IDENTICAL=1
    log "build OK · ${el}s · bundle $after (byte-identical — no client-side change this iteration)"
  else
    BUNDLE_IDENTICAL=0
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
  # PORT is passed explicitly: server.js:2905 defaults to 3001, so without it a non-default run started a
  # server on the one port it had just decided not to use.
  PORT="$APP_PORT" caffeinate -is nohup node "$ROOT/server.js" > "$SERVER_LOG" 2>&1 &
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
# ── DEFECTS ARE NOT DECKS THAT NEVER RENDERED ────────────────────────────────────────────────────────
# This used to echo flags.length — EVERY flag, sev ignored — so a pair that never built scored exactly the
# same as a pair that rendered a wrong number. The analyzer has always drawn that distinction (analyze.js:137
# emits sev:'build' and RETURNS, so the other 23 checks never run and it prints "recompute N/A — no deck");
# the count simply threw it away. That is why the five recorded baselines read 8 / 68 / 68 / 13 / 25 while
# REAL defects per analyzable pair sat flat at 1.60 / 2.00 / 2.00 / 1.67 / 2.00.
#
# sev:'build' is the ONLY non-analyzable marker: analyze.js emits it at exactly one site (:138), inside
# `if (!rec.ok)`. The other sevs — high, mid, token — are all emitted AFTER that early return, i.e. only on
# decks that DID build, so none of them can be confused for a capture failure.
#
# THIS IS COUNTING, NOT GRADING. What constitutes a defect is unchanged; a build failure simply stops being
# counted as one and becomes an EXCLUDED SAMPLE, reported separately so it can never hide.
#
# echoes TAB-separated: defects <TAB> analyzable <TAB> not_analyzable <TAB> na_list <TAB> ok_list
# rc 2 = analyzer CRASHED (a crash is not a defect — callers still die on it)
measure_defects() {                            # $1 = snapshot dir, $2 = optional CSV of pairs to EXCLUDE
  # EXCLUDE drops a pair from the numerator AND the denominator together (GATE_SPEC §13). Never one side:
  # removing a pair defects while keeping it in the denominator would flatter the change, and keeping its
  # defects while dropping it from the denominator would punish it. Both or neither.
  local dir="$1" excl="${2:-}" flags="$RUN_DIR/flags-$$.json"
  flags_of "$dir" "$flags" || return 2
  DECK_DIR="$dir" EXCLUDE="$excl" node -e '
    const fs=require("fs");
    const drop=new Set((process.env.EXCLUDE||"").split(",").map(x=>x.trim()).filter(Boolean));
    const flags=JSON.parse(fs.readFileSync(process.argv[1])).filter(f=>!drop.has(f.pair));
    const defects=flags.filter(f=>f.sev!=="build").length;
    // The analyzable/not-analyzable SETS come from the decks themselves, not from the flag list: a deck
    // that built cleanly emits no flag at all, so counting flag pairs would miss every clean pair.
    const dir=process.env.DECK_DIR; const ok=[], na=[];
    for(const f of fs.readdirSync(dir)){
      if(!f.endsWith(".json")) continue;
      try{ const j=JSON.parse(fs.readFileSync(dir+"/"+f)); const pr=j.pair||f.replace(/\.json$/,"");
           if(drop.has(pr)) continue; (j.ok?ok:na).push(pr); }
      catch(e){ const pr=f.replace(/\.json$/,""); if(!drop.has(pr)) na.push(pr); }
    }
    ok.sort(); na.sort();
    process.stdout.write([defects, ok.length, na.length, na.join(","), ok.join(",")].join("\t"));
  ' "$flags"
}
# defects per analyzable pair, 2dp — the gate value. Zero analyzable pairs yields "0" and is caught by the
# analyzable-floor check at the gate, never divided by.
density() { awk -v d="$1" -v n="$2" 'BEGIN{ if (n+0<=0) { print "0.00" } else { printf "%.2f", d/n } }'; }
# §2(b): is $2's analyzable set a SUPERSET of $1's? Echoes the pairs that were analyzable BEFORE and are
# not AFTER (empty = superset holds). Both args are comma-separated pair lists.
lost_analyzable() {                            # $1 = before ok_list, $2 = after ok_list
  BEFORE="$1" AFTER="$2" node -e '
    const b=(process.env.BEFORE||"").split(",").filter(Boolean);
    const a=new Set((process.env.AFTER||"").split(",").filter(Boolean));
    process.stdout.write(b.filter(p=>!a.has(p)).join(","));'
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

# ── RENDER DEPTH (GATE_SPEC §13) ─────────────────────────────────────────────────────────────────────
# The gate could not tell a DEGRADED capture from a healthy one, so it compared a half-rendered baseline
# against a full after-capture and charged the difference to the change. Run 20260820-133803: ABNB/EXPE
# rendered 31,571 chars at baseline under a pageError and 41,020 after (+29.9%), and the two defects that
# became visible were pre-existing classes (queue items 1 and 4). Density read 1.17 -> 1.50 and a correct,
# test-proven fix was reverted.
#
# depth = total innerText across a deck sections; errs = pageErrors. BOTH already exist in every capture —
# this measures what was always recorded and never read.
#
# THE RULE IS ASYMMETRIC, AND THAT IS THE WHOLE DESIGN. The only way for a pair to leave the comparison is
# to render MORE. Rendering LESS is harm and scores REGRESSION, so a capture can never be shrunk into a
# better grade — the §2(b) hazard at a finer grain than build success. It also closes that hole in the
# other direction: until now a deck could render half its content without failing its build, its defects
# would silently vanish, and the change would look BETTER for it.
#
# ERROR MOVEMENT IS NOT ERROR GROWTH. Errors are judged on the signature multiset across the WHOLE capture
# set, never per pair. In 20260820-133803 one pageError (Cannot read properties of undefined, reading
# length) left ABNB/EXPE and appeared on KO/NSRGY — one before, one after. Per pair, KO/NSRGY gained an
# error and shrank 4.9%; corpus-wide nothing new appeared. Charging a moved flake to the change is exactly
# what §5 forbids for a 429, and the same reasoning applies here: a pair that gains an error whose
# signature did not grow corpus-wide is INDETERMINATE, never a regression. Manufacturing that excuse would
# require emitting an error signature that already exists elsewhere WITHOUT increasing its count, which is
# not what breaking a deck does.
#
# A NULL-HONESTY FIX SHRINKS TEXT — deliberately, and far below the tolerance. Turning $2,467 into a dash
# removes ~5 characters from a ~41,000-character deck (0.01%). DEPTH_TOL is three orders of magnitude above
# that, so the class of fix this harness exists to enable can never trip the FELL rule.
depth_states() {                               # $1 = before dir, $2 = after dir
  # TSV: pair <TAB> STABLE|FELL|ROSE|INDET_ERRMOVE <TAB> depthBefore <TAB> depthAfter <TAB> pct <TAB> errB <TAB> errA
  BEFORE_DIR="$1" AFTER_DIR="$2" DEPTH_TOL="$DEPTH_TOL" node -e '
    const fs=require("fs"),path=require("path");
    const read=d=>{ const m=new Map();
      let files=[]; try{ files=fs.readdirSync(d); }catch(e){ return m; }
      for(const f of files){ if(!f.endsWith(".json")) continue;
        let j; try{ j=JSON.parse(fs.readFileSync(path.join(d,f),"utf8")); }catch(e){ continue; }
        const sec=j.sections||{}; let depth=0;
        for(const k of Object.keys(sec)) depth+=String(sec[k]==null?"":sec[k]).length;
        const errs=(j.pageErrors||[]).map(e=>String(e).slice(0,160));
        m.set(j.pair||f.replace(/\.json$/,"").replace("_","/"),{depth,errs});
      } return m; };
    const B=read(process.env.BEFORE_DIR), A=read(process.env.AFTER_DIR);
    const TOL=parseFloat(process.env.DEPTH_TOL||"3");
    const bag=m=>{ const c=new Map(); for(const v of m.values()) for(const e of v.errs) c.set(e,(c.get(e)||0)+1); return c; };
    const cb=bag(B), ca=bag(A); let grew=false;
    for(const [sig,n] of ca) if(n>(cb.get(sig)||0)) grew=true;
    for(const p of [...new Set([...B.keys(),...A.keys()])].sort()){
      const x=B.get(p), y=A.get(p);
      if(!x||!y) continue;
      const pct = x.depth===0 ? 0 : ((y.depth-x.depth)/x.depth*100);
      const de  = y.errs.length - x.errs.length;
      let state;
      if(de>0)                    state = grew ? "FELL" : "INDET_ERRMOVE";
      else if(pct<=-TOL)          state = "FELL";
      else if(pct>=TOL || de<0)   state = "ROSE";
      else                        state = "STABLE";
      process.stdout.write([p,state,x.depth,y.depth,pct.toFixed(1),x.errs.length,y.errs.length].join("\t")+"\n");
    }'
}
depth_pairs() {                                # $1 = TSV, $2... = states to select → space-separated pairs
  local tsv="$1"; shift
  printf '%s\n' "$tsv" | awk -F'\t' -v want=" $* " '$2!="" && index(want," "$2" ")>0 {printf "%s ",$1}'
}

# Run the analyzer over a capture dir, writing its flag array to $2. Split out of measure_defects so the
# gate can hold the BEFORE and AFTER flag sets at the same time — comparing flag IDENTITY needs both, and
# the single overwritten flags file could only ever hold the most recent one.
flags_of() {                                   # $1 = capture dir, $2 = out json ; rc 2 = analyzer crashed
  RAW_DIR="$1" FLAGS="$2" EXPECTED="$RUN_DIR/expected-$$.json" node "$ANALYZE_JS" >/dev/null 2>&1 || return 2
  return 0
}

# Flags in AFTER and not in BEFORE, for ONE pair. Two uses: routing an INDETERMINATE pair newly-visible
# findings into ## Discovered, and supplying the harm evidence the count demotion (§12c) requires before a
# risen density may veto a test-proven fix.
new_flags_for() {                              # $1 = before flags json, $2 = after flags json, $3 = pair
  BF="$1" AF="$2" PAIR="$3" node -e '
    const fs=require("fs");
    const rd=f=>{ try{ return JSON.parse(fs.readFileSync(f,"utf8")).filter(x=>x.sev!=="build"); }catch(e){ return []; } };
    const key=f=>[f.pair,f.root||"",f.kind||"",f.what||""].join(" | ");
    const b=new Set(rd(process.env.BF).map(key));
    for(const f of rd(process.env.AF)){
      if(f.pair!==process.env.PAIR) continue;
      if(b.has(key(f))) continue;
      process.stdout.write([f.sev,f.root||"-",String(f.what||"").replace(/[\t\n]+/g," ").slice(0,300)].join("\t")+"\n");
    }'
}

# The newly-visible flags of an INDETERMINATE pair are FINDINGS, not verdicts: they were invisible at
# baseline because the deck did not render that far, so they say nothing about the change. They go to
# QUEUE.md ## Discovered in its own pair/observed/expected/source shape rather than being dropped, because
# "not caused by this change" is not the same as "not a defect".
route_newly_visible() {                        # $1 = before flags, $2 = after flags, $3 = pairs, $4 = why
  local pair sev root what n=0 body=""
  for pair in $3; do
    while IFS=$(printf '\t') read -r sev root what; do
      [[ -n "$what" ]] || continue
      n=$(( n + 1 ))
      body+="
- **Newly visible on $pair once its deck rendered further (run $RUN_ID iter $CUR_ITER).** NOT attributed to
  that iteration change: $4, so this flag could not have been observed in the before-capture. Routed here by
  GATE_SPEC §13 rather than counted against the change. Diagnose before promoting it to ## Open.
  (pair: $pair · observed: [analyzer $sev/$root] $what · expected: not established here — this records an
  observation the gate could finally see, not a diagnosis · source: analyzer flag root=$root, first observed
  in agent/runs/$RUN_ID/cap/after-$CUR_ITER)
"
    done < <(new_flags_for "$1" "$2" "$pair")
  done
  [[ "$n" -eq 0 ]] && { log "  no newly-visible flags to route"; return 0; }
  QUEUE_F="$QUEUE" BODY="$body" node -e '
    const fs=require("fs"); const f=process.env.QUEUE_F;
    let t=fs.readFileSync(f,"utf8");
    if(!/^## Discovered/m.test(t)) t=t.replace(/\s*$/,"\n\n## Discovered\n");
    t=t.replace(/^## Discovered[^\n]*\n/m, m=>m+process.env.BODY);
    fs.writeFileSync(f,t);' || { log "  WARNING: could not append the newly-visible flags to QUEUE.md"; return 1; }
  log "  routed $n newly-visible flag(s) to QUEUE.md ## Discovered"
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

# ── WHOSE EDITS ARE THESE? ───────────────────────────────────────────────────────────────────────────
# finalize used to stage with `git add -A`, which has no notion of authorship: it commits whatever is in
# the tree. Proven, not theorised — driving PARTIAL_UNVERIFIED offline with two foreign files present
# committed BOTH of them alongside the agent's fix, under the sweep's message, on the sweep's branch.
#
# So the loop snapshots the tree immediately before run_agent and diffs at finalize; only paths whose
# CONTENT changed across the agent call are staged. The snapshot is (sha, path) for every dirty path —
# normally EMPTY, because the runner refuses to start on a dirty tree (see the DIRTY check in SETUP) and
# every iteration ends with a commit or a revert. Cost is one `git ls-files`, one `git hash-object` over
# the dirty set, and one node process.
#
# THE RESIDUAL GAP, STATED PLAINLY: this distinguishes edits that existed BEFORE the agent ran from those
# that appeared DURING it. It CANNOT tell the agent's write from a concurrent session's write inside that
# same window — both are simply "changed since the snapshot". The only complete mitigation is one writer
# per tree. See GATE_SPEC §6a.
tree_snapshot() {                              # echoes "<sha>\t<path>" per dirty path; silent on a clean tree
  ROOT="$ROOT" node -e '
    const {execFileSync}=require("child_process"); const R=process.env.ROOT;
    const g=a=>execFileSync("git",["-C",R,...a],{encoding:"utf8"});
    let files=[]; try{ files=g(["ls-files","-m","-o","--exclude-standard","-z"]).split("\0").filter(Boolean); }catch(e){}
    if(!files.length) process.exit(0);
    let h=[]; try{ h=g(["hash-object","--",...files]).trim().split("\n"); }catch(e){}
    files.forEach((f,i)=>process.stdout.write((h[i]||"MISSING")+"\t"+f+"\n"));
  ' 2>/dev/null
}
agent_touched_paths() {                        # $1 = snapshot file; echoes paths whose content changed since it
  SNAP="$1" ROOT="$ROOT" node -e '
    const fs=require("fs"); const {execFileSync}=require("child_process"); const R=process.env.ROOT;
    const g=a=>execFileSync("git",["-C",R,...a],{encoding:"utf8"});
    const before=new Map();
    try{ for(const l of fs.readFileSync(process.env.SNAP,"utf8").split("\n")){ const i=l.indexOf("\t"); if(i>0) before.set(l.slice(i+1),l.slice(0,i)); } }catch(e){}
    let files=[]; try{ files=g(["ls-files","-m","-o","--exclude-standard","-z"]).split("\0").filter(Boolean); }catch(e){}
    if(!files.length) process.exit(0);
    let h=[]; try{ h=g(["hash-object","--",...files]).trim().split("\n"); }catch(e){}
    files.forEach((f,i)=>{ if((h[i]||"MISSING")!==before.get(f)) process.stdout.write(f+"\n"); });
  ' 2>/dev/null
}

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
# analyzable_pairs / not_analyzable are appended LAST so every existing reader keeps its column offsets.
# defects_before/after are now REAL defects only (sev!='build'); the capture failures they used to include
# live in not_analyzable, where they can be seen instead of silently inflating the defect count.
calib_hdr() { [[ -f "$CALIB" ]] || echo "run_id,iter,item,status,wall_sec,turns,cost_usd,defects_before,defects_after,capture_mode,forced_recapture,agent_is_error,agent_subtype,agent_status_token,analyzable_pairs,not_analyzable" > "$CALIB"; }
finalize() {                                   # $1=status $2=marker (x=done · ~=parked · o=leave OPEN) $3=forced $4=optional commit-body note
  calib_hdr
  [[ "$2" == "x" || "$2" == "~" ]] && { queue_mark "$2" "$1 run $RUN_ID" || true; }   # "o" ⇒ leave the item OPEN (NO_VERDICT/BUILD_BROKEN/UNVERIFIED/NO_CHANGE/PARTIAL_UNVERIFIED)
  printf '%s,%s,"%s",%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' "$RUN_ID" "$CUR_ITER" "$ITEM_TITLE" "$1" "$WALL" "$TURNS" "$COST" "$DEF_BEFORE" "$DEF_AFTER" "$CAP_MODE" "$3" \
    "${AGENT_IS_ERROR:-ABSENT}" "${AGENT_SUBTYPE:-ABSENT}" "${STATUS_TOKEN:-ABSENT}" \
    "${ANA_AFTER:-${ANA_BEFORE:-}}" "${NA_AFTER:-${NA_BEFORE:-}}" >> "$CALIB"
  local msg="sweep($RUN_ID) iter $CUR_ITER: $ITEM_TITLE [$1] defects $DEF_BEFORE->$DEF_AFTER over ${ANA_AFTER:-${ANA_BEFORE:-?}} analyzable pair(s)"
  [[ -n "${4:-}" ]] && msg+=$'\n\n'"$4"
  # Stage the runner's OWN bookkeeping, then ONLY the paths the agent changed across its call (AGENT_PATHS,
  # set by the loop from the pre-agent tree snapshot). Never `add -A` — see tree_snapshot() for why and for
  # the residual gap this does NOT close.
  gitr add -- "$CALIB" "$DECISIONS" "$QUEUE" >/dev/null 2>&1 || true
  [[ -d "$AGENT_DIR/diagnosis" ]] && { gitr add -- "$AGENT_DIR/diagnosis" >/dev/null 2>&1 || true; }
  if [[ -n "${AGENT_PATHS:-}" ]]; then
    while IFS= read -r _p; do
      [[ -n "$_p" ]] && { gitr add -- "$_p" >/dev/null 2>&1 || true; }
    done <<< "$AGENT_PATHS"
  fi
  gitr commit -q -m "$msg" >/dev/null 2>&1 || true
}

# ── the ledger must record the runs that DIED, not only the ones that finished ───────────────────────
# finalize() only runs at the end of a completed iteration, so a run killed before that left NO trace:
# run 20260816-212606 died during its baseline capture and has no calibration row and no envelope at all.
# A ledger that silently omits its failures understates both the cost and the failure rate, and the runs
# most worth studying are exactly the ones that never reached finalize.
#
# Called from the EXIT trap, so it covers die(), Ctrl-C, `kill`, and a failed setup. It cannot cover
# SIGKILL — nothing can — which is why reap_stale_capture() exists to clean up after that case instead.
finalize_abnormal() {
  [[ "$RUN_COMPLETED" -eq 1 ]] && return 0     # normal end: finalize() already wrote every row
  [[ "$RUN_PHASE" == "startup" ]] && return 0  # never got past setup (e.g. lock refused) — nothing to report
  [[ -n "${RUN_ID:-}" && -n "${CALIB:-}" ]] || return 0
  calib_hdr
  local wall cost phase
  wall=$(( $(date +%s) - ${START_EPOCH:-$(date +%s)} ))
  # Cost is only known for iterations whose agent call RETURNED. A run killed mid-agent, or during a
  # capture, never learns what it spent — so the field is left EMPTY, which reads as "unknown". Writing 0
  # there would be a lie that also silently drags down the ledger's total.
  cost=""
  awk "BEGIN{exit !(${COST_TOTAL:-0} > 0)}" && cost="${COST_TOTAL}"
  phase="$(printf '%s' "killed during $RUN_PHASE" | sed 's/,/;/g; s/"/'"'"'/g' | cut -c1-120)"
  printf '%s,%s,"%s",%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$RUN_ID" "${CUR_ITER:-0}" "$phase" KILLED "$wall" "" "$cost" \
    "${DEF_BEFORE:-}" "" "${CAP_MODE:-}" false ABSENT ABSENT ABSENT \
    "${ANA_BEFORE:-}" "${NA_BEFORE:-}" >> "$CALIB"
  log "KILLED: wrote a ledger row (phase $RUN_PHASE · ${wall}s · cost ${cost:-unknown}) — an abnormal end must not be invisible"
  decide "run ended abnormally during $RUN_PHASE after ${wall}s; wrote a KILLED row to calibration.csv (cost ${cost:-unknown — the run died before its agent call returned})."
  # Commit ONLY the two bookkeeping files. Not `add -A`: whatever the agent had on disk when we died is not
  # ours to commit, and leaving these two uncommitted would trip the next run's dirty-tree check.
  gitr add "$CALIB" "$DECISIONS" >/dev/null 2>&1 || true
  gitr commit -q -m "sweep($RUN_ID): KILLED during $RUN_PHASE after ${wall}s — ledger row for an abnormal end" >/dev/null 2>&1 || true
}

# ── TEST-FIRST GRADING (GATE_SPEC §12) ───────────────────────────────────────────────────────────────
# A count-graded gate can only see a defect the analyzer already has a pattern for. Item 2d — an
# unresolved company published as $0 revenue instead of null — is invisible to BOTH graders by
# construction: the deck BUILDS (docs/sweep-v2/captures/BRK.B_PGR.json is ok:true) and a zeroed payload
# renders as a well-formed deck full of real-looking numbers. Run 20260817-163640 wrote the correct fix,
# scored 9->9, and was committed UNVERIFIED with the item left OPEN. An honest null can never LOWER a
# defect count. The declared test is the measurement the count cannot make.
#
# THE MECHANISM IS RED-THEN-GREEN, AND THE RUNNER PERFORMS BOTH — never the agent's word for it. A test
# written after the fix tests the fix, not the defect, so the runner re-runs the declared test against
# the PRE-AGENT tree (app code from $CHECKPOINT, the test file held constant) and requires it to FAIL
# there before a pass on the agent's tree counts for anything.
#
# WHAT THIS ENFORCES, AND WHAT IT DOES NOT — read this before trusting a DONE_TESTED. It proves the test
# DISCRIMINATES between the pre-agent and post-agent trees. It does NOT prove the test was written
# before the fix: an agent that writes the fix first, then a test tuned to that fix's signature, passes
# red/green too. That residual is closed by reading the test, not by this code.
TEST_TIMEOUT="${TEST_TIMEOUT:-120}"            # a declared test is a unit check, not a capture
# DEPTH_TOL — the % change in a pair rendered-text total that counts as MATERIAL (GATE_SPEC §13). DERIVED
# from the archive, not chosen: across 23 pair-comparisons in four archived runs (20260815-150838,
# 20260817-153300, 20260817-163640, 20260820-133803) the largest drift on a pair whose error state did not
# change is 1.2% (BRK.B/PGR, genuine data movement, twice; every other stable pair reads 0.0-1.2%). The two
# real render events in that archive measure -4.9% and +29.9%. 3% sits 2.5x above the observed noise
# ceiling and well below the smallest real event, separating them with margin on both sides. Re-derive it
# against the corpus if the decks change size; do not round it up to a friendlier number.
DEPTH_TOL="${DEPTH_TOL:-3}"

# Exit codes ARE the contract: 0 = PASS · 1 = FAIL · 2 = ERROR (could not run). Anything else — a missing
# module, a syntax error, a signal, a timeout — is read as ERROR, never as a fail. This is GATE_SPEC §5's
# rule applied to the test instead of the capture: an unrunnable test must never be able to delete a good
# fix. Note the asymmetry is deliberate and one-directional.
run_declared_test() {                          # $1 = label → returns 0 | 1 | 2
  # Two statements, not one: bash expands EVERY word of a `local` before it assigns any of them, so
  # `local label="$1" out="…$label…"` reads $label unbound and dies under `set -u`.
  local label="$1"
  local out="$RUN_DIR/test-iter$CUR_ITER-$label.log" rc pid waited=0
  ( cd "$ROOT" && BASE="$BASE_URL" node "$ITEM_TEST" ) > "$out" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [[ "$waited" -ge "$TEST_TIMEOUT" ]]; then
      kill_tree "$pid"; wait "$pid" 2>/dev/null
      log "  test $label: exceeded ${TEST_TIMEOUT}s, killed — reading as ERROR (2), not a fail"
      return 2
    fi
    sleep 1; waited=$(( waited + 1 ))
  done
  wait "$pid"; rc=$?
  sed 's/^/      | /' "$out" 2>/dev/null | head -40
  case "$rc" in
    0|1|2) ;;
    *) log "  test $label: exited $rc (not 0/1/2) — reading as ERROR; an unrunnable test is never a fail"; rc=2 ;;
  esac
  return "$rc"
}

# The RED tree: app code back at $CHECKPOINT, everything under agent/ — the test itself above all — held
# CONSTANT, so app code is the only thing that differs between the two runs. Holding the test constant is
# not optional: tools/noop-ab/README.md documents the same trap from the other side (stash the file that
# defines the inputs and the two runs stop being comparable).
#
# File-level backup/restore into $RUN_DIR, NOT `git stash`/`git checkout`: the restore must be exactly
# reversible without consulting git state, because a half-restored tree would silently hand the
# after-capture code nobody wrote. $RUN_DIR is gitignored, so `git clean -fd` cannot eat the backup.
app_paths_of() {                               # AGENT_PATHS minus everything under agent/
  printf '%s\n' "${AGENT_PATHS:-}" | grep -v '^$' | grep -v '^agent/' || true
}
red_swap() {                                   # $1 = in|out · $2 = swap dir; rc 1 = swap failed
  local dir="$2" p
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    if [[ "$1" == "in" ]]; then
      mkdir -p "$dir/agent/$(dirname "$p")" 2>/dev/null || true
      cp "$ROOT/$p" "$dir/agent/$p" 2>/dev/null || true
      if gitr cat-file -e "$CHECKPOINT:$p" 2>/dev/null; then
        gitr show "$CHECKPOINT:$p" > "$ROOT/$p" 2>/dev/null || return 1
      else
        rm -f "$ROOT/$p" 2>/dev/null || true    # the agent CREATED it — the pre-agent tree had no such file
      fi
    else
      if [[ -f "$dir/agent/$p" ]]; then cp "$dir/agent/$p" "$ROOT/$p" 2>/dev/null || return 1
      else rm -f "$ROOT/$p" 2>/dev/null || true; fi
    fi
  done < <(app_paths_of)
  return 0
}

# ── a committed test is READ-ONLY to the agent ───────────────────────────────────────────────────────
# Rule 1, ALWAYS, whether or not the item declares a test: no file under agent/tests/ that existed at the
# checkpoint may differ from it. A test the agent can edit is a test the agent can weaken to fit its fix,
# and the iteration where that pays is precisely a REPEAT attempt on an item whose test already caught it
# once — which is the state item 2d is in.
# Rule 2, only when the item declares a test: a NEW file under agent/tests/ must BE that test. An item may
# grow its own test; it may not leave a litter of others behind.
# Deliberately NOT covered, and stated so nobody reads more into this than it does: a test the agent
# writes THIS iteration is its own until it reports, and it can loosen that one freely. Red/green only
# requires that the result discriminate. This guard is about tests that were already gated and committed.
test_guard_violation() {                       # echoes a reason, or nothing
  local changed added all p
  changed="$(gitr diff --name-only "$CHECKPOINT" -- "agent/tests" 2>/dev/null || true)"
  added="$(printf '%s\n' "${AGENT_PATHS:-}" | grep '^agent/tests/' || true)"
  all="$(printf '%s\n%s\n' "$changed" "$added" | grep -v '^$' | sort -u)"
  [[ -z "$all" ]] && return 0
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    if gitr cat-file -e "$CHECKPOINT:$p" 2>/dev/null; then
      printf 'modified %s, which already existed at the checkpoint — a committed test is read-only to the agent' "$p"
      return 0
    fi
    if [[ -n "${ITEM_TEST:-}" && "$p" != "$ITEM_TEST" ]]; then
      printf 'created %s, which is not this item'"'"'s declared test (%s)' "$p" "$ITEM_TEST"
      return 0
    fi
  done <<< "$all"
  return 0
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
    # Inject the ACTUAL turn budget (Part 2) so the agent knows when to stop and emit STATUS: PARTIAL, instead
    # of working as if unbounded and getting cut off mid-fix. The number is $MAX_TURNS at call time — never
    # hardcoded in the prompt, so it can't drift from the real cap.
    # SCRATCH is injected, never hardcoded in the prompt: it is run-scoped, so two runs can never collide on
    # a probe filename. Run 20260816-222441 wrote /tmp/probe_irdm.js and /tmp/probe_gm.js, both of which
    # already existed from run -202617; the Write tool refuses an unread existing file, so BOTH writes failed
    # and the agent then ran -202617's probe code believing it was its own.
    mkdir -p "$SCRATCH_DIR" 2>/dev/null || true
    ( cd "$ROOT" && { cat "$PROMPT"; printf '\n\nSCRATCH DIR: %s — write every probe/scratch file there, NOT /tmp. It is created, empty, private to this run, and gitignored, so a probe name can never collide with another run and `git clean -fd` will not delete it.\n\nTURN BUDGET: you have %s turns (assistant steps) this call. At about 75%% (~%s turns) STOP and emit STATUS: PARTIAL with the root cause and any findings so far — finishing the report beats finishing the fix.\n\nITEM: %s\n' "$SCRATCH_DIR" "$MAX_TURNS" "$(( MAX_TURNS * 3 / 4 ))" "$ITEM"; } | \
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
# puppeteer-core is capture.js's ONLY browser dependency, required there by ABSOLUTE path (capture.js:5).
# It was undeclared in package.json until f8c5343, so `npm install <anything>` pruned it, and run
# 20260817-151534 spent 69s on a frontend build and a server boot before dying at capture with the reason
# piped to /dev/null. Checking it HERE fails in under a second, before the lock, the port, the tree or the
# tag is touched.
#
# REQUIRE it — do NOT test for the directory. A half-extracted or corrupted install leaves
# node_modules/puppeteer-core on disk and still throws MODULE_NOT_FOUND (or a syntax error) at load, which
# is precisely the case a `[[ -d ]]` check waves through. Resolving the same ABSOLUTE path capture.js uses
# also catches a hoisted/nested install that would resolve for the runner but not for the collector.
node -e 'require(process.argv[1])' "$ROOT/node_modules/puppeteer-core" >/dev/null 2>&1 \
  || die "puppeteer-core failed to load from $ROOT/node_modules/puppeteer-core — capture.js:5 requires it, so EVERY capture would die at module load. Fix: npm install puppeteer-core"
# The Chrome binary is capture.js's OTHER undeclared external assumption (declared at capture.js:8, used
# at capture.js:199). Unlike the missing module it would not fail at load — it would fail at deck 1, after
# a build, a server boot and a baseline already in flight.
#
# DERIVED from capture.js, never retyped. That literal already exists in THREE places —
# tools/sweep-analyzer/capture.js:8, tools/noop-ab/run.js:16, server/harness/edgar.js:8 — and hardcoding a
# fourth copy here would add another site to miss when Chrome moves, while also letting the preflight
# drift from the path the collector actually launches. Reading the constant out of the collector keeps
# them the same path by construction.
CHROME_BIN="$(node -e 'const fs=require("fs");const m=fs.readFileSync(process.argv[1],"utf8").match(/^const CHROME *= *(["\x27])(.*?)\1/m);process.stdout.write(m?m[2]:"")' "$CAPTURE_JS" 2>/dev/null)"
[[ -n "$CHROME_BIN" ]] || die "could not read the CHROME constant from $CAPTURE_JS — the preflight cannot verify a browser it cannot locate; confirm capture.js:8 still reads: const CHROME = '<path>'"
[[ -x "$CHROME_BIN" ]] || die "Chrome is not executable at $CHROME_BIN (path read from capture.js:8) — every deck would fail at browser launch. Fix: install Google Chrome at that path, or update the CHROME constant in $CAPTURE_JS"
acquire_lock                                   # Part 1: FIRST — before we touch the port, the tree, or the tag
reap_stale_raw                                 # sweep up abandoned per-run capture dirs before making ours
# GIT MUST RUN BEFORE ANY GIT ANSWER IS BELIEVED. Run 20261112-000000: Xcode.app updated (Nov 11 18:06) and
# its license was unaccepted, so /usr/bin/git refused every call ("You have not agreed to the Xcode license
# agreements"). The DIRTY guard below read git's EMPTY stdout as a CLEAN tree (Pattern C — a guard holding
# by accident), BASE_BRANCH came back empty, and the tag step then died as "restore tag already exists"
# with no such tag. Probe once, show git's own stderr, and test the status call's exit code separately.
_giterr="$(gitr rev-parse --git-dir 2>&1 >/dev/null)" || die "git is not runnable (${_giterr:-no stderr}) — every git answer this run would read is unreliable. If this is the Xcode license: sudo xcodebuild -license accept"
[[ -n "$BASE_BRANCH" ]] || die "BASE_BRANCH is empty — git rev-parse at startup returned nothing"
_gitst="$(gitr status --porcelain 2>&1)" || die "git status FAILED (${_gitst}) — cannot tell a clean tree from a dirty one"
[[ -z "$_gitst" ]] || die "working tree is DIRTY — commit or stash first, then re-run"
# NO SLEEPING MID-RUN. Run 20260916-124247 lost all 50 decks to "FATAL Connection closed." when the Mac
# slept during the baseline capture: the browser died with it and 409 minutes produced nothing analyzable.
# `caffeinate -i -w $$` blocks IDLE sleep for the lifetime of THIS shell and exits when it does, so no trap
# is needed and a deliberate lid-close still sleeps. Placed before the baseline capture, not just the
# iteration loop, because that capture is the longest unattended stretch. restart_server's own
# `caffeinate -is` covers only the app server process, not this loop.
caffeinate -i -w $$ &
CAFFEINATE_PID=$!
log "sleep guard: caffeinate -i -w $$ started (pid $CAFFEINATE_PID) — idle sleep blocked for this run"

mkdir -p "$RUN_DIR/cap"
echo "$$" > "$RUN_DIR/run.pid"   # liveness marker — the dashboard checks kill -0 on this to tell RUNNING from DIED
build_pairs_json
NPAIRS="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).length))' "$PAIRS_JSON")"
# A Discovered entry with a full repro (pair/observed/expected/source, and a pair naming a real deck) is a
# queue item nobody filed; promote-discovered.mjs moves it to the BOTTOM of Open so the hand-maintained
# upstream-first order above is untouched. It is advisory: a failure here must never stop a run, and it
# leaves anything with a missing field or a placeholder pair exactly where it is, with the reason logged.
while IFS= read -r _pl; do [[ -n "$_pl" ]] && log "$_pl"; done < <(node "$AGENT_DIR/promote-discovered.mjs" "$QUEUE" 2>&1 || echo "promote: FAILED (non-fatal) — QUEUE.md left as it was")

QCOUNT="$(node -e 'const fs=require("fs"),t=fs.readFileSync(process.argv[1],"utf8");const o=(t.split(/^## Open/m)[1]||"").split(/^## /m)[0];process.stdout.write(String((o.match(/^- \[ \] /mg)||[]).length));' "$QUEUE")"

gitr rev-parse -q --verify "refs/tags/restore/pre-sweep-$RUN_ID" >/dev/null 2>&1 && die "restore tag already exists"
_tagerr="$(gitr tag "restore/pre-sweep-$RUN_ID" 2>&1 >/dev/null)" || die "git tag restore/pre-sweep-$RUN_ID FAILED (${_tagerr:-no stderr})"
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
# MAX_ITER and BUDGET_USD are the two halt conditions the loop can hit without anything going wrong,
# and the dashboard could not show how far a run had left to go without them (QUEUE.md Discovered).
log "RUN $RUN_ID · branch sweep/auto-$RUN_ID · $NPAIRS pairs · $QCOUNT open items · mode $CAP_MODE · max_iter $MAX_ITER · budget \$$BUDGET_USD · sweep_pairs $SWEEP_PAIRS"
NREPRO="$(printf '%s' "$REPRO_PAIRS" | wc -w | tr -d ' ')"
NOPAIR="$(repro_pair queue "$QUEUE" | grep -c '^-$' || true)"
log "capture set: $NPAIRS pairs = $NREPRO mandatory repro + filler (PAIRS_LIMIT=$PAIRS_LIMIT caps filler only)"
  [[ "$SWEEP_PAIRS" -gt 0 && "$SWEEP_PAIRS" -lt "$NREPRO" ]] && log "WARNING: SWEEP_PAIRS=$SWEEP_PAIRS is below the $NREPRO repro pairs — this run is a DEMO, not a graded measurement"
log "repro pairs (forced): ${REPRO_PAIRS:-<none>}"
[[ "$NOPAIR" -gt 0 ]] && log "WARNING: $NOPAIR open item(s) name no repro pair — each is BLOCKED at its iteration (never guessed)"
log "START $(date '+%Y-%m-%d %H:%M:%S')  →  PROJECTED END ~$END_HUMAN  (${SWEEPS} sweeps × ~${PER_SWEEP_S}s + agent)"

log "baseline capture ($NPAIRS pairs)…"
BASE_DIR="$RUN_DIR/cap/baseline"
restart_server || die "frontend build or server boot FAILED at baseline (HEAD may not build/run) — see $BUILD_LOG and $SERVER_LOG"
do_capture "$BASE_DIR" "baseline" || die "baseline capture failed"
MEAS="$(measure_defects "$BASE_DIR")" || die "analyzer CRASHED on baseline — aborting (a crash is not a defect)"
IFS=$'\t' read -r DEF_BEFORE ANA_BEFORE NA_BEFORE NA_LIST_BEFORE OK_LIST_BEFORE <<< "$MEAS"
# ONE POPULATION, NOT TWO. This line used to print DEF_BEFORE (computed from every deck found ON DISK)
# against NPAIRS (the count REQUESTED in PAIRS_JSON). Run 20260816-222441 logged "25 defects across 5 pairs"
# while 20 decks sat on disk — 15 of them foreign stubs from another run. Both numbers now come from the
# decks actually analysed, and the not-analyzable half is named rather than folded into the total.
log "baseline: $DEF_BEFORE defects across $ANA_BEFORE analyzable pairs ($(density "$DEF_BEFORE" "$ANA_BEFORE") per pair) · $NA_BEFORE not-analyzable of $NPAIRS requested${NA_LIST_BEFORE:+ — $NA_LIST_BEFORE}"

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
  WALL=0; TURNS=0; COST=0; DEF_AFTER="$DEF_BEFORE"; ITEM_TEST=""; TESTED=0
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

  # ── the item's declared test, if any (GATE_SPEC §12). Read HERE, BEFORE the agent runs, so that an
  #    agent which edits QUEUE.md cannot change which file grades it this iteration. Same reason
  #    queue_next() reads position and nothing else: what must hold has to be captured, not requested.
  ITEM_TEST="$(item_test "$ITEM")"
  if [[ -n "$ITEM_TEST" ]]; then log "grading: TEST-GRADED on $ITEM_TEST (red-then-green), plus the count gate"
  else log "grading: COUNT-GRADED (item declares no test:)"; fi

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
    MEAS="$(measure_defects "$CUR_BEFORE_DIR")" || die "analyzer CRASHED on before-capture"
    IFS=$'\t' read -r DEF_BEFORE ANA_BEFORE NA_BEFORE NA_LIST_BEFORE OK_LIST_BEFORE <<< "$MEAS"
    log "before-capture: $DEF_BEFORE defects across $ANA_BEFORE analyzable ($(density "$DEF_BEFORE" "$ANA_BEFORE")/pair) · $NA_BEFORE not-analyzable${NA_LIST_BEFORE:+ — $NA_LIST_BEFORE}"
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

  # Snapshot the tree IMMEDIATELY before the agent, so finalize can stage only what the agent changed
  # rather than everything in the tree. Normally records nothing — the tree is clean at this point.
  SNAP_FILE="$RUN_DIR/.tree-snapshot-iter$CUR_ITER"
  SNAP_T0="$(date +%s%3N 2>/dev/null || date +%s)"
  tree_snapshot > "$SNAP_FILE" 2>/dev/null || : > "$SNAP_FILE"
  # `grep -c` PRINTS its count and EXITS 1 when that count is zero, so `|| echo 0` fired ON TOP of grep's
  # own "0" and SNAP_N became the two-line string "0\n0" — which the [[ ]] below then rejected with
  # `[[: 0\n0: syntax error in expression`, printed into loop.log, and the log line read "tree snapshot:
  # 0\n0 dirty path(s)". It fires on the NORMAL case, a clean tree; run 20260817-163640 masked it only
  # because that iteration happened to start with one dirty path. `wc -l` exits 0 on an empty file, so
  # there is no failure branch to paper over. tree_snapshot always \n-terminates, so the count is exact.
  SNAP_N="$(wc -l < "$SNAP_FILE" 2>/dev/null | tr -d ' ')"; SNAP_N="${SNAP_N:-0}"
  log "tree snapshot: $SNAP_N dirty path(s) before agent$( [[ "$SNAP_N" -gt 0 ]] && echo ' — NOT this agent'"'"'s work, will not be committed')"

  # run the agent under a wall-clock timeout (bounds a permission-prompt hang that --max-turns cannot)
  RUN_PHASE="agent:iter $CUR_ITER"
  run_agent_timed "$ITER_TIMEOUT"; AGENT_RC=$?
  RUN_PHASE="gate:iter $CUR_ITER"
  # What the agent actually touched. Every finalize below stages from this, never `add -A`.
  AGENT_PATHS="$(agent_touched_paths "$SNAP_FILE")"
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
    # ── CUT OFF MID-FIX, WITH WORK ON DISK → PARK it, don't delete it. Run 20260816-202617 diagnosed item 2,
    #    WROTE the fix to server.js, and died at turn 61 while verifying — NO_VERDICT reverted a complete $5
    #    fix to nothing. This exception keeps the work, labelled UNVERIFIED, instead of deleting it. It makes
    #    NO claim the work is good: the item stays OPEN, it counts toward the consecutive-fail breaker, and
    #    the gate never measured it. An EMPTY diff still reverts below — this is not a path to committing junk.
    #
    #    THE CONDITION IS is_error, NOT A SUBTYPE LIST. It was `AGENT_SUBTYPE == error_max_turns`, which is a
    #    statement about ONE way of being cut off, and the very next death came through a different door: run
    #    20260816-222441 slept mid-response at turn 38 of 60 and reported subtype "success" with
    #    terminal_reason "api_error" — so the check was false and the agent's brand-new
    #    server/data/debtConcepts.js, written on its FINAL turn, was deleted by `git clean -fd`.
    #    is_error:true IS the "the agent was cut off before it could report" signal, whatever cut it off —
    #    turn cap, API error, sleep, execution error. Enumerating subtypes means re-losing work every time a
    #    new one appears. A clean envelope that merely lacks a STATUS token is NOT covered: that agent ran to
    #    completion and chose not to report, which is a different (and answerable) failure.
    if [[ "$AGENT_IS_ERROR" == "true" ]] && agent_changed; then
      # Name the real cause, the same way the dashboard does: subtype unless it is the useless literal
      # "success", in which case terminal_reason carries the truth.
      CUTOFF="$AGENT_SUBTYPE"
      [[ "$CUTOFF" == "success" || "$CUTOFF" == "ABSENT" ]] && CUTOFF="${AGENT_TERMINAL:-unknown}"
      # The agent's paths, from the snapshot diff — NOT `git status`, which cannot tell whose edits are whose.
      FILES="$(printf '%s' "${AGENT_PATHS:-}" | tr '\n' ' ')"
      # capture the work into $RUN_DIR (gitignored) BEFORE finalize commits, so nothing git does can lose it
      gitr diff HEAD > "$RUN_DIR/partial-iter$CUR_ITER.diff" 2>/dev/null || true
      cp "$AGENT_OUT" "$RUN_DIR/envelope-iter$CUR_ITER.json" 2>/dev/null || true
      SID="$(json_field "$AGENT_OUT" session_id)"
      TRANSCRIPT="$(find "$HOME/.claude/projects" -maxdepth 2 -name "$SID.jsonl" 2>/dev/null | head -1)"
      [[ -n "$TRANSCRIPT" ]] && tail -c 60000 "$TRANSCRIPT" > "$RUN_DIR/partial-iter$CUR_ITER.transcript-tail.jsonl" 2>/dev/null || true
      log "PARTIAL_UNVERIFIED: cut off ($CUTOFF) at turn $TURNS with work on disk → KEEPING it (files: $FILES), NOT reverting"
      decide "iter $CUR_ITER PARTIAL_UNVERIFIED: agent was cut off ($CUTOFF) at turn $TURNS with a non-empty diff; committed UNVERIFIED (cut off mid-fix, never measured), item left OPEN. Files: $FILES"
      finalize PARTIAL_UNVERIFIED "o" "$FORCED" "Cut off mid-fix ($CUTOFF) at turn $TURNS with work on disk — committed UNVERIFIED. The runner never measured this; the queue item stays OPEN. Files touched: $FILES. Diff + transcript tail saved under $RUN_DIR."
      PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
      log "PARTIAL_UNVERIFIED · consecutive fail = $CONSEC_FAIL"; continue
    fi
    log "NO_VERDICT (${VERDICT#NO_VERDICT }) — untrustworthy agent result; revert, leave item OPEN, save envelope to diagnosis/"
    # Part 3: the envelope lands in TWO places on purpose.
    #   $AGENT_DIR/diagnosis — the durable, committed record; survives the revert below via revert_to's
    #                          preserve list, and finalize then stages it EXPLICITLY (`gitr add --
    #                          "$AGENT_DIR/diagnosis"`). NOT `git add -A`: that was removed deliberately —
    #                          see tree_snapshot() for what replaced it and the gap it does not close.
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
    # revert would hand the note straight to `reset --hard`. Write it after, so finalize's explicit
    # `gitr add -- "$QUEUE"` commits it. (Same ordering finalize/queue_mark already relies on.)
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

  # ── TEST-FIRST GATE (GATE_SPEC §12) ─────────────────────────────────────────────────────────────────
  #    Placed HERE deliberately: AFTER the verdict gate (an untrustworthy agent never spends a test run),
  #    AFTER PARTIAL (report-and-stop leaves no claimed fix to test), AFTER BUILD_BROKEN (a bundle that
  #    will not compile must surface AS BUILD_BROKEN, never as a test failure — otherwise the test gets
  #    blamed for the build), and BEFORE do_capture, so a falsified fix short-circuits the ~10-minute
  #    capture exactly the way NO_VERDICT does at the verdict gate.

  # Rule 1 runs on EVERY iteration, test-graded or not: a committed test is read-only to the agent.
  GUARD="$(test_guard_violation)"
  if [[ -n "$GUARD" ]]; then
    log "TEST_TAMPERED: agent $GUARD"
    decide "iter $CUR_ITER TEST_TAMPERED: agent $GUARD; reverted unmeasured before any capture — a test the agent can weaken cannot grade the agent."
    revert_to "$CHECKPOINT"; WALL=$(( $(date +%s) - ITER_T0 ))
    finalize TEST_TAMPERED "o" "$FORCED" "Agent $GUARD. Reverted before the after-capture; the item stays OPEN."
    PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
    log "TEST_TAMPERED · consecutive fail = $CONSEC_FAIL"; continue
  fi

  if [[ -n "$ITEM_TEST" ]]; then
    if [[ ! -f "$ROOT/$ITEM_TEST" ]]; then
      log "test ERROR: declared test $ITEM_TEST is not on the tree — falling through to the count gate"
      decide "iter $CUR_ITER: declared test $ITEM_TEST absent from the tree; graded on the count alone."
    else
      log "test GREEN run (the agent's tree): node $ITEM_TEST"
      run_declared_test green; GREEN_RC=$?
      if [[ "$GREEN_RC" -eq 1 ]]; then
        log "TEST_FAILED: the declared test FAILS on the agent's own tree — the claimed fix is falsified, no capture spent"
        decide "iter $CUR_ITER TEST_FAILED: $ITEM_TEST exited 1 on the agent's tree; reverted, item left OPEN, after-capture skipped."
        revert_to "$CHECKPOINT"; WALL=$(( $(date +%s) - ITER_T0 ))
        finalize TEST_FAILED "o" "$FORCED" "Declared test $ITEM_TEST failed on the agent's own tree. Reverted before the after-capture."
        PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
        log "TEST_FAILED · consecutive fail = $CONSEC_FAIL"; continue
      elif [[ "$GREEN_RC" -eq 2 ]]; then
        log "test ERROR (exit 2) on the agent's tree — NOT a fail; falling through to the count gate, breaker untouched"
        decide "iter $CUR_ITER: $ITEM_TEST could not run (exit 2 — unreachable app, limiter, or precondition unmet); graded on the count alone, exactly as an item with no test: line."
      else
        # GREEN passed. The only question that matters now: would it have passed WITHOUT the fix?
        SWAP="$RUN_DIR/redswap-iter$CUR_ITER"; rm -rf "$SWAP"; mkdir -p "$SWAP"
        APP_N="$(app_paths_of | grep -c '' || true)"
        if [[ "${APP_N:-0}" -eq 0 ]]; then
          log "TEST_VACUOUS: the agent changed no app code, so RED and GREEN are the SAME tree — a pass proves nothing"
          decide "iter $CUR_ITER TEST_VACUOUS: $ITEM_TEST passed, but the agent changed no app code, so the red and green trees are identical and the test cannot discriminate."
          revert_to "$CHECKPOINT"; WALL=$(( $(date +%s) - ITER_T0 ))
          finalize TEST_VACUOUS "o" "$FORCED" "Declared test passed on a tree with no app-code change — nothing to discriminate. Reverted."
          PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
          log "TEST_VACUOUS · consecutive fail = $CONSEC_FAIL"; continue
        fi
        log "test RED run: putting $APP_N app path(s) back to $CHECKPOINT, holding agent/ (the test) constant"
        if ! red_swap in "$SWAP"; then
          red_swap out "$SWAP" || true; restart_server || true
          log "test ERROR: could not build the RED tree — red is unproven; falling through to the count gate"
          decide "iter $CUR_ITER: the RED tree could not be built, so red-then-green is unproven; graded on the count alone."
        else
          restart_server || log "  RED restart_server failed — a test that needs the app will report ERROR, which is not a fail"
          run_declared_test red; RED_RC=$?
          red_swap out "$SWAP" || log "  WARNING: red_swap out reported a failure — verifying the tree below"
          if ! restart_server; then
            log "BUILD_BROKEN: the tree would not rebuild after restoring the agent's code → revert + HALT"
            decide "iter $CUR_ITER BUILD_BROKEN: the tree would not rebuild after the RED swap was restored; reverted and halted rather than capture an unknown tree."
            revert_to "$CHECKPOINT"; WALL=$(( $(date +%s) - ITER_T0 ))
            finalize BUILD_BROKEN "o" "$FORCED"; CONSEC_FAIL=$(( CONSEC_FAIL + 1 )); break
          fi
          case "$RED_RC" in
            1) TESTED=1
               log "test RED->GREEN CONFIRMED: exits 1 at $CHECKPOINT and 0 on the agent's tree — the test discriminates" ;;
            0) log "TEST_VACUOUS: the declared test PASSES on the pre-agent tree too — it tests something the fix did not change"
               decide "iter $CUR_ITER TEST_VACUOUS: $ITEM_TEST passes at $CHECKPOINT as well as on the agent's tree, so it cannot tell the defect from its absence; reverted, item left OPEN."
               revert_to "$CHECKPOINT"; WALL=$(( $(date +%s) - ITER_T0 ))
               finalize TEST_VACUOUS "o" "$FORCED" "Declared test $ITEM_TEST passes with AND without the fix — it does not test the defect. Reverted."
               PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
               log "TEST_VACUOUS · consecutive fail = $CONSEC_FAIL"; continue ;;
            *) log "test RED run ERROR (exit 2) — red could not be established; falling through to the count gate, breaker untouched"
               decide "iter $CUR_ITER: the RED run of $ITEM_TEST could not run (exit 2), so red-then-green is unproven; graded on the count alone." ;;
          esac
        fi
      fi
    fi
  fi

  # ── no-op short-circuit ────────────────────────────────────────────────────────────────────────────
  # Nothing about the app changed, so there is nothing to measure and an after-capture would compare the
  # tree with itself. Run 20260929-193005 iter 1 is the case this exists for: the item was a HARNESS defect,
  # the agent correctly returned BLOCKED and touched no app code, and the harness still spent 84 minutes on
  # a 50-deck after-capture — then scored REGRESSION because DAL/ALK failed to capture that hour, burning a
  # breaker slot on a flaky deck. The agent's own token is recorded as the reason.
  #
  # The test is APP-CODE paths, not `git status`: that iteration's agent left a diagnosis note under agent/,
  # so the tree was dirty while the app was untouched. It is also NOT "the bundle is byte-identical" alone —
  # a server-side fix (server.js, ltmCalc.js) legitimately produces an identical bundle, and skipping its
  # measurement is exactly how run 20260815-150838 read an unmeasured no-op as "8->8 clear".
  APP_CHANGED_N="$(app_paths_of | grep -c '' || true)"
  if [[ "${SNAP_N:-0}" -eq 0 && "${APP_CHANGED_N:-0}" -eq 0 && "${BUNDLE_IDENTICAL:-0}" -eq 1 ]]; then
    log "gate: no-op short-circuit — no app-code change and a byte-identical bundle; after-capture skipped (agent token: ${STATUS_TOKEN:-ABSENT})"
    case "$STATUS_TOKEN" in
      DONE*|RESOLVED_UPSTREAM*) log "  the token claims '$STATUS_TOKEN' on a tree whose app code it never touched — recorded, NOT credited as a fix" ;;
    esac
    decide "iter $CUR_ITER NO_CHANGE by no-op short-circuit: agent returned '${STATUS_TOKEN:-ABSENT}' having changed no app code, and the rebuild was byte-identical; no after-capture spent, item left OPEN."
    DEF_AFTER="$DEF_BEFORE"; ANA_AFTER="$ANA_BEFORE"; OK_LIST_AFTER="$OK_LIST_BEFORE"
    WALL=$(( $(date +%s) - ITER_T0 ))
    finalize NO_CHANGE "o" "$FORCED" "No-op short-circuit: no app-code change, byte-identical bundle, after-capture skipped. Agent token: ${STATUS_TOKEN:-ABSENT}."
    CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
    log "NO_CHANGE (no-op short-circuit) · consecutive fail = $CONSEC_FAIL"
    continue
  fi

  # after-capture (capture failure ≠ code failure → INDETERMINATE)
  AFTER_DIR="$RUN_DIR/cap/after-$CUR_ITER"
  if ! do_capture "$AFTER_DIR" "after-$CUR_ITER"; then
    log "after-capture failed → INDETERMINATE; revert conservatively, no fail-count"
    revert_to "$CHECKPOINT"; WALL=$(( $(date +%s) - ITER_T0 ))
    finalize INDETERMINATE "~" "$FORCED"; PENDING_FRESH_BASELINE=1; continue
  fi
  DIFF_OUT="$RUN_DIR/diff-$CUR_ITER.json"; run_diff "$CUR_BEFORE_DIR" "$AFTER_DIR" "$DIFF_OUT"
  MEAS="$(measure_defects "$AFTER_DIR")" || die "analyzer CRASHED on after-capture"
  IFS=$'\t' read -r DEF_AFTER ANA_AFTER NA_AFTER NA_LIST_AFTER OK_LIST_AFTER <<< "$MEAS"
  if [[ -n "${TEST_REGRESS_ITERS:-}" && ",${TEST_REGRESS_ITERS}," == *",${CUR_ITER},"* ]]; then DEF_AFTER=$(( DEF_AFTER + 1 )); fi  # TEST-ONLY
  REVERT_SIGNAL="$(json_field "$DIFF_OUT" revert_signal false)"
  WALL=$(( $(date +%s) - ITER_T0 ))

  # ── THE GATE (per GATE_SPEC) ──
  DEN_BEFORE="$(density "$DEF_BEFORE" "$ANA_BEFORE")"; DEN_AFTER="$(density "$DEF_AFTER" "$ANA_AFTER")"
  log "GATE: $DEF_BEFORE/$ANA_BEFORE = $DEN_BEFORE per pair  ->  $DEF_AFTER/$ANA_AFTER = $DEN_AFTER per pair (not-analyzable $NA_BEFORE -> $NA_AFTER)"

  # ── DEPTH GATE (GATE_SPEC §13) — evaluated BEFORE the density comparison ────────────────────────────
  # Skipped when §2(b) already has a lost pair to report: a deck that did not build is the coarser and
  # older signal and owns that verdict. depth_states cannot see such a pair anyway (no after entry).
  if [[ -z "$(lost_analyzable "$OK_LIST_BEFORE" "$OK_LIST_AFTER")" ]]; then
    DEPTH_TSV="$(depth_states "$CUR_BEFORE_DIR" "$AFTER_DIR")"
    printf '%s\n' "$DEPTH_TSV" | awk -F'\t' '$2!="STABLE" && $2!="" {printf "      | %-12s %-14s depth %s -> %s (%s%%)  errs %s -> %s\n",$1,$2,$3,$4,$5,$6,$7}'
    D_FELL="$(depth_pairs "$DEPTH_TSV" FELL)"
    D_INDET="$(depth_pairs "$DEPTH_TSV" ROSE INDET_ERRMOVE)"
    D_STABLE="$(depth_pairs "$DEPTH_TSV" STABLE)"
    if [[ -n "$D_FELL" ]]; then
      log "GATE §13 VIOLATED: pair(s) rendered materially LESS after the change: $D_FELL → REGRESSION"
      decide "iter $CUR_ITER REGRESSION per GATE_SPEC §13: $D_FELL rendered materially less content after the change (tolerance ${DEPTH_TOL}%), or gained an error signature new to the whole corpus. A deck that renders less silently drops its own defects out of the count, so this is breakage at a finer grain than a build failure — never an improvement."
      revert_to "$CHECKPOINT"; WALL=$(( $(date +%s) - ITER_T0 ))
      finalize REGRESSION "~" "$FORCED" "GATE_SPEC §13: $D_FELL rendered materially less after the change (>${DEPTH_TOL}% of section text, or a corpus-new page error). Density would have read $DEN_BEFORE -> $DEN_AFTER, but a deck that renders less is breakage: its unrendered sections cannot be flagged, so the count improves for the wrong reason."
      PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
      log "REVERTED (REGRESSION §13) · consecutive fail = $CONSEC_FAIL"; continue
    fi
    if [[ -n "$D_INDET" ]]; then
      # GUARD 1 — the item OWN repro pair. If that deck is not comparable then nothing was measured about
      # the item at all, and §5 precedent applies: an unmeasurable capture is INDETERMINATE, never a grade.
      if [[ " $D_INDET " == *" $ITEM_PAIR "* ]]; then
        log "GATE §13: the repro pair $ITEM_PAIR is not comparable between captures → INDETERMINATE (nothing was measured about this item)"
        decide "iter $CUR_ITER INDETERMINATE per GATE_SPEC §13: the repro pair $ITEM_PAIR rendered a materially different amount of content between the two captures, so the deck carrying the defect could not be compared; reverted conservatively, breaker untouched."
        revert_to "$CHECKPOINT"; WALL=$(( $(date +%s) - ITER_T0 ))
        finalize INDETERMINATE "~" "$FORCED" "GATE_SPEC §13: repro pair $ITEM_PAIR not comparable (render depth moved materially between captures), so no measurement of this item was possible."
        PENDING_FRESH_BASELINE=1
        log "INDETERMINATE (§13 repro pair) · consecutive fail unchanged = $CONSEC_FAIL"; continue
      fi
      # GUARD 2 — nothing comparable left. Never DONE on an unmeasured set.
      if [[ -z "$D_STABLE" ]]; then
        log "GATE §13: every captured pair is incomparable → INDETERMINATE (never DONE on an unmeasured set)"
        decide "iter $CUR_ITER INDETERMINATE per GATE_SPEC §13: every captured pair rendered differently between the two captures, so the comparable set is empty and no density can be computed; reverted conservatively, breaker untouched."
        revert_to "$CHECKPOINT"; WALL=$(( $(date +%s) - ITER_T0 ))
        finalize INDETERMINATE "~" "$FORCED" "GATE_SPEC §13: no comparable pairs remained between the two captures."
        PENDING_FRESH_BASELINE=1
        log "INDETERMINATE (§13 empty comparable set) · consecutive fail unchanged = $CONSEC_FAIL"; continue
      fi
      D_EXCL="$(printf '%s' "$D_INDET" | sed 's/ *$//; s/  */,/g')"
      log "GATE §13: $D_INDET not comparable (their baseline rendered differently) → excluded from BOTH captures; comparing on: $D_STABLE"
      flags_of "$CUR_BEFORE_DIR" "$RUN_DIR/flags-before-$CUR_ITER.json" || true
      flags_of "$AFTER_DIR"      "$RUN_DIR/flags-after-$CUR_ITER.json"  || true
      route_newly_visible "$RUN_DIR/flags-before-$CUR_ITER.json" "$RUN_DIR/flags-after-$CUR_ITER.json" "$D_INDET" \
        "its deck rendered a materially different amount of content between the two captures (tolerance ${DEPTH_TOL}%)"
      if MEAS="$(measure_defects "$CUR_BEFORE_DIR" "$D_EXCL")"; then
        IFS=$'\t' read -r DEF_BEFORE ANA_BEFORE NA_BEFORE NA_LIST_BEFORE OK_LIST_BEFORE <<< "$MEAS"
      fi
      if MEAS="$(measure_defects "$AFTER_DIR" "$D_EXCL")"; then
        IFS=$'\t' read -r DEF_AFTER ANA_AFTER NA_AFTER NA_LIST_AFTER OK_LIST_AFTER <<< "$MEAS"
      fi
      DEN_BEFORE="$(density "$DEF_BEFORE" "$ANA_BEFORE")"; DEN_AFTER="$(density "$DEF_AFTER" "$ANA_AFTER")"
      log "GATE §13 re-measured on the comparable set: $DEF_BEFORE/$ANA_BEFORE = $DEN_BEFORE  ->  $DEF_AFTER/$ANA_AFTER = $DEN_AFTER per pair"
    fi
  fi
  # ── CONDITION (b) FIRST — GATE_SPEC §2(b): "`analyzable_pairs_set` is a superset of
  #    `baseline_analyzable_pairs_set`", and §3: "it requires that no pair which was analyzable at baseline
  #    becomes not-analyzable. Do not remove condition (b) in any future edit; without it the gate is
  #    gameable by breakage."
  #
  #    It is checked BEFORE condition (a) and it is not optional, because excluding build failures from the
  #    numerator (which this change does) is exactly what would otherwise reward breaking a capture: break
  #    a deck, its defects leave the numerator AND its pair leaves the denominator, and density improves.
  #    §2(b) closes that door. A pair analyzable before and not after is a REGRESSION, never an excluded
  #    sample — the two land together or neither does.
  LOST="$(lost_analyzable "$OK_LIST_BEFORE" "$OK_LIST_AFTER")"
  if [[ -n "$LOST" ]]; then
    log "GATE §2(b) VIOLATED: pair(s) analyzable BEFORE and not AFTER: $LOST → REGRESSION (not an excluded sample)"
    decide "iter $CUR_ITER REGRESSION per GATE_SPEC §2(b): $LOST was analyzable in the before-capture and is not in the after-capture; a lost sample is breakage, not an improvement."
    revert_to "$CHECKPOINT"; finalize REGRESSION "~" "$FORCED" "GATE_SPEC §2(b): $LOST became not-analyzable. Density would have read $DEN_BEFORE -> $DEN_AFTER, but a pair that stopped rendering is breakage, not a fix."
    PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
    log "REVERTED (REGRESSION §2(b)) · consecutive fail = $CONSEC_FAIL"
  elif [[ "$ANA_AFTER" -eq 0 ]]; then
    # No analyzable pairs ⇒ nothing was measured. Never scoreable as an improvement (GATE_SPEC §3's
    # reward-breakage hazard in its purest form: zero decks means zero defects).
    log "GATE: 0 analyzable pairs after — nothing was measured → INDETERMINATE"
    revert_to "$CHECKPOINT"; finalize INDETERMINATE "~" "$FORCED"; PENDING_FRESH_BASELINE=1
    log "INDETERMINATE (no analyzable pairs) · consecutive fail unchanged = $CONSEC_FAIL"
  elif awk -v a="$DEN_AFTER" -v b="$DEN_BEFORE" 'BEGIN{exit !(a>b)}'; then
    # ── COUNT DEMOTION for test-graded items (GATE_SPEC §12c) ────────────────────────────────────────
    # An honest null can only hold the defect count FLAT or RAISE it: the analyzer flags a dash that hides a
    # figure present elsewhere, and the cross-surface checks fire on dash-vs-value asymmetry. So for the
    # class of fix this harness exists to enable, a risen count is not evidence of harm — it is the
    # expected signature of the fix. The count keeps its veto, but it must now SHOW the harm: a pair lost
    # (§2(b)), a pair rendering less (§13), or a NEW FLAG ON THE REPRO PAIR. Absent all three, a test that
    # fails at the checkpoint and passes here outranks the number.
    NEW_ON_REPRO=""
    if [[ "$TESTED" -eq 1 ]]; then
      flags_of "$CUR_BEFORE_DIR" "$RUN_DIR/flags-before-$CUR_ITER.json" || true
      flags_of "$AFTER_DIR"      "$RUN_DIR/flags-after-$CUR_ITER.json"  || true
      NEW_ON_REPRO="$(new_flags_for "$RUN_DIR/flags-before-$CUR_ITER.json" "$RUN_DIR/flags-after-$CUR_ITER.json" "$ITEM_PAIR")"
    fi
    if [[ "$TESTED" -eq 1 && -z "$NEW_ON_REPRO" ]]; then
      log "GATE: density rose $DEN_BEFORE -> $DEN_AFTER, but the test went RED->GREEN, §2(b) and §13 hold, and NO new flag appeared on the repro pair $ITEM_PAIR → the count shows no harm → DONE_TESTED (§12c)"
      decide "iter $CUR_ITER DONE_TESTED over a risen count: density $DEN_BEFORE -> $DEN_AFTER, but $ITEM_TEST fails at the checkpoint and passes on this tree, no pair was lost (§2(b)), none rendered less (§13), and no new flag appeared on the repro pair $ITEM_PAIR. An honest null can only hold the count flat or raise it, so a risen count carrying no evidence of harm does not overrule the test."
      finalize DONE_TESTED "x" "$FORCED" "Graded by TEST over a risen count (GATE_SPEC §12c): $ITEM_TEST exits 1 at $CHECKPOINT and 0 here. Density $DEN_BEFORE -> $DEN_AFTER rose, but with no harm evidence — no lost pair, no pair rendering less, no new flag on $ITEM_PAIR. The count vetoes on harm; it does not certify."
      CUR_BEFORE_DIR="$AFTER_DIR"; DEF_BEFORE="$DEF_AFTER"; ANA_BEFORE="$ANA_AFTER"; OK_LIST_BEFORE="$OK_LIST_AFTER"; CONSEC_FAIL=0
      log "COMMITTED (item closed, test-graded over a risen count) iter $CUR_ITER"
    else
      log "GATE: density $DEN_BEFORE -> $DEN_AFTER (rose) → REGRESSION"
      decide "iter $CUR_ITER REGRESSION: defect density rose $DEN_BEFORE -> $DEN_AFTER per analyzable pair after the change${TESTED:+ (test-graded: $TESTED)}${NEW_ON_REPRO:+, including a NEW flag on the repro pair $ITEM_PAIR}; reverted, item parked. §2(b) held and no pair rendered less, so the rise is attributed to the change itself."
      revert_to "$CHECKPOINT"
      finalize REGRESSION "~" "$FORCED" "Defect density rose $DEN_BEFORE -> $DEN_AFTER per analyzable pair.${NEW_ON_REPRO:+ New flag(s) on the repro pair $ITEM_PAIR: ${NEW_ON_REPRO}}"
      PENDING_FRESH_BASELINE=1; CONSEC_FAIL=$(( CONSEC_FAIL + 1 ))
      log "REVERTED (REGRESSION) · consecutive fail = $CONSEC_FAIL"
    fi
  elif [[ "$REVERT_SIGNAL" == "true" ]]; then
    BNA="$(became_not_analyzable "$DIFF_OUT" "$AFTER_DIR" | head -1)"; BNA_PAIR="${BNA%% *}"; BNA_REASON="${BNA##* }"
    log "GATE: $BNA_PAIR became not-analyzable (reason=$BNA_REASON)"
    if [[ "$BNA_REASON" == "RATE_LIMITED" ]]; then
      log "INDETERMINATE ($BNA_REASON) — retrying the CAPTURE before touching code (THE TRAP)…"
      RETRY_DIR="$RUN_DIR/cap/after-$CUR_ITER-retry"
      if do_capture "$RETRY_DIR" "after-$CUR_ITER-retry" && run_diff "$CUR_BEFORE_DIR" "$RETRY_DIR" "$DIFF_OUT"; then
        RS2="$(json_field "$DIFF_OUT" revert_signal true)"
        if MEAS2="$(measure_defects "$RETRY_DIR")"; then
          IFS=$'\t' read -r DA2 ANA2 NA2 NA_LIST2 OK_LIST2 <<< "$MEAS2"
        else
          DA2=$(( DEF_BEFORE + 1 )); ANA2="$ANA_BEFORE"; OK_LIST2="$OK_LIST_BEFORE"   # analyzer crash ⇒ treat as worse
        fi
        # §2(b) applies to the RETRY capture too — a retry that "recovers" by losing a DIFFERENT pair is
        # still breakage. Density, not raw count, for the same reason as the main gate.
        LOST2="$(lost_analyzable "$OK_LIST_BEFORE" "${OK_LIST2:-}")"
        DEN2="$(density "$DA2" "${ANA2:-0}")"
        if [[ "$RS2" == "false" && -z "$LOST2" ]] && awk -v a="$DEN2" -v b="$DEN_BEFORE" 'BEGIN{exit !(a<=b)}'; then
          log "capture retry RECOVERED $BNA_PAIR → density $DEN_BEFORE -> $DEN2, §2(b) holds → COMMIT"
          AFTER_DIR="$RETRY_DIR"; DEF_AFTER="$DA2"; ANA_AFTER="${ANA2:-0}"; OK_LIST_AFTER="${OK_LIST2:-}"
          finalize DONE "x" "$FORCED"; CUR_BEFORE_DIR="$AFTER_DIR"; DEF_BEFORE="$DEF_AFTER"; ANA_BEFORE="$ANA_AFTER"; OK_LIST_BEFORE="$OK_LIST_AFTER"; CONSEC_FAIL=0
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
  elif awk -v a="$DEN_AFTER" -v b="$DEN_BEFORE" 'BEGIN{exit !(a<b)}'; then
    # strict improvement in DENSITY + §2(b) holds + no revert_signal + a verdict is present → COMMIT
    log "GATE: density $DEN_BEFORE->$DEN_AFTER (improved), §2(b) holds, no revert_signal, verdict $STATUS_TOKEN → COMMIT"
    finalize DONE "x" "$FORCED"; CUR_BEFORE_DIR="$AFTER_DIR"; DEF_BEFORE="$DEF_AFTER"; ANA_BEFORE="$ANA_AFTER"; OK_LIST_BEFORE="$OK_LIST_AFTER"; CONSEC_FAIL=0
    log "COMMITTED (item closed) iter $CUR_ITER"
  elif [[ "$TESTED" -eq 1 ]] && agent_changed; then
    # equal count + a test that went RED->GREEN. The count could not move, and for a whole class of
    # defects it never can: an honest null cannot LOWER a defect count, and item 2d's zeroed payload
    # renders as a well-formed deck that both graders score clean. This is exactly the case that scored
    # UNVERIFIED on run 20260817-163640 with a correct fix. It is now MEASURED — by the test, which fails
    # at $CHECKPOINT and passes here — so the item CLOSES and the breaker resets. §2(b) held and the count
    # did not rise; a passing test never overrides either of those, it only speaks where they are silent.
    log "GATE: density $DEN_BEFORE->$DEN_AFTER (unchanged), §2(b) holds, declared test RED->GREEN → DONE_TESTED"
    decide "iter $CUR_ITER DONE_TESTED: the count could not move ($DEF_BEFORE->$DEF_AFTER) but $ITEM_TEST fails at the checkpoint and passes on this tree, so the fix is measured rather than merely unmeasurable; item closed."
    finalize DONE_TESTED "x" "$FORCED" "Graded by TEST, not by count: $ITEM_TEST exits 1 at $CHECKPOINT and 0 on this tree. Density $DEN_BEFORE -> $DEN_AFTER (unchanged), GATE_SPEC 2(b) holds."
    CUR_BEFORE_DIR="$AFTER_DIR"; DEF_BEFORE="$DEF_AFTER"; ANA_BEFORE="$ANA_AFTER"; OK_LIST_BEFORE="$OK_LIST_AFTER"; CONSEC_FAIL=0
    log "COMMITTED (item closed, test-graded) iter $CUR_ITER"
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

RUN_COMPLETED=1                                # the run ended on its own terms — finalize_abnormal stands down
log "RUN $RUN_ID COMPLETE · branch sweep/auto-$RUN_ID · undo: $RUN_DIR/UNDO.txt"
commit_ledger                                  # explicit at COMPLETE; the EXIT trap repeats it for every other path

# ── exit contract (added 2026-09-17) ─────────────────────────────────────────────────────────────────
# A run whose FINAL capture summary reads "(0 ok)" produced nothing analyzable: every deck failed, both
# graders had empty input, and the gate could only compare absent to absent. That is a FAILED run and it has
# to be visible where the schedulers look — launchd's `last exit code` and the agents widget row — not only
# in loop.log. Run 20260916-124247 slept mid-capture, logged "50 decks captured (0 ok)" after 409m, exited 0,
# and the Auto Fixer row read "ok" all night.
#   0 = a real run (any analyzable decks)   1 = die()   2 = completed but zero analyzable decks
# Graded from loop.log — the SAME line sweep-watchdog.sh reads — so the two verdicts cannot disagree. A
# missing or "(? ok)" summary is NOT a proven zero and stays 0: unknown is not failure.
# The EXIT trap (on_exit) runs after this and never calls exit itself, so the code below is what launchd sees.
# >>> exit-contract  (scripts/sources-selftest.mjs extracts this block verbatim — keep the sentinels)
FINAL_SUMMARY="$(grep -oE '[0-9]+ decks captured \([0-9?]+ ok\)' "$RUN_DIR/loop.log" 2>/dev/null | tail -1 || true)"
if [[ "$FINAL_SUMMARY" == *"(0 ok)"* ]]; then
  log "RUN $RUN_ID FAILED · $FINAL_SUMMARY — zero analyzable decks; exiting 2 so launchd records a failed run"
  exit 2
fi
exit 0
# <<< exit-contract
