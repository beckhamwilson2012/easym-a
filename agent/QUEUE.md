# Sweep queue

<!-- Each item requires four fields: pair · observed · expected · source. An item without all
     four is not actionable and must not be moved out of Discovered. Values below are pulled from the
     analyzer output (docs/sweep-v2/RUN-findings.md per-pair checks + GATE-2A/2B by-root aggregate) — not
     placeholders, not fabricated. Counts are the GATE-2A by-root totals. -->

## Open

<!-- ORDER IS UPSTREAM-FIRST. Two shared-cause chains run through these items; fixing a downstream symptom
     while its cause is live creates the parallel code path the charter forbids:
       null/blank target GROSS PROFIT : item 1 (§7 LTM GP blank) is upstream of item 4 (§8 combined GM skips it)
       null target/combined DEBT      : 2a (EDGAR misses the debt) → 2b (null rendered as $0) → item 3 (false
                                        EBITDA message). 2a is the DATA gap; 2b is the COERCION that lies
                                        about it; item 3 is the message that fires off the resulting null.
     Do item 1 before 4, and 2a before 2b before 3.
     2a and 2b were ONE item until 2026-08-17. They are separate defects, not one: fixing 2a populates debt
     for IRDM/TM/CART and 2b's `|| 0` never fires for them — but it still fires for ANY filer whose debt is
     genuinely unavailable, turning "unknown" into "$0 repaid". Neither fix removes the other.
     2c and 2d were added 2026-08-17 and are FILED after 2a/2b, but neither is downstream of them — file
     position is not work order here:
       2c is the debt-concept VOCABULARY that 2a's fix (67574d7) widened in only one of the three places
          that keep a copy of it. It is upstream of every debt consumer, /quote and SS16 alike.
       2d is the SAME null-is-not-zero defect as 2b, one layer earlier: 2b coerces one null at the render
          boundary, 2d ships zeros for the whole payload before any render runs.
     Do 2c before any further debt-concept work, and 2d before 2b — 2b's `|| 0` can never fire on a value
     the stub has already turned into a real 0, so fixing 2b alone leaves the stub publishing zeros. -->

- [x] **1. Leg-availability / LTM gross-profit blanking** — 32 pairs (GATE-2A root: GP/COGS-crossSurface).  <!-- REOPENED: run 20260815-150838 committed UNVERIFIED work. No agent verdict (envelope is_error:true / error_max_turns, no status token); the :3001 server was never restarted so the after-capture graded stale code; and the repro pair GOOGL/AMZN was never captured (the baseline took the alphabetically-first 5 pairs), so the 8->8 "clear" was measured on decks that cannot contain this defect. bcda19a is NOT reverted — the work may be right, it was simply never measured. -->
  - pair: GOOGL/AMZN · observed: §7 LTM rendered **—** for both Cost of Revenue and Gross Profit while
    `/api/pnl` served both values (`ltm.costOfRevenue = 381870`) · expected: §7 LTM renders the sourced
    LTM cost of revenue and gross profit · source: hardcoded `costOfRevenue: null` in
    `src/components/deck/sections/SectionStandalonePL.js`, plus a stale `build/` bundle that hid the fix.
    <!-- DONE 2026-08-16 — verified on screen after the frontend rebuild. §7 now renders, in the LTM
         column, Cost of Revenue ($381,870) and Gross Profit $393,810 / 50.8%. BOTH halves of the defect
         are resolved. The gross-profit half came back RESOLVED_UPSTREAM from bcda19a. The client-side
         half was fixed in that same commit — `costOfRevenue: null` became `costOfRevenue:
         L.costOfRevenue ?? null` in SectionStandalonePL.js — but only became VISIBLE once the build step
         landed: server.js serves the build/ bundle via express.static, so until the runner ran
         `npm run build` no src/ edit could reach a capture (build/ was dated Aug 14 18:34 against a
         bcda19a landing Aug 15 15:33). That invisibility is what sent runs 165919 and 165953 into two
         61-turn NO_VERDICT deaths against work that was already correct.
         An earlier version of this repro carried an expected cost-of-revenue figure read off the FY2026E
         consensus column, not the LTM column. It is deleted rather than corrected in place: §8's target
         column is not LTM, and no future agent should chase a number taken from it.
         COUNT: the title's "32 pairs" is stale. The last analyzable baseline (run 20260816-165919,
         flags-50664.json) carries 15 A-crossSurface flags across 14 pairs, of which 9 are cost of revenue
         and 5 gross profit. That baseline was itself degraded — 33 of 50 decks failed to build on 429s
         from two concurrent sweeps — so re-measure before trusting either number. -->
    <!-- was: "target (AMZN) gross profit renders — on §7 while §2 shows gross margin 50.3% and §8 shows
         target GP $415,634M — analyzer #18 GP ASYMMETRY". Retired 2026-08-16: no longer reproduces. -->

