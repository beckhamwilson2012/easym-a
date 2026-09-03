# Phase format — proposal

**Status: authoritative.** This supersedes the earlier draft spec. Authored from the
Stage 0 assessment of the sweep harness (`agent/run-sweep.sh`, `agent/GATE_SPEC.md`,
`agent/ITERATION_PROMPT.md`, `CLAUDE.md`).

All `file:line` citations into `agent/` are as of commit `d1e5d8b`.

---

## 1. The block

```
## phase <n>: <title>
  enter:     <command>            # optional; exit 0 = may enter
  done:      <prose>              # required; for the human and the agent, never parsed as a check
  verify:    <command>            # required; exit 0 pass / 1 fail / 2 could-not-run
  red:       fails | absent | none  # required; the expected before-state
  touches:   <glob> [, <glob>…]   # required; ENFORCED
  turns:     <int>                # required; per-phase agent budget
  tripwire:  <command>            # optional; plan-wide invariant, see §5
```

Extraction is **literal**, never inferred — the way `repro_pair`
(`agent/run-sweep.sh:211-216`) and `item_test` (`:245-252`) already work in the sweep
harness. Values are captured **to end of line**: they may contain commas, slashes and
parentheses, so no mid-line separator is ever a delimiter (`CLAUDE.md:95` — a greedy
split bit this project once).

**A missing required field is a parse error, never a default.** An optional field that is
absent is recorded explicitly in the parsed structure as `<not declared>`, so a reader can
never confuse "absent" with "defaulted to something".

---

## 2. `done` vs `verify` — why they split

`done` was being asked to be prose a human can read *and* a predicate a runner can
evaluate. It would be bad at both. The sweep harness already separates these: the queue
item's prose versus its `test: agent/tests/<slug>.js` line (`GATE_SPEC.md:337-343`).

  - `done` is **never executed**. It is what the agent is told to achieve and what a human
    reads in the record.
  - `verify` is **the only thing that grades**. If `verify` does not parse, or names a
    command that does not exist, the phase is unverifiable and **halts at plan preflight**
    (§6) — it is never accepted and silently graded on nothing.

### 2a. Exit semantics

    0 = PASS      the asserted condition holds
    1 = FAIL      the asserted condition does not hold
    2 = ERROR     could not run — precondition unmet, service down, rate limited
    anything else (missing module, syntax error, signal, timeout) is read as 2

This is `GATE_SPEC.md:345-354` unchanged, including its asymmetry: **ERROR is never a
fail and never reverts.** An unrunnable check must not be able to delete good work.

### 2b. The assertion marker — the fix for vacuous red

Exit codes alone cannot distinguish *"the assertion failed"* from *"the check never
ran"*. A Node test importing a module that does not exist at the checkpoint throws
`MODULE_NOT_FOUND`, node exits **1**, and the current harness reads that exit 1 as a
discriminating red (`agent/run-sweep.sh:1366`). Every new-file phase would pass red
trivially.

So `verify` must **print a marker line to stdout before exiting**:

    VERIFY:ASSERTED <n>        # n = number of assertions actually evaluated, n >= 1

A load failure never reaches the line that prints it. The runner then reads:

| exit | marker | reading |
|---|---|---|
| 0 | present | PASS |
| 1 | present | FAIL — a real assertion failed |
| 1 | **absent** | **the check never ran** — not a fail, not a red; halt |
| 0 | **absent** | a check that asserted nothing; halt |
| 2 | either | ERROR — never a fail |

This is the project's own established pattern: `build_frontend` (`:364-366`, `:389-402`)
refuses to trust `npm run build` exiting 0 and verifies the artifact instead, because a
build that dies late leaves the previous bundle in place and looks identical to success.
Positive evidence, not an exit code.

---

## 3. `red:` — the expected before-state

The runner establishes red itself, by restoring `touches` paths to the checkpoint while
holding the verify command and its fixtures constant (`red_swap`, `:910-928`). It never
asks the agent to certify its own red. What differs is what counts as a correct red.

### `red: fails` — the bug-fix case. Fully provable.

Verify at the checkpoint must exit **1 with the marker**. Verify on the agent's tree must
exit **0 with the marker**. Anything else halts.

  - checkpoint exits 0 → `PHASE_VACUOUS`. The check passes with and without the work.
  - checkpoint exits 1 **without** the marker → red not established by assertion; halt.
    This is the case the marker exists to catch.
  - agent's tree exits 1 → `VERIFY_FAILED`, revert, halt. The claimed work is falsified.

