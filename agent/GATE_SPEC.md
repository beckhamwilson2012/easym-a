# Analyzer gate specification

The unattended sweep harness grades itself against the fuzz analyzer
(`tools/sweep-analyzer/analyze.js`). This document is the contract for how that
grade is computed. It is documentation, not code.

## 1. Exit code detects a CRASH, never a defect

The harness NEVER branches on the analyzer's exit code to detect defects. The
analyzer exits **zero whether or not defects are found** — a non-zero exit means
the analyzer itself **crashed**; a zero exit means it **ran**. The defect count
is obtained by parsing the `FLAGS` JSON array and taking its length. Reading the
exit code as a defect signal makes a defect-rich run look clean and only a crash
look like failure.

## 2. The gate is TWO values — both must hold

A change passes the gate only if **both** conditions hold:

  a. `defect_count <= baseline_defect_count`
  b. `analyzable_pairs_set` is a **superset** of `baseline_analyzable_pairs_set`

A pair is **analyzable** when its `checks_run == 24`. A `checks_run == 1` means
the deck **build failed** and the pair is **NOT-ANALYZABLE** — a state that is
**distinct from CLEAN** and must never be scored as clean.

### 2a. The count is defects, not decks that never rendered

`defect_count` counts flags with **`sev != 'build'`**. A pair whose deck never built
contributes **no defect** — it is an **excluded sample**, reported separately as
`not_analyzable` with its pair list, never folded into the total.

This is **counting, not grading**: what constitutes a defect is unchanged. The
analyzer always drew this line — `analyze.js:137` emits `sev:'build'` and returns,
so the other 23 checks never run and it prints *"recompute N/A — no deck"* — but the
runner counted `flags.length` and threw the distinction away. `sev:'build'` is the
**only** non-analyzable marker, emitted at exactly one site inside `if (!rec.ok)`;
`high`, `mid` and `token` are all emitted after that return, i.e. only on decks that
built.

Why it mattered: five recorded baselines read **8 / 67 / 67 / 13 / 25** while REAL
defects per analyzable pair sat flat at **1.60 / 2.00 / 2.00 / 1.67 / 2.00**. The
count was measuring how many decks survived the rate limiter, not the code. Because
the denominator moves, **the gate compares defects PER ANALYZABLE PAIR**, not raw
counts.

<!-- CORRECTED 2026-08-17 — this is a GRADER CHANGE, NOT DRIFT. Read this before
     concluding the baseline moved.
     The two middle figures were originally recorded as 68 / 68. They re-measure as
     67 / 67 after commit f2e8034, which fixed `tileVal` in analyze.js. The whole
     difference is ONE phantom flag per run:
       SHEL/OXY — "dashboard renders Combined EBITDA $17.80B (>0) yet the
       Debt/EBITDA tile says Combined EBITDA is non-positive"
     The dashboard rendered no such thing. The Combined EBITDA tile rendered "N/A",
     and the old parser scanned past it onto the NEXT tile, reading Shell's
     Acquirer Net Income ($17.8B) as the combined EBITDA. The flag's own premise was
     false. Same phantom removed one flag each from runs 20260816-165919 and
     -165953; the other three baselines are unchanged.
     Re-measured over the archived deck dirs (defects = sev!='build'):
       run                analyzable   defects 68-era -> now   density -> now
       20260815-150838        5            8 ->  8             1.60 -> 1.60
       20260816-165919       17           35 -> 34             2.06 -> 2.00
       20260816-165953       17           35 -> 34             2.06 -> 2.00
       20260816-202617        6           10 -> 10             1.67 -> 1.67
       20260816-222441        5           10 -> 10             2.00 -> 2.00
     UNRESOLVED, recorded rather than smoothed over: the density figures in the
     sentence above (2.00 / 2.00 for the two middle runs) match the POST-fix
     measurement, not the pre-fix 2.06. Either they were derived by a method other
     than defects/analyzable, or they were written after some other correction. The
     raw-count correction 68 -> 67 is unambiguous and is what this note fixes; the
     density line is left exactly as written because I could not reproduce how 2.00
     was originally obtained, and overwriting a figure I cannot derive would be a
     worse error than leaving the discrepancy visible. -->

