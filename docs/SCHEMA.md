# Canonical company financial schema (Phase 0 contract)

One canonical company object, produced by every entry point, carrying **provenance** and
distinguishing **zero from missing**. This document is the target; it orders no refactor.
Phase 0 is additive and must be a provable no-op — accessors read both the wrapped shape and
today's bare values transparently.

Design axiom: **store primitives, derive the rest.** Anything computable from stored
primitives (ebitda, netDebt, EV, equity value, margins, growth, multiples) is NOT a field —
it is computed in JS at read time. Storing a derived value invites the two-sources-disagree
class of bug this whole campaign has been unwinding.

---

## 1. Field list

Units: `$M` = millions of the object's reporting currency (see `scale`/`currency` meta).
`sh(M)` = millions of shares (count — currency-neutral, never FX-converted). `$/sh` = per
share. Kind: **P** = stored primitive, **D** = derived (NOT stored — see §4), **M** = meta.

### Required six (extraction core)
| Field | Type | Unit | Kind | Notes |
|-------|------|------|------|-------|
| `revenue` | number | $M | P (required) | Net sales / total revenue |
| `ebit` | number | $M | P (required) | Operating income. **Not** EBITDA. |
| `da` | number | $M | P (required) | Depreciation & amortization. **No current builder supplies this** (they emit `ebitda`); see §6. |
| `netIncome` | number | $M | P (required) | Net income attributable to the company |
| `cash` | number | $M | P (required) | Cash & equivalents |
| `totalDebt` | number | $M | P (required) | Total debt. May be summed from `currentPortionLTD` + `longTermDebt` at extraction (provenance `source:'derived'`) or extracted directly |

> **EBITDA is dual-provenance.** `da` stays a primitive, `status:'missing'` until the extractor
> supplies it from the cash-flow statement. `ebitda` is **also** an optional primitive whose
> `source` records HOW it was obtained: `'fmp_reported'` (provider EBITDA — carries *their*
> add-back choices) vs `'derived_ebit_plus_da'` (self-derived from our primitives — carries
> *ours*). **These are different numbers.** The deck prefers self-derived; when it falls back to
> provider-reported EBITDA, that provenance **must** surface in §16 (Data Verification). Today's
> builders emit only provider `ebitda` and no `da` → Phase 0c wraps provider ebitda as
> `source:'fmp_reported'` and leaves `da` `status:'missing'`.

### Income statement
| Field | Type | Unit | Kind | Notes |
|-------|------|------|------|-------|
| `ebitda` | number | $M | P (optional) | **Dual-provenance.** `source ∈ {'fmp_reported','derived_ebit_plus_da'}` — different numbers (provider add-backs vs ours). Deck prefers self-derived; fallback to provider-reported surfaces in §16 |
| `cogs` | number | $M | P (optional) | Cost of goods sold |
| `grossProfit` | number | $M | P (optional) | Reported line item; derivable `revenue − cogs` when absent but stored only when reported |
| `sga` | number | $M | P (optional) | Selling, general & admin |
| `rnd` | number | $M | P (optional) | Research & development |
| `otherOpex` | number | $M | P (optional) | Other operating expense |
| `interestExpense` | number | $M | P (optional) | |
| `otherIncome` | number | $M | P (optional) | Non-operating other income/(expense) |
| `pretaxIncome` | number | $M | P (optional) | Reported; derivable `ebit − interestExpense + otherIncome` |
| `tax` | number | $M | P (optional) | Income tax expense |

### Balance sheet
| Field | Type | Unit | Kind | Notes |
|-------|------|------|------|-------|
| `ar` | number | $M | P (optional) | Accounts receivable |
| `inventory` | number | $M | P (optional) | |
| `totalCurrentAssets` | number | $M | P (optional) | |
| `totalAssets` | number | $M | P (optional) | |
| `ap` | number | $M | P (optional) | Accounts payable |
| `currentPortionLTD` | number | $M | P (optional) | Current portion of long-term debt |
| `longTermDebt` | number | $M | P (optional) | |
| `totalLiabilities` | number | $M | P (optional) | |
| `totalEquity` | number | $M | P (optional) | Total shareholders' equity |
| `shortTermInvestments` | number | $M | P (optional) | Short-term marketable securities (net-debt convention b). *Present in code today; add to schema.* |
| `tangibleBookValue` | number | $M | P (optional, bank) | Bank P/TBV basis; null for non-financials |

