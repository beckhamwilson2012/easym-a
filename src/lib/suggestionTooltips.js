import { isBankDeal, fmtMoney, fmtMoneyDual } from '../components/deck/shared/deckTokens';

// ── Calculators ───────────────────────────────────────────────────────────────

export function calcSuggestedSynergy(target, acquirer, year) {
  const bankMode = isBankDeal(target, acquirer);
  if (bankMode) {
    // Synergies are bounded by the TARGET being absorbed — scale to the TARGET's non-interest
    // expense, not the combined figure (same fix as the standard-mode revenue branch: a giant bank
    // can't wring more cost savings out of a small target just by being large).
    const targetNIE = target?.nonInterestExpense || 0;
    // If target bank facts have loaded, use NIE-based rates; otherwise fall through to revenue fallback.
    if (targetNIE > 0) {
      const rates = { 1: 0.05, 2: 0.08, 3: 0.11 };
      return Math.round(targetNIE * (rates[year] || 0.05));
    }
  }
  // Synergies are bounded by the TARGET being absorbed, not the combined entity — a giant acquirer
  // can't wring more savings out of a small target just by being large. Scale to the TARGET's revenue
  // (the standard rough heuristic), NOT combined revenue: scaling to combined let UNH ($448B) inflate
  // ADBE's Year-1 synergies to $9.4B — larger than ADBE's entire net income (the bug this fixes).
  const targetRev = target?.revenue || 0;
  if (!(targetRev > 0)) return null;
  const rates = { 1: 0.02, 2: 0.035, 3: 0.05 };
  return Math.round(targetRev * (rates[year] || 0.02));
}

// ── Tooltip builders ──────────────────────────────────────────────────────────

export function buildCashPercentTooltip(isBank = false) {
  const defaultCash = isBank ? 80 : 60;
  const defaultStock = 100 - defaultCash;
  return {
    formula: 'Heuristic default — adjust to reflect deal-specific financing capacity and acquirer share price',
    inputs: [
      { label: 'Suggested cash component', value: `${defaultCash}%` },
      { label: 'Suggested stock component', value: `${defaultStock}%` },
      { label: '19.9% threshold (NYSE §312.03 / Nasdaq Rule 5635)', value: 'Stock issuance ≥ 19.9% of acquirer shares → shareholder vote required' },
      { label: 'Majority-stock trigger', value: 'Stock issuance ≥ 50% of acquirer shares → heightened scrutiny' },
    ],
    result: `${defaultCash}% cash / ${defaultStock}% stock`,
    notes: 'The median cash share across completed US M&A from 2010 to 2024 falls between 55% and 65%. NYSE Rule §312.03 and Nasdaq Rule 5635 require an acquirer shareholder vote whenever the stock issued exceeds 19.9% of pre-deal shares outstanding — a common deal constraint. All-cash deals are more frequent in private-target deals; all-stock deals signal the acquirer believes its own equity is overvalued.'
      + (isBank ? ' Bank regulators apply additional scrutiny to stock-heavy deals that dilute Tier 1 capital ratios — acquirers with CET1 below 10% typically prefer cash or hybrid structures.' : ''),
    sources: ['Refinitiv US M&A Review', 'NYSE Listed Company Manual §312.03', 'Nasdaq Rule 5635'],
  };
}

export function buildSynergyTooltip(target, acquirer, year) {
  const bankMode = isBankDeal(target, acquirer);
  const bankRates = { 1: 0.05, 2: 0.08, 3: 0.11 };
  const stdRates  = { 1: 0.02, 2: 0.035, 3: 0.05 };
  const rate = bankMode ? (bankRates[year] || 0.05) : (stdRates[year] || 0.02);
  const suggested = calcSuggestedSynergy(target, acquirer, year);
  const resultStr = suggested !== null ? fmtMoneyDual(suggested) : 'Insufficient data';

  if (bankMode) {
    return {
      formula: `Year ${year} synergies = target non-interest expense × ${(rate * 100).toFixed(0)}%`,
      inputs: [
        { label: 'Target non-interest expense',     value: fmtMoney(target?.nonInterestExpense || 0) },
        { label: `Year ${year} cost-takeout rate`,  value: `${(rate * 100).toFixed(0)}% of target expense base` },
      ],
      result: resultStr,
      notes: 'Bank M&A synergies are overwhelmingly cost-driven and are bounded by the TARGET being absorbed — a larger acquirer cannot wring more savings from a small target. Target synergies of 25–35% of the target expense base over 3 years is the historical benchmark; revenue synergies typically realize at 30–50% of estimated value. This tool models cost synergies only — branch consolidation, technology integration, and overlapping operations are the primary levers.',
      sources: ['Federal Reserve Bank merger studies', 'Oliver Wyman Banking M&A Insights'],
    };
  }

  return {
    formula: `Year ${year} synergies = target revenue × ${(rate * 100).toFixed(1)}%`,
    inputs: [
      { label: 'Target revenue',                value: fmtMoney(target?.revenue || 0) },
      { label: `Year ${year} realization rate`, value: `${(rate * 100).toFixed(1)}% (industry rule of thumb)` },
    ],
    result: resultStr,
    notes: 'Synergies are scaled to the TARGET being absorbed (target revenue), not the combined entity — scaling to combined revenue would let a large acquirer inflate synergies beyond the entire earnings of the target. The estimate blends ~55% cost synergies (headcount, facility consolidation, procurement) and ~45% revenue synergies (cross-sell, market expansion). The realization rate ramps from ~2% in Year 1 to ~5% by Year 3 as integration completes. Actual realization historically averages 60–70% of announced figures.',
    sources: ['Bain & Company M&A Practitioners Report', 'Damodaran corporate finance lectures'],
  };
}
