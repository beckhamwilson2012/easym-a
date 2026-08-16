# Sweep queue

<!-- Each item requires four fields: pair · observed · expected · source. An item without all
     four is not actionable and must not be moved out of Discovered. Values below are pulled from the
     analyzer output (docs/sweep-v2/RUN-findings.md per-pair checks + GATE-2A/2B by-root aggregate) — not
     placeholders, not fabricated. Counts are the GATE-2A by-root totals. -->

## Open

<!-- ORDER IS UPSTREAM-FIRST. Two shared-cause chains run through these items; fixing a downstream symptom
     while its cause is live creates the parallel code path the charter forbids:
       null/blank target GROSS PROFIT : item 1 (§7 LTM GP blank) is upstream of item 4 (§8 combined GM skips it)
       null target/combined DEBT      : item 2 (target debt dropped) is upstream of item 3 (false EBITDA message)
     Do item 1 before 4, and item 2 before 3. -->

- [ ] **1. Leg-availability / LTM gross-profit blanking** — 32 pairs (GATE-2A root: GP/COGS-crossSurface).  <!-- REOPENED: run 20260815-150838 committed UNVERIFIED work. No agent verdict (envelope is_error:true / error_max_turns, no status token); the :3001 server was never restarted so the after-capture graded stale code; and the repro pair GOOGL/AMZN was never captured (the baseline took the alphabetically-first 5 pairs), so the 8->8 "clear" was measured on decks that cannot contain this defect. bcda19a is NOT reverted — the work may be right, it was simply never measured. -->
  - pair: GOOGL/AMZN · observed: target (AMZN) gross profit renders "—" on §7 (LTM P&L) while §2 shows
    AMZN gross margin **50.3%** [present] and §8 shows target GP **$415,634M** [present] — analyzer #18
    `GP ASYMMETRY [§2gm=50.3%[VALUE] · §7=—[DASH] · §8tgt=$415,634[VALUE]]` · expected: §7 renders AMZN's
    LTM gross profit — the annual GP is present and the only thing missing is the three-leg LTM split, so a
    working annual fallback should fill it instead of blanking · source: RUN-findings.md GOOGL/AMZN #18 +
    #17 ("three-leg LTM split not exposed on /quote → leg-level N/A"); GATE-2B.1 splits the 32 into BUG5
    (FMP-wiring) + **BUG6 (leg-availability: annual GP present, LTM GP blank)** — BUG6 needs its own LTM-leg fix.

- [ ] **2. Target debt dropped via null preferred path** — 6 pairs (GATE-2A root: debt-dropped). Corrupts EV/leverage.
  - pair: RKLB/IRDM · observed: `/quote?symbol=IRDM` debt=**null** → deal-model preferred path
    `companyBDebt=null`, coerced to **$0** in the EV/net-debt sum; §2 shows IRDM Net Debt/(Cash) = **(184)**
    [net cash $184M], EV **$5,059M**, EV/EBITDA **12.0x** — all omit the debt · expected: §16 Data
    Verification shows Total Debt **$1.8B** (EDGAR★ + FMP, ✓ verified); true net debt ≈ **+$1,616M**, true EV
    ≈ **$6,859M**, true EV/EBITDA ≈ **16.2x** · source: `/quote` IRDM debt=null vs §16 $1.8B (EDGAR★+FMP) —
    RUN-findings.md GT-1 / check #20; `dealCalc.js:183` `combinedDebt = (companyADebt!=null && companyBDebt!=null) ? … : null`.
    Other instances: TM/GM (`/quote` debt=null, §16 $130.30B), CART/DASH (`/quote` debt=null, §16 $3.30B).

- [ ] **3. False "Combined EBITDA is non-positive"** — 12 pairs (GATE-2A root: D-ebitdaMsg). Downstream of item 2.
  - pair: NET/DDOG · observed: deck renders "Combined EBITDA is non-positive" while combined EBITDA is
    actually **POSITIVE $57M** (§10: A $-17M + B $5M + synY1 $70M = $58M mine, $57M rendered); the message
    fires on a null `combinedDebt`, NOT on EBITDA sign · expected: no non-positive message when combined
    EBITDA is positive — the message must reflect the actual EBITDA sign · source: `SectionDashboard.js:260`
    `note = results.debtEBITDA === 'N/A' ? 'Combined EBITDA is non-positive' : null` (does not branch on
    EBITDA); `dealCalc.js:184` `debtEBITDA = (combinedEBITDA>0 && combinedDebt!=null) ? … : null` → 'N/A'
    whenever `combinedDebt` is null; `dealCalc.js:183` combinedDebt null if EITHER debt null. RUN-findings.md
    NET/DDOG #23; GATE-2B.2. NOTE: shares the null-combinedDebt trigger with item 2, but the message logic is
    independently wrong (fires on ANY null combinedDebt, incl. acquirer-null) — fix the message, not just the data.

