import { fmtMoney, fmtPerShare, fmtPct } from '../components/deck/shared/deckTokens';

// Pure-function explainer registry.
// Each function takes relevant deal/company data and returns:
//   { formula, inputs: [{label, value}], result, notes, sources }
// Call lazily on click — not at render time.

// ── Market data ───────────────────────────────────────────────────────────────

export function explainSharePrice({ name, price, source }) {
  return {
    formula: 'Market share price = most recent trade on primary exchange',
    inputs: [
      { label: 'Company', value: name || 'Target' },
      { label: 'Share price', value: fmtPerShare(price) },
      { label: 'Source', value: source || 'Live market data' },
    ],
    result: fmtPerShare(price),
    notes: 'Refreshed when you select a company. Used as the unaffected baseline for computing the acquisition premium.',
    sources: ['Financial Modeling Prep', 'Finnhub', 'Alpha Vantage'],
  };
}

// ── Deal terms ────────────────────────────────────────────────────────────────

export function explainDealSize({ offerPrice, shares, targetName }) {
  const offer = parseFloat(offerPrice) || 0;
  const sharesN = parseFloat(shares) || 0;
  const total = offer * sharesN;
  return {
    formula: 'Deal Size (Equity Value) = Offer Price × Shares Outstanding',
    inputs: [
      { label: 'Offer price / share', value: fmtPerShare(offer) },
      { label: `${targetName || 'Target'} shares outstanding`, value: `${sharesN.toFixed(1)}M` },
    ],
    result: fmtMoney(total),
    notes: 'This is the equity purchase price only — it does not include assumed debt. See Enterprise Value for the full economic cost of the acquisition.',
  };
}

export function explainCashPercent({ cashPercent, dealSize }) {
  const pct = parseFloat(cashPercent) || 0;
  const stock = 100 - pct;
  const d = parseFloat(dealSize) || 0;
  return {
    formula: 'Cash/Stock mix determines funding source and share dilution',
    inputs: [
      { label: 'Cash portion', value: `${pct.toFixed(0)}% = ${fmtMoney(d * pct / 100)}` },
      { label: 'Stock portion', value: `${stock.toFixed(0)}% = ${fmtMoney(d * stock / 100)}` },
    ],
    result: `${pct.toFixed(0)}% cash / ${stock.toFixed(0)}% stock`,
    notes: 'All-cash deals are immediately accretive if the target earns more than the after-tax cost of debt, but exhaust liquidity. Stock deals preserve cash but dilute existing shareholders. Mixed structures balance both concerns.',
  };
}

// ── Enterprise value ──────────────────────────────────────────────────────────

export function explainEV({ totalPurchasePrice, debt, cash, targetName }) {
  const pp = parseFloat(totalPurchasePrice) || 0;
  const d = parseFloat(debt) || 0;
  const c = parseFloat(cash) || 0;
  const ev = pp + d - c;
  return {
    formula: 'Enterprise Value = Equity Value + Debt − Cash',
    inputs: [
      { label: `Equity value (offer × shares)`, value: fmtMoney(pp) },
      { label: `+ ${targetName || 'Target'} debt`, value: fmtMoney(d) },
      { label: `− ${targetName || 'Target'} cash`, value: fmtMoney(c) },
    ],
    result: `EV = ${fmtMoney(ev)}`,
    notes: 'Enterprise value represents the total takeover cost — what you pay for the equity plus the debt you assume, less the cash you acquire. It is capital-structure-neutral, making it the preferred basis for cross-company valuation comparisons.',
    sources: ['CFA Institute', 'SEC filings'],
  };
}

// ── Valuation multiples ───────────────────────────────────────────────────────

export function explainEvEbitda({ ev, ebitda, multiple }) {
  return {
    formula: 'EV/EBITDA = Enterprise Value ÷ EBITDA',
    inputs: [
      { label: 'Enterprise value', value: fmtMoney(ev) },
      { label: 'EBITDA', value: fmtMoney(parseFloat(ebitda) || 0) },
    ],
    result: multiple != null && multiple !== 'N/A' ? `${parseFloat(multiple).toFixed(1)}x` : 'N/A',
    notes: 'Most widely used deal multiple. Typical ranges: tech/software 15–25x, industrials 8–12x, consumer 10–15x. Paid multiples above sector median imply expected above-average synergies or growth.',
    sources: ['Damodaran NYU sector data', 'Bloomberg sector comps'],
  };
}