### Cash flow
| Field | Type | Unit | Kind | Notes |
|-------|------|------|------|-------|
| `cashFromOps` | number | $M | P (optional) | Operating cash flow |
| `capex` | number | $M | P (optional) | Capital expenditure (sign per source; normalize at extraction) |
| `stockComp` | number | $M | P (optional) | Stock-based compensation |
| `changeInWC` | number | $M | P (optional) | Change in working capital |

> **freeCashFlow is derived** (`cashFromOps − |capex|`) — NOT a field. ⚠️ Decision to confirm:
> today's EDGAR/FMP builders emit `freeCashFlow` directly and do **not** emit `cashFromOps`/`capex`.
> Making FCF derived means a source that supplies only FCF leaves `cashFromOps`/`capex`
> `missing` and FCF underivable. Alternative: keep `freeCashFlow` as an optional primitive.
> Flagging for your call (§7, Open decisions).

### Market data
| Field | Type | Unit | Kind | Notes |
|-------|------|------|------|-------|
| `sharePrice` | number | $/sh | P (optional) | Live price; `missing` when no live quote |
| `sharesOutstanding` | number | sh(M) | P (required for caps) | Point-in-time count |
| `dilutedShares` | number | sh(M) | P (optional) | Weighted-avg diluted — EPS math only, never caps |
| `eps` | number | $/sh | P (optional) | Reported diluted EPS |
| `marketCap` | — | $M | **D** | **Not stored.** Trading equity value = `sharePrice × sharesOutstanding`. See §4/§5 (D14). |

### Qualitative
| Field | Type | Unit | Kind | Notes |
|-------|------|------|------|-------|
| `businessDescription` | string | — | P (optional) | |
| `hq` | string | — | P (optional) | Headquarters location |
| `employees` | number | count | P (optional) | |
| `foundingYear` | number | year | P (optional) | Founded (≠ IPO year) |
| `sic` | string | 4-digit | P (optional) | SEC SIC code (bank/restaurant gating reads this) |
| `sector` | string | — | P (optional) | GICS-style sector; `sicDescription` is the current near-equivalent |

### Meta (object-level; per-field wrapper overrides where a field differs)
| Field | Type | Kind | Notes |
|-------|------|------|-------|
| `currency` | string (ISO 4217) | M (required) | Object reporting currency, e.g. `"USD"` |
| `scale` | `"millions"` \| `"thousands"` \| `"units"` | M (required) | Multiplier the values are expressed in (`$M` today) |
| `fiscalYearEnd` | string `YYYY-MM-DD` | M (optional) | Period-end of the annual figures |
| `periodLabel` | string | M (optional) | e.g. `"FY2025"`, `"LTM"` |
| `hasMarketData` | boolean | M (required) | Whether `sharePrice` & `sharesOutstanding` are present (drives cap availability) |

---

## 2. Type & requiredness summary

- **Required (six):** revenue, ebit, da, netIncome, cash, totalDebt. Plus meta `currency`,
  `scale`, `hasMarketData`. Plus `sharesOutstanding` for any cap/EPS-per-share use.
- **Optional primitives:** everything else in §1 marked P (optional).
- **Derived (never stored):** §4.

A **required** field that a source cannot supply is emitted as `status:'missing'`, `value:null`
— present in the object, honestly absent. It is never omitted and never defaulted to 0.

---

## 3. The wrapper

Every field is a wrapper object, never a bare value in the canonical shape:

```js
{
  value:      number | string | null,   // the datum; null ONLY when status === 'missing'
  currency:   string,                    // ISO 4217; defaults to meta.currency
  scale:      'millions'|'thousands'|'units', // defaults to meta.scale
  source:     'sec_edgar'|'fmp'|'yahoo'|'manual'|'non_gaap'|'derived',
  page:       string | null,             // document locator (filing page / API path); null if n/a
  label:      string | null,             // source line-item label, e.g. 'Total revenues'
  confidence: number,                    // 0..1
  status:     'verified'|'review'|'missing'|'override',
}
```

