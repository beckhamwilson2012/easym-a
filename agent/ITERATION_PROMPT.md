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
STATUS:       DONE | BLOCKED(<reason>) | FAILED(<reason>)
```

**Do NOT self-report verification as passed.** The runner re-runs both graders independently. Your
assessment of your own work is not evidence and is **not read** — only the block above and your committed
diagnosis/diff are.

---

ITEM: <the runner appends the specific queue item here>
