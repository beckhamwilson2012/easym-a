import { FINANCIAL_SIC } from '../../../lib/financialSic'; // shared with server.js — one SIC source of truth
import { UTILITY_SIC, UTILITY_GROSS_REASON } from '../../../lib/utilitySic'; // same pattern

// ── Color tokens ──────────────────────────────────────────────────────────────
export const NAVY      = '#0F2244';
export const SF_BLUE   = '#0070D2';
export const LIGHT_BLUE = '#EFF6FF';
export const RED       = '#DC2626';
export const GRAY_BORDER = '#E5E7EB';
export const GRAY_TEXT   = '#6B7280';
export const ALT_ROW     = '#F9FAFB';
export const DONUT_COLORS = ['#0070D2', '#1B96FF', '#51A9EE', '#0B5CAB', '#A8C4DC', '#D4E9F7'];

// ── Number formatters ─────────────────────────────────────────────────────────
// All monetary formatters treat input as millions of dollars (e.g., 2187 = $2.187B).

// Primary money formatter — compact, single form. >= $1B switches to billions.
export function fmtMoney(m) {
  const v = parseFloat(m);
  if (isNaN(v) || m === null || m === undefined) return 'N/A';
  const abs  = Math.abs(v);
  let body;
  if (abs >= 1000) body = `$${(abs / 1000).toFixed(1)}B`;
  else if (abs >= 1) body = `$${abs.toFixed(1)}M`;
  else if (abs >= 0.001) body = `$${(abs * 1000).toFixed(1)}K`;
  else body = `$${(abs * 1e6).toFixed(0)}`;
  // Accounting convention: negatives in parentheses, matching fmtMoneyAccounting so every money
  // formatter agrees. Guard body!=='$0' so a value rounding to zero never shows a misleading ($0).
  return (v < 0 && body !== '$0') ? `(${body})` : body;
}

// Table money formatter — stays in M with comma separators until $10B.
// Use in dense tables (sensitivity, comparables, P&L) for direct comparison.
export function fmtMoneyTable(m) {
  const v = parseFloat(m);
  if (isNaN(v) || m === null || m === undefined) return 'N/A';
  const abs  = Math.abs(v);
  let body;
  if (abs >= 10000) body = `$${(abs / 1000).toFixed(1)}B`;
  else if (abs >= 1) body = `$${Math.round(abs).toLocaleString('en-US')}M`;
  else if (abs >= 0.001) body = `$${(abs * 1000).toFixed(1)}K`;
  else body = `$${(abs * 1e6).toFixed(0)}`;
  // Accounting convention: negatives in parentheses, matching fmtMoneyAccounting. fmtMoneyAccounting
  // passes Math.abs(v) in, so it never double-wraps. Guard body!=='$0' so near-zero shows no ($0).
  return (v < 0 && body !== '$0') ? `(${body})` : body;
}

// Dual money formatter — shows billions + millions for values >= $1B.
// Use in suggestion badges and deal-size headlines for educational context.
export function fmtMoneyDual(m) {
  const v = parseFloat(m);
  if (isNaN(v) || m === null || m === undefined) return 'N/A';
  const abs  = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs < 1000) return fmtMoney(m);
  const billions = `${sign}$${(abs / 1000).toFixed(1)}B`;
  const millions = `$${Math.round(abs).toLocaleString('en-US')}M`;
  return `${billions} (${sign}${millions})`;
}

// Accounting format — negatives in parentheses for P&L tables.
export function fmtMoneyAccounting(m) {
  const v = parseFloat(m);
  if (isNaN(v) || m === null || m === undefined) return 'N/A';
  if (v < 0) return `(${fmtMoneyTable(Math.abs(v))})`;
  return fmtMoneyTable(v);
}

// Uniform-scale money formatter — the CALLER commits ONE scale ('B' or 'M') for a whole table so every
// row reads in the same unit. Unlike fmtMoney/fmtMoneyTable, which auto-switch to $B per-value at a
// magnitude threshold (mixing $B and $M in one column), this keeps a table's chosen scale fixed. Input
// in millions. Negatives use the accounting-parens convention, consistent with fmtMoney/fmtMoneyTable.
export function fmtScaled(value, scale = 'M') {
  const v = parseFloat(value);
  if (isNaN(v) || value === null || value === undefined) return 'N/A';
  const abs = Math.abs(v);
  const body = scale === 'B'
    ? `$${(abs / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}B`
    : `$${Math.round(abs).toLocaleString('en-US')}M`;
  const roundsToZero = body === '$0M' || body === '$0.0B';
  return (v < 0 && !roundsToZero) ? `(${body})` : body;
}

