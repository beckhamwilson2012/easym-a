# Sweep queue

<!-- Each item requires four fields: pair · observed · expected · source. An item without all
     four is not actionable and must not be moved out of Discovered. A FIFTH field is optional:
     `test: agent/tests/<slug>.js` makes the item TEST-GRADED (GATE_SPEC §12) — required for any defect
     whose correct fix cannot move a defect count. Without it the item is count-graded, as before. Values below are pulled from the
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
     2c and 2d were added 2026-08-17. 2d was MOVED above 2b the same day, so the file now reads
     1, 2a, 2d, 2b, 2c. The labels are deliberately NOT in alphabetical order and must not be "tidied"
     back into sequence — position IS the schedule. queue_next() picks the topmost `- [ ]` and reads
     nothing else: not this comment, not the labels, not the prose. Anything that must happen in a
     particular order has to be expressed as POSITION, or it does not happen.
       2d now leads because it is the SAME null-is-not-zero defect as 2b, one layer earlier: 2b coerces
          one null at the render boundary, 2d ships zeros for the whole payload before any render runs.
          2b's `|| 0` can never fire on a value the stub has already turned into a real 0, so fixing 2b
          first would leave the stub publishing zeros. File order and work order now agree for it.
       2c is the ONE remaining place where they do not agree. It is the debt-concept VOCABULARY that 2a's
          fix (67574d7) widened in only one of the three places that keep a copy of it, so it is upstream
          of every debt consumer (/quote and SS16 alike) — but it is still FILED last of the 2-series.
          Do 2c before any further debt-concept work regardless of where it sits here, or move it up. -->

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

- [x] **2d. Unresolved companies get a zeroed payload stub instead of nulls** — (root: null-is-not-zero,
      at the payload level). MOVED above 2b 2026-08-17: this is FIRST in file and first in work order.
      Upstream of 2b and of every per-field guard — 2b coerces ONE null at the render boundary; this
      ships zeros for the WHOLE payload before any render runs.
  <!-- CLOSED 2026-08-17 by MEASUREMENT, not by a run. The fix is at HEAD (247e4b9, merged 906f6be);
       what was missing was any way to grade it — an honest null cannot lower a defect count, so the run
       scored 9->9 and left this OPEN. agent/tests/2d-null-not-zero.js now supplies that measurement and
       was run in BOTH directions by hand: exit 1 at 247e4b9^ printing "revenue = 0, want null" for all
       seven fields, exit 0 at HEAD, each against a server started from that exact tree on an isolated
       port with the listener PID verified as ours. That is the same red-then-green evidence the runner
       now produces for DONE_TESTED (GATE_SPEC §12); it was taken by hand rather than spending a full
       sweep to re-derive what was already measured. Closed here so file order matches work order —
       queue_next() reads position and nothing else, so 2b cannot be worked while this sits above it. -->
  - test: agent/tests/2d-null-not-zero.js
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

- [ ] **2b. Unavailable target debt coerced to $0 at the render boundary** — (GATE-2A root: debt-dropped).
      Downstream of 2a, but INDEPENDENT: it fires for any filer whose debt is genuinely unavailable.
  - test: agent/tests/2b-null-not-zero.js
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

- [ ] **6. A bad verdict destroys the agent's code before anything records it** — HARNESS defect, not an
      app defect. **OUT OF AGENT SCOPE — MINE to fix, supervised**: the fix is in `run-sweep.sh`, so an
      agent handed this item would be editing the harness that grades it, exactly the conflict the 429
      item in Discovered is held back for. Filed here for visibility, not for the loop to pick up.
  - pair: BRK.B/PGR · observed: on **every** revert path — NO_VERDICT, REGRESSION, TIMEOUT, NO_CHANGE —
    `revert_to` (`run-sweep.sh:613`) runs BEFORE `finalize` (`:646`) and does `git reset --hard` +
    `git clean -fd`. It deliberately preserves `DECISIONS.md`, `calibration.csv` and `agent/diagnosis/`
    (`:625-636`) — findings survive, **code does not**, and no copy is taken. Run 20260817-153300's 2d
    fix (`server.js` + `src/App.js`) existed only in the working tree 15:47→15:52 and was never committed
    anywhere: `d34c77e` holds DECISIONS/QUEUE/calibration/diagnosis and no code. Same loss in
    20260816-202617 (the Stage 7A-4 debt branch, turn-cap death) and 20260816-222441 — **three fixes.**
    153300's was afterwards proven CORRECT: `f2e8034` showed its REGRESSION was a `tileVal` phantom, and
    re-gated it scores 1.50 → 1.50 · expected: the agent's diff is written OUTSIDE the revert path before
    `revert_to` runs — e.g. `$RUN_DIR/agent-iter<N>.diff`, since `runs/` is gitignored and survives
    `clean -fd` — on EVERY terminal verdict. Reverting the tree is right; destroying the only copy of the
    work is not · source: `run-sweep.sh:613-637` `revert_to`, and the `PARTIAL_UNVERIFIED` branch at
    `:962-966` which is the ONLY path that keeps a diff ("KEEPING it, NOT reverting") and covers only the
    cut-off case. The bad-verdict case has no equivalent. A fix that scores badly must stay recoverable,
    because **the score can itself be wrong** — 153300 is the proof that it can.

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

