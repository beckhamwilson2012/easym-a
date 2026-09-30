# Item 6 — A bad verdict destroys the agent's code before anything records it

Run 20260929-193005. **Status: BLOCKED(out-of-agent-scope).** No code change was made.

## Repro (STEP 0), checked against the live tree at bce277d
The queue text's line numbers are out of date. The defect is still there:

- `agent/run-sweep.sh:766-790` `revert_to`: backs up `$DECISIONS`, `$CALIB` and `agent/diagnosis/` into
  `$RUN_DIR`, then runs `gitr reset --hard "$1"` (`:782`) and `gitr clean -fd` (`:783`). It writes **no
  diff of the agent's work** anywhere.
- The only diff capture is still the PARTIAL_UNVERIFIED cut-off branch:
  `:1251` `gitr diff HEAD > "$RUN_DIR/partial-iter$CUR_ITER.diff"`.
- `revert_to "$CHECKPOINT"` runs before any record of the code on every bad-verdict path: TIMEOUT `:1198`,
  FAILED `:1213/1215`, NO_VERDICT `:1276`, PARTIAL `:1303`, BUILD_BROKEN `:1320/1383`,
  TEST_TAMPERED `:1336`, TEST_FAILED `:1352`, TEST_VACUOUS `:1366/1391`, INDETERMINATE
  `:1407/1444/1453/1495/1548/1553`, REGRESSION `:1433/1488/1520/1558`, NO_CHANGE `:1591`.

## Root cause
`revert_to` discards the working tree without first saving the agent's diff outside the revert path.
The tree is the only copy of that work, so any bad verdict (including a wrong one, see f2e8034 / 153300)
loses it for good. Classification: **New**, a harness ordering and ownership defect rather than an A/B/C
data pattern.

## Why BLOCKED
The item says: "OUT OF AGENT SCOPE — MINE to fix, supervised". The fix belongs in `agent/run-sweep.sh`,
the runner that grades this iteration. CLAUDE.md lists `agent/` as sweep harness that must not be edited by
the loop. Editing it here would change my own grading pipeline in the same run.

## Note for the supervised fix (a finding, not applied)
Copying `:1251` into `revert_to` as it stands is not enough. `git diff HEAD` leaves out **untracked new
files**, and those are exactly what `clean -fd` deletes: the 20260816 debt fix created
`server/data/debtConcepts.js` (see the `:1238` comment). Something like `git add -N` on the agent-touched
paths before the diff, or `git stash create` / a tarball of the untracked files, is needed so new files
are saved too. It also needs to go inside `revert_to` itself, before `:782`, so every caller gets it
without per-branch edits.
