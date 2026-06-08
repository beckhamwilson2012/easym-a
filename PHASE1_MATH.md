# Phase 1 — Corrected Merger Math (verified by hand for CRM acquires TEAM)

All $ figures in millions ($M) unless noted. Share counts in millions. Per-share in $.

## Inputs used by the model
- Acquirer (Company A): `companyAShares`, `companyAEPS`, `companyANetIncome`, `companyARevenue`,
  `companyAEBITDA`, `companyADebt`, `currentSharePriceA` (real live price).
- Target (Company B): `companyBShares`, `companyBEPS`, `companyBNetIncome`, `companyBRevenue`,
  `companyBEBITDA`, `companyBCash`, `companyBDebt`, `currentSharePriceB` (real live price).
- Deal: `offerPricePerShare`, `cashPercent` (0–100), `transactionFees` ($M, one-time),
  `synergiesY1/Y2/Y3` ($M, pre-tax annual run-rate).

## Documented assumptions (transaction assumptions, not fetched data)
- `TAX_RATE = 0.21` — US federal statutory rate; applied to synergies and to financing interest.
- `DEBT_INTEREST_RATE = 0.05` — incremental acquisition-financing cost, ON by default. A cash deal
  carries a real interest drag: the cash portion is funded by new debt at the marginal IG rate. We
  charge it on the FULL cash portion, after tax. Set to 0 for the simpler quick-accretion convention.
- Standalone EPS for the accretion comparison = acquirer net income ÷ shares (same basis as the
  pro-forma EPS), not the reported diluted EPS — so the comparison is apples-to-apples.

## Formulas
```
stockPercent        = 100 - cashPercent
totalPurchasePrice  = offerPricePerShare * companyBShares          // offer($) × shares(M) = $M
cashPortion         = totalPurchasePrice * cashPercent/100
stockPortion        = totalPurchasePrice * stockPercent/100

// Acquirer price — REAL price; only fall back to EPS×15 P/E proxy if no live price (and flag it)
acquirerPrice       = currentSharePriceA > 0 ? currentSharePriceA
                                             : (companyAEPS > 0 ? companyAEPS*15 : 0)
newSharesIssued     = acquirerPrice > 0 ? stockPortion / acquirerPrice : 0   // never 0 when stock>0 & price>0
totalShares         = companyAShares + newSharesIssued

// Recurring pro-forma net income (one-time transaction fees do NOT belong here)
afterTaxSynergies   = synergiesY1 * (1 - TAX_RATE)
newInterestAfterTax = cashPortion * DEBT_INTEREST_RATE * (1 - TAX_RATE)   // financing ON (5%)
proFormaNetIncome   = companyANetIncome + companyBNetIncome + afterTaxSynergies - newInterestAfterTax
proFormaEPS         = totalShares > 0 ? proFormaNetIncome / totalShares : 0

// Accretion / dilution — standalone EPS on the SAME net-income÷shares basis as the pro-forma EPS
standaloneEPS       = companyAShares > 0 ? companyANetIncome / companyAShares : companyAEPS
accretionMeaningful = standaloneEPS > 0 && proFormaEPS > 0   // suppress % off any non-positive base
isAccretive         = accretionMeaningful && proFormaEPS > standaloneEPS   // degenerate → leans dilutive
epsChangePct        = accretionMeaningful ? (proFormaEPS/standaloneEPS - 1)*100 : null

// Premium — REAL target price basis
targetPrice         = currentSharePriceB > 0 ? currentSharePriceB
                                             : (companyBEPS > 0 ? companyBEPS*15 : 0)
purchasePremium     = targetPrice > 0 ? (offerPricePerShare/targetPrice - 1)*100 : null

// Multiples & leverage (guard non-positive denominators → N/A)
enterpriseValue     = totalPurchasePrice + companyBDebt - companyBCash
evEBITDA            = companyBEBITDA > 0 ? enterpriseValue / companyBEBITDA : N/A
peRatio             = companyBEPS    > 0 ? offerPricePerShare / companyBEPS : N/A
combinedEBITDA      = companyAEBITDA + companyBEBITDA + synergiesY1          // synergies pre-tax
combinedDebt        = companyADebt + companyBDebt + cashPortion             // cash funded by new debt
debtEBITDA          = combinedEBITDA > 0 ? combinedDebt / combinedEBITDA : N/A
combinedRevenue     = companyARevenue + companyBRevenue
```

## Hand check — CRM acquires TEAM, offer $150, 60% cash, Y1 synergies $935 (A.price 188, B.price 116)
Data: A=CRM shares 929, NI 7457, price 188.  B=TEAM shares 262, NI -257, price 116, EBITDA -38.

- totalPurchasePrice = 150 × 262 = **39,300** ($39.3B)
- premium = 150/116 − 1 = **+29.3%**
- cashPortion = 23,580 ; stockPortion = 15,720
- newSharesIssued = 15,720 / 188 = **≈83.6M** ✓ (non-zero!)
- totalShares = 929 + 83.6 = **1,012.6**
- afterTaxSynergies = 935 × 0.79 = 738.7
- newInterestAfterTax = 23,580 × 0.05 × 0.79 = **931.4** (after-tax interest on the cash portion)
- proFormaNetIncome = 7457 − 257 + 738.7 − 931.4 = **7,007.3**
- proFormaEPS = 7,007.3 / 1,012.6 = **$6.92**
- standaloneEPS = 7457/929 = **$8.03** → proForma 6.92 < 8.03 → **DILUTIVE**, epsChangePct = (6.92/8.03−1) = **−13.8%**
- evEBITDA: TEAM EBITDA −38 ≤ 0 → **n/m** (negative EBITDA) ; peRatio: TEAM EPS −0.98 ≤ 0 → **n/m** (negative earnings)

(With live prices ≈$186/$99 the headline shifts slightly — newShares ≈84.5M, proFormaEPS ≈$6.91 —
because the live acquirer price differs from the $188 assumed here. Still DILUTIVE.)

## Reactivity spot-checks (A.price 188, financing ON)
- offer $150→$180: premium +29.3%→+55.2%, newShares 83.6→100, financing 931→1118, proFormaEPS 6.92→6.63. ✓
- cash 60%→20%: less cash → less financing (931→310) but more shares (84→167); net proFormaEPS 6.92→6.96. ✓
- synergy Y1 935→2000: proFormaEPS 6.92→7.75. ✓

Negative-EPS rule: if standaloneEPS ≤ 0 OR proFormaEPS ≤ 0 → `accretionMeaningful = false`,
`epsChangePct = null` (shown "N/M"), and `isAccretive = false` (leans dilutive). No more
"−$0.98 → $0.00 = −100% ✓ Accretive".