export function explainPeRatio({ offerPrice, eps, multiple }) {
  return {
    formula: 'P/E = Offer Price ÷ Target EPS',
    inputs: [
      { label: 'Offer price / share', value: fmtPerShare(parseFloat(offerPrice) || 0) },
      { label: 'Target EPS', value: fmtPerShare(parseFloat(eps) || 0) },
    ],
    result: multiple != null && multiple !== 'N/A' ? `${parseFloat(multiple).toFixed(1)}x` : 'N/A',
    notes: 'Used when EBITDA is unavailable or for financial companies where EBITDA is less meaningful. S&P 500 forward P/E is typically 17–22x; deal P/Es for quality public targets often reach 25–35x including premium.',
  };
}

export function explainDebtEbitda({ combinedDebt, combinedEbitda, multiple }) {
  return {
    formula: 'Debt/EBITDA = Combined Net Debt ÷ Combined EBITDA (post-synergies)',
    inputs: [
      { label: 'Combined debt (incl. cash used)', value: fmtMoney(combinedDebt) },
      { label: 'Combined EBITDA', value: fmtMoney(parseFloat(combinedEbitda) || 0) },
    ],
    result: multiple != null && multiple !== 'N/A' ? `${parseFloat(multiple).toFixed(1)}x` : 'N/A',
    notes: 'Above 5x is considered highly leveraged and can restrict credit access. Investment-grade companies typically maintain below 3x. LBO transactions often reach 6–8x but carry refinancing risk.',
    sources: ['S&P Global ratings methodology'],
  };
}

// ── Synergies ─────────────────────────────────────────────────────────────────

export function explainSynergies({ synY1, synY2, synY3, targetRevenue, isBank, targetNIE }) {
  const y1 = parseFloat(synY1) || 0;
  const y2 = parseFloat(synY2) || 0;
  const y3 = parseFloat(synY3) || 0;

  if (isBank) {
    const nie = parseFloat(targetNIE) || 0;
    const niePct = nie > 0 ? ` (${(y1 / nie * 100).toFixed(1)}% of target NIE)` : '';
    return {
      formula: 'Cost Savings = headcount reduction + branch consolidation + technology integration + back-office overlap (scaled to the target expense base)',
      inputs: [
        { label: 'Year 1 cost savings', value: `${fmtMoney(y1)}${niePct}` },
        { label: 'Year 2 cost savings', value: fmtMoney(y2) },
        { label: 'Year 3 cost savings', value: fmtMoney(y3) },
      ],
      result: `Year 3 run-rate: ${fmtMoney(y3)}`,
      notes: 'Bank mergers typically target 15–25% of the TARGET non-interest expense (NIE) base as cost savings — synergies are bounded by the target being absorbed, not the combined entity. Revenue synergies from cross-sell are harder to model reliably and are excluded here. Historical cost-savings realization: ~70–80% of announced targets.',
      sources: ['FDIC merger research', 'Federal Reserve bank merger analysis'],
    };
  }

  const rev = parseFloat(targetRevenue) || 0;
  const revPct = rev > 0 ? ` (${(y1 / rev * 100).toFixed(1)}% of target revenue)` : '';
  return {
    formula: 'Synergies ≈ target revenue × year-ramp rate (~2% Y1 → ~5% Y3); blend of ~55% cost + ~45% revenue synergies',
    inputs: [
      { label: 'Year 1 synergies', value: `${fmtMoney(y1)}${revPct}` },
      { label: 'Year 2 synergies', value: fmtMoney(y2) },
      { label: 'Year 3 synergies', value: fmtMoney(y3) },
    ],
    result: `Year 3 run-rate: ${fmtMoney(y3)}`,
    notes: 'Synergies typically ramp from ~2% of TARGET revenue in Year 1 to ~5% by Year 3 — scaled to the target being absorbed, not the combined entity. Historical realization averages 60–70% of announced targets. This model blends cost and revenue synergies; real deals track them separately.',
    sources: ['McKinsey M&A research', 'Bain & Company synergy studies'],
  };
}