The 312-flag full-corpus no-op proof for f2e8034 (10 archived deck dirs, 123 decks:
6 flags removed, 0 added, every other flag byte-identical) is the evidence that the
parser change altered nothing except the phantoms. What constitutes a defect did not
change; only a fabricated input to the checks was removed.

### 2b-enforcement. Excluding build failures REQUIRES condition (b)

Excluding a failed deck from the numerator also removes its pair from the
denominator. On its own that **rewards breaking a capture** — precisely the hole §3
describes. So condition (b) is evaluated **first, before (a)**, and a pair that was
analyzable before and is not after is a **REGRESSION**, never an excluded sample.
The two land together or neither does.

## 3. Why condition (b) exists — do not remove it

A build-failed pair contributes **0 defects from its 23 unrun checks**. Gating on
defect count alone (condition a) therefore **REWARDS breaking builds**: break a
build, its defects vanish, the count drops, the change "passes." Condition (b)
exists **solely to close that hole** — it requires that no pair which was
analyzable at baseline becomes not-analyzable. Do not remove condition (b) in any
future edit; without it the gate is gameable by breakage.

## 4. Set membership, not count

Condition (b) is over the **set** of analyzable pairs, not its **count**.
KO/NSRGY's build timeout is flaky run-to-run, so the analyzable *count* drifts for
reasons unrelated to any code change. The harness must:

  - report **which** pair dropped out of the analyzable set, by name;
  - distinguish a pair that was **already not-analyzable at baseline**
    (tolerate — log it, it does not fail the gate) from a pair that
    **became not-analyzable after the change** (revert — this fails the gate).

Comparing counts alone cannot tell these two apart; comparing sets can.

## 5. INDETERMINATE — a third state; capture failure is not code failure

Conditions (a) and (b) assume the analyzer actually **ran**. A pair can become
not-analyzable for a reason that has nothing to do with the code under test: the
**capture itself** failed on an environmental condition — most commonly a **429
rate limit** on the loadA-critical fetch (see QUEUE.md). `capture.js` records
`reason=RATE_LIMITED` on such failures. Scored naively, condition (b) reads this as
`analyzable -> not-analyzable -> revert_signal`, so the harness would **delete a
good fix** and blame the agent for a transient network event. Three in a row would
trip the consecutive-fail circuit breaker on **pure network noise**.

A pair is **INDETERMINATE** when it became not-analyzable **AND** the capture
reported `RATE_LIMITED` (or another environmental failure reason) — as opposed to a
code-caused build failure.

Harness behavior on INDETERMINATE:

  1. **Retry the CAPTURE first.** Never revert code on an unretried capture failure
     — the code may be fine.
  2. If the retry **succeeds**, proceed with normal comparison (conditions a/b as
     usual).
  3. If the retry **exhausts**, revert conservatively (once capture keeps failing we
     cannot distinguish causes) **BUT record status `INDETERMINATE`, never
     `REGRESSION`**.
  4. INDETERMINATE does **NOT** increment the consecutive-fail counter. The circuit
     breaker exists to stop a wrong premise, not to stop the network.
  5. `calibration.csv` records the run as `INDETERMINATE` so it never pollutes the
     timing or success statistics.

Rationale — keep this in the file so it survives future edits: **capture failure and
code failure are different events.** A 429 during an unattended run is a property of
the network that hour, not of the change under test. Attributing one to the other
makes the harness blame the agent for network conditions — reverting good work and,
if it recurs, halting the whole run on noise. The three-state grade
(**CLEAN / REGRESSION / INDETERMINATE**) is what keeps the gate honest under real
network conditions.

## 6. Terminal statuses — what the runner records and what each one costs

Every iteration ends in exactly one status, written to `calibration.csv` and to the
iteration's commit message. Only some of them are *grades*; the rest describe why
no grade was possible. The distinction that matters is the third column: the
**consecutive-fail breaker** halts the run after 3, so anything that increments it
must represent a wrong premise, never a correct report or a network event.