- [x] **2a. EDGAR concept-family gap — TOTAL-debt concepts outside the LongTermDebt family** — 6 pairs
      (GATE-2A root: debt-dropped). Upstream of 2b. This is the DATA gap: the debt never arrives.
      **FIXED by 67574d7** (2026-08-17) — widened the EDGAR debt-concept vocabulary at steps 4 and 5 of the
      resolution chain in `server.js`. Previously-null debts now resolve: IRDM **$1,749M**, DASH
      **$2,727M**, DDOG **$986M**, GME **$4,166M**. No-op proof PASSED — AAPL 82,300 / MSFT 40,294 /
      AMZN 132,995 / KO 39,065 / GOOGL 100,164 byte-identical against the pre-patch captures, so the
      widened vocabulary changed nothing for filers that already resolved.
      TM/GM is NOT in that confirmed set: 67574d7's evidence does not cover it. Treat that instance as
      UNVERIFIED, not fixed.
  - pair: RKLB/IRDM · observed: `/quote?symbol=IRDM` returned `"debt": null` with
    `"dataSource":"sec_edgar"`, `"cash":184`, `"bsAsOf":"2026-06-30"` — live value captured by run
    20260816-202617 at turn 19 · expected: `debt` populated ≈ **$1.8B**, per §16 Data Verification
    (EDGAR★ + FMP, ✓ verified); 67574d7 resolves it to **$1,749M** · source: `server.js:699` — the
    resolution chain was
    `bsPick(['LongTermDebt']) ?? ltdSiblingSum ?? bsPick(['LongTermDebtAndCapitalLeaseObligations']) ?? convertTotal`,
    and none of those four branches covered a TOTAL-debt concept tagged outside the LongTermDebt family.
    IRDM's borrowings are a term loan; a revolver draw failed the same way. Run 20260816-202617 diagnosed
    this and wrote a fifth branch ("Stage 7A-4, non-LongTermDebt TOTAL-debt concepts") at its turn 75,
    which was reverted when the run died at the turn cap — see `agent/runs/20260816-202617/`.
    Other instances: TM/GM (`/quote` debt=null, §16 $130.30B — basis unclassified, see below),
    CART/DASH (`/quote` debt=null, expected **$2,727M** — corrected 2026-08-17, see below).

    LEASE BASIS — read before "correcting" any expected in this item. **The deal model excludes operating
    leases by convention**, so every `expected` debt figure here is stated on a **lease-EXCLUSIVE** basis
    (borrowings only). SS16/§16 figures are NOT automatically on that basis. Do not restore a figure from
    §16 without first establishing which basis it is on.
    - **CART/DASH — lease-INCLUSIVE → CORRECTED 2026-08-17: $3.30B → $2,727M.** The $3.30B came from
      SS16 on a lease-inclusive basis: DASH borrowings $2,727M + operating leases ($104M + $474M = $578M)
      = $3,305M ≈ $3.30B. The lease-exclusive figure — the one this app must produce — is **$2,727M**,
      which is exactly what 67574d7 now returns. Restoring $3.30B would make the correct fix grade as a
      failure.
    - **RKLB/IRDM ≈$1.8B — INDETERMINATE, NOT SOURCED.** 67574d7 returns $1,749M, which is consistent
      with a ≈$1.8B rounding, but agreement is not proof of basis: IRDM's operating-lease balance appears
      in no run artifact on hand, so the sum that would separate a lease-inclusive from a lease-exclusive
      reading cannot be formed. **Left at ≈$1.8B unchanged** — the `≈` tolerance already spans $1,749M, so
      it does not misgrade the fix either way. Classifying it requires IRDM's lease footnote, which is out
      of scope for a text pass.
    - **TM/GM $130.30B — INDETERMINATE, NOT SOURCED.** GM's operating-lease balance is likewise absent
      from the run artifacts, so this figure cannot be classified as inclusive or exclusive. It is also
      the one instance 67574d7 did not confirm, so its basis AND its resolution are both open. **Left
      unchanged deliberately.** A wrong expected is worse than an unclassified one: an absent figure
      blocks grading, a wrong one makes a correct fix grade as a failure.