- [ ] **4. Combined gross margin understated via null target GP** — 6 pairs (GATE-2A root: B-nullInSum). Downstream of item 1.
  - pair: AAPL/VZ · observed: §8 combined gross margin renders **36.2%** — it skips the target (VZ) gross
    profit (null) in the numerator but keeps VZ's revenue in the denominator → understated · expected: §8
    combined GM ≈ **46.6%** (include the target GP, or drop target revenue symmetrically — never sum a null
    GP as zero against a live revenue) · source: RUN-findings.md AAPL/VZ #18
    `§8 combined GM 36.2% skips target GP (null) but keeps target revenue → understated; correct ≈ 46.6%`;
    Pattern-B null-in-sum. If item 1 populates target GP on the §7/LTM path, this numerator stops being null.

- [ ] **5. KO/NSRGY comparables degrade to CNBC-only (foreign-issuer gap)** — 1 pair (surfaced during 429 re-capture).
  - pair: KO/NSRGY · observed: comparables source = **CNBC** (EDGAR absent); peer screen reports
    "No comparable public peers identified"; oracle NSRGY **sic=undefined** (Nestlé S.A., foreign issuer, no
    SEC 10-K) · expected: EDGAR-sourced comps, OR explicit foreign-issuer handling (peer resolution not
    gated solely on a domestic SIC) · source: peer-screen SIC dependency; capture docs/sweep-v2/captures/
    KO_NSRGY.json comparables section; oracle NSRGY sic=undefined. Deterministic (reproduces every capture).

## Closed

## Discovered

- loadA build failure — THREE pairs failed identically: **KO/NSRGY, V/PYPL, WBD/PARA** (`ok=false,
  stage=loadA, sections=0`). RESOLVED: root cause was a transient **429 rate-limit BURST** hitting three
  CONSECUTIVE captures at the tail of the sweep (by timestamp V/PYPL → WBD/PARA → KO/NSRGY; NEE/AEP just
  before also 429'd but survived; CRH/ACSA just after recovered). NOT company-specific. Re-captured
  individually, spaced: **V/PYPL → CLEAN**, **WBD/PARA → CLEAN**, **KO/NSRGY → builds ok/17 sections but
  DIRTY** (now Open item 5). `capture.js` now bails fast on a loadA-critical 429 and retries 3× with
  backoff (`reason=RATE_LIMITED`); GATE_SPEC §5 adds INDETERMINATE so an unattended 429 never reverts good
  code. loadA-429 CLOSED.

- App-side: **no retry on 429 in the ticker fetch.** User-facing — a real user loading a ticker during a
  rate limit gets a **silent indefinite hang with no error surfaced** (the app swallows the 429, no
  pageError, and never renders " loaded"). Worked around in `capture.js` only. **MINE to fix, supervised.**
  Explicitly OUT OF AGENT SCOPE: it feeds the render → captures → both graders, so an agent changing it
  would move its own grading baseline. (pair: KO/NSRGY,V/PYPL,WBD/PARA · observed: 429 consoleError, no
  app retry, no " loaded" · expected: app retries/backs off the load fetch on 429 and surfaces an error ·
  source: client ticker-load fetch path)

- **Rate-limit storm on a full 50-pair baseline.** Surfaced in calibration run 1 (20260815-135915): the
  50-pair sweep hammered the APIs hard enough that a chunk of pairs came back DIRTY, and capture.js's
  dirty-pair **retry pass itself got 429'd and gave up** — `loadTicker … rate-limited, gave up after 3
  attempts` on F/RIVN, GME/BBWI, GSK/NUVL, HD/FND. Baseline ran >52 min without an iteration starting. This
  reproduces the known rate-limit problem on a REAL full sweep, and **must be fixed before any unattended
  overnight run — it would eat the whole freeze window.** (observed: retry pass 429s and gives up on a
  50-pair baseline · expected: a full baseline completes within a bounded time without rate-limit failures ·
  source: capture.js retry pass + the app/upstream rate limiter)

- **~35 Chrome processes alive during a long capture.** Observed during run 1's retry pass — far more than
  the single reused browser capture.js should hold, suggesting pages accumulate across retries instead of
  being closed. Separate from the 429s, and gets worse the longer a run goes (a 5-hour overnight run would
  accumulate many). (observed: ~35 Chrome procs mid-capture · expected: one reused browser, pages closed per
  pair · source: capture.js browser/page lifecycle)

- **Runner should emit MAX_ITER and BUDGET_USD into loop.log at RUN start.** The dashboard can't show the
  item-count denominator, the budget cap, or a correct ETA because the runner never reports its actual run
  params (its loop.log projected-end assumes the full queue). This is the real fix that unblocks the ETA and
  the "of N" / "Cap $N" fields — right now they honestly render "—". (observed: dashboard shows "—" for
  cap/count/ETA during a run · expected: runner logs MAX_ITER + BUDGET_USD so the dashboard reads them ·
  source: run-sweep.sh RUN-start logging)
