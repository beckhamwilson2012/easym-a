// Forward cost row (Fix 17 Task 2), read by the Pro Forma slide and both Standalone P&L slides. One definition.
// FMP's SG&A consensus is not used (Fix 17 addendum): for HNGE it exceeds revenue − operating income in every year.
//
// Total costs: consensus revenue − consensus operating income, the two figures the slides already show, or null when
// either is missing. Nothing here holds a margin or a ratio: cost of revenue, gross profit and gross margin stay
// unavailable on forward columns (the Nov 2 banker rule).

export const TOTAL_COSTS_LABEL = 'Total costs (derived: revenue − operating income)';

const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// A forward column's total costs ($M): revenue − operating income, both consensus; null when either is missing.
export function forwardTotalCosts(col) {
  if (!col || col.actual) return null;
  const rev = fin(col.revenue), oi = fin(col.operatingIncome);
  return rev != null && oi != null ? rev - oi : null;
}

// Combined (and PF Tot.): acquirer + target where both exist, otherwise null ("—").
export const sumBoth = (a, b) => (a != null && b != null ? a + b : null);