Terminal status on success: **`DONE_VERIFIED`**. This is the only status that means the
runner proved a behavioral difference.

### `red: absent` — new file, new endpoint. Provable only in part.

The thing under test does not exist at the checkpoint, so verify *cannot* meaningfully
run there. The runner requires the checkpoint run to exit **non-zero without the marker**
— consistent with the declaration — and the agent's tree to exit **0 with the marker**.

If the checkpoint run exits non-zero **with** the marker, the declaration is wrong: the
thing did exist and did fail, so the phase should have declared `red: fails`. Halt and
say so.

Terminal status: **`DONE_UNPROVEN_RED`**. It is deliberately not `DONE_VERIFIED`. The
runner proved the capability exists now; it did not prove the new code is why, nor that
no earlier form of it existed. Read such a phase as a draft someone should look at — the
same way `GATE_SPEC.md:182-186` says to read a `PARTIAL_UNVERIFIED` commit.

### `red: none` — refactor, no behavior change. The check inverts.

There is no red by construction, and treating its absence as a failure would reject
correct refactors — the mirror of the problem `GATE_SPEC.md §12` was written to solve.

Verify must exit **0 with the marker at BOTH** the checkpoint and the agent's tree. A
failure at either end halts. **The unchanged green is the evidence.**

Because "do nothing" also produces an unchanged green, `red: none` carries a second
requirement: **the diff within `touches` must be non-empty**, else `PHASE_VACUOUS`. This
is the generic form of the `TEST_VACUOUS` guard at `:1342-1349`, where an agent that
changed no app code makes red and green the same tree.

Terminal status: **`DONE_UNCHANGED`**. See §7.1 for what this does not establish.

---

## 4. `touches` — enforced

After the agent returns, the runner diffs the pre-agent tree snapshot (`tree_snapshot`
`:676-685`, `agent_touched_paths` `:686-697`) and compares the changed set against the
declared globs. Any path outside → **`TOUCH_VIOLATION`**: revert the phase, halt the
phase, name every offending path.

### 4a. Whether a glob must MATCH depends on `red:`

Corrected during implementation — the first example plan caught it. Requiring every glob
to match at least one file rejects every new-file phase, which is exactly the phase type
`red: absent` exists for. The rule is therefore conditioned on the declared before-state:

  - **`red: fails` / `red: none`** — every glob must match ≥1 file. The subject has to
    already exist to *have* a before-state.
  - **`red: absent`** — an unmatched glob is expected and allowed, but each glob's
    **parent directory must exist**. A new file is the point; a new tree is a typo.

### 4b. `touches` may not name the runner's own code

`planrunner/*.js`, `SPEC.md` and `.gitignore` are refused at parse time. A plan that can
edit the runner can edit its own grader.

`touches` also scopes `red_swap`: it is exactly the set restored to the checkpoint to
build the red tree. Declaring it and enforcing it are the same mechanism, which is why it
cannot be advisory — an unenforced `touches` is a comment, and `CLAUDE.md:54-56` is
explicit that a comment only humans read is not a control.

**Honesty requirement on the message.** The snapshot separates edits that existed *before*
the agent ran from edits that appeared *during* it. It **cannot** tell the agent's write
from a concurrent session's write inside that window (`GATE_SPEC.md:200-210`). So a
`TOUCH_VIOLATION` must name the paths and say *"changed during the phase window — by the
agent, or by a concurrent writer"*. It must never claim authorship. The only complete
mitigation remains one writer per tree.

---

## 5. `tripwire` — semantics

**A tripwire is a plan-wide invariant, declared on the phase that first makes it
checkable, and re-evaluated after every subsequent phase.**

The failure it exists to catch is phase 7 silently breaking what phase 2 established. A
check scoped to its own phase cannot see that. The sweep harness already has this shape:
`§2(b)`'s "no pair that was analyzable at baseline may become not-analyzable" is precisely
a plan-wide invariant re-evaluated every iteration (`:1463-1469`), and `GATE_SPEC.md:88-95`
says in terms that removing it makes the gate gameable by breakage.

