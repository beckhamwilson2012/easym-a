# 2c. Three hand-maintained debt-concept lists have drifted apart — STEP 0 split → PARTIAL

Run `20260929-193005`. No app code changed.

## The item's premise, checked against the tree

The item says `server.js`, `edgarClient.js` and `ltmCalc.js` each carry their own list, and that the shared
module lives in `server/data/debtConcepts.js`. Both have drifted:

- The shared module now exists at **`server/services/debtConcepts.js`** (`resolveTotalDebt`), landed by
  `a5511a9 fix(debt): one resolver, incl current maturities across deal EV, comps, and §16`.
- **`server.js:17`** and **`server/services/edgarClient.js:3`** both import it:
  - `server.js:723` — `resolveTotalDebt(bsPick)`
  - `edgarClient.js:120-122` — `resolveTotalDebt(names => pickAtEnd(ns, names, refEnd)?.val)`
  So the core LongTermDebt-family vocabulary is already ONE list for `/quote` and §16. **This half is resolved.**

## What still diverges (the remaining half)

1. **`server.js:726-727` tail, not in the shared module.** When the resolver returns null, `/quote` falls
   through to `convertTotal` (`ConvertibleDebtNoncurrent`/`ConvertibleLongTermNotesPayable` +
   `ConvertibleDebtCurrent`/`ConvertibleNotesPayableCurrent`, `server.js:698-700`), then
   `DebtLongtermAndShorttermCombinedAmount`, `LongTermLineOfCredit`, `LongTermNotesPayable`.
   `edgarClient.js:120-122` has **none** of these tails → for a filer the resolver can't reach, `/quote`
   resolves a debt figure while §16's EDGAR leg stays null.
2. **`server/services/ltmCalc.js:57`** still carries its own list
   `['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations']`, consumed at
   `ltmCalc.js:377` (`instantLatest(entriesFor(ns, N.debt))`) — first-match, no current-maturities sum, no
   tails. It does not use `resolveTotalDebt` at all.
3. `edgarClient.js:123-125` `debtRepEntry` is a fourth first-match list (period metadata only).

## Live values for the named pair (neither surface is null)

| pair | `/quote` debt | §16 `/api/verified` totalDebt |
|---|---|---|
| IRDM | 1749 | edgar 1757 @2025-12-31 FY, fmp 1761 → verified |
| RKLB | 13 | edgar 2 @2025-12-31 FY, fmp 254 → **flagged**, maxDev 126 |

The item's user-visible claim — "a ticker can resolve a debt figure on one surface and stay null on the
other" — does **not** reproduce on RKLB/IRDM: both surfaces are non-null for both tickers. The
IRDM 1749 vs 1757 gap is period (interim bsAnchor vs FY refEnd), not vocabulary.

## Why no code change

- STEP 0 split rule: half of the class (server.js ↔ edgarClient core vocabulary) is resolved by `a5511a9`;
  the remaining half is a code-level divergence with no live null-vs-value repro on the named pair.
- Every remaining edit site (`debtConcepts.js`, `edgarClient.js`, `ltmCalc.js`) is under `server/services/*`,
  which CLAUDE.md marks as owned by a concurrent session — "do not edit without asking". Headless run, no one
  to ask.

## Adjacent observation (filed in QUEUE ## Discovered, not worked)

RKLB §16 EDGAR debt 2 vs FMP 254 (and `/quote` 13): the resolver returns a small non-null
LongTermDebt-family value, so `server.js:726`'s `?? convertTotal` never fires and RKLB's convertible notes are
not counted — Pattern A (a present-but-wrong value blocking a working fallback). Not verified at the concept
level this run.