- [ ] **2b. Unavailable target debt coerced to $0 at the render boundary** — (GATE-2A root: debt-dropped).
      Downstream of 2a, but INDEPENDENT: it fires for any filer whose debt is genuinely unavailable.
  - pair: RKLB/IRDM · observed: with `companyBDebt = null`, `src/utils/dealCalc.js:104`
    `const targetDebtRepaid = num(inputs.companyBDebt) || 0;` yields **0** — an unknown debt is rendered
    as "$0 repaid" in sources & uses rather than as absent · expected: an unavailable figure renders
    **blank/null, never $0** (charter: "Unavailable data is an honest blank — never zero, never a
    substituted proxy"); a real $0 and an absent value must render differently · source:
    `src/utils/dealCalc.js:104` (`|| 0`). Note the sibling lines 180/183/184 already do this correctly —
    they guard with `!= null` and propagate null — so line 104 is the outlier, not the pattern.
    NOT SOURCED, deliberately: the §2 figures from the old combined item (EV $5,059M, EV/EBITDA 12.0x,
    Net Debt/(Cash) (184)) are NOT attributed here. `dealCalc.js:180` returns **null** for EV when debt is
    null, so those rendered numbers come from a different code path that the run artifacts do not
    identify. Establishing which surface renders them is part of this item, not a premise for it.

- [ ] **2c. Three hand-maintained debt-concept lists have drifted apart** — (root: debt-dropped, same
      family as 2a). Filed after 2a/2b but NOT downstream of them: this is the vocabulary 2a's fix widened
      in only one of the three places that keep a copy of it.
  - pair: RKLB/IRDM · observed: `server.js`, `edgarClient.js` and `ltmCalc.js` EACH carry their own
    hand-maintained list of EDGAR debt concepts, and the three have diverged. 67574d7 widened `server.js`
    only, so `/quote` and SS16 now disagree about what counts as debt for the same filer — a ticker can
    resolve a debt figure on one surface and stay null on the other · expected: ONE shared debt-concept
    vocabulary imported by all three call sites, so every surface answers "what counts as debt"
    identically · source: the three separate concept lists in `server.js`, `edgarClient.js` and
    `ltmCalc.js`. Run 20260816-222441 already wrote `server/data/debtConcepts.js` as exactly that shared
    module — the design is sound and is the right landing point. **It is a starting point, not a
    drop-in:** its list OMITS `LongTermNotesPayable` and `DebtLongtermAndShorttermCombinedAmount`, both
    of which 67574d7 added to `server.js`. Importing the module as written would silently NARROW
    `server.js` and regress 2a. Reconcile to the UNION first, then switch all three call sites.

- [ ] **2d. Unresolved companies get a zeroed payload stub instead of nulls** — (root: null-is-not-zero,
      at the payload level). Filed after 2b but UPSTREAM of it, and of every per-field guard: 2b coerces
      ONE null at the render boundary; this ships zeros for the WHOLE payload before any render runs.
  - pair: BRK.B/PGR · observed: when no provider resolves a ticker, `/quote` emits a whole-payload
    default carrying **0** for revenue, ebitda, netIncome, shares, eps, cash AND debt, with `name`
    falling back to the ticker string, `dataSource:"none"`, and `ltm.reason:"no data source resolved"`.
    Zero is a real number to every downstream consumer, so a BRK.B deck publishes **$0 revenue for
    Berkshire Hathaway** as though it were sourced — a fabricated figure, not a gap · expected: **null
    for every unresolved field**, so the render shows honest dashes and the stub is distinguishable from
    a company that genuinely reports zero · source: the `/quote` no-provider default payload — the object
    carrying `dataSource:"none"` / `ltm.reason:"no data source resolved"`.
    CRITICAL — **this defect is invisible to the analyzer.** `docs/sweep-v2/captures/BRK.B_PGR.json` is
    **`ok:true`**: that deck built successfully and BOTH graders scored it clean. Nothing in the current
    gate can see it, because a zeroed payload renders as a well-formed deck full of real-looking numbers.
    Any check added for this MUST key on **`dataSource:"none"` specifically**, not on implausible values —
    a plausibility heuristic misses it exactly as the graders did, and would also fire on filers that
    legitimately report zero.
    This is the app's own **"null is not zero"** invariant (charter: "Unavailable data is an honest blank —
    never zero, never a substituted proxy") violated at the PAYLOAD level. The fix is upstream of every
    individual field guard, 2b's `|| 0` included — fixing 2b alone leaves this stub publishing zeros,
    because `|| 0` never fires on a value the stub already turned into a real 0.

- [ ] **3. False "Combined EBITDA is non-positive"** — 12 pairs (GATE-2A root: D-ebitdaMsg). Downstream of 2a/2b.
  - pair: NET/DDOG · observed: deck renders "Combined EBITDA is non-positive" while combined EBITDA is
    actually **POSITIVE $57M** (§10: A $-17M + B $5M + synY1 $70M = $58M mine, $57M rendered); the message
    fires on a null `combinedDebt`, NOT on EBITDA sign · expected: no non-positive message when combined
    EBITDA is positive — the message must reflect the actual EBITDA sign · source: `SectionDashboard.js:260`
    `note = results.debtEBITDA === 'N/A' ? 'Combined EBITDA is non-positive' : null` (does not branch on
    EBITDA); `dealCalc.js:184` `debtEBITDA = (combinedEBITDA>0 && combinedDebt!=null) ? … : null` → 'N/A'
    whenever `combinedDebt` is null; `dealCalc.js:183` combinedDebt null if EITHER debt null. RUN-findings.md
    NET/DDOG #23; GATE-2B.2. NOTE: shares the null-combinedDebt trigger with 2a/2b, but the message logic is
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
