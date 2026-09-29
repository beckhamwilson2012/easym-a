# Sweep demo — meeting script

A 6-step walkthrough, but **not run in numeric order**: start the live 5-pair run first and leave it
working, present the finished overnight run while it captures, then come back for the verdict. The live
run takes about fourteen minutes. Timings below are measured from `20260929-160247` — the first run whose
agent actually ran, 14m16s on 2026-09-29 — not estimates.

**Before anyone is in the room** — `bash agent/demo.sh` runs its own pre-flight, but these take a minute
to fix and are awkward live:

```bash
git status --porcelain            # must be empty; the runner refuses a dirty tree
ls agent/STOP                     # must NOT exist; with it, the loop halts after the baseline
node server.js &                  # :3001
bash agent/dashboard/open-dashboard.sh   # :3002
```

> **Running order — start the run first, then talk over it.** The live run is ~14 minutes, and most of
> that is two four-minute captures with nothing to watch. Do not walk the steps in numeric order:
>
> | minute | do this |
> |---|---|
> | 1 | **Step 4** — `bash agent/demo.sh`, wait for the RUN line, then leave the terminal alone |
> | 1–11 | **Steps 1–3** on `http://localhost:3002/` — the overnight run, a real defect, the gate |
> | ~14 | back to the terminal for **Steps 5–6** — the verdict and the commit |
>
> The 2026-09-24 OAuth failure is fixed: `20260929-160247` returned `DONE_TESTED` off a real 49-turn,
> $1.72 agent iteration. If it recurs the symptom is `Failed to authenticate: OAuth session expired and
> could not be refreshed` in `runs/<id>/agent-1.json` with `is_error: true`, and the run still reaches a
> verdict — `NO_VERDICT`, item left open. Re-authenticate the CLI and rerun.

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

## Step 4 — Start the live run (30 sec, then ~1 min of setup) — do this at minute 1

**Run** in a terminal they can see:

```bash
bash agent/demo.sh
```

**Say:** "Same harness, shrunk to five pairs and one iteration so it fits in a meeting."
**Should appear:** six green `ok` pre-flight lines, then within ~60 seconds the RUN line:
`RUN <id> · 5 pairs · 6 open items · mode N+1 · max_iter 1 · budget $50 · sweep_pairs 5`.
**Timing:** pre-flight is instant; the gap to the RUN line is ~60s (lock, stale-capture reap, pair build).
**Then leave it.** Once the RUN line is up, go to Step 1 — the next 13 minutes are captures and the
agent's own turn, and none of it needs a watcher. Come back at ~14 min for Steps 5–6.
**If a pre-flight check fails:** each failure prints the exact fix under it. The common one is a dirty
tree — `git status --porcelain`, commit or stash, rerun. Don't debug live; use `--pairs 3` if you're short
on time, or fall back to Step 1's finished run.

## Step 5 — The capture and the live iteration (13 min, unattended)

**You are not watching this live** — Steps 1–3 run over it. This is what the terminal will have printed
by the time you come back, and the one line worth reading aloud on the way past.
**Say:** "It's driving a real browser through the app right now — entering tickers, building each deck,
then reading every figure back out and comparing it to EDGAR."
**Should appear:** `capture START · baseline · 5 decks`, then a per-deck line roughly every 48 seconds,
ending `capture END · baseline · 5 decks captured (5 ok) · 4m`, then
`baseline: 6 defects across 5 analyzable pairs (1.20 per pair)`.
**All three runs:** 5 ok of 5, 6 defects — baseline capture 4m08s / 4m07s on the two dry runs, 4m20s on
the live run `20260929-160247`.
**Live iteration** (new — the two dry runs never reached it, their agent turn was an empty error): four
`claude -p working… Nm elapsed` lines, then `verdict: agent returned DONE` at 4m05s — 49 turns, $1.72,
0 permission denials. A graded iteration then re-captures: `capture START · after-1`, another 4m14s.
**Budget two four-minute waits here, not one.** The step ran 16:03:56→16:17:03 = 13m07s and the run
totalled 14m16s, against 5m17s–5m21s back when the agent's OAuth was dead and it never ran.
**If decks start failing:** if the reason is `RATE_LIMITED`, say so plainly — that's the app's own rate
limiter, fixed for loopback in `483a910`; on an unpatched build it's the known cause. A failed deck is
excluded from grading, never counted as a pass. Keep talking over it; 4 of 5 is still a working demo.

## Step 6 — The verdict and the paper trail (1 min)

**Should appear:** the summary block — elapsed time, `baseline: 5 ok, 0 failed`, the defect line, the
gate verdict, the iteration commit hash, the branch, and the dashboard URL.
**Say:** "Every run is a branch with an UNDO file. Nothing is merged automatically. The commit message
carries the verdict — this one says DONE_TESTED: the defect count did not move, 6 to 6, but the test the
agent declared before it started went red-to-green, so the gate closed the item on the test, not the
count."
**Expected:** exit 0, total 14m16s, and these two lines —
`GATE: density 1.20->1.20 (unchanged), §2(b) holds, declared test RED->GREEN → DONE_TESTED`
`COMMITTED (item closed, test-graded) iter 1`
then commit `78389d2` on branch `sweep/auto-20260929-160247`.
**If asked why a test it wrote is trusted:** the runner proves the test discriminates before believing
it — `test RED->GREEN CONFIRMED: exits 1 at <base> and 0 on the agent's tree`. The five red failures are
in `agent/runs/20260929-160247/test-iter1-red.log`, e.g. `companyBDebt=null -> targetDebtRepaid="0", want
null`.
**If the iteration comes back NO_VERDICT:** the agent's envelope was `is_error: true` and the harness left
the item open — show a graded one instead, `git show 78389d2 --stat`.

---

## Measured timings

The two 2026-09-24 runs never reached the iteration — the agent's turn came back as an auth error with
zero tokens — so their totals understate a real run by about nine minutes. Use the live column.

| phase | `20260924-163754` (agent dead) | `20260924-164351` (agent dead) | `20260929-160247` (live) |
|---|---|---|---|
| pre-flight → RUN line | 60s | 60s | 60s |
| `npm run build` | 9s | 8s | 8s |
| capture, 5 decks — baseline | 4m08s (5 ok) | 4m07s (5 ok) | 4m20s (5 ok) |
| analyzer | ~1s, 6 defects | ~1s, 6 defects | ~1s, 6 defects |
| agent turn | — (empty, auth error) | — (empty, auth error) | 4m05s · 49 turns · $1.72 · 0 denials |
| test RED→GREEN + 3 rebuilds | — | — | 28s |
| capture, 5 decks — after-1 | — | — | 4m14s (5 ok) |
| gate | 3s (`NO_VERDICT`) | 1s (`NO_VERDICT`) | <1s (`DONE_TESTED`) |
| **total** | **5m21s, exit 0** | **5m17s, exit 0** | **14m16s, exit 0** |

The iteration step alone (agent turn through gate, `16:08:16`→`16:17:03`) is 8m47s — the `wall_sec` on the
`20260929-160247` row of `agent/calibration.csv`.

Budget **15 minutes** of run time against ~6 minutes of talking, which is why Steps 1–3 go over the
capture rather than after it. `--pairs 3` cuts roughly 100 seconds off *each* capture and there are now
two of them (estimate — the `--pairs 3` path has not been timed end to end).
