// Forward cost rows (Fix 17 Task 2), read by the Pro Forma slide and both Standalone P&L slides. One definition each.
//
// SG&A: FMP's own SG&A consensus (analyst-estimates `sgaExpenseAvg`), passed through by /api/pnl as `sga`, or null with
// the reason. It is SG&A only (it excludes R&D), so it is its own row and never the "Operating Expense" row.
// Total costs: consensus revenue − consensus operating income, the two figures the slides already show, or null when
// either is missing. Nothing here holds a margin or a ratio: cost of revenue, gross profit and gross margin stay
// unavailable on forward columns (the Nov 2 banker rule).

// FMP publishes analyst counts for revenue and EPS only; it gives none for SG&A, so the label says so rather than
// borrowing another metric's count.
export const SGA_LABEL = 'SG&A (FMP consensus, no analyst count)';
export const TOTAL_COSTS_LABEL = 'Total costs (derived: revenue − operating income)';

const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// A forward column's SG&A consensus ($M), or null.
export function forwardSga(col) {
  return col && !col.actual ? fin(col.sga) : null;
}

// Why a forward column's SG&A is "—", or null when it has a value.
export function forwardSgaReason(col) {
  if (!col || col.actual) return null;
  if (fin(col.sga) != null) return null;
  return col.sgaReason || `FMP returns no SG&A estimate for ${col.label || 'this year'}`;
}

// A forward column's total costs ($M): revenue − operating income, both consensus; null when either is missing.
export function forwardTotalCosts(col) {
  if (!col || col.actual) return null;
  const rev = fin(col.revenue), oi = fin(col.operatingIncome);
  return rev != null && oi != null ? rev - oi : null;
}

// Combined (and PF Tot.): acquirer + target where both exist, otherwise null ("—").
export const sumBoth = (a, b) => (a != null && b != null ? a + b : null);
