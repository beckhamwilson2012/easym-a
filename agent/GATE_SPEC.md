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