The **wrapper is never null and never 0** — it is always an object. Only `value` may be null,
and only when `status === 'missing'`. This is the entire point: **zero and missing are
different objects**, not the same falsy scalar.

`status` semantics:
- **verified** — sourced and trusted (single trusted source or ≥2 agreeing). A real reported
  `0` is `{ value: 0, status: 'verified' }`.
- **review** — sourced but flagged (sources disagree, or a single low-confidence source).
- **missing** — no source returned it. `value: null`.
- **override** — manually entered / user-edited, superseding any fetched value.

---

## 4. Derived values — NOT schema fields

Computed in JS from stored primitives at read time; never stored, never extracted, never
carried in the wrapper set:

| Derived | Formula (from primitives) |
|---------|---------------------------|
| `ebitda` (self-derived) | `ebit + da` — the **preferred** basis. NOTE: `ebitda` is *also* storable as an optional primitive when only provider EBITDA is available (`source:'fmp_reported'`), §1. The two are different numbers; the deck prefers self-derived and flags provider fallback in §16 |
| `netDebt` | `totalDebt − cash − shortTermInvestments` |
| `enterpriseValue` (EV) | `equityValue + netDebt` |
| `tradingEquityValue` (trading "market cap") | `sharePrice × sharesOutstanding` |
| `freeCashFlow` | `cashFromOps − |capex|` — **always derived**; renders "—" until the extractor supplies both components. Never import a provider FCF (would silently adopt their capex convention) |
| all **margins** | grossMargin, ebitMargin, ebitdaMargin, netMargin, fcfMargin, … = line ÷ revenue |
| all **growth rates** | revenueGrowth, YoY, CAGR, … |
| all **multiples** | EV/Revenue, EV/EBITDA, P/E, P/TBV, … |
| `acquisitionEquityValue` | `offerPricePerShare × sharesOutstanding` — **deal-level**, not a company field |
| premium, accretion/dilution, exchange ratio, ownership split | all deal-model derived |

---

## 5. D14 resolution — the `marketCap` / `currentMarketCap` ambiguity

**Today (do not change in this phase):** `currentMarketCap` = trading cap (`price × shares`,
745/779) and `marketCap` = acquisition price (`offer × shares`, 749) — two different
quantities under near-identical names, the root of the §B-vs-Dashboard P/TBV split (D13).

