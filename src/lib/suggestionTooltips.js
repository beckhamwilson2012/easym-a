import { isBankDeal, isFinancial, fmtMoney, fmtMoneyDual, fmtPerShare } from '../components/deck/shared/deckTokens';

// ── Calculators ───────────────────────────────────────────────────────────────

export function calcSuggestedOfferPrice(target) {
  const { sharePrice, eps, ebitda, shares, revenue } = target || {};

  // Primary: 30% control premium over live market price
  if (sharePrice > 0) return parseFloat((sharePrice * 1.30).toFixed(2));

  // Blend of fundamental methods when no live price
  const methods = [];
  if (shares > 0 && ebitda > 0) methods.push((ebitda * 12) / shares);
  if (eps > 0) { methods.push(eps * 18); methods.push(eps * 15 * 1.30); }
  if (!methods.length && shares > 0 && revenue > 0) methods.push((revenue * 2) / shares);
  if (!methods.length) return null;

  const avg = methods.reduce((a, b) => a + b, 0) / methods.length;
  return avg > 0 ? parseFloat(avg.toFixed(2)) : null;
}

// Returns base advisory fee only. Legal / regulatory / financing are reference estimates
// shown in the "All-in estimate" tooltip — the model uses only this base fee.
export function calcAdvisoryFee(dealSizeM) {
  if (!(dealSizeM > 0)) return null;
  if (dealSizeM >= 10000) return dealSizeM * 0.003;  // mega-cap: 0.3%  ($10B+)
  if (dealSizeM >= 1000)  return dealSizeM * 0.01;   // large:    1.0%  ($1B–$10B)
  if (dealSizeM >= 500)   return dealSizeM * 0.015;  // mid-upper: 1.5% ($500M–$1B)
  if (dealSizeM >= 50)    return dealSizeM * 0.03;   // mid:       3.0% ($50M–$500M)
  // Small deals (<$50M): Lehman-style stepping
  const rates = [0.05, 0.04, 0.03, 0.02];
  let fee = 0; let remaining = dealSizeM * 1e6;
  for (const rate of rates) {
    const chunk = Math.min(remaining, 1e6);
    fee += chunk * rate; remaining -= chunk;
    if (remaining <= 0) break;
  }
  if (remaining > 0) fee += remaining * 0.01;
  return fee / 1e6;
}

// Returns only the advisory fee (what the model uses as transactionFees input).
export function calcSuggestedTransactionFees(dealSizeM) {
  const advisorFee = calcAdvisoryFee(dealSizeM);
  return advisorFee !== null ? Math.round(advisorFee) : null;
}

// Reference breakdown for the all-in estimate tooltip (not used by model).
export function calcAllInFeeEstimate(dealSizeM) {
  const advisorFee = calcAdvisoryFee(dealSizeM);
  if (advisorFee === null) return null;
  const legalFee   = dealSizeM < 100 ? 2 : dealSizeM < 1000 ? 10 : 25;
  const otherFee   = dealSizeM < 100 ? 1 : dealSizeM < 1000 ? 5  : 15; // financing, misc
  return { advisorFee: Math.round(advisorFee), legalFee, otherFee, total: Math.round(advisorFee + legalFee + otherFee) };
}

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

export function buildOfferPriceTooltip(target) {
  const { sharePrice, eps, ebitda, shares } = target || {};
  const suggested = calcSuggestedOfferPrice(target);
  const resultStr = suggested ? `${fmtPerShare(suggested)}/share` : 'Insufficient data';

  const peerPEPrice = eps > 0 ? parseFloat((eps * 15).toFixed(2)) : null;
  const evEBITDAPrice = (shares > 0 && ebitda > 0) ? parseFloat(((ebitda * 12) / shares).toFixed(2)) : null;
  const isFinancialCo = isFinancial(target); // OBJECT → SIC fallback fires for banks /quote tags 'standard'

  const inputs = [];
  if (sharePrice > 0) {
    inputs.push({ label: 'Current share price', value: fmtPerShare(sharePrice) });
    inputs.push({ label: 'Control premium applied', value: '30% (industry median)' });
  }
  if (peerPEPrice) {
    inputs.push({ label: 'Cross-check: EPS × peer P/E (15×)', value: fmtPerShare(peerPEPrice) });
  }
  if (isFinancialCo) {
    inputs.push({ label: 'EV/EBITDA cross-check', value: 'N/A (financial company — see P/TBV instead)' });
  } else if (evEBITDAPrice) {
    inputs.push({ label: 'Cross-check: EBITDA × 12 / shares', value: fmtPerShare(evEBITDAPrice) });
  }

  return {
    formula: sharePrice > 0
      ? 'Current share price × (1 + control premium)'
      : 'Blend of methods — premium-to-market is typically the binding constraint',
    inputs,
    result: resultStr,
    notes: 'A 30% premium reflects the empirical median for completed US public-company M&A from 2010 to 2024. Premiums above 50% are unusual outside competitive bidding situations.',
    sources: ['Damodaran NYU acquisition premium dataset', 'McKinsey Global M&A practice'],
  };
}

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

export function buildTransactionFeesTooltip(dealSizeM, isBank = false) {
  if (!(dealSizeM > 0)) {
    return {
      formula: 'Base advisory fee only — add legal & financing separately if needed',
      inputs: [{ label: 'Deal size', value: 'Not yet determined' }],
      result: 'Enter offer price to estimate base advisory fee',
      notes: 'Size-tiered advisory rates: >$10B → 0.3%, $1B–$10B → 1%, $500M–$1B → 1.5%, $50M–$500M → 3%, <$50M → Lehman steps. The field captures only the base advisory fee; all-in costs (legal, regulatory, financing) add ~$25–40M on large deals.',
      sources: ['Lazard / Goldman advisory fee surveys', 'PwC M&A Integration Survey'],
    };
  }

  const advisorFeeM = calcAdvisoryFee(dealSizeM) ?? 0;
  const allIn = calcAllInFeeEstimate(dealSizeM);

  const rate = dealSizeM > 10000 ? '0.3%' : dealSizeM > 1000 ? '1.0%' :
               dealSizeM > 500  ? '1.5%' : dealSizeM > 50 ? '3.0%' : 'Lehman steps';

  const note = `Size-tiered advisory rate for a ${fmtMoneyDual(dealSizeM)} deal: ${rate}. The model uses only the base advisory fee shown above. All-in costs include legal/regulatory (~${fmtMoney(allIn?.legalFee ?? 0)}) and other transaction costs (~${fmtMoney(allIn?.otherFee ?? 0)}).`
    + (isBank ? ' Bank M&A integration costs typically run higher (3.5–4.5% of deal value) due to core-systems consolidation and regulatory compliance work.' : '');

  return {
    formula: 'Base advisory fee = deal value × size-tiered rate',
    inputs: [
      { label: 'Deal size',                value: fmtMoneyDual(dealSizeM) },
      { label: `Advisory rate (${rate})`,  value: fmtMoney(advisorFeeM) },
      { label: 'Legal & regulatory (ref)', value: fmtMoney(allIn?.legalFee ?? 0) },
      { label: 'Other / financing (ref)',  value: fmtMoney(allIn?.otherFee ?? 0) },
      { label: 'All-in estimate (ref)',    value: fmtMoneyDual(allIn?.total ?? advisorFeeM) },
    ],
    result: `${fmtMoneyDual(Math.round(advisorFeeM))} (base advisory fee — model input)`,
    notes: note,
    sources: ['Lazard / Goldman advisory fee surveys', 'PwC M&A Integration Survey'],
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