| Status | Item | Breaker | Meaning |
|---|---|---|---|
| `DONE` | closed `[x]` | resets | Defects fell, no `revert_signal`, agent returned a verdict. Committed. |
| `PARTIAL` | stays OPEN | **untouched** | The defect class split — part resolved, part did not. See §7. |
| `BLOCKED` | parked `[~]` | untouched | The item could not be worked at all. See §8. |
| `NO_VERDICT` | stays OPEN | **+1** | The agent's result is untrustworthy. See §9. |
| `UNVERIFIED` | stays OPEN | +1 | Agent edited files, defect count did not move. Committed but unmeasured. |
| `NO_CHANGE` | stays OPEN | +1 | Agent returned a verdict but left no edits and moved nothing. |
| `REGRESSION` | parked `[~]` | +1 | Defects rose, or a pair became not-analyzable for a non-environmental reason. Reverted. |
| `INDETERMINATE` | parked `[~]` | untouched | Capture failed environmentally. See §5. |
| `TIMEOUT` | parked `[~]` | +1 | Agent exceeded `ITER_TIMEOUT` wall-clock and was tree-killed. |
| `BUILD_BROKEN` | stays OPEN | +1 | The bundle would not build, or the server would not boot, on the agent's edits. Reverted **and halts the run**. |
| `FAILED` | parked `[~]` | +1 | Two attempts exhausted, or a confirmed replay. |
| `PARTIAL_UNVERIFIED` | stays OPEN | +1 | Agent was **cut off mid-fix** (`is_error:true` — turn cap, API error, sleep) **with a non-empty diff**. See §6a. |
| `KILLED` | untouched | untouched | The run ended abnormally — `die()`, Ctrl-C, `kill`, failed setup. Written from the EXIT trap. See §6b. |
| `DONE_TESTED` | closed `[x]` | resets | The count could not move, but the item's declared test fails at the checkpoint and passes on the agent's tree. Committed. See §12. |
| `TEST_FAILED` | stays OPEN | +1 | The declared test fails on the agent's OWN tree — the claimed fix is falsified. Reverted before the after-capture. |
| `TEST_VACUOUS` | stays OPEN | +1 | The declared test passes with AND without the fix, so it cannot discriminate. Reverted. See §12. |
| `TEST_TAMPERED` | stays OPEN | +1 | The agent altered a test that already existed at the checkpoint, or created one that is not its item's declared test. Reverted. |

### §6a. `PARTIAL_UNVERIFIED` — and the one thing it does that nothing else does

**It is the only non-`DONE` status that commits the agent's actual code.** Every other
failure path calls `revert_to`; this one deliberately does not, then calls
`finalize`, whose `gitr add -A` sweeps the working tree into the commit.

That is intentional — run `20260816-202617` diagnosed item 2, wrote the fix, and
died at turn 61 while verifying, and `NO_VERDICT` reverted a complete $5 fix to
nothing — but it means **unmeasured agent code reaches the branch**. The gate never
scored it: the item stays OPEN, the run's breaker increments, and the commit body
says so. Treat such a commit as a draft someone must still review, never as a pass.

It fires on `is_error:true` AND a non-empty diff, not on a subtype list. An empty
diff, or a *clean* envelope merely missing a `STATUS:` token, still reverts.

**What gets staged, and the gap that remains.** `finalize` used to stage with
`git add -A`, which has no notion of authorship — it commits whatever is in the
tree. Driving this path offline with two foreign files present committed **both of
them**, alongside the agent's fix, under the sweep's message on the sweep's branch.

The runner now snapshots the working tree (sha + path for every dirty path)
immediately before `run_agent` and diffs at `finalize`; only paths whose content
changed across the agent call are staged, plus the runner's own bookkeeping.

**This does NOT make staging author-aware, and must not be described as if it
does.** It separates edits that existed *before* the agent ran from edits that
appeared *during* it. A concurrent session writing inside that same window is
indistinguishable from the agent — both are simply "changed since the snapshot" —
and such a file **will** be committed. Measured, not assumed: a foreign file dirty
before the agent is correctly excluded; the same file modified during the agent
window is staged.

