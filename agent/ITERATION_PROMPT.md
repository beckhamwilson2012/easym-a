# Iteration prompt — one queue item per run

You are running **headless** inside the unattended sweep harness. The harness picks one item from
`agent/QUEUE.md ## Open`, appends it to the end of this prompt, and feeds the whole thing to `claude -p`.
Your job is to fix that one item, correctly, and leave a written record. Both graders
(`tools/sweep-analyzer/analyze.js` and `tools/snapshot-diff.js`) re-run against your result afterward —
you are not the judge of your own work.

## HEADLESS OPERATION

- **No human will answer.** Never ask a question. Never pause for confirmation.
- Never end with an offer to do more ("let me know if…"). There is no one to tell.
- Complete the item, **or** mark it `BLOCKED` with a written reason, and stop.

## THE RUNNER VERIFIES — NOT YOU

Write the fix and report it. **Do NOT restart the server, re-capture, or verify your own fix.** The runner
does all of that between phases: it restarts `:3001` on your code and re-runs both graders after you finish.
Run `20260816-202617` diagnosed its item and wrote the fix, then **spent its last turns trying to restart
`:3001` to test it** — the `kill` was denied, it died there, and the finished fix was thrown away. Reading
the running app to *diagnose* is fine (`node -e "fetch('http://localhost:3001/api/…')…"`); restarting it,
killing a server process, or re-running the capture to *check your own fix* is not your job and will cost you
the turns you need to report.

## YOUR TURN BUDGET

You have a fixed number of turns, stated as **`TURN BUDGET`** at the very end of this prompt. You cannot see
the cap approaching — if you hit it mid-work you are cut off with no chance to report. So treat about **75% of
the budget as a hard deadline: the moment you have used roughly three-quarters of your turns, STOP whatever
you are doing and emit `STATUS: PARTIAL(<what you found> / <what remains>)`** with the root cause and any
value/concept findings so far — even if the fix is unwritten or unfinished. **Finishing the report beats
finishing the fix.** A completed fix with no STATUS block is nearly worthless: the runner never measured it
and can at best keep it labelled unverified. A reported `PARTIAL` is a real, measured result the next run
resumes from. Do not gamble the report against squeezing in one more probe or edit.

## SHELL SHAPES THAT WORK (read this before your first command)

You run headless, so an unlisted Bash command is **denied outright** — there is no human to approve it and
no second chance. Run `20260816-165919` lost 13 of its 61 turns (~17% of the budget) rediscovering these by
trial and error. Use these shapes and spend the turns on the item instead.

- **Scratch scripts go in the SCRATCH DIR, never `/tmp`.** The exact path is given as **`SCRATCH DIR:`** at
  the end of this prompt. `Write` the file there, then `node` it. A `cat > f <<'EOF'` heredoc is a shell
  write and is **denied**; the `Write` tool is auto-accepted, so Write-then-`node` always works and costs
  the same two turns.
  **Why not `/tmp`:** it is shared by every run and the names collide. Run `20260816-222441` wrote
  `/tmp/probe_irdm.js` and `/tmp/probe_gm.js`, both left over from run `20260816-202617`. The `Write` tool
  refuses to overwrite a file it has not read, so **both writes failed** — and the agent then ran the
  *previous run's* probe code believing it was its own, and reasoned from its output. The scratch dir is
  private to your run, created empty, and gitignored, so neither collision nor `git clean -fd` can touch it.
- **Grep your own scratch output with `Read`, not `grep`.** Pattern search is confined to the project
  directory. The scratch dir is inside it, so `grep` works there — but `grep … /tmp/out.md` is blocked
  even though `cat`/`Read` on it is fine.
- **Prefer `cd "<root>" && <cmd>` over `git -C <path> <cmd>`.** `cd` is allowed and compound commands are
  checked per segment, so `cd … && git log` works; `git -C … log` does **not** match the `git log` rule.
- **Probing the running app:** `node -e "fetch('http://localhost:3001/api/…')…"` always works. Plain
  `curl http://localhost:3001/…` works; common flag combinations are allowed but not every ordering is, so
  reach for `node -e` when a curl invocation is denied rather than retrying variants.
- **Env-prefixed commands are allowed only in front of `node`** (`RAW_DIR=… node …`, `PORT=… node …`).
  Nothing else takes an env prefix — a blanket rule would bypass the deny list.
- **Never retry a denied command more than once.** A denial is a *rule* mismatch, not a transient error;
  the identical command will be denied identically. Change the shape or change the approach.

## SCOPE

- Work **exactly one item**: the one named at the END of this prompt. Nothing else.
- Notice an adjacent defect? Do **not** fix it. Append it to `agent/QUEUE.md ## Discovered` with its four
  fields (pair · observed · expected · source) and move on.
- **Wide changes ARE permitted** — there is no blast-radius limit. Touch as many files as the correct fix
  needs. Breadth is fine; a parallel code path for one pair is not (see FIX).
- **OFF-LIMITS — never edit, never copy logic from:**
  - `.env`, secrets, deploy config
  - `tools/sweep-analyzer/analyze.js` · `tools/snapshot-diff.js` — the two graders
  - `tools/sweep-analyzer/capture.js` — generates the grading input
  - app-side fetch **retry** logic — shapes the render that becomes the grading input
  The first three grade you; the last two generate and shape what you are graded on. Changing any of them
  **moves your own grading baseline** and invalidates the run.

## STEP 0 — VERIFY THE REPRO STILL REPRODUCES

**Before diagnosing anything**, reproduce the item's stated defect using the pair, observed value, and
expected value in the item. Print the live value.

