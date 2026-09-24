# Sweep demo — meeting script

A 6-step walkthrough: a finished overnight run on the dashboard, then a live 5-pair run that finishes in
about five and a half minutes. Timings below are measured from two end-to-end dry runs on 2026-09-24
(`20260924-163754`, 5m21s · `20260924-164351`, 5m17s), not estimates.

**Before anyone is in the room** — `bash agent/demo.sh` runs its own pre-flight, but these take a minute
to fix and are awkward live:

```bash
git status --porcelain            # must be empty; the runner refuses a dirty tree
ls agent/STOP                     # must NOT exist; with it, the loop halts after the baseline
node server.js &                  # :3001
bash agent/dashboard/open-dashboard.sh   # :3002
```

> **Known caveat, 2026-09-24.** The iteration step currently returns `NO_VERDICT`: the sweep agent's
> `claude` CLI answers `Failed to authenticate: OAuth session expired and could not be refreshed`
> (`runs/<id>/envelope-iter1.json`). Capture, grading and the ledger all work — only the agent's own turn
> is empty. Re-authenticate the CLI before the meeting, or plan to use the Step 5 fallback.

---

## Step 1 — The overnight run (2 min)

**Open** `http://localhost:3002/`, run **`20260922-194237`**.
**Say:** "This runs unattended every night. It builds decks for 50 company pairs, grades every number
against SEC filings, and stops on its own if nothing improves."
**Click** the run to expand it.
**Should appear:** `50 decks captured (38 ok) · 169m` and `45 defects across 38 analyzable pairs`.
**If it fails** (dashboard blank or the run missing): show the log directly —
`tail -40 agent/runs/20260922-194237/loop.log`. Same numbers, less polish.

## Step 2 — What a defect actually is (2 min)

**Open** the flags for that run: `agent/runs/20260922-194237/flags-22509.json`.
**Say:** "Not a crash — a number that disagrees with itself. Here the target's gross profit shows 45.6%
on one page of the deck and a dash on two others, while the filing says $63.08B."
**Should appear:** the `AAPL/VZ` entry, `kind: MISSING`, `root: A-crossSurface`, severity `high`.
**Expected shape:** 57 raw flags → 45 after the allowlist; top roots `A-crossSurface` 15, `D-ebitdaMsg` 8,
`B-nullInSum` 6.
**If it fails** (file too large to read on screen): quote the one line in this script and move on — the
point is the *kind* of bug, not the JSON.

## Step 3 — Why it can't cheat (1 min)

**Open** `agent/GATE_SPEC.md`.
**Say:** "The agent that fixes these can't grade itself. A fix counts only if the defect count drops on a
re-capture, or a declared test goes red-to-green. Anything else is reverted and the item stays open."
**Should appear:** the grading contract, and in the ledger `agent/calibration.csv` the honest spread of
verdicts — `DONE`, `UNVERIFIED`, `REGRESSION`, `NO_VERDICT`.
**If asked "has it ever been wrong?"** — yes, say so: run `20260817-153300` scored REGRESSION and was
reverted; a later commit showed that flag was a phantom. It's in `CLAUDE.md` under hard-won lessons.

## Step 4 — Start the live run (30 sec, then ~1 min of setup)

**Run** in a terminal they can see:

```bash
bash agent/demo.sh
```

**Say:** "Same harness, shrunk to five pairs and one iteration so it fits in a meeting."
**Should appear:** six green `ok` pre-flight lines, then within ~60 seconds the RUN line:
`RUN <id> · 5 pairs · 6 open items · mode N+1 · max_iter 1 · budget $50 · sweep_pairs 5`.
**Timing:** pre-flight is instant; the gap to the RUN line is ~60s (lock, stale-capture reap, pair build).
**If a pre-flight check fails:** each failure prints the exact fix under it. The common one is a dirty
tree — `git status --porcelain`, commit or stash, rerun. Don't debug live; use `--pairs 3` if you're short
on time, or fall back to Step 1's finished run.

## Step 5 — Watch the capture (4 min)

**Say:** "It's driving a real browser through the app right now — entering tickers, building each deck,
then reading every figure back out and comparing it to EDGAR."
**Should appear:** `capture START · baseline · 5 decks`, then a per-deck line roughly every 48 seconds,
ending `capture END · baseline · 5 decks captured (5 ok) · 4m`, then
`baseline: 6 defects across 5 analyzable pairs (1.20 per pair)`.
**Both dry runs:** 5 ok of 5, 6 defects, capture 4m00s.
**If decks start failing:** if the reason is `RATE_LIMITED`, say so plainly — that's the app's own rate
limiter, fixed for loopback in `483a910`; on an unpatched build it's the known cause. A failed deck is
excluded from grading, never counted as a pass. Keep talking over it; 4 of 5 is still a working demo.

## Step 6 — The verdict and the paper trail (1 min)

**Should appear:** the summary block — elapsed time, `baseline: 5 ok, 0 failed`, the defect line, the
gate verdict, the iteration commit hash, the branch, and the dashboard URL.
**Say:** "Every run is a branch with an UNDO file. Nothing is merged automatically. The commit message
carries the verdict — this one says NO_VERDICT, meaning the agent's answer wasn't trustworthy, so the
harness reverted it and left the item open."
**Expected:** exit 0, total 5m17s–5m21s.
**If the iteration is empty** (today's OAuth caveat): show a real one instead —
`git show ce746de --stat` (a REGRESSION that was reverted) or `247e4b9` (UNVERIFIED, committed and left
open). Say: "the agent's credentials expired this morning; here's what a graded iteration looks like."

---

## Measured timings — the two dry runs, 2026-09-24

| phase | `20260924-163754` | `20260924-164351` |
|---|---|---|
| pre-flight → RUN line | 60s | 60s |
| `npm run build` | 9s | 8s |
| capture, 5 decks | 4m08s (5 ok) | 4m07s (5 ok) |
| analyzer | ~1s, 6 defects | ~1s, 6 defects |
| iteration + gate | 3s (`NO_VERDICT`) | 1s (`NO_VERDICT`) |
| **total** | **5m21s, exit 0** | **5m17s, exit 0** |

Budget the demo at **6 minutes** of run time and 6 minutes of talking. `--pairs 3` cuts roughly 100
seconds off the capture.