- [x] **capture.js drove a UI that no longer exists — CLOSED 2026-09-24, fixed in `144e01b`.**
  Two selectors re-pointed at the post-`d1bfd2d` flow: `Public → Public` (chooseDealType('pubpub'),
  src/App.js:1498) and `Run Analysis` (src/App.js:1534); timings, viewport, waits and the 16-key record
  schema unchanged, proven by `scripts/capture-selftest.mjs` (AAPL/VZ, KO/NSRGY, NET/DDOG → ok:true,
  stage:'done', pdfPages 17). The deliberate-deferral reasoning below was honoured: this landed as a
  declared NEW baseline, not a silent re-baseline — see DECISIONS.md "Baseline discontinuity 2026-09-17".
  Live proof in the harness: 0 ok on every run from 2026-08-20 through 2026-09-17, then 24 ok
  (20260921-193714) and 38 ok of 50 (20260922-194237), with 45 defects across 38 analyzable pairs.
  Original entry, kept verbatim:

  - **BLOCKING: `capture.js` drives a UI that no longer exists — every capture fails at stage `start`.**
    `capture.js:112-116` opens the app and waits for a button matching `/Auto-Lookup/`, clicks it, then waits
    for `input[id^="react-select"]`. Commit **`d1bfd2d`** ("feat(entry-flow): deal-type-first entry —
    public/private per side, no checkbox, back link") removed that flow: `src/App.js:988` records that "the
    old 'auto'/'manual' modes were replaced by 'entry'", and the string `Auto-Lookup` now appears nowhere in
    `src/` or in the built bundle. So the collector times out 30s into its first interaction, every deck
    returns `ok:false stage:"start" error:"Waiting failed: 30000ms exceeded" loadedCount:0`, and **the sweep
    harness cannot produce a baseline at all.**
    Measured 2026-08-20 on both ports, so it is not the SWEEP_APP_PORT change: a single-pair capture on
    :34500 and the identical capture on the unchanged default :3001 both fail with the same stage, error and
    `loadedCount:0`. The oracle fetches in the same run succeed and carry full data, so the app and the HTTP
    path are healthy — it is only the browser-driving script that is stale.
    **NOT fixed here, deliberately, and this is the reason:** re-pointing the driver at the new entry flow
    changes which decks build and how far they render, which changes what the analyzer can see. That is a
    change to WHAT GETS MEASURED, and it would silently re-baseline every comparison against the archive.
    `capture.js` is off-limits to the sweep agent for exactly this reason (ITERATION_PROMPT SCOPE), and the
    same logic applies to anyone editing it between runs: the re-pointing and the first baseline it produces
    need to land together, deliberately, with the old and new capture sets compared pair by pair.
    (pair: AAPL/VZ (reproduces on every pair) · observed: `ok:false stage:"start" error:"Waiting failed:
    30000ms exceeded" loadedCount:0` on both :3001 and :34500, with oracles fetched successfully in the same
    record · expected: the collector drives the current entry flow and builds a deck, as it did before
    `d1bfd2d` · source: `tools/sweep-analyzer/capture.js:113` waiting on `/Auto-Lookup/`, against the entry
    flow introduced by `d1bfd2d`; `src/App.js:988` documents the replacement)

## Discovered

- **`dealCalc.js:107` — `excessCashAvail` fabricates a zero from a null, in the same function 2b fixes.**
  `const excessCashAvail = combinedCash != null ? Math.max(0, combinedCash - minCash) : 0;` — when the
  combined cash bucket does not resolve, "how much cash is available to fund the deal" is UNKNOWN, and this
  publishes it as **$0 available**, which then flows into `newDebt` (the deal is funded entirely with new
  borrowing) and `excessCashUsed`. It is the identical Pattern B as `:104`, three lines below it, on a
  different input — and the ternary `: 0` shape is precisely the one a `|| 0` grep does not find
  (docs/03-PATTERNS.md P3). Left untouched by the 2b work, which was scoped to the debt leg.
  (pair: — (no deck repro on hand; needs a filer whose cash bucket fails to resolve) · observed:
  `combinedCash == null` yields `excessCashAvail = 0`, so the model reports no cash available rather than
  unknown, and `newDebt` absorbs the whole consideration · expected: absent → null, propagated through
  `newDebt`/`excessCashUsed` exactly as the 2b fix propagates an absent debt; a genuine $0 stays 0 ·
  source: `src/utils/dealCalc.js:107`)

- **`SectionDashboard.js:338` and `:347` — a Pattern C the 2b fix CREATES, currently latent.**
  Both read `parseFloat(results.newInterestAfterTax) > 0 ? [row] : []`. Once 2b lands, `newInterestAfterTax`
  is **null** whenever the target's debt is unavailable; `parseFloat(null)` is `NaN` and `NaN > 0` is false,
  so the After-Tax Financing Cost row silently **disappears** instead of rendering "—". It does not
  fabricate — which is why it is filed here and not ranked — but it is safe by ACCIDENT: the guard is a
  magnitude test standing in for a presence test, and it holds only because a NaN comparison happens to be
  false. That is the textbook Pattern C. **It is not reproducible today**: at HEAD the value is never null,
  so this becomes live only when the 2b fix is applied. Fix it in the same commit as 2b, or it ships as a
  vanishing row nobody ordered.
  (pair: RKLB/IRDM, once 2b lands — not reproducible before that · observed: with
  `newInterestAfterTax = null` the financing-cost row is omitted entirely, so a deck whose financing cost is
  UNKNOWN reads identically to one with no financing cost · expected: an unknown drag renders "—" like every
  other absent figure; absence and zero must look different · source: `src/components/deck/sections/
  SectionDashboard.js:338` and `:347`, both `parseFloat(...) > 0` used as a presence check)

- **`capture.js:9` hardcodes `localhost:3001`, so a sweep can only ever run on that one port — and takes
  it by force.** `const BASE = 'http://localhost:3001'` is a module constant read by every deck fetch
  (`capture.js:32`) and the page load (`:112`); nothing in capture.js consults `BASE_URL`, which the runner
  otherwise threads through as `APP_PORT`. `restart_server` then kills **whoever holds that port**, by PID
  (`run-sweep.sh:412` — `lsof -ti tcp:$APP_PORT`, escalating to `-9`), so launching a sweep terminates any
  other session's app server without asking. On 2026-08-17 that was pid 73095, a second session's server in
  this same repo.
  **This is what makes worktree isolation a PARTIAL mitigation, and the reason is worth stating plainly:** a
  dedicated worktree fixes the two tree-level hazards — the branch switch on the shared checkout, and
  GATE_SPEC §6a's staging gap where a concurrent writer's file is committed into the sweep commit — but it
  does NOT fix this one, because both trees still resolve `localhost:3001` to the same socket. Two sweeps,
  or a sweep and a human session, still collide on the port and kill each other's servers. **Making `BASE`
  configurable is therefore the PRECONDITION for two sessions ever running at once**; until it is, "one
  writer per tree" (§6a) has to be read as the stronger "one app server per machine", and worktree
  parallelism cannot be offered as a solution.
  Note the constant already exists in three other places (`tools/noop-ab/run.js:16`,
  `server/harness/edgar.js:8`, and the runner's own `BASE_URL` default), so a fix is a shared-source
  question, not a one-line edit — the same drift shape as item 2c's three debt-concept lists.
  (pair: — (harness artifact, no deck repro) · observed: `capture.js:9` is a hardcoded literal; a sweep
  launched with `BASE_URL=http://localhost:3002` still captures against :3001, and `restart_server` kills
  the unrelated process holding :3001 · expected: the collector reads the port from one shared source the
  runner sets, so a sweep can be pinned to a private port and cannot kill another session's server ·
  source: `tools/sweep-analyzer/capture.js:9`, consumed at `:32` and `:112`; kill at `run-sweep.sh:412`)

- **`SNAP_N` reads "0\n0" on a CLEAN tree, and the log line is garbled by a shell syntax error.**
  `run-sweep.sh:1018` is `SNAP_N="$(grep -c '' "$SNAP_FILE" 2>/dev/null || echo 0)"`. On an empty snapshot
  file `grep -c ''` PRINTS `0` and EXITS 1 (no matches), so `|| echo 0` fires as well and `SNAP_N` becomes
  the two-line string `0\n0`. The next line's `[[ "$SNAP_N" -gt 0 ]]` then dies with
  `[[: 0\n0: syntax error in expression`, and the log reads `tree snapshot: 0\n0 dirty path(s)`.
  It fires on the NORMAL case — a clean tree — and was invisible until now only because run
  20260817-163640 happened to have 1 dirty path at its snapshot. Cosmetic in effect (the failed `[[ ]]`
  only skips an explanatory suffix; `AGENT_PATHS` and staging are unaffected), but it prints a shell
  syntax error into the ledger's own log, which is where someone later looks to decide whether a run was
  healthy. Found by the test-first rig, not by a run.
  (pair: — (harness artifact, no deck repro) · observed: `[[: 0\n0: syntax error in expression` plus
  `tree snapshot: 0\n0 dirty path(s)` on any iteration starting from a clean tree · expected: `SNAP_N=0`
  and `tree snapshot: 0 dirty path(s)` · source: `run-sweep.sh:1018`, `grep -c` exiting 1 on zero matches
  while still printing its count)

- **`UNDO.txt` leads with a command that is safe alone and destructive in sequence.** The file the runner
  writes at every run start (`run-sweep.sh`, the `cat > "$RUN_DIR/UNDO.txt"` heredoc) reads:
  `git checkout <base> && git branch -D sweep/auto-<id> && git tag -d restore/pre-sweep-<id>`.
  The first clause is a perfectly ordinary command someone may legitimately want on its own; nothing in
  the line marks where "go back" ends and "destroy the run" begins, and a partial paste or a copied first
  clause leaves no signal about which of the two was actually run. **It cost a branch on 2026-08-17:**
  `sweep/auto-20260817-153300` and its `restore/pre-sweep-20260817-153300` tag were both deleted while the
  intent was only to change branch, taking the 2d diagnosis out of reach (`d34c77e` survives only because
  it was tagged afterwards). This is a hazard in the RECOVERY tool, which is the worst place for one.
  (pair: — (no deck repro; harness artifact, filed here rather than Open so the runner never BLOCKs an
  iteration on it) · observed: a 3-clause `&&` chain whose first clause is independently meaningful and
  whose later clauses are irreversible, with no marker distinguishing partial from complete execution ·
  expected: a form that CANNOT be half-run — see the two candidate shapes below · source:
  `run-sweep.sh` UNDO.txt heredoc)

  PROPOSED SHAPES — either satisfies "cannot be half-run"; the first is preferred.

  1. **A script, not a line.** The runner writes `$RUN_DIR/undo.sh` (executable, gitignored with `runs/`)
     and UNDO.txt says only `bash agent/runs/<id>/undo.sh`. There is no first clause to run by accident:
     the unit of execution IS the whole undo. The script can then afford to be safe in ways a pasteable
     line cannot — refuse to run if HEAD is not the sweep branch, refuse if the tree is dirty, print what
     it is about to delete and require `--yes`, and report each step. A destructive tool should be able to
     say no; a `&&` chain never can.
  2. **A leading no-op that makes partial execution obvious**, if a one-liner must be kept:
     `test -n "$UNDO_20260817_153300" && git checkout … && git branch -D … && git tag -d …`
     The chain is inert unless the variable is set, so a partial paste does nothing at all rather than
     doing the first destructive-adjacent step. Weaker than (1) — it guards the whole line, not the
     boundary between clauses, and it still relies on the reader not stripping the guard.

  NOT proposed: reordering so the destructive clauses come first (makes a partial run worse), or dropping
  `git checkout` from the line (leaves the user on a branch that the next clause deletes).

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