// Choose ONE uniform scale for a set of values (in millions) so a whole table commits to a single unit.
// Returns 'B' only when the table is large (max ≥ $10B) AND its smallest non-zero magnitude still reads
// cleanly in $B (≥ $1B) — so no value collapses to "$0.xB" and loses signal; otherwise 'M' (lossless,
// comma-separated). Precision-safe: a table with any sub-$1B value stays in $M rather than crushing it.
export function pickScale(values) {
  const mags = (values || [])
    .map((v) => Math.abs(parseFloat(v)))
    .filter((m) => Number.isFinite(m) && m > 0);
  if (!mags.length) return 'M';
  const max = Math.max(...mags), min = Math.min(...mags);
  return (max >= 10000 && min >= 1000) ? 'B' : 'M';
}

// Default percentage — input is already a percent value (e.g., 25.3 means 25.3%).
export function fmtPct(v, digits = 1) {
  const n = parseFloat(v);
  if (isNaN(n) || v === null || v === undefined) return 'N/A';
  return `${n.toFixed(digits)}%`;
}

// Signed percentage — always shows sign. Use for EPS change, growth rates.
export function fmtPctSigned(v, digits = 1) {
  const n = parseFloat(v);
  if (isNaN(n) || v === null || v === undefined) return 'N/A';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

// Whole-number percentage — no decimal, for slider labels and suggestion badges.
export function fmtPctWhole(v) {
  const n = parseFloat(v);
  if (isNaN(n) || v === null || v === undefined) return 'N/A';
  return `${Math.round(n)}%`;
}

// Ownership/share % that never collapses a TRUE POSITIVE to "0%": a value that rounds to 0 at the given
// precision but is > 0 shows "<0.1%" (or "<1%" at 0 digits); the near-100% counterpart shows ">99.9%". So a
// tiny target stake reads as immaterial-but-present, not a null 0% (RRGB's ~0.04% equity of a mega-cap).
export function fmtPctFloor(v, digits = 1) {
  const n = parseFloat(v);
  if (isNaN(n) || v === null || v === undefined) return 'N/A';
  const floor = digits === 0 ? 1 : Math.pow(10, -digits);
  if (n > 0 && n < floor) return `<${floor}%`;
  if (n < 100 && n > 100 - floor) return `>${(100 - floor).toFixed(digits)}%`;
  return `${n.toFixed(digits)}%`;
}

// Balance-sheet as-of date label (2B-2). Basis-driven so a reader can tell an INTERIM instant from a
// fiscal year-end at the same date (e.g. GOOGL 2026-06-30 interim vs MSFT 2026-06-30 FY-end).
export function fmtAsOf(asOf, basis) {
  if (!asOf) return null;
  return basis === 'annual' ? `${asOf} (FY-end)` : asOf;
}

export function fmtMult(v) {
  if (v === null || v === undefined || v === 'N/A') return 'N/A';
  const n = parseFloat(v);
  if (isNaN(n) || !isFinite(n)) return 'N/A';
  return `${n.toFixed(1)}x`;
}

export function fmtPerShare(v) {
  const n = parseFloat(v);
  if (isNaN(n) || v === null || v === undefined) return 'N/A';
  return `$${n.toFixed(2)}`;
}

// Single standalone-EPS basis for the WHOLE deck: the company's REPORTED DILUTED EPS (the filed
// per-share figure), matching dealCalc.acquirerStandaloneEPS so a company shows ONE EPS on every
// slide. Net income ÷ shares is the FALLBACK only — used when reported EPS is genuinely unavailable
// (and it prefers diluted weighted-average shares, never the point-in-time cover-page count, which
// biased EPS high — the bug this fixes).
export function standaloneEPS(company) {
  const rep = parseFloat(company?.eps);
  if (Number.isFinite(rep) && rep !== 0) return rep;
  const ni = parseFloat(company?.netIncome);
  const sh = parseFloat(company?.dilutedShares) || parseFloat(company?.shares);
  return (!isNaN(ni) && sh > 0) ? ni / sh : null;
}

// Reported NON-GAAP profitability for a company, sourced from /api/nongaap (the fiscal-year-end
// earnings 8-K, period-matched to the deck FY and code-reconciled server-side) and threaded onto the
// company object as `company.nonGaap` (the full API payload). Returns the usable figures ONLY when the
// server isolated AND reconciled the annual column; otherwise null, so callers fall back to GAAP and
// label the basis honestly. We NEVER derive/fake a non-GAAP number here — display-only of a real figure.
export function nonGaapFigures(company) {
  const ng = company?.nonGaap;
  if (!ng || !ng.allReconciled) return null;
  const f = ng.nonGaap || {};
  const oi  = parseFloat(f.operatingIncome);
  const ni  = parseFloat(f.netIncome);
  const eps = parseFloat(f.dilutedEPS);
  const sh  = parseFloat(f.dilutedShares);
  if (!Number.isFinite(oi) && !Number.isFinite(ni) && !Number.isFinite(eps)) return null;
  return {
    operatingIncome: Number.isFinite(oi)  ? oi  : null,
    netIncome:       Number.isFinite(ni)  ? ni  : null,
    dilutedEPS:      Number.isFinite(eps) ? eps : null,
    dilutedShares:   Number.isFinite(sh)  ? sh  : null, // sourced from the 8-K (Part 1); used by the accretion flip
    accession:       ng.sourceAccession || null,
    sourceUrl:       ng.sourceUrl || null,
    fiscalYear:      ng.fiscalYear || null,
  };
}

// Share count formatter — input in millions (e.g., 47.3 = 47.3M shares).
export function fmtShares(v) {
  const n = parseFloat(v);
  if (isNaN(n) || v === null || v === undefined) return 'N/A';
  const abs = Math.abs(n);
  if (abs >= 1000) return `${(abs / 1000).toFixed(1)}B`;
  if (abs >= 1)    return `${abs.toFixed(1)}M`;
  if (abs >= 0.001) return `${(abs * 1000).toFixed(0)}K`;
  return `${(abs * 1e6).toFixed(0)}`;
}

// ── Business type helpers ─────────────────────────────────────────────────────

// Accepts either a companyType string ('financial') or a company object.
// Object form also checks SIC codes as a fallback for when companyType isn't set.
export function isFinancial(companyTypeOrCompany) {
  if (!companyTypeOrCompany) return false;
  if (typeof companyTypeOrCompany === 'string') return companyTypeOrCompany === 'financial';
  return companyTypeOrCompany.companyType === 'financial' ||
    FINANCIAL_SIC.includes(companyTypeOrCompany.sic);
}

// Restaurant SIC detection (sibling to isFinancial — single source of truth, no parallel check). For
// 5812 (Eating Places) / 5813 (Drinking Places), "gross profit" = revenue − COGS is meaningless: COGS is
// food/beverage only (~26%); the dominant labor (~34%) + occupancy costs sit BELOW the gross line, so the
// figure shows a false ~74% margin next to a near-zero operating margin (or, when COGS isn't tagged, the
// fabricated 65% estimate). §5/§6/§7/§14 suppress gross profit for these and show operating income instead.
export function isRestaurant(company) {
  return company?.sic === '5812' || company?.sic === '5813';
}

// Utility SIC detection (sibling to isFinancial). Gross profit and gross margin render "n/m" for these filers.
export function isUtility(company) {
  return UTILITY_SIC.includes(company?.sic);
}
export const UTILITY_GROSS_NOTE = `Gross profit and gross margin: n/m, ${UTILITY_GROSS_REASON}.`;

// Accretion verdict with a NEUTRAL band (Fix #4). A % that DISPLAYS as ±0.0% — i.e. |pct| rounds to 0.0
// at one decimal, the same rounding §8/§9 show — is breakeven (rounding noise), NOT a direction: return
// 'neutral'. Anything that displays as a non-zero % keeps its real 'accretive'/'dilutive' verdict. null
// for n/m (no pct). Single source of truth so §8 (accretion table) and §9 (forward bridge) agree.
export function accretionVerdict(pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (Math.abs(pct).toFixed(1) === '0.0') return 'neutral'; // matches the displayed ±0.0%
  return pct >= 0 ? 'accretive' : 'dilutive';
}

export function isSaaSLike(companyType) {
  return companyType === 'saas' || companyType === 'software';
}

// ── Estimation helpers ────────────────────────────────────────────────────────

export function estimateSegmentMix(target) {
  if (isFinancial(target)) { // OBJECT → SIC fallback: banks /quote tags 'standard' still get the bank mix
    return [
      { name: 'Investment Banking', value: 30 },
      { name: 'Wealth Management', value: 25 },
      { name: 'Retail Banking',     value: 25 },
      { name: 'Trading & Other',    value: 20 },
    ];
  }
  return [
    { name: 'Core Products',   value: 45 },
    { name: 'Services',        value: 30 },
    { name: 'Subscriptions',   value: 15 },
    { name: 'Other',           value: 10 },
  ];
}

export function estimateGeographyMix() {
  return [
    { name: 'North America', value: 55 },
    { name: 'Europe',        value: 25 },
    { name: 'Asia Pacific',  value: 15 },
    { name: 'Rest of World', value: 5  },
  ];
}

export function estimateEmployeeMix() {
  return [
    { name: 'Operations',      value: 35 },
    { name: 'Sales & Mktg',    value: 25 },
    { name: 'R&D / Technology', value: 25 },
    { name: 'G&A',             value: 15 },
  ];
}

export function buildFinancialCommentary(target, deal) {
  const lines = [];
  const rev   = parseFloat(target.revenue)  || 0;
  const ebitda = parseFloat(target.ebitda)  || 0;
  const ni    = parseFloat(target.netIncome) || 0;
  // Basis-aware net income so the §5 commentary matches the (non-GAAP) table on a non-GAAP deal. Gated by
  // deal.basis exactly like the table — a GAAP/bank deal leaves niVal == ni, so the wording is unchanged.
  const ng    = deal?.basis === 'Non-GAAP' ? nonGaapFigures(target) : null;
  const niVal = ng?.netIncome ?? ni;
  const niIsNonGaap = ng?.netIncome != null;
  const margin = rev > 0 && ebitda > 0 ? (ebitda / rev * 100).toFixed(1) : null;

  if (margin !== null) {
    const adj = parseFloat(margin) > 25 ? 'strong' : parseFloat(margin) > 15 ? 'solid' : 'moderate';
    lines.push(`EBITDA margin of ${margin}% reflects ${adj} operational efficiency.`);
  }
  if (deal.purchasePremium !== undefined) {
    lines.push(`Acquisition premium of ${fmtPct(deal.purchasePremium)} versus estimated market value.`);
  }
  if (deal.evEBITDA && deal.evEBITDA !== 'N/A') {
    const adj2 = parseFloat(deal.evEBITDA) > 15 ? 'above' : 'in line with';
    lines.push(`Entry EV/EBITDA of ${fmtMult(deal.evEBITDA)} is ${adj2} sector median.`);
  }
  if (niVal > 0 && rev > 0) {
    lines.push(`Net income of ${fmtMoney(niVal)}${niIsNonGaap ? ' (non-GAAP)' : ''} represents a ${(niVal / rev * 100).toFixed(1)}% net margin.`);
  }
  lines.push(`Transaction financed ${fmtPct(deal.cashPercent)} cash / ${fmtPct(100 - parseFloat(deal.cashPercent || 0))} stock.`);
  return lines;
}

export function buildStrategicSection(target, acquirer, deal) {
  const a    = acquirer.name || 'Acquirer';
  const b    = target.name   || 'Target';
  const combRev = (parseFloat(target.revenue || 0) + parseFloat(acquirer.revenue || 0));
  const bankMode = isBankDeal(target, acquirer);

  const rationale = [
    `Scale enhancement: combined entity would reach ${fmtMoney(combRev)} in annual revenue.`,
    `Accelerates ${a}'s growth into ${b}'s core markets with immediate customer access.`,
    `Cross-sell opportunity: ${b}'s customer base presents incremental wallet share for ${a}'s portfolio.`,
    `Operational synergies: ${deal.synergiesY1 > 0 ? fmtMoney(deal.synergiesY1) : 'meaningful'} in Year 1 cost savings identified across G&A, technology, and procurement.`,
  ];

  const risks = [
    `Integration execution risk — cultural and systems alignment critical to synergy realization.`,
    `Purchase premium of ${fmtPct(deal.purchasePremium)} may limit returns in a downside scenario.`,
    `Customer retention during transition requires proactive account management.`,
  ];

  if (bankMode) {
    const cet1 = combinedCET1(target, acquirer);
    rationale.push(`Geographic / business-line complementarity supports cross-sell into combined loan and deposit book.`);
    rationale.push(`Scale economics in technology and back-office processing reduce per-account operating costs.`);
    if (cet1 !== null && cet1 > 0.11)
      rationale.push(`Pro forma capital position of ${fmtPct(cet1 * 100)} remains comfortably above regulatory minimums.`);

    risks.push(`Regulatory review by Federal Reserve, OCC, and DOJ; approval timeline typically 9–15 months.`);
    if (cet1 !== null && cet1 < 0.10)
      risks.push(`Pro forma CET1 ratio falls below well-capitalized threshold; capital raise may be required.`);
    risks.push(`Core systems integration historically the largest source of bank merger overruns.`);
    risks.push(`Customer attrition during integration; deposit retention typically 85–92% in first 24 months.`);
  }

  return { rationale, risks };
}

// ── Bank-mode helpers ─────────────────────────────────────────────────────────

// US G-SIBs (Globally Systemically Important Banks) — stable list per FSB annual designation.
// Mergers between two G-SIBs face near-certain regulatory rejection under Dodd-Frank and
// Federal Reserve concentration limits.
export const US_GSIBS = ['JPM', 'BAC', 'C', 'WFC', 'GS', 'MS', 'BK', 'STT'];
export const isGSIB = (ticker) => US_GSIBS.includes(ticker?.toUpperCase());

// Pass the OBJECTS (not target.companyType strings) so isFinancial's SIC fallback fires — banks that
// /quote classifies 'standard' (e.g. JPM/BAC, SIC 6021) are still recognized by SIC. Single source.
export const isBankDeal = (target, acquirer) =>
  isFinancial(target) && isFinancial(acquirer);

export const calcPTBV = (company) => {
  if (!company?.marketCap || !company?.tangibleBookValue) return null;
  return company.marketCap / company.tangibleBookValue;
};

export const calcEfficiencyRatio = (company) => {
  const denom = (company?.netInterestIncome || 0) + (company?.nonInterestIncome || 0);
  if (!company?.nonInterestExpense || denom === 0) return null;
  return company.nonInterestExpense / denom;
};

export const calcROTCE = (company) => {
  if (!company?.netIncome || !company?.tangibleBookValue) return null;
  return company.netIncome / company.tangibleBookValue;
};

export const combinedCET1 = (target, acquirer) => {
  const tRWA  = target?.riskWeightedAssets   || 0;
  const aRWA  = acquirer?.riskWeightedAssets  || 0;
  const tCET1 = target?.cet1Ratio   || 0;
  const aCET1 = acquirer?.cet1Ratio  || 0;
  if (tRWA + aRWA === 0) return null;
  return (tCET1 * tRWA + aCET1 * aRWA) / (tRWA + aRWA);
};

export const fmtRatio = (n) => (n == null ? 'N/A' : `${n.toFixed(2)}x`);
export const fmtBps   = (n) => (n == null ? 'N/A' : `${(n * 10000).toFixed(0)} bps`);

export function computeBankFlags(results, inputs, target, acquirer) {
  const flags = [];
  const cet1      = combinedCET1(target, acquirer);
  const dealSize  = parseFloat(results?.totalPurchasePrice || 0);
  const tDep      = target?.totalDeposits   || 0;
  const aDep      = acquirer?.totalDeposits  || 0;
  const tTBV      = target?.tangibleBookValue   || 0;
  const aTBV      = acquirer?.tangibleBookValue  || 0;

  // Two G-SIBs — near-certain regulatory rejection
  if (isGSIB(target?.ticker) && isGSIB(acquirer?.ticker) && dealSize > 100000) {
    flags.push({ level: 'critical', icon: '🚨', text: 'Transaction would face near-certain regulatory rejection on antitrust and systemic-risk grounds. The Dodd-Frank Act and Federal Reserve concentration limits effectively prohibit mergers between two G-SIBs (Globally Systemically Important Banks).' });
    return flags; // no lesser flags needed — this supersedes all others
  }

  // Carry over non-EBITDA standard flags
  if (inputs?.companyAShares > 0 && parseFloat(results?.newSharesIssued || 0) / inputs.companyAShares > 0.2)
    flags.push({ level: 'warning', icon: '⚠️', text: 'Significant share dilution — existing shareholders may be negatively impacted' });
  if (parseFloat(results?.purchasePremium || 0) > 50)
    flags.push({ level: 'warning', icon: '⚠️', text: 'Very high acquisition premium — overpaying risk is elevated' });

  // Capital adequacy
  if (cet1 !== null && cet1 < 0.10)
    flags.push({ level: 'critical', icon: '🚨', text: `Pro forma CET1 of ${fmtPct(cet1 * 100)} falls below the 10% well-capitalized threshold — capital raise may be required` });

  // Deposit concentration
  if (tDep + aDep > 1500000)
    flags.push({ level: 'critical', icon: '🚨', text: 'Combined deposit base exceeds $1.5T — may trigger deposit concentration review by regulators' });

  // Regulatory review
  if (dealSize > 50000)
    flags.push({ level: 'warning', icon: '⚠️', text: 'Transaction over $50B — Federal Reserve, OCC, and DOJ review required; approval timeline 9–15 months' });

  // Goodwill / intangibles
  const paidPremium = dealSize - tTBV;
  const combinedTBV = tTBV + aTBV;
  if (paidPremium > 0 && combinedTBV > 0 && paidPremium / combinedTBV > 0.25)
    flags.push({ level: 'warning', icon: '⚠️', text: 'Pro forma goodwill exceeds 25% of combined tangible equity — intangible-heavy acquisition increases capital sensitivity' });

  return flags;
}

export function buildBankNarrative(results, inputs, target, acquirer, nameA, nameB) {
  const a          = nameA || 'Acquirer';
  const b          = nameB || 'Target';
  const priceStr   = fmtPerShare(inputs?.offerPricePerShare || 0);
  const totalStr   = fmtMoneyDual(results?.totalPurchasePrice);
  const direction  = results?.isAccretive ? 'accretive' : 'dilutive';
  const pct        = results?.epsChangePct === null || results?.epsChangePct === undefined
    ? null : parseFloat(results.epsChangePct);

  let text;
  if (pct === null || isNaN(pct)) {
    text = `${a}'s acquisition of ${b} at ${priceStr}/share (${totalStr} total) moves pro forma EPS from ${fmtPerShare(results?.companyAEPS)} to ${fmtPerShare(results?.proFormaEPS)} — accretion/(dilution) is not meaningful from a non-positive EPS base.`;
  } else {
    const epsDir = results?.isAccretive ? 'increasing' : 'decreasing';
    text = `${a}'s acquisition of ${b} at ${priceStr}/share (${totalStr} total) would be ${direction}, ${epsDir} EPS by ${Math.abs(pct).toFixed(1)}% from ${fmtPerShare(results?.companyAEPS)} to ${fmtPerShare(results?.proFormaEPS)}.`;
  }

  const cet1 = combinedCET1(target, acquirer);
  if (cet1 !== null) {
    const pct       = (cet1 * 100).toFixed(1);
    const threshold = cet1 >= 0.10 ? 'above' : 'below';
    text += ` Combined CET1 ratio of ${pct}% is ${threshold} the 10% well-capitalized threshold.`;
  }

  if ((inputs?.synergiesY1 || 0) > 0)
    text += ` Year 1 cost synergies of ${fmtMoney(inputs.synergiesY1)} offset ${fmtMoney(inputs.transactionFees)} in transaction fees.`;

  const dealSize = parseFloat(results?.totalPurchasePrice || 0);
  if (isGSIB(target?.ticker) && isGSIB(acquirer?.ticker) && dealSize > 100000) {
    text += ` Transaction would face near-certain regulatory rejection — Dodd-Frank Act and Federal Reserve concentration limits effectively prohibit mergers between two G-SIBs.`;
  } else if (dealSize > 50000) {
    text += ` Transaction will require Federal Reserve, OCC, and DOJ review.`;
  }

  return text;
}
