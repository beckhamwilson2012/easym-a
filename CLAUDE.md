# CLAUDE.md

## Bug-list / sweep-plan format

When you write a bug list for the sweep harness, emit **exactly** this shape so every list is identical
and machine-parseable. The dashboard's "Paste plan" box parses it **deterministically (no LLM)** — a
regex extractor cannot fabricate, and that guarantee is the point.

```
## Next up
- [ ] KO/NSRGY — comps sourced from CNBC
      got: comps table shows CNBC prices
      want: EDGAR-sourced
      why: peer screen SIC dependency
```

Rules:

- `- [ ]` starts an item; `- [x]` marks one already **done**.
- The title line is `PAIR — short description`. **PAIR** is two tickers with a slash (e.g. `KO/NSRGY`).
- `got:` / `want:` / `why:` are **indented** under the title, one per line:
  - `got:` — the observed (wrong) behavior
  - `want:` — the expected/correct behavior
  - `why:` — the suspected source / root cause
- Values may contain commas, slashes, parentheses. They are captured to **end of line** — do **not** use
  `·` or any mid-line separator as a delimiter (a greedy split bit this once).
- `## Heading` lines set the **default status** for items beneath them:
  - `## Next up` → queued
  - `## Blocked on you` → blocked
  - `## Parked` → skipped
  - `## Done` → done
- An item **missing any of got/want/why is BLOCKED** — it would return BLOCKED from the harness and burn
  ~22 minutes of capture before any agent work. **A pair with no detail lines is BLOCKED — a pair alone
  is not a repro.** Never invent a got/want/why to make an item look complete.
