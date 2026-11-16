import { forwardSga, forwardSgaReason, forwardTotalCosts, sumBoth, SGA_LABEL, TOTAL_COSTS_LABEL } from '../forwardCosts';

// Fix 17 Task 2. Columns as /api/pnl returns them ($M, rounded by inM): FMP analyst-estimates of Nov 16 2026.
// HNGE FY2027E: revenueAvg 1,118,946,207 → 1,119; ebitAvg 313,417,550 → 313; sgaExpenseAvg 896,550,206 → 897.
// OMDA FY2027E: revenueAvg 411,456,389 → 411; ebitAvg 47,224,201 → 47; sgaExpenseAvg 311,494,519 → 311.
const hnge27 = { fy: 2027, label: 'FY2027E', actual: false, revenue: 1119, operatingIncome: 313, sga: 897, sgaReason: null };
const omda27 = { fy: 2027, label: 'FY2027E', actual: false, revenue: 411, operatingIncome: 47, sga: 311, sgaReason: null };

describe('forward cost rows', () => {
  test('SG&A is FMP’s figure as returned', () => {
    expect(forwardSga(hnge27)).toBe(897);
    expect(forwardSga(omda27)).toBe(311);
    expect(sumBoth(forwardSga(hnge27), forwardSga(omda27))).toBe(1208);
  });

  test('total costs = revenue − operating income, by hand', () => {
    expect(forwardTotalCosts(hnge27)).toBe(1119 - 313);   // 806
    expect(forwardTotalCosts(omda27)).toBe(411 - 47);     // 364
    expect(sumBoth(forwardTotalCosts(hnge27), forwardTotalCosts(omda27))).toBe(1170);
  });

  test('missing SG&A is null with the reason, never 0', () => {
    const col = { ...hnge27, sga: null, sgaReason: 'FMP returns no SG&A estimate for FY2027' };
    expect(forwardSga(col)).toBeNull();
    expect(forwardSgaReason(col)).toBe('FMP returns no SG&A estimate for FY2027');
    expect(forwardSgaReason(hnge27)).toBeNull();
    expect(sumBoth(forwardSga(col), forwardSga(omda27))).toBeNull();   // one side missing → Combined "—"
  });

  test('missing operating income → total costs null; actual columns are not forward rows', () => {
    expect(forwardTotalCosts({ ...hnge27, operatingIncome: null })).toBeNull();
    expect(forwardTotalCosts({ ...hnge27, actual: true })).toBeNull();
    expect(forwardSga({ ...hnge27, actual: true })).toBeNull();
    expect(forwardTotalCosts(null)).toBeNull();
  });

  test('a genuine 0 operating income is a value, not absent', () => {
    expect(forwardTotalCosts({ ...hnge27, operatingIncome: 0 })).toBe(1119);
  });

  test('labels: SG&A is its own row and says FMP gives no count', () => {
    expect(SGA_LABEL).toMatch(/^SG&A \(FMP consensus/);
    expect(SGA_LABEL).not.toMatch(/Operating Expense/);
    expect(TOTAL_COSTS_LABEL).toBe('Total costs (derived: revenue − operating income)');
  });
});