**The only complete mitigation is one writer per tree.** Run the sweep on a tree
no other session is editing — a dedicated worktree or clone. The snapshot narrows
the window; it does not close it.

### §6b. `KILLED` — the run that never reached `finalize`

`finalize` only runs at the end of a completed iteration, so a run killed before
that left **no trace at all**: run `20260816-212606` ran 37 minutes, died during its
baseline capture, and had no calibration row and no envelope. A ledger that omits
its failures understates both cost and failure rate.

`KILLED` rows carry the phase the run died in and elapsed seconds. **The cost field
is empty when unknown** — a run killed mid-agent never learns what that call cost,
and writing `0` would be a lie that also drags down the ledger total. It cannot
cover `SIGKILL`; nothing can.

A `KILLED` row is **not** evidence that any item was worked. Consumers must exclude
it before concluding a run reached an iteration.

## 7. PARTIAL — the defect class split

An item names a **class** (item 1: "GP/COGS-crossSurface", 32 pairs) but its repro
line names a single **member** of that class (gross profit on GOOGL/AMZN). These can
diverge: a prior commit fixes the named member while a sibling metric, or the same
metric on other pairs, still fails. STEP 0's original three exits — reproduces /
`RESOLVED_UPSTREAM` / `BLOCKED(repro-drifted)` — had no vocabulary for that state.

The cost of the omission was measured. On run `20260816-165919` the agent established
at turn 39, six minutes in, that gross profit rendered correctly (`§7 = $393,810 /
50.8%`) because `bcda19a` had fixed the server-side leg. With no legal way to report
a half-resolved class it kept investigating, discovered the cost-of-revenue half at
turn 62, opened a third line of inquiry, and hit the 60-turn cap at 61 — `is_error:
true`, `subtype: error_max_turns`, no status token, `NO_VERDICT`. Run `20260816-165953`
reproduced it exactly. Two nights, ~$9, and 122 turns produced no verdict on an item
whose true answer was available in six minutes.

Harness behavior on `PARTIAL`:

  1. The agent's `PARTIAL(<resolved> / <remains>)` detail is parsed literally and
     written back into the queue item as a note. The item stays **OPEN**.
  2. The after-capture is **skipped** — the agent's contract is report-and-stop, so
     there is no claimed fix to measure, and a ~88-minute capture would grade nothing.
  3. Any edits the agent left are **reverted unmeasured**, and the fact is logged.
     Keeping unmeasured edits would poison the next iteration's before-snapshot.
  4. `PARTIAL` does **NOT** increment the consecutive-fail counter.

Rationale — keep this in the file: **a true partial answer reported early beats a
complete answer that never ships.** The breaker exists to stop a wrong premise. An
agent correctly reporting that half its item is already fixed is the single most
useful thing it can do with the budget, and penalizing it produces exactly the
behavior that burned runs 165919 and 165953 — an agent that keeps digging because
stopping is not expressible.

## 8. BLOCKED — the item could not be worked

`BLOCKED` is a **park, not a code failure**. It reverts nothing and does not touch the
consecutive-fail breaker. Three sources:

  - **Pre-agent, no repro pair** — the item names no parseable `pair: A/B`, so nothing
    can be measured. Caught before any capture or agent time is spent.
  - **Pre-agent, repro pair not captured** — the pair is missing or not-analyzable in
    the snapshot the gate would score against. Working it is what let run
    `20260815-150838` read a no-op as "8→8 clear": the deck carrying the defect was
    never in the window, so neither grader could see the fix *or* its absence.
  - **Agent-returned** — `BLOCKED(no-repro)`, `BLOCKED(repro-drifted)`, or another
    stated reason.

Note the asymmetry: the two pre-agent forms short-circuit the iteration, but an
agent-returned `BLOCKED` still proceeds to the after-capture and gate. If that agent
left no edits the gate records `NO_CHANGE`, which **does** increment the breaker — so
a correctly-reported `BLOCKED` can still cost a strike. This is known and deliberate
for now: an agent that blocks without a pre-agent reason may simply have given up.

## 9. NO_VERDICT — the agent's result is untrustworthy

