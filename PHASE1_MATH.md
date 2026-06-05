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
- `TAX_RATE = 0.21` — US federal statutory rate; applied to synergies and new interest.
- `DEBT_INTEREST_RATE = 0.05` — marginal cost of new acquisition debt; applied to the cash portion.

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
newInterestAfterTax = cashPortion * DEBT_INTEREST_RATE * (1 - TAX_RATE)
proFormaNetIncome   = companyANetIncome + companyBNetIncome + afterTaxSynergies - newInterestAfterTax
proFormaEPS         = totalShares > 0 ? proFormaNetIncome / totalShares : 0

// Accretion / dilution
standaloneEPS       = companyAEPS
isAccretive         = proFormaEPS > standaloneEPS
accretionMeaningful = standaloneEPS > 0           // % from a negative base is not meaningful
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

## Hand check — CRM acquires TEAM, offer $150, 60% cash, Y1 synergies $935
Data: A=CRM shares 929, EPS 7.85, NI 7457, price 186.72, debt 14439.
      B=TEAM shares 262, EPS -0.98, NI -257, price 98.72, cash 2513, debt 988, EBITDA -38.

- totalPurchasePrice = 150 × 262 = **39,300** ($39.3B)
- fee tier (>$10B → 0.3%) = 39,300 × 0.003 = **118** ✓ (Phase 2.4 target)
- cashPortion = 23,580 ; stockPortion = 15,720
- newSharesIssued = 15,720 / 186.72 = **84.2M** ✓ (non-zero!)
- totalShares = 929 + 84.2 = 1,013.2
- afterTaxSynergies = 935 × 0.79 = 738.7
- newInterestAfterTax = 23,580 × 0.05 × 0.79 = 931.4
- proFormaNetIncome = 7457 − 257 + 738.7 − 931.4 = 7,007.3
- proFormaEPS = 7,007.3 / 1,013.2 = **$6.92**
- standaloneEPS 7.85 → proForma 6.92 < 7.85 → **DILUTIVE**, epsChangePct = (6.92/7.85−1) = **−11.8%**
- premium = 150/98.72 − 1 = **+51.9%**
- combinedEBITDA = 9531 − 38 + 935 = 10,428 ; combinedDebt = 14439 + 988 + 23,580 = 39,007 ;
  debtEBITDA = 39,007/10,428 = **3.7x**
- evEBITDA: TEAM EBITDA −38 ≤ 0 → **N/A** (correctly guarded)
- peRatio: TEAM EPS −0.98 ≤ 0 → **N/A** (correctly guarded)

## Reactivity spot-checks
- offer $150→$180: premium +51.9%→+82.3%, newShares 84.2→101.0, proFormaEPS 6.92→6.62. ✓
- cash 60%→20%: newShares 84.2→168.4, interest drag 931→310, proFormaEPS 6.92→6.95,
  stock issuance 9.1%→18.1% of acquirer shares (still < 19.9% no-vote). ✓

Negative-acquirer-EPS edge (e.g. if TEAM were the acquirer): standaloneEPS ≤ 0 →
epsChangePct = null (shown "N/M"), accretive/dilutive still by raw EPS comparison; narrative
avoids reporting a percentage from a negative base (no more "−100% ✓ Accretive").
