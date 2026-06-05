# Phase 1 — Core Merger Math Diagnosis (CRM acquires TEAM)

Diagnosis of the four reported bugs against the model code in `src/utils/dealCalc.js`.
Bugs 1, 2, and most of 4 were already corrected in commit 3c21c9e; this pass aligns the
pro-forma EPS to the hand-worked acceptance example and tightens the negative-EPS rule.

## Bug 1 — Roles flipped ("Atlassian's acquisition of Salesforce") → ALREADY FIXED
No variable swap exists. `calculate()` uses `companyA*` for the acquirer and `companyB*` for the
target throughout. The narrative is `${nameA}'s acquisition of ${nameB}` (dealCalc.js `buildNarrative`,
also deckTokens.js `buildBankNarrative`), and `nameA` is bound to the user's Company-A selection in
App.js `handleSelectA`. The live app renders "Salesforce, Inc.'s acquisition of Atlassian Corporation".
The flip in the original screenshot was a symptom of the price=0 / shares=0 era, not an A/B swap.

## Bug 2 — New Shares Issued = 0M → ALREADY FIXED
Root cause was twofold: (a) the acquirer price was faked as `companyAEPS × 15`, and (b) a state race
where the `/quote` response overwrote the live price with 0 (EDGAR returns no share price). Now:
- `acquirerSharePrice(inputs)` (dealCalc.js:14) returns the real `currentSharePriceA` (EPS×15 only as a
  labeled fallback, never from a loss).
- `newSharesIssued = stockPortion / acqPrice` (dealCalc.js:49) → ~84M for CRM/TEAM @ $150, never 0.
- App.js `handleSelectA` now fetches the acquirer live price and the `/quote` handler no longer clobbers it.

## Bug 3 — Pro Forma EPS does not match the worked example → FIX NEEDED
The EPS is a real computed number (not $0.00), but lines 58–62 subtract an after-tax **financing cost**
(`DEBT_INTEREST_RATE = 0.05` × cash portion × (1−tax)). For CRM/TEAM @ $150/60% cash that is
≈ 23,580 × 0.05 × 0.79 ≈ **$931M** of interest drag, giving proFormaEPS ≈ **$6.92**.
The acceptance example ignores incremental financing cost and expects proFormaEPS ≈ **$7.84**.
**Fix:** default the incremental financing-cost drag to 0 in the base accretion/dilution check
(`DEBT_INTEREST_RATE = 0`), documented as an assumption. This makes the base check match the worked
example and the standard "quick" accretion/dilution convention; a non-zero rate can be reintroduced
later to model fully debt-funded cash.

## Bug 4 — Accretion label + "−100%" → MOSTLY FIXED, needs broader guard
Lines 66–70 already compute `isAccretive = proFormaEPS > standaloneEPS` and suppress the percent
(`epsChangePct = null`) when `standaloneEPS ≤ 0`, so the "−100% ✓ Accretive" nonsense is gone.
The spec rule is broader: suppress the percent when `standaloneEPS ≤ 0` **OR** `proFormaEPS ≤ 0`, and
"lean dilutive" in degenerate cases.
**Fix:** `accretionMeaningful = standaloneEPS > 0 && proFormaEPS > 0`; and
`isAccretive = accretionMeaningful && proFormaEPS > standaloneEPS` (so any non-positive EPS leans dilutive).

## Hand-worked acceptance target (offer $150, 60% cash, A.price 188, synergiesY1 935, tax 21%)
dealValue 39,300 · premium +29.3% · stockConsideration 15,720 · newShares ≈83.6M ·
combinedShares ≈1,012.6 · afterTaxSynergies ≈739 · combinedNetIncome ≈7,939 ·
proFormaEPS ≈ **$7.84** · acquirerStandaloneEPS ≈ **$8.03** · **DILUTIVE**, ≈ **−2.4%**.
Acquirer must remain CRM throughout.