Rules:

  1. Exit 0 = holds. Non-zero = **halt the entire plan**, revert the current phase, status
     **`TRIPWIRE`**. Not just the phase: a violated invariant means the tree state is no
     longer trusted, so continuing would measure against an unknown baseline.
  2. **A tripwire must pass at the moment it is declared**, or the plan halts immediately
     as `TRIPWIRE_BORN_RED`. You cannot declare an invariant that is already violated —
     that is a tripwire that can only ever fire on its own falsity.
  3. It is re-run after every phase from its declaring phase onward, in declaration order,
     and its stdout/stderr are written durably every time (§6.3), not only on failure.
  4. **Tripwires must be cheap.** Cost is O(tripwires x phases). The runner logs each
     tripwire's wall time and warns above a threshold; an expensive tripwire is a design
     smell, not something to silently absorb.
  5. A failing tripwire is never resolved by a later phase. It always stops.

Not covered, stated so nobody reads more into it: a tripwire catches invariants somebody
thought to declare. Nothing catches the one nobody wrote. See §7.6.

---

## 6. Making the halts tolerable

Stripping the count gate turns four fall-through branches into halts
(`:1323-1324`, `:1336-1337`, `:1353-1354`, `:1374-1375` — each currently reads *"falling
through to the count gate"*), and §2-§5 above add more. A runner that halts constantly is
one you babysit, which defeats the point.

The reframe: **the count gate was never a verifier, it was a fallback** — a weaker signal
that let the night continue when proper measurement was impossible. A generic runner has
no weaker signal, so the goal is not to avoid halting. It is to make halting **cheap**.

### 6.1 Preflight the whole plan before executing any phase

Most halts are predictable before a single token is spent. Run, at plan load:

  - every phase parses; all required fields present
  - every `verify`, `enter` and `tripwire` command's **program resolves on PATH**, and —
    when that program is an interpreter (`node`, `python3`, `bash`, …) — its **script
    argument is on disk**.

    Narrowed during implementation, and the example plan is what caught it: a blanket
    *"every path-looking argument must exist"* rule breaks `enter: test -f <path>`, whose
    entire job is to ask whether a path is there. It turned a legitimately false predicate
    into a bogus "missing dependency" halt — the right outcome reported for the wrong
    reason, which is worse than no check at all. Only a script an interpreter is about to
    **run** is a real dependency.
  - every `touches` glob satisfies §4a, and none names the runner's own code (§4b)
  - every `enter` predicate, in order
  - every `verify` **at HEAD** — which classifies each phase up front:
      - `red: fails` and verify already **passes** at HEAD → the phase's premise is already
        false. That is `RESOLVED_UPSTREAM`, not a halt: report it and skip the phase.
        (`ITERATION_PROMPT.md:124-127` — an item that resolved itself is a success.)
      - `red: fails` and verify **fails with the marker** at HEAD → executable, green light.
      - `red: none` and verify **fails** at HEAD → the invariant is already broken; halt now.
  - every declared tripwire passes at its declaration point (§5.2)

This is `run-sweep.sh:1003-1028` — fail in under a second, before the lock, the port, the
tree or the tag — applied to the whole plan instead of one runner's externals. Output is a
plan report: *"7 phases executable, phase 3 halts on an unparseable verify, phase 5's
premise is already resolved."* **The human fixes the plan once, up front, instead of being
woken six times.** That single change converts most halts from mid-run interruptions into
a linting step.

### 6.2 A phase halt does not stop the plan

The sweep runner moves to the next queue item because items are independent. Plan phases
are ordered, but not every phase depends on every prior one. On a phase halt: mark it
`HALTED`, then continue with any phase whose `enter` still passes and whose `touches` does
not intersect the halted phase's. Report at the end: *"7 of 9 complete, 2 halted, here is
why."*

That is the difference between a night that produces nothing and a night that produces
7/9 plus a precise list of what needs a human. **The only halt that stops everything is a
tripwire** (§5.1), because that one means the tree is untrusted.

### 6.3 Every halt carries a resolvable artifact

A halt that says `PHASE_VACUOUS` is useless at 3am. A halt that says *"phase 4 verify
exited 1 without the assertion marker; here is stdout, stderr, the parsed phase block, the
diff, and the command to reproduce it"* is a five-minute fix over coffee.

So every halt writes, to a gitignored run directory, before anything destructive:

  - the exact `verify` command and its **stdout and stderr** — never `/dev/null`
  - the phase block **as parsed**, so a mis-parse is visible as a mis-parse
  - the agent's diff and envelope (`:1229-1237` already does this for
    `PARTIAL_UNVERIFIED`; generalize it to every halt)
  - a single copy-pasteable reproduction command

