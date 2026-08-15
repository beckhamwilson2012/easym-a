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
  - RESOLUTION (diagnosed + mitigated): root cause = a transient **429 rate-limit BURST** hitting three
    CONSECUTIVE captures at the tail of the sweep (by timestamp V/PYPL → WBD/PARA → KO/NSRGY; NEE/AEP just
    before also 429'd but survived; CRH/ACSA just after recovered). NOT company-specific. Re-captured
    individually, spaced: **V/PYPL → CLEAN** (ok, 17 sections, EDGAR-sourced), **WBD/PARA → CLEAN**,
    **KO/NSRGY → builds ok/17 sections but DIRTY** (foreign-issuer item below). `capture.js` now bails
    fast on a loadA-critical 429 and retries 3× with exponential backoff, recording `reason=RATE_LIMITED`;
    GATE_SPEC §5 adds the INDETERMINATE state so an unattended 429 never reverts good code. loadA-429 CLOSED.

- App does not retry on a 429 during ticker load — the real app-side ROOT. When the ticker-A fetch 429s
  the app swallows it (no pageError) and never renders " loaded", so the build stalls the full 80s.
  `capture.js` now works around it (bail + retry), but the durable fix is app-side retry/backoff on the
  load fetch. NOT fixed here — application code is out of scope. (pair: KO/NSRGY,V/PYPL,WBD/PARA ·
  observed: 429 consoleError, no app retry, no " loaded" · expected: app retries the load fetch on 429 ·
  source: client ticker-load fetch path)

- KO/NSRGY comparables degrade to CNBC-only (DIRTY) — foreign-issuer gap, distinct from the loadA 429.
  NSRGY (Nestlé S.A.) returns no SIC code (foreign issuer, no SEC 10-K), so the peer screen reports "No
  comparable public peers identified" and the comparables source falls back from EDGAR to CNBC.
  Deterministic (reproduces every capture). loadA is fixed; this remains a data-coverage limitation for
  foreign targets. (pair: KO/NSRGY · observed: comps source=CNBC, EDGAR absent, oracle NSRGY sic=undefined ·
  expected: EDGAR-sourced comps or explicit foreign-issuer handling · source: peer screen SIC dependency)
