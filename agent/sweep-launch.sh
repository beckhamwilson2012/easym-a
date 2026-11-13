#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────────────────────────────────
# sweep-launch.sh — what the nightly LaunchAgent runs. It decides WHAT CODE the sweep tests, and where.
#
# Before this, launchd ran the MAIN checkout's agent/run-sweep.sh, which tested whatever that checkout had on
# HEAD and then ran `git checkout -b sweep/auto-<id>` IN the main checkout. So the sweep graded an old branch
# (sweep/auto-20261111-000000 @ 0f58189) while all current work sat on overnight/nov2-banker-feedback, and
# every night moved the main checkout to a new branch.
#
# Now, every night:
#   1. git must run (Xcode-license lesson, run 20261112-000000) — else the night is skipped, with git's error.
#   2. SKIP THE NIGHT if another Claude Code session is working in this repo: any worktree other than the main
#      checkout and this launcher's own (under $WT_ROOT), or anything listening on ports 3100–3110.
#   3. Resolve the CURRENT head of $TARGET_BRANCH and create a fresh DETACHED worktree of it under $WT_ROOT.
#   4. Run THAT worktree's agent/run-sweep.sh. Its sweep/auto-<id> branch is created inside the worktree, off
#      the target head; the main checkout's HEAD, index and files are never touched.
#   5. Stop the app server the run left on its port (only a process whose cwd is the run's worktree), then
#      remove the worktree if it is clean (dirty → kept, logged). Run logs live in the main checkout's
#      agent/runs/ (gitignored), so they survive.
#
# Never: checkout/switch in the main checkout, merge, push, delete a branch or tag.
# Env: SWEEP_REPO, SWEEP_TARGET_BRANCH, SWEEP_WT_ROOT, SWEEP_BUSY_PORTS ("3100-3110"), DRY_RUN, plus anything
#      run-sweep.sh reads (MAX_ITER, BUDGET_USD, SWEEP_PAIRS, …), which is passed straight through.
# ─────────────────────────────────────────────────────────────────────────────────────────────────────────
set -uo pipefail

REPO="${SWEEP_REPO:-$HOME/src/EasyM&A/ma-app}"
TARGET_BRANCH="${SWEEP_TARGET_BRANCH:-overnight/nov2-banker-feedback}"
WT_ROOT="${SWEEP_WT_ROOT:-$(dirname "$REPO")/.ma-app-sweep-worktrees}"
BUSY_PORTS="${SWEEP_BUSY_PORTS:-3100-3110}"
RUNS_DIR="${SWEEP_RUNS_DIR:-$REPO/agent/runs}"
RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
LLOG="$RUNS_DIR/launcher.log"

mkdir -p "$RUNS_DIR" 2>/dev/null
say()  { local l; l="[$(date '+%Y-%m-%d %H:%M:%S')] launch $RUN_ID: $*"; printf '%s\n' "$l"; printf '%s\n' "$l" >> "$LLOG" 2>/dev/null; }
skip() { say "SKIPPED THE NIGHT — $*"; exit 0; }       # a skip is a decision, not a failure: rc 0, reason logged
fail() { say "FAILED — $*"; exit 1; }
g()    { git -C "$REPO" "$@"; }

# 1. git must run before any git answer is believed
_e="$(g rev-parse --git-dir 2>&1 >/dev/null)" || fail "git is not runnable in $REPO (${_e:-no stderr}). If this is the Xcode license: sudo xcodebuild -license accept"
MAIN_WT="$(cd "$REPO" && pwd -P)"
mkdir -p "$WT_ROOT" 2>/dev/null || fail "cannot create $WT_ROOT"
OWN_ROOT="$(cd "$WT_ROOT" && pwd -P)"