### 6.4 The honest cost

This trades throughput for trust, and on a badly-written plan it will halt a lot. That is
correct for a runner whose premise is that an unverifiable phase stops and waits. The
mitigation is that preflight makes plan quality visible *before* the run. If preflight is
clean, a mid-run halt means the agent did something unexpected — exactly when stopping is
what you want.

**The residual, stated rather than papered over:** preflight cannot catch a *weak*
`verify`. A phase whose verify is `true` fails the marker requirement, but one that
asserts something trivially true passes everything here. Nothing mechanical catches that.
It is closed by reading the verify command, the same way `GATE_SPEC.md:371-375` says
red/green proves discrimination but not that the test captures the defect rather than the
fix's shape.

---

## 7. What this runner CANNOT verify

Known up front, rather than discovered in the fifth session.

**7.1 Pure refactors.** `red: none` establishes "behavior unchanged **as far as this one
verify command looks**, and the diff is non-empty". It cannot distinguish a good refactor
from a bad one that happens to preserve the tested behavior. `DONE_UNCHANGED` is an honest
label for weakly verified, not for verified.

**7.2 New capability.** `red: absent` proves the capability exists now. It cannot prove it
did not exist before in another form, nor that the new code is the reason. Hence
`DONE_UNPROVEN_RED` as a distinct status.

**7.3 Design quality.** API shape, naming, whether the abstraction is right, readability.
No exit code expresses these, and no tripwire approximates them.

**7.4 Plausibility of values.** `GATE_SPEC.md:486-503`: Verizon's 52-week low rendered as
$10.60 against a $48.48 share price and a $51.68 high — an impossible range that neither
grader flagged, surfaced only by the accident of the value having moved that run. A
`verify` checks what it was told to check. A confidently wrong but *stable* value passes.
This gets **worse** generically, since there is no analyzer with learned defect patterns at
all — only the assertions someone wrote.

**7.5 Flaky verifies.** The sweep harness carries an elaborate INDETERMINATE apparatus
(`GATE_SPEC.md §5`) because captures are network-bound. A generic runner should apply the
same rule — retry the *verify*, never revert code on an unretried failure — but that only
rescues transient flakes. A genuinely non-deterministic verify produces random halts and
the runner cannot tell one from a regression.

**7.6 Undeclared cross-phase interaction.** Tripwires catch invariants somebody thought to
declare. The plan-runner form of `GATE_SPEC.md §11`.

**7.7 Whether the verify tests the goal or the implementation's shape.**
`GATE_SPEC.md:371-375`, unchanged: red/green proves the check discriminates between two
trees. An agent that writes the code first, then a check tuned to that code's signature,
passes red/green too. Closed by reading the check, not by the harness.

**7.8 Performance and resource regressions**, unless explicitly tripwired.

**7.9 Anything outside `touches`.** By construction — that boundary is enforced, so a
phase that breaks an untouched file is invisible unless a tripwire covers it.


---

## 8. Implementation

  - `parse.js`     — the plan parser (§1-§5). Rejects rather than defaults; `node parse.js <plan>`.
  - `preflight.js` — the plan preflight (§6.1); `node preflight.js <plan>`. Exit 0 fully
                     runnable · 1 runnable in part · 2 not runnable.
  - `selftest.js`  — every gate demonstrated **failing** on a case where it should, and
                     passing on one where it should. 22 gates, 44 assertions.
  - `examples/`    — `small.plan.md` (fully runnable), `unverifiable.plan.md` (every halt
                     class), `malformed.plan.md` (every parser rejection), plus the
                     `checks/` and `sandbox/` fixtures they run against.

Run artifacts land in `planrunner/runs/<id>/` and are gitignored: evidence a killed run
cannot clean up after itself, and never `/dev/null` (§6.3).

**Not built yet:** the executor. Preflight classifies phases; nothing runs an agent, does
the red swap, enforces `touches` post-hoc, or re-runs tripwires between phases. Those are
specified above and unimplemented.