// ── EPS ───────────────────────────────────────────────────────────────────────

export function explainEpsChange({ acquirerEPS, proFormaEPS, changePct, acquirerName }) {
  const a = parseFloat(acquirerEPS) || 0;
  const pf = parseFloat(proFormaEPS) || 0;
  // Accretion is only meaningful from a positive EPS base. dealCalc nulls changePct in that case; a null/
  // NaN changePct must render 'not meaningful', NOT default to 0 → "accretive" (the bug for a loss-making
  // acquirer). Positive-base deals are unchanged.
  const meaningful = changePct != null && changePct !== '' && Number.isFinite(parseFloat(changePct));
  const pct = meaningful ? parseFloat(changePct) : null;
  const direction = !meaningful ? 'not meaningful' : pct >= 0 ? 'accretive' : 'dilutive';
  return {
    formula: 'Pro Forma EPS = (Combined Net Income + After-Tax Synergies − After-Tax Financing Cost) ÷ (Diluted Acquirer Shares + New Shares Issued)',
    inputs: [
      { label: `${acquirerName || 'Acquirer'} standalone EPS`, value: fmtPerShare(a) },
      { label: 'Pro forma EPS', value: fmtPerShare(pf) },
      { label: 'Change', value: meaningful ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : 'n/m (non-positive EPS base)' },
    ],
    result: meaningful ? `Deal is ${direction}` : 'Accretion/(dilution) is not meaningful — the acquirer or pro-forma EPS is non-positive',
    notes: 'EPS accretion/dilution is the primary internal metric buyers use to evaluate deals. Management teams typically target 5%+ accretion within 2 years. Dilution beyond −5% in Year 1 requires a compelling strategic narrative.',
  };
}

export function explainProFormaEPS({ combinedNetIncome, synergiesY1, totalShares, acquirerShares, newShares }) {
  const ni = parseFloat(combinedNetIncome) || 0;
  const syn = parseFloat(synergiesY1) || 0;
  const ts = parseFloat(totalShares) || 0;
  // After-tax financing interest is netted into pro-forma net income (matches dealCalc).
  const pf = ts > 0 ? (ni + syn) / ts : 0;
  return {
    formula: 'Pro Forma EPS = (Combined Net Income + After-Tax Synergies − After-Tax Financing Cost) ÷ (Diluted Acquirer Shares + New Shares Issued)',
    inputs: [
      { label: 'Combined net income', value: fmtMoney(ni) },
      { label: '+ After-tax synergies', value: fmtMoney(syn) },
      { label: 'Diluted acquirer shares', value: `${(parseFloat(acquirerShares) || 0).toFixed(1)}M` },
      { label: '+ New shares issued', value: `${(parseFloat(newShares) || 0).toFixed(1)}M` },
    ],
    result: fmtPerShare(pf),
    notes: 'New shares are issued at the acquirer\'s live market price (primary); a 15× EPS proxy is used only as a fallback when no live price is available. After-tax financing interest on the cash portion is netted into pro-forma net income. More shares issued = more dilution = lower pro forma EPS.',
  };
}

// ── Deal score ────────────────────────────────────────────────────────────────

