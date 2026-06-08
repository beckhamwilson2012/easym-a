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
  const sign = v < 0 ? '-' : '';
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}B`;
  if (abs >= 1)    return `${sign}$${abs.toFixed(1)}M`;
  if (abs >= 0.001) return `${sign}$${(abs * 1000).toFixed(1)}K`;
  return `${sign}$${(abs * 1e6).toFixed(0)}`;
}

// Table money formatter — stays in M with comma separators until $10B.
// Use in dense tables (sensitivity, comparables, P&L) for direct comparison.
export function fmtMoneyTable(m) {
  const v = parseFloat(m);
  if (isNaN(v) || m === null || m === undefined) return 'N/A';
  const abs  = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 10000) return `${sign}$${(abs / 1000).toFixed(1)}B`;
  if (abs >= 1)     return `${sign}$${Math.round(abs).toLocaleString('en-US')}M`;
  if (abs >= 0.001) return `${sign}$${(abs * 1000).toFixed(1)}K`;
  return `${sign}$${(abs * 1e6).toFixed(0)}`;
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

// Single standalone-EPS basis for the WHOLE deck: net income ÷ shares outstanding. This is the same
// basis dealCalc.acquirerStandaloneEPS uses for the accretion math, so a company shows ONE EPS on
// every slide (the dashboard/§7 already use this; §3/§4/§5/§6/FinancialProfile previously printed the
// reported `eps` field, which differs for profitable filers because reported EPS uses diluted
// weighted-average shares). Falls back to the reported `eps` field only when NI or shares is missing.
export function standaloneEPS(company) {
  const ni = parseFloat(company?.netIncome);
  const sh = parseFloat(company?.shares);
  if (!isNaN(ni) && sh > 0) return ni / sh;
  const rep = parseFloat(company?.eps);
  return isNaN(rep) ? null : rep;
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
    ['6020', '6021', '6022', '6199', '6211'].includes(companyTypeOrCompany.sic);
}

export function isSaaSLike(companyType) {
  return companyType === 'saas' || companyType === 'software';
}

// ── Estimation helpers ────────────────────────────────────────────────────────

export function estimateSegmentMix(target) {
  if (isFinancial(target.companyType)) {
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

export function generatePriceSeries(target, deal) {
  const ebitda = parseFloat(target.ebitda) || 0;
  const shares = parseFloat(target.shares) || 1;
  const cash   = parseFloat(target.cash)   || 0;
  const debt   = parseFloat(target.debt)   || 0;
  const offerPrice = parseFloat(deal.offerPrice) || 0;
  const multiples  = [8, 10, 12, 14, 16];

  return multiples.map(mult => {
    const ev     = ebitda > 0 ? ebitda * mult : 0;
    const equity = ev - debt + cash;
    const price  = shares > 0 ? equity / shares : 0;
    const diff   = offerPrice > 0 && price > 0 ? ((offerPrice - price) / price) * 100 : null;
    return { multiple: mult, ev, price: Math.max(price, 0), diffPct: diff };
  });
}

export function buildFinancialCommentary(target, deal) {
  const lines = [];
  const rev   = parseFloat(target.revenue)  || 0;
  const ebitda = parseFloat(target.ebitda)  || 0;
  const ni    = parseFloat(target.netIncome) || 0;
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
  if (ni > 0 && rev > 0) {
    lines.push(`Net income of ${fmtMoney(ni)} represents a ${(ni / rev * 100).toFixed(1)}% net margin.`);
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

export const isBankDeal = (target, acquirer) =>
  isFinancial(target?.companyType) && isFinancial(acquirer?.companyType);

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
    text = `${a}'s acquisition of ${b} at ${priceStr}/share (${totalStr} total) would be ${direction}, moving pro forma EPS from ${fmtPerShare(results?.companyAEPS)} to ${fmtPerShare(results?.proFormaEPS)} (percentage change not meaningful from a negative base).`;
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