Checked **before** the after-capture, so an unusable result never spends a capture.
`NO_VERDICT` fires when either:

  - the envelope is unreadable, or `is_error: true` (a cut-off, a `max_turns` death, an
    API error) — regardless of what the agent wrote; or
  - the result carries no `STATUS:` token from the documented set.

**A non-empty diff is not a verdict.** Run `20260815-150838` returned `is_error: true`
/ `error_max_turns` with no `.result` at all, yet had made 13 real edits across three
files; the gate of the day scored it `DONE` and committed `bcda19a` unmeasured. That
commit is the direct cause of item 1's repro text describing a defect that no longer
existed, which in turn caused the two `NO_VERDICT` deaths documented in §7.

On `NO_VERDICT` the runner reverts the agent's code, leaves the item **OPEN**,
increments the breaker, and preserves the envelope to `agent/diagnosis/` and
`$RUN_DIR/envelope-iterN.json`. It increments the breaker because an untrustworthy
result is a wrong premise: three in a row means the agent is not completing work and
the run should stop rather than spend the night.

## 10. Capture scope is per-run — resume does NOT carry across runs

The capture directory is **`$SWEEP_RAW_DIR` = `/tmp/sweep_v2_raw/<RUN_ID>`**, one per
run. It used to be a single shared `/tmp/sweep_v2_raw`, and run `20260816-212606`'s
orphaned capture wrote failure stubs into it while run `-222441` was capturing;
`-222441` then copied 15 foreign decks into its own baseline. That is the whole
difference between its recorded baseline of **25** and its true baseline of **10
across 5 pairs**.

**This is intended measurement isolation, not a regression.** Two consequences follow
directly from it, and both are correct:

1. **`alreadyClean()` resume no longer carries across runs.** A relaunch under a NEW
   `RUN_ID` starts cold and re-captures every pair. Resume within a run is unaffected
   (and was already moot — `do_capture` clears the directory before every phase).
   A run must only ever be graded on decks it produced itself; inheriting a previous
   run's decks is the bug, not a feature.
2. **Two guards enforce it rather than assume it.** The directory must be empty after
   clearing, and every deck in it must be a pair *this run requested* — checked
   against `PAIRS_JSON` before the copy. A foreign deck **aborts the capture**; it is
   never merged.

Per-run directories are evidence and are not deleted at the end of a run, so a
reaper removes ones older than `RAW_KEEP_DAYS` (default 3), bounded to the sweep's
own root and never the current run.

## 12. Test-first grading — the measurement the count cannot make

**Neither grader can see a defect whose fix does not move a number.** §11 states the general blind spot;
this is the case where it bites hardest. Item 2d — an unresolved company published as `$0` revenue
instead of `null` — is invisible to both graders **by construction**: the deck BUILDS
(`docs/sweep-v2/captures/BRK.B_PGR.json` is `ok:true`), and a zeroed payload renders as a well-formed
deck full of real-looking numbers. Run `20260817-163640` wrote the correct fix, measured `9 -> 9`, and
was committed `UNVERIFIED` with the item left OPEN. **An honest null can never LOWER a defect count.**

An item may therefore declare ONE test:

    test: agent/tests/<slug>.js

Extracted literally, the way `pair:` is, and read at iteration start **before the agent runs**, so an
agent that edits QUEUE.md cannot change which file grades it. **No `test:` line ⇒ the item is
count-graded exactly as before.** This is opt-in and changes nothing for an item that does not use it.

### 12a. Exit codes are the contract

  - **0 = PASS** — the defect is absent.
  - **1 = FAIL** — the defect is present.
  - **2 = ERROR** — the test could not run: app unreachable, the app's own rate limiter, a precondition
    unmet. Anything that is not 0/1/2 (missing module, syntax error, signal, timeout) is read as **2**.

ERROR is never a fail, and never reverts. That asymmetry is §5's rule applied to the test instead of the
capture: **an unrunnable test must never be able to delete a good fix.** On ERROR the iteration falls
through to the count gate exactly as an undeclared item would, and the breaker is untouched.

### 12b. RED-then-GREEN, performed by the RUNNER

