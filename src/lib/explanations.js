import { fmtMoney, fmtPerShare, fmtPct } from '../components/deck/shared/deckTokens';
import { NONE_ENTERED, fmtSynergy, marginSentence } from './synergies';

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

export function explainPeRatio({ offerPrice, eps, multiple, equityValue, netIncome }) {
  // A private target has no per-share figures: its P/E is purchase equity value ÷ net income (dealCalc peBasis).
  if (equityValue != null) {
    return {
      formula: 'P/E = Purchase Equity Value ÷ Target Net Income (private target: no share count)',
      inputs: [
        { label: 'Purchase equity value', value: fmtMoney(equityValue) },
        { label: 'Target net income', value: netIncome != null && Number.isFinite(parseFloat(netIncome)) ? fmtMoney(parseFloat(netIncome)) : '—' },
      ],
      result: multiple != null && multiple !== 'N/A' ? `${parseFloat(multiple).toFixed(1)}x` : 'N/A',
      notes: 'The same multiple as offer price ÷ EPS, on totals: a private company has no share count, so it has no EPS.',
    };
  }
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
    formula: 'Debt/EBITDA = Pro-forma Total Debt ÷ Combined EBITDA (post-synergies)',
    inputs: [
      { label: 'Pro-forma debt (acquirer debt + new acquisition debt; target debt repaid)', value: fmtMoney(combinedDebt) },
      { label: 'Combined EBITDA', value: fmtMoney(parseFloat(combinedEbitda) || 0) },
    ],
    result: multiple != null && multiple !== 'N/A' ? `${parseFloat(multiple).toFixed(1)}x` : 'N/A',
    notes: 'Above 5x is considered highly leveraged and can restrict credit access. Investment-grade companies typically maintain below 3x. LBO transactions often reach 6–8x but carry refinancing risk.',
    sources: ['S&P Global ratings methodology'],
  };
}

// ── Synergies ─────────────────────────────────────────────────────────────────

export function explainSynergies({ schedule, isBank }) {
  const line = (y) => `Cost ${fmtSynergy(y.cost)} · Revenue ${fmtSynergy(y.revenue)} · Total ${y.entered ? fmtSynergy(y.ebitda) : NONE_ENTERED}`;
  const y3 = schedule.years[2];
  return {
    formula: 'Total synergies (EBITDA impact) = cost synergies + revenue synergies × combined gross margin',
    inputs: schedule.years.map((y) => ({ label: `Year ${y.year}`, value: line(y) })),
    result: `Year 3 total: ${y3.entered ? fmtSynergy(y3.ebitda) : NONE_ENTERED}`,
    notes: `${isBank ? 'Bank deal: gross margin does not apply, so revenue synergies add to revenue only. ' : ''}${marginSentence(schedule.margin)} Every figure here is what was entered on the input page: an empty line assumes no synergy. The preset percentages are app defaults, editable, and are not market figures.`,
    sources: ['Entered on the input page'],
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