- **Still reproduces** (live value matches "observed") → proceed to diagnose.
- **Does NOT reproduce** (live value now matches "expected", or the defect condition no longer holds) →
  **STOP.** Mark the item `RESOLVED_UPSTREAM(<item that fixed it, if identifiable>)` and record the live
  values proving it in `agent/diagnosis/<slug>.md`. Make **NO** code change. Move on.
- **Live value matches NEITHER** observed nor expected → **STOP.** Mark `BLOCKED(repro-drifted)` and
  record all three values. Something changed that is not accounted for, and diagnosing against a stale
  premise wastes the iteration and risks a wrong fix.
- **The item's defect class SPLIT — part of it resolved, part did not** → **STOP.** Mark
  `PARTIAL(<what resolved> / <what remains>)`, record the live values for both halves in
  `agent/diagnosis/<slug>.md`, and make **NO** code change. This is the case where the item names a class
  (e.g. "GP/COGS-crossSurface", "32 pairs") but the repro line names only one member of it, and the two
  now disagree: the named metric is fixed while a sibling metric on the same pair, or the same metric on
  other pairs, still fails. Report the split; do **not** start diagnosing the remaining half.

**PARTIAL is a REPORT, not a failure.** It does not count against you and does not trip the run's
consecutive-fail breaker. The runner writes your `<what remains>` text back into the queue item and leaves
it OPEN, so the next iteration starts from what you established instead of rediscovering it.

**Why this exit exists — keep this in the file.** Item 1's class was `GP/COGS-crossSurface` while its repro
line named only gross profit. Commit `bcda19a` fixed the gross-profit half and not the cost-of-revenue
half. On run `20260816-165919` the agent proved GP correct at turn 39 — six minutes in — then had no legal
way to report "half of this is done", kept investigating for another 22 turns, and died on the turn cap at
61 with no verdict at all. Run `20260816-165953` repeated it exactly. Two nights and ~$9 produced zero
verdicts because this exit did not exist. **A true, partial answer reported early beats a complete answer
that never ships.**

**RATIONALE (keep this in the file so it survives future edits):** the queue is ordered upstream-first,
and items 1→4 and 2→3 share root causes. **Cascading resolution is the design goal, not a missing bug.**
An item that resolved itself is a **success** — do not look for something else to fix in order to produce
a change. A needless edit passes both graders (defect count does not rise, and the cells it touched moved
for a stated reason), so the graders **cannot** catch this. Step 0 is the only thing that can.

## DIAGNOSE BEFORE FIXING

- Trace the **real** code path end to end. Do not pattern-match from the queue text.
- Print **live values at each hop**, using the exact pair named in the item. Show the number changing (or
  failing to change) at each step from source data to rendered cell.
- State the root cause in **one sentence** and classify it:
  - **Pattern A** — a stale value blocking a working fallback
  - **Pattern B** — a null coerced to zero, producing a plausible wrong number
  - **Pattern C** — a safety check holding by accident
  - **New** — none of the above (describe it explicitly)
- Write the diagnosis to `agent/diagnosis/<slug>.md` (slug = the item's short name). Always write it —
  it is the durable record whether the item ends DONE, BLOCKED, or FAILED.
- If you **cannot produce live values** (no repro), mark `BLOCKED(no-repro)`, commit the diagnosis, and
  stop. **A guessed fix is worse than no fix** — it burns an iteration and returns BLOCKED anyway.

## FIX

- Reuse the **single-source-of-truth** helpers already in the codebase. **No parallel code paths** for one
  pair — do not special-case the named pair with its own branch.
- **Never fabricate.** Unavailable data is an honest blank — never zero, never a substituted proxy, never
  a "close enough" figure.
- **Distinguish zero from absent at every coercion site you touch.** `x || 0` is the defect, not the fix.
  Watch `?? 0` and `: 0` (ternary-to-zero) as well — a `|| 0` grep is a **floor, not a census**. Absent →
  blank/`null`; a real zero → `0`. They are different states and must render differently.

## RETRY

- **Two attempts maximum.**
- Attempt 2 is allowed **only if the root-cause diagnosis changed.** The same diagnosis retried is a
  **repeat, not a retry** — do not spend attempt 2 on it.
- Attempt 2 **may not touch more files** than attempt 1.
- After two attempts, park the item with written analysis, set `STATUS: FAILED(<reason>)`, and stop.

## TRAPS TO CHECK (before declaring DONE)

- **Unit scale** — millions vs thousands vs units
- **Period matching** — LTM vs FY vs quarterly
- **Basis mismatch** — GAAP vs non-GAAP
- **Null vs zero** coercion
- **Share-count** source and vintage
- **FX** — spot rate for the balance sheet, period-average for flows
- **Stale filing dates** rendered as current

## OUTPUT FORMAT

End your run with exactly this block, and nothing after it:

```
ITEM:         <the item you worked>
ROOT CAUSE:   <one sentence> + Pattern <A | B | C | New>
FILES:        <every file changed>
TARGET FIXED: <pair> — <old value> -> <new value> (source authority: <where the correct value comes from>)
STATUS:       DONE | RESOLVED_UPSTREAM(cause) | PARTIAL(<resolved> / <remains>) | BLOCKED(reason) | FAILED(reason)
```

The parenthetical is **parsed**, not decorative. For `PARTIAL` it is the only description of what is left,
and it is written verbatim into the queue item — so state the remaining half in terms the next iteration
can act on (metric, pair, surface), not "the rest of the class".

**Do NOT self-report verification as passed.** The runner re-runs both graders independently. Your
assessment of your own work is not evidence and is **not read** — only the block above and your committed
diagnosis/diff are.

---

ITEM: <the runner appends the specific queue item here>
