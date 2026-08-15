# Sweep queue

<!-- Each item requires four fields: pair · observed · expected · source. An item without all
     four is not actionable and must not be moved out of Discovered. -->

## Open

- [ ]

## Closed

## Discovered

- loadA build failure — THREE pairs fail identically: **KO/NSRGY, V/PYPL, WBD/PARA**. All show
  `ok=false, stage=loadA, sections=0` and run only check #1 (skip checks 2–24), so each is
  NOT-ANALYZABLE — a distinct state from CLEAN (see GATE_SPEC.md §2/§4). Same stage across three pairs
  is treated as **ONE suspected shared root cause, not three independent flaky heavy pairs**. The gate
  tolerates them as already-not-analyzable-at-baseline, but that means ~69 checks (3 × 23) contribute
  zero defects and read as clean forever — recovering them is the largest remaining coverage gain.
  Diagnosis is a separate READ-ONLY pass; the fix is a separate approval. Do not "fix" it in a scaffold
  or housekeeping pass.
  - pair: KO/NSRGY · observed: checks_run=1, stage=loadA, build wait 80000ms exceeded, sections=0 ·
    expected: checks_run=24 · source: tools/sweep-analyzer/capture.js loadA wait
  - pair: V/PYPL · observed: checks_run=1, stage=loadA, sections=0 ·
    expected: checks_run=24 · source: tools/sweep-analyzer/capture.js loadA wait
  - pair: WBD/PARA · observed: checks_run=1, stage=loadA, sections=0 ·
    expected: checks_run=24 · source: tools/sweep-analyzer/capture.js loadA wait
