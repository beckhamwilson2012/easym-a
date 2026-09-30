# Item 3 — False "Combined EBITDA is non-positive" (D-ebitdaMsg)

## Repro (run 20260929-193005, iter 5)
Named pair NET/DDOG resolved upstream in iter 4 (Debt/EBITDA 74.7x, no message). The defect class persists
on other pairs. Live value from `agent/runs/20260929-193005/cap/before-5/CART_DASH.json` bodyText:

- `Combined EBITDA (incl. Y1 synergies)  $2,333M`   ← positive
- `DEBT / EBITDA  n/m  Combined EBITDA is non-positive`   ← false
- `Total Debt  N/A` on one side  ← acquirer debt null

Repro confirmed: CART/DASH renders "Combined EBITDA is non-positive" while combined EBITDA is +$2,333M.

## Trace
1. `src/utils/dealCalc.js:193` — `combinedDebt = (companyADebt != null && companyBDebt != null) ? … : null`
   → null because one side's debt is null.
2. `src/utils/dealCalc.js:194` — `debtEBITDA = (combinedEBITDA > 0 && combinedDebt != null) ? … : null`
   → null, even though combinedEBITDA = 2,333 > 0.
3. `src/utils/dealCalc.js:218` — `debtEBITDA: 'N/A'`; `:225` `combinedEBITDA: '2333'`.
4. `src/components/deck/sections/SectionDashboard.js:260` — `note = debtEBITDA === 'N/A' ? 'Combined EBITDA
   is non-positive' : null`. The note checks only for N/A. It never looks at which of the two
   conditions from step 2 failed.

## Root cause
The Debt/EBITDA note maps all three N/A causes (EBITDA null, EBITDA ≤ 0, combined debt null) to the
single "EBITDA is non-positive" message. That makes a confident false claim about the EBITDA sign.
Classification: **New**. It is a mislabelled absence (the message names the wrong cause), not a null
coerced to zero.

## Fix
`SectionDashboard.js:260` now branches on `results.combinedEBITDA`, the same value the ratio guard uses:
- `null` → "Combined EBITDA not available"
- `≤ 0` → "Combined EBITDA is non-positive" (the only case where the old text was true)
- `> 0` (so the ratio is N/A only because combinedDebt is null) → "Combined debt not available"

The rendered value ('n/m') is unchanged; only the note text changes. Pairs whose ratio is not N/A are
untouched.

Expected per-pair effect (from the iter-4 PARTIAL census):
- 9 positive-EBITDA pairs → "Combined debt not available": ARM/SNPS, CART/DASH, CMCSA/PARA, F/RIVN,
  PLTR/SNOW, RDDT/PINS, SAP/NOW, TM/GM, WBD/PARA.
- 8 N/A-EBITDA pairs → "Combined EBITDA not available": BRK.B/PGR, BX/APO, GSK/NUVL, LLY/SRPT,
  MRNA/BNTX, SHEL/OXY, SONY/EA, UL/CL.

Not verified by me: the runner rebuilds, restarts, and re-captures.

## Adjacent (already filed, not touched)
`SectionDashboard.js:76` `combinedDebtForExplain` and `explanations.js:140-141` use `|| 0` in the
Debt/EBITDA explain popup, so it shows a fabricated combined debt when one side is null. This is already
in QUEUE.md ## Discovered (~line 283).
