# Item 4 — Combined gross margin understated via null target GP (AAPL/VZ)

## Repro (live, :3001, 2026-09-30)
`/api/pnl/AAPL` FY2026E: revenue 477451 · grossProfit 223949
`/api/pnl/VZ`   FY2026E: revenue 140906 · grossProfit **null** (every column, actual and forward)

§8 (pro-forma, SectionProFormaPL §6a) combined GM = 223949 / (477451 + 140906) = **36.2%** → Repro confirmed: 36.2%.

## Path (pre-fix line numbers; post-fix: sum :95, cRev/cGross :120, cEbit/cNi :121, COGS :130, GM :136)
- `SectionProFormaPL.js:92` `sum = (x, y) => (x != null && y != null) ? x + y : (x ?? y ?? null)`
- `:117` `cGross = sum(a.grossProfit, b.grossProfit)` → 223949 (AAPL alone, labelled "Combined")
- `:117` `cRev = sum(a.revenue, b.revenue)` → 618357 (both legs)
- `:133` `margin(cGross, cRev)` → 36.2%

## Root cause
The local `sum` fell back to the one live leg when the other was null, so a single company's gross profit
was published as "Combined" and divided by two-company revenue. **Pattern B** (null in a sum → plausible
wrong number; the `x ?? y` fallback is the null-as-zero coercion in disguise).

## Fix
`sum` now requires both legs; otherwise null ("—"). Consumers already null-guard: `margin`, `growth`, and
the `pf` ternaries on Revenue / Gross Profit / EBIT / Net Income. All three call sites (`:117`, `:118`,
`:127`) are local to §6a — one helper, whole class (GP, COGS, and the same latent shape on revenue/EBIT/NI).

## Why not 46.6%
The grader's "correct ≈ 46.6%" restores VZ GP from the §2 LTM gross margin (45.6%) × forward revenue. VZ
has no forward (or any FY) gross profit in `/api/pnl`; applying an LTM margin to consensus revenue would be
a substituted proxy, which the item's own alternative ("never sum a null GP as zero against a live
revenue") and the no-fabrication rule rule out. Post-fix AAPL/VZ §8: combined GP "—", combined GM "—"
(the analyzer's cm18 check requires a rendered combined GM, so the flag clears for an honest reason).
Populating VZ GP at source is item 1's territory.

## Unaffected
Pairs where both legs are present for a row compute identically (`x + y` branch unchanged).

## Not measured
Did not restart :3001 or re-capture (runner's job). `build/` must be rebuilt for the change to show.

## Iter 7 (run 20260929-193005) — STEP 0: Repro FAILED → RESOLVED_UPSTREAM(iter 6, 5f5d9b8)
- Served bundle carries the fix: `build/static/js/main.6802a687.js.map` contains "Combined = BOTH legs"
  (build 15:50, src edit 15:49); the old `x ?? y ?? null` shape is absent from every map.
- Runner capture `cap/before-5/AAPL_VZ.json` §8 Gross margin % row: `46.9% · — · 36.2% · — · 36.2%`
  (FY2026E; 36.8% / 37.3% FY2027E/28E) — the item's observation.
- Runner capture `cap/after-6/AAPL_VZ.json` (captured 16:18 on the fixed build) §8: Gross Profit
  `$223,949 · — · — · — · —`, Gross margin % `46.9% · — · — · — · —` for all three forward years.
  Combined GM is now an honest dash, not 36.2% — the Pattern-B defect condition no longer holds.
- Live `/api/pnl/VZ` (2026-09-30): grossProfit null in all six columns (FY2023–FY2028E), revenue live.
  So the item's numeric expectation (≈46.6%) is not reachable without a substituted LTM-margin proxy;
  it only becomes reachable if item 1 populates VZ GP at source, in which case the both-legs `sum` computes it.
- Defect count 54→54 in iter 6 is not explained here: the capture shows the AAPL/VZ cell moved from
  36.2% to "—". The flag-level check (which cm18 flags cleared, what was added) was not done in this iteration.
- No code change in iter 7.