**Target (this schema):** neither is a stored field. Both are **derived**, with unambiguous
names, computed where used:
- **`tradingEquityValue`** = `sharePrice × sharesOutstanding` — company-level, the real
  trading equity value (today's `currentMarketCap`).
- **`acquisitionEquityValue`** = `offerPricePerShare × sharesOutstanding` — **deal-level**,
  lives in the deal model, never on the company object (today's overloaded `marketCap`).

The schema stores only the primitives (`sharePrice`, `sharesOutstanding`); no field named
`marketCap`. `hasMarketData` signals whether a trading value is computable at all. This is a
**naming target for new code**, not a rename order for existing code (D14 stays deferred).

---

## 6. Mapping — the three entry points (EDGAR shown as the fullest reference)

`✓` = supplied · `—` = not supplied (→ `status:'missing'`) · `≈` = derivable at extraction.
EDGAR (`sec_edgar`, server.js:733) is the most complete builder and the de-facto reference;
FMP (server.js:821) and Yahoo (server.js:877) and Manual (App.js:431-438) diverge from it.

| Schema field | EDGAR key | FMP key | Yahoo key | Manual key |
|--------------|-----------|---------|-----------|------------|
| revenue | `revenue` ✓ | `revenue` ✓ | `revenue` ✓ | `companyXRevenue` ✓ |
| ebit | `operatingIncome` ✓ | `operatingIncome` ✓ | — | `companyXOperatingIncome` ✓ |
| da | — (≈ ebitda−ebit) | — (≈) | — | — |
| netIncome | `netIncome` ✓ | `netIncome` ✓ | `netIncome` ✓ | `companyXNetIncome` ✓ |
| cash | `cash` ✓ | `cash` ✓ | `cash` ✓ | `companyXCash` ✓ |
| totalDebt | `debt` ✓ | `debt` ✓ | `debt` ✓ | `companyXDebt` ✓ |
| grossProfit | `grossProfit` ✓ | `grossProfit` ✓ | — | `companyXGrossProfit` ✓ |
| shortTermInvestments | `shortTermInvestments` ✓ | — | — | `companyXSti` ✓ |
| totalAssets | `totalAssets` ✓ | — | — | — |
| tangibleBookValue | (bankFacts) ✓ | (bankFacts) ✓ | — | — |
| cogs / sga / rnd / otherOpex / interestExpense / otherIncome / pretaxIncome / tax | — | — | — | — |
| ar / inventory / totalCurrentAssets / ap / currentPortionLTD / longTermDebt / totalLiabilities / totalEquity | — | — | — | — |
| cashFromOps / capex / stockComp / changeInWC | — (only `freeCashFlow`) | — (only `freeCashFlow`) | — | — |
| sharePrice | — (EDGAR carries no price) | `sharePrice` ✓ | `sharePrice` ✓ | `currentSharePriceX` ✓ |
| sharesOutstanding | `shares` ✓ | `shares` ✓ | `shares` ✓ | `companyXShares` ✓ |
| dilutedShares | `dilutedShares` ✓ | `dilutedShares` ✓ | — | `companyXDilutedShares` ✓ |
| eps | `eps` ✓ | `eps` ✓ | `eps` ✓ | `companyXEPS` ✓ |
| businessDescription / hq / employees / foundingYear | — (via /api/profile) | — (via /api/profile) | — | — |
| sic | `sic` ✓ | — | — | — |
| sector | ≈ `sicDescription` | — | — | — |
| currency | — (USD implied) | `reportedCurrency` ✓ | — (USD implied) | — (USD implied) |
| scale | 'millions' (implied) | 'millions' (implied) | 'millions' (implied) | 'millions' (implied) |
| fiscalYearEnd | `fiscalYearEnd` ✓ | — | — | ≈ `companyXBsBasis`/`LtmRevenue` |
| periodLabel | ≈ `fiscalYear`+`fiscalPeriod` | — | — | ≈ (LTM basis) |

**What each source cannot supply:**
- **EDGAR** — `sharePrice` (by design; comes from `/api/price`), `da`, full income-statement
  detail (cogs/sga/rnd/…), full balance sheet (ar/inventory/…), cash-flow components, sector.
- **FMP** — `totalAssets`, `shortTermInvestments`, `sic`, `fiscalYearEnd`/period, `da`,
  income-statement & balance-sheet detail, cash-flow components. **Adds** `currency` +
  FX provenance (the only source that does).
- **Yahoo** — the sparsest: also missing `operatingIncome` (ebit), `grossProfit`,
  `dilutedShares`, `totalAssets`, `shortTermInvestments`, `sic`, fiscal period, plus all of
  the above. ⚠️ Uses `|| 0` **23×** in server.js — it emits **0 for missing** today, the exact
  zero-vs-missing collision the wrapper exists to fix. Wrapping Yahoo is the highest-value
  builder in this phase.
- **Manual** — flat per-company keys, defaulted to `0`/`null`; no `totalAssets`, no
  income-statement/balance-sheet/cash-flow detail, no qualitative, no `currency`/`sic`.

**Non-GAAP overlay (context, not a builder):** `resolveAccretionBasis` (App.js:73-85) overwrites
three manual keys per company — `netIncome`, `EPS` (`dilutedEPS`), `dilutedShares` — when both
sides reconcile. In the schema these become wrapper writes with `source:'non_gaap'`,
`status:'override'`.

---

## 7. Resolved decisions

1. **`da` + `ebitda`.** `da` stays a primitive, `status:'missing'` until the extractor supplies
   it from the cash-flow statement. `ebitda` is ALSO an optional primitive with dual provenance
   (`'fmp_reported'` vs `'derived_ebit_plus_da'`) — different numbers; the deck prefers
   self-derived and surfaces provider fallback in §16. (§1, §4)
2. **`freeCashFlow` — DERIVED, not stored.** Renders "—" until `cashFromOps` + `capex` are
   extracted. Storing a provider FCF would import their capex convention. (§4)
3. **`marketCap` naming — `tradingEquityValue` / `acquisitionEquityValue`.** Confirmed. (§5)

All resolved; everything else follows the store-primitives axiom.