# 2a. our own leftovers first: a clean one is removed; a dirty one is kept (it holds work) but is still OURS
while IFS= read -r wt; do
  [[ -z "$wt" || "$wt" != "$OWN_ROOT"/* ]] && continue
  if [[ -d "$wt" && -z "$(git -C "$wt" status --porcelain 2>/dev/null)" ]]; then
    g worktree remove --force "$wt" >/dev/null 2>&1 && say "removed own leftover worktree $wt (clean)" || say "WARNING: could not remove own leftover worktree $wt"
  else
    say "own leftover worktree $wt is DIRTY or missing — kept for inspection"
  fi
done < <(g worktree list --porcelain | sed -n 's/^worktree //p')
g worktree prune >/dev/null 2>&1 || true

# 2b. anyone else's worktree → another session is working here → skip
others=""
while IFS= read -r wt; do
  [[ -z "$wt" ]] && continue
  rp="$(cd "$wt" 2>/dev/null && pwd -P || printf '%s' "$wt")"
  [[ "$rp" == "$MAIN_WT" || "$rp" == "$OWN_ROOT"/* ]] && continue
  br="$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  others+="${others:+, }$rp ($br)"
done < <(g worktree list --porcelain | sed -n 's/^worktree //p')
[[ -n "$others" ]] && skip "another worktree is present: $others"

# 2c. anything listening on the busy-port range → another session's servers → skip
lo="${BUSY_PORTS%-*}"; hi="${BUSY_PORTS#*-}"; busy=""
for (( p = lo; p <= hi; p++ )); do
  pid="$(lsof -nP -iTCP:"$p" -sTCP:LISTEN -t 2>/dev/null | head -1)"
  [[ -n "$pid" ]] && busy+="${busy:+, }:$p (pid $pid $(ps -o comm= -p "$pid" 2>/dev/null | xargs basename 2>/dev/null))"
done
[[ -n "$busy" ]] && skip "ports in use in $BUSY_PORTS: $busy"

# 3. the CURRENT head of the target branch, in a fresh detached worktree
SHA="$(g rev-parse --verify -q "refs/heads/$TARGET_BRANCH^{commit}")" || fail "branch $TARGET_BRANCH not found in $REPO"
RUN_WT="$OWN_ROOT/sweep-$RUN_ID"
_e="$(g worktree add --detach "$RUN_WT" "$SHA" 2>&1 >/dev/null)" || fail "git worktree add failed: $_e"
# untracked-but-ignored runtime deps the app needs, linked from the main checkout (never copied, never committed)
for f in node_modules .env; do [[ -e "$REPO/$f" && ! -e "$RUN_WT/$f" ]] && ln -s "$REPO/$f" "$RUN_WT/$f"; done
[[ -z "$(git -C "$RUN_WT" status --porcelain)" ]] || fail "fresh worktree $RUN_WT is not clean after linking deps — refusing to run"
say "testing $TARGET_BRANCH @ $(git -C "$RUN_WT" rev-parse --short HEAD) in $RUN_WT (main checkout $MAIN_WT stays on $(g rev-parse --abbrev-ref HEAD) @ $(g rev-parse --short HEAD))"

# 4. run the WORKTREE's runner — the runner under test is the one on the target branch
SWEEP_RUNS_DIR="$RUNS_DIR" SWEEP_WORKTREE=1 BASE_BRANCH="$TARGET_BRANCH" RUN_ID="$RUN_ID" DRY_RUN="${DRY_RUN:-0}" \
  bash "$RUN_WT/agent/run-sweep.sh"
rc=$?
say "run-sweep.sh exited rc=$rc (log: $RUNS_DIR/$RUN_ID/loop.log)"

# 5. stop the app server the run left behind — by IDENTITY: listening on the sweep port AND cwd inside RUN_WT
port="${SWEEP_APP_PORT:-3001}"
for pid in $(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null); do
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  [[ "$cwd" == "$RUN_WT"* ]] && { kill "$pid" 2>/dev/null && say "stopped run server pid $pid on :$port (cwd $cwd)"; }
done
if [[ -z "$(git -C "$RUN_WT" status --porcelain 2>/dev/null)" || "${DRY_RUN:-0}" == "1" ]]; then
  # DRY_RUN writes no commits by design, so anything it left (ledger rows) is disposable
  g worktree remove --force "$RUN_WT" >/dev/null 2>&1 && say "removed worktree $RUN_WT" || say "WARNING: could not remove $RUN_WT"
else
  say "worktree $RUN_WT left in place: it has uncommitted changes ($(git -C "$RUN_WT" status --porcelain | wc -l | tr -d ' ') path(s))"
fi
exit "$rc"
