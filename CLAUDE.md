# CLAUDE.md

Standing rules, read at session start. The `.claude/settings.json` deny list is **live even under `--dangerously-skip-permissions`** (it refused `git branch` on 2026-08-17); everything else here is on me.

## File ownership

**Sweep harness — it grades the app. Never edit it to make a grade move.**
- `agent/` — `run-sweep.sh` (runner), `QUEUE.md` (work order), `GATE_SPEC.md` (grading contract),
  `ITERATION_PROMPT.md`, `CHARTER.md`, `DECISIONS.md`, `calibration.csv` (ledger), `dashboard/`, `runs/`.
- `tools/sweep-analyzer/analyze.js` and `tools/snapshot-diff.js` are the two **graders**; `capture.js`
  generates their input; `tools/noop-ab/` is the no-op A/B harness; findings live in `docs/sweep-v2/`.
  Editing a grader, `capture.js`, or app-side fetch/retry logic moves the baseline a change is scored against.

**App code** — `server.js`, `server/` (services, data, harness), `src/`, `fmpEngine.js`, `peerOverrides.js`,
`scripts/*.mjs` (diagnostics). `build/` is generated and gitignored but **`server.js` serves it via
`express.static`** — a `src/` edit is invisible to :3001 and to every capture until `npm run build` runs.

**Being worked right now by a concurrent session: `server/services/*` and `src/App.js`.** Assume they are
dirty and moving. Do not edit them without asking first, and never stage them incidentally.

## Standing guardrails

- Never `git add -A` or `git add .`. Stage explicit paths, one at a time.
- `git status` before every commit. If a path is not mine, it does not go in the commit.
- Never print `.env` contents or any key — not to stdout, not into a scratch file, not into a commit.
- Never run `UNDO.txt` or any clause of it: the first (`git checkout <base>`) is safe alone, the rest (`branch -D`, `tag -d`) is not — it has already destroyed a branch and its restore tag.
- Never launch a sweep (`agent/run-sweep.sh`) unless asked.
- Scratch files go in the session scratchpad, never `/tmp` — names collide and stale probes get re-run as new.

## Working method

- Diagnosis before implementation. Trace the real code path to `file:line` and print **live values at each
  hop**, source data to rendered cell. Never reason from symptoms or from the queue text.
- No-op proof: unaffected cases stay byte-identical via `tools/noop-ab/ab.sh` (manual entry does no network
  fetch, so identical inputs give identical decks). A frozen live capture proves nothing — data drifts.
- `docs/DEFERRED.md` is a LIVE register, not an archive: check it before filing a `## Discovered` entry, and
  file in QUEUE.md's `pair · observed · expected · source` shape (D18 was rediscovered from scratch once).
- Never fabricate a number. Absent → `null`, which renders as a dash. A genuine `0` and an absent value are
  different states and must render differently. `x || 0` is the defect, not the fix — `?? 0` and `: 0` are
  the same defect, so a `|| 0` grep is a floor, not a census.
- Reuse the single-source-of-truth helper. No parallel code path for one pair or one ticker.
- Making a value nullable is not safe alone: guard every sum and ratio consuming it in the **same commit** — JS coerces `null` to 0 in addition, turning a conspicuous zero into a plausible number.

## Named failure patterns

- **A** — a stale-but-present value blocking a working fallback. A real value is there; it is the wrong one.
- **B** — a null coerced to zero inside a sum or ratio, producing a plausible wrong number. A fabrication
  that survives inspection is worse than a visible zero.
- **C** — a safety property holding by accident rather than by design: `=== 0` used as an absence check, or
  `??` whose right operand can never itself be null, so the guard is unconditional.

## Hard-won lessons

- **A comment only humans read is not a control.** `queue_next()` takes the topmost `- [ ]` and reads
  nothing else — not the labels, not the prose, not the ordering comment above it. Anything that must happen
  in an order has to be expressed as **position**, or it does not happen.
- **Check flag identity, not magnitude.** The gate compares the *set* of analyzable pairs, not its count;
  `f2e8034`'s evidence was flag-level — 312 flags, 6 removed, 0 added, the rest byte-identical.
- **A correct fix can raise the defect count.** Run `20260817-153300` scored REGRESSION and was reverted;
  `f2e8034` later showed that flag was a `tileVal` phantom and the same fix re-gates 1.50 → 1.50. The score
  can itself be wrong — read *which* flags moved before believing it, and keep the diff recoverable.
- **A test that changes nothing looks identical to a passing test if you only read the exit code.**
  `analyze.js` exits 0 whether or not it finds defects; non-zero means it crashed. Run `20260815-150838` read
  an unmeasured no-op as "8→8 clear": server never restarted onto the new code, repro pair never captured.
- **An undeclared dependency is one you will lose.** `puppeteer-core` ran the whole capture harness while
  undeclared in `package.json`, until an unrelated `npm install` pruned it (`f8c5343`).
- **A capture failure is not a code failure.** A 429 during capture is a property of the network that hour;
  scoring it as a regression deletes good work and blames the change (GATE_SPEC §5, INDETERMINATE).
- **A clean gate means "no known pattern broke and nothing moved"**, never "the output is correct" —
  neither grader asks whether a number is plausible.

## Response format

- Report what was **verified**, with real values: pair, `file:line`, before → after, and where the correct
  value comes from. Not adjectives, not "should now work".
- State plainly what was measured, what was not, and what I chose not to do.
- No "remaining work", "next steps", or handoff sections unless I ask for them.

## Bug-list / sweep-plan format

Emit **exactly** this shape — the dashboard's "Paste plan" box parses it deterministically (no LLM), and a regex extractor that cannot fabricate is the point.

```
## Next up
- [ ] KO/NSRGY — comps sourced from CNBC
      got: comps table shows CNBC prices
      want: EDGAR-sourced
      why: peer screen SIC dependency
```

- `- [ ]` starts an item, `- [x]` marks one done. Title line is `PAIR — short description`, PAIR being two
  tickers with a slash.
- `got:` (observed wrong behavior) / `want:` (expected) / `why:` (suspected source) are **indented** under
  the title, one per line. Values are captured **to end of line** — they may contain commas, slashes and
  parentheses, so never use `·` or any mid-line separator as a delimiter (a greedy split bit this once).
- `## Heading` sets the default status beneath it: `## Next up` → queued, `## Blocked on you` → blocked,
  `## Parked` → skipped, `## Done` → done.
- **An item missing any of got/want/why is BLOCKED**, and a pair alone is not a repro — it returns BLOCKED
  after burning ~22 minutes of capture. Never invent a got/want/why to make an item look complete.
