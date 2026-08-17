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

## 10. Known blind spots

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
