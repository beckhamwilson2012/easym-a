# 2b — Unavailable target debt coerced to $0 at the render boundary

Run `20260929-160247`. (Runs 20260924-163754 / -164351 / -170138 recorded NO_VERDICT on this item: their agent
json shows `Failed to authenticate: OAuth session expired` — they never executed, so nothing to resume from.)

## Step 0 — repro (declared test, HEAD `03a4f2b`)

`node agent/tests/2b-null-not-zero.js` → exit 1:

```
ABSENT (null)  targetDebtRepaid="0"  newDebt="2467"  excessCashUsed="558"
GENUINE $0     targetDebtRepaid="0"  newDebt="2467"  excessCashUsed="558"
REAL $1749M    targetDebtRepaid="1749"  newDebt="4216"  excessCashUsed="558"
```

Repro confirmed: `companyBDebt=null → targetDebtRepaid="0"`, indistinguishable from a genuine $0.

## Root cause

`src/utils/dealCalc.js:104` `num(inputs.companyBDebt) || 0` turns an unavailable target debt into $0 repaid,
and that 0 is an addend in `newDebt`, `excessCashUsed`, the after-tax financing drag, pro-forma net income,
pro-forma EPS and the sensitivity grid (`calcProFormaEPS`). **Pattern B.**

Hops (RKLB/IRDM test inputs, cash consideration 55×110×50% = 3025, excess cash avail 557.84):

| hop | null debt, before | null debt, after | $0 debt (both) | $1749M (both) |
|---|---|---|---|---|
| targetDebtRepaid | 0 | null | 0 | 1749 |
| newDebt | 2467 | null | 2467 | 4216 |
| excessCashUsed | 558 | null | 558 | 558 |
| newInterestAfterTax | 97 | null | 97 | 167 |
| proFormaEPS / epsChangePct / calcProFormaEPS | numbers | null | unchanged | unchanged |

(post-fix values from `scratch/probe_2b_cascade.js`, positive-NI variant of the test inputs.)

The render layer re-coerced the same unknown independently:

- `SectionTransactionStructure.js:79` `bDebt = num(inp.companyBDebt) || 0` → pre-deal total debt, net debt,
  leverage, and the header **EV** fallback at `:108`: `deckModel.js:124` correctly returns
  `transactionEV = null` when `T.debt` is null, but §10 then fell back to
  `equityPurchase + netCashDebt(0, bCash, bSti)` = equity − target cash, i.e. **Net debt/(cash) = (target
  cash)** — with IRDM cash $184M this yields exactly `(184)`, matching the item's unsourced figure (arithmetic
  match; the live deck was not re-captured to confirm the surface); `EV/EBITDA 12.0x` was not traced (see Discovered: dashboard explainer EV).
- §10 `:60-63` `(targetDebtRepaid || 0)`, `(newDebt || 0)`, `(excessCashUsed || 0)` → totals that "foot".
- §10 `lev(v)` would render `0.0x` for a null input (null/EBITDA).
- `SectionProFormaPL.js:98` `finDrag = parseFloat(...) || 0` → PF Net Income silently drag-free.
- `SectionDashboard.js:338/347` `parseFloat(null) > 0` → financing-cost row vanished (Pattern C, per QUEUE
  Discovered).

## Fix

- `dealCalc.js` — `targetDebtRepaid = num(companyBDebt)`; `newDebt`, `excessCashUsed`, `newInterestAfterTax`,
  `proFormaNetIncome` go null with it; `calcProFormaEPS` returns null on unknown new debt; `toFixed` guarded.
  Bank path untouched (still `targetDebtRepaid: null` meaning "not repaid", newDebt = cash consideration).
- §10 — bank keeps its genuine 0s (debt not repaid, no excess cash drawn); non-bank null → totals, fee cash,
  pre/PF debt, PF cash, net debt, impacts, leverage and fallback EV all null → "—". The "Repay debt" and
  "Excess cash used" rows now show with "—" when unknown (a genuine 0 stays hidden, as before). The footing
  line reads "not footed: target debt unavailable" instead of a false ✓ or ⚠.
- §6a — PF Net Income and the "Less: financing" line → "—" when the drag is unknown.
- Dashboard — financing-cost row shows "—" when unknown.

No-op: with debt known, every expression reduces to the old one (test case REAL: newDebt 4216, excess cash
used 558, unchanged; `$0` case unchanged at 2467/558).

## Test

`agent/tests/2b-null-not-zero.js` (pre-existing, unmodified): red at HEAD (5 failures above) → green:
`PASS: unknown target debt renders blank · a genuine $0 still renders $0 · … real-debt deal unchanged (newDebt 4216, excess cash used 558)`.
`agent/tests/2d-null-not-zero.js` still PASS.

## Not measured

Live deck not rebuilt or re-captured (runner's job). Whether IRDM's live `/quote` debt currently resolves
null was not probed — the test pins the construction with fixed inputs.