export function explainDealScore({ score, results }) {
  const epsChange = parseFloat(results?.epsChangePct) || 0;
  const premium = parseFloat(results?.purchasePremium) || 0;
  const debtEBITDA = results?.debtEBITDA !== 'N/A' ? parseFloat(results?.debtEBITDA) : null;
  const dealSize = parseFloat(results?.totalPurchasePrice) || 0;

  const inputs = [
    { label: 'Base score', value: '5 / 10' },
    { label: 'EPS accretive?', value: epsChange >= 0 ? `Yes (+2) — ${epsChange.toFixed(1)}%` : `No (−2) — ${epsChange.toFixed(1)}%` },
    { label: 'Purchase premium', value: `${premium.toFixed(1)}%${premium < 30 ? ' (+1)' : premium > 50 ? ' (−1)' : ''}` },
    ...(debtEBITDA !== null ? [{ label: 'Debt/EBITDA', value: `${debtEBITDA.toFixed(1)}x${debtEBITDA < 3 ? ' (+1)' : debtEBITDA > 5 ? ' (−1)' : ''}` }] : []),
    ...(dealSize > 500000 ? [{ label: 'Deal size > $500B', value: '−2 antitrust risk' }] : []),
  ];

  return {
    formula: 'Deal Score = base 5 + EPS accretion bonus + leverage adjustment + premium adjustment + size penalty',
    inputs,
    result: `${score} / 10`,
    notes: 'Scores 8–10: strong economics. Scores 5–7: neutral — may be strategic but not financially compelling. Below 5: significant financial risk. This model scores seven quantitative factors; real deal committees assess dozens more.',
  };
}

// ── Bank-specific ─────────────────────────────────────────────────────────────

export function explainPTBV({ marketCap, tangibleBookValue, ratio, companyName }) {
  const mc = parseFloat(marketCap) || 0;
  const tbv = parseFloat(tangibleBookValue) || 0;
  return {
    formula: 'P/TBV = Market Cap ÷ Tangible Book Value',
    inputs: [
      { label: `${companyName || 'Company'} market cap`, value: fmtMoney(mc) },
      { label: 'Tangible book value', value: fmtMoney(tbv) },
    ],
    result: ratio != null ? `${parseFloat(ratio).toFixed(2)}x` : 'N/A',
    notes: 'Price-to-Tangible Book Value is the primary valuation metric for bank M&A. Historical deal premiums to TBV: 1.3–2.5x for healthy community banks; 0.8–1.2x for troubled institutions. Tangible book excludes goodwill and intangibles, giving a clean measure of hard capital.',
    sources: ['FDIC bank merger data', 'SNL Financial'],
  };
}

export function explainCET1({ cet1Ratio, rwa, companyName }) {
  const ratio = parseFloat(cet1Ratio) || 0;
  const rwaN = parseFloat(rwa) || 0;
  return {
    formula: 'CET1 Ratio = Common Equity Tier 1 Capital ÷ Risk-Weighted Assets',
    inputs: [
      { label: `${companyName || 'Company'} CET1 ratio`, value: fmtPct(ratio * 100) },
      { label: 'Risk-weighted assets', value: fmtMoney(rwaN) },
    ],
    result: fmtPct(ratio * 100),
    notes: 'CET1 is the highest-quality capital (common equity only). Minimum regulatory requirement: 4.5%. Well-capitalized threshold: 10%. G-SIBs must maintain buffers above these minima. A merger that pushes combined CET1 below 10% may require a capital raise before regulatory approval.',
    sources: ['Basel III framework', 'Federal Reserve capital rules'],
  };
}

export function explainCombinedCET1({ targetCET1, acquirerCET1, targetRWA, acquirerRWA }) {
  const tRWA = parseFloat(targetRWA) || 0;
  const aRWA = parseFloat(acquirerRWA) || 0;
  const tC = parseFloat(targetCET1) || 0;
  const aC = parseFloat(acquirerCET1) || 0;
  const combined = tRWA + aRWA > 0 ? (tC * tRWA + aC * aRWA) / (tRWA + aRWA) : null;
  return {
    formula: 'Combined CET1 = (Target CET1 × Target RWA + Acquirer CET1 × Acquirer RWA) ÷ Combined RWA',
    inputs: [
      { label: 'Target CET1 × RWA', value: fmtMoney(tC * tRWA) },
      { label: 'Acquirer CET1 × RWA', value: fmtMoney(aC * aRWA) },
      { label: 'Combined RWA', value: fmtMoney(tRWA + aRWA) },
    ],
    result: combined !== null ? fmtPct(combined * 100) : 'N/A',
    notes: 'Pro forma CET1 is a RWA-weighted average of the two standalone ratios. Regulators will also require adjustments for goodwill created by the deal (which deducts from CET1) and any purchase accounting marks.',
    sources: ['Federal Reserve SR 14-2', 'OCC merger guidance'],
  };
}
