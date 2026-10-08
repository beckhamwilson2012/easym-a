# Dashboard EV / Debt÷EBITDA explainers rebuild EV with target debt coerced to 0

Run `20261007-113735`. Pair RKLB/IRDM.

## STEP 0

- Live `/api/verified/IRDM` at 2026-10-08T02:15Z: `totalDebt` = 1757 (verified, edgar; fmp 1761), `cash` = 97.
  The pair-level precondition ("when IRDM debt resolves null") does **not** hold live tonight.
- The defect is a deterministic code-path property, so it was reproduced by executing the shipped
  expression (read verbatim from `SectionDashboard.js:75-76`) and the real `explanations.js` with
  `companyBDebt: null` (scratch `repro-ev-explainer.mjs`):
  - `ev input = 6503` = TPP 6600 − cash 97 → target debt taken as $0; explainer EV `"$6.5B"` beside result `N/A`.
  - `combinedDebtForExplain = 4500` = 1200 + **0** + 3300; explainer `"$4.5B"` beside `N/A`.
  - Independently, `explainEvEbitda({ev:null})` → `"$0"`, `explainDebtEbitda({combinedDebt:null})` → `"$0"`.
- **Repro confirmed: 6503** (= offer value − target cash, debt as $0).

## Path

`dealCalc.js:190` `enterpriseValue` and `:193` `combinedDebt` already null-guard both legs, and `:191`/`:194`
null the multiples — but neither numerator was exposed on `results`. `SectionDashboard.js:75-76` rebuilt both
with `|| 0` (Pattern B, hop 1), and `explanations.js:115,140` coerced again via `parseFloat(x) || 0` (Pattern B,
hop 2), so nulling either alone still renders a fabricated figure.

## Root cause

The explainers rebuilt the multiples' numerators in a parallel path that coerces an unavailable target debt
to 0, instead of reading dealCalc's null-guarded numerators. **Pattern B.**

## Fix

- `src/utils/dealCalc.js` — expose `enterpriseValue` / `combinedDebt` on `results` (null when a leg is absent,
  `toFixed(0)` otherwise, same convention as `totalPurchasePrice`/`cashPortion`).
- `src/components/deck/sections/SectionDashboard.js:75-76` — read `results.enterpriseValue` / `results.combinedDebt`.
- `src/lib/explanations.js:115,140` — `fmtMoney(x)` directly; `fmtMoney` already renders null/undefined as `N/A`
  and a genuine 0 as `$0`.

## Post-fix (scratch `postfix-ev-explainer.mjs`, 2b fixture, only companyBDebt varied)

| companyBDebt | results.enterpriseValue (old rebuild) | EV explainer | results.combinedDebt (old) | Debt explainer |
|---|---|---|---|---|
| null | null (5866) | `N/A` · N/A | null (4225) | `N/A` · N/A |
| 0 | 5866 (5866) | `$5.9B` · 24.9x | 4225 (4225) | `$4.2B` · 25.5x |
| 1749 | 7615 (7615) | `$7.6B` · 32.3x | 5974 (5974) | `$6.0B` · 36.0x |

Non-null cases are value-identical to the old rebuild. `agent/tests/2b-null-not-zero.js` still PASS.
Explainers are click-only (lazy), so deck captures should not move.

## Not done

- The EBITDA leg in the same explainers (`explanations.js:116,141` `parseFloat(ebitda) || 0`) still coerces;
  out of item scope — filed in QUEUE ## Discovered.
- Not measured: live deck with IRDM debt null (precondition not live); no server restart/capture (runner's job).