A test written after seeing the fix tests the fix, not the defect. So the runner does not take the
agent's word for the red: after the test passes on the agent's tree, it puts **app code back to
`$CHECKPOINT` while holding everything under `agent/` — the test above all — constant**, and re-runs.

  - RED exits 1, GREEN exits 0 → the test **discriminates**. `TESTED=1`.
  - RED exits 0 → **`TEST_VACUOUS`**: the test passes with and without the fix, so it cannot tell the
    defect from its absence. Reverted, item OPEN, breaker +1. An agent that changed no app code at all
    lands here too — RED and GREEN are then the same tree, and a pass proves nothing.
  - RED exits 2 → red is unproven; fall through to the count gate, breaker untouched.

Holding the test constant is not optional. `tools/noop-ab/README.md` documents the same trap from the
other side: when both trees move together, the comparison proves nothing.

**What this enforces, and what it does not.** It proves the test DISCRIMINATES between the pre-agent and
post-agent trees. It does **NOT** prove the test was written before the fix: an agent that writes the fix
first, then a test tuned to that fix's signature, passes red/green too. Keep this sentence in the file —
a `DONE_TESTED` means "measured", not "the test captures the defect rather than the fix's shape". That
residual is closed by reading the test, not by the harness.

### 12c. What the gate does with the result

A passing test **never overrides the count downward**. §2(b) and the density check run exactly as before;
a test cannot license breaking other pairs. It speaks only where the count is silent:

  - test RED->GREEN + density improved → `DONE` (unchanged).
  - test RED->GREEN + density **unchanged** → **`DONE_TESTED`**: item closes, breaker resets. This is the
    branch that used to be `UNVERIFIED`, and it is the whole point of the mechanism.
  - test RED->GREEN + density **rose**, or §2(b) violated → still `REGRESSION`, still reverted.
  - test FAILS on the agent's tree → `TEST_FAILED`, reverted, **after-capture skipped** — a falsified fix
    short-circuits the ~10-minute capture the way `NO_VERDICT` does at the verdict gate.

### 12d. A committed test is READ-ONLY to the agent

Checked on **every** iteration, test-graded or not:

  1. No file under `agent/tests/` that existed at the checkpoint may differ from it.
  2. When the item declares a test, any NEW file under `agent/tests/` must BE that test.

Either violation is `TEST_TAMPERED`: reverted, item OPEN, breaker +1. A test the agent can edit is a test
the agent can weaken to fit its fix, and the iteration where that pays is a REPEAT attempt on an item
whose test already caught it once.

**Deliberately not covered, stated so nobody reads more into the guard than it does:** a test the agent
writes *this* iteration is its own until it reports, and it may loosen that one freely. Red/green only
requires that the result discriminate. Note also that a reverted iteration's test is discarded with its
code — `revert_to` does not preserve `agent/tests/` — which is what stops a `TEST_VACUOUS` tautology from
persisting into the next iteration and becoming unfixable under rule 1.

## 11. Known blind spots

**Neither grader checks whether a number is plausible.** The analyzer matches known
defect patterns — it answers "does this output look like a shape I was taught to
recognize as broken?" The differ detects change — it answers "did this cell move
between two captures?" Nothing in either one asks "is this figure believable for this
company?" So a figure that is confidently, materially wrong but *stable* passes both
graders silently: the analyzer has no pattern for it, and the differ sees no movement
because it never moves. This is not theoretical. Run `20260815-150838` rendered
Verizon's 52-week low as **$10.60** against a $48.48 share price and a $51.68 52-week
high — an impossible range that the analyzer did not flag, and that the differ only
surfaced as an unflagged `VALUE -> VALUE` cell change, on the accident of the value
having moved *that* run. Had the bad value been present in both captures it would
have been completely invisible. The upstream cause was a single-source field: CNBC is
sole source of truth for `week52Low`, and with Yahoo rate-limited (429) and Finnhub
keyless, the cross-check degraded to `single` — one source cannot disagree with
itself, so no flag was possible. Treat a clean gate as "no *known* pattern broke and
nothing moved", never as "the output is correct".
