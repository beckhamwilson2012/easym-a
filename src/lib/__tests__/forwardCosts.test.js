import { forwardTotalCosts, sumBoth, TOTAL_COSTS_LABEL } from '../forwardCosts';
import * as forwardCosts from '../forwardCosts';

// Fix 17 Task 2 (with the addendum: no SG&A row). Columns as /api/pnl returns them ($M, rounded by inM): FMP
// analyst-estimates of Nov 16 2026. HNGE FY2027E revenueAvg 1,118,946,207 → 1,119; ebitAvg 313,417,550 → 313.
// OMDA FY2027E revenueAvg 411,456,389 → 411; ebitAvg 47,224,201 → 47.
const hnge27 = { fy: 2027, label: 'FY2027E', actual: false, revenue: 1119, operatingIncome: 313 };
const omda27 = { fy: 2027, label: 'FY2027E', actual: false, revenue: 411, operatingIncome: 47 };

describe('forward cost row', () => {
  test('total costs = revenue − operating income, by hand', () => {
    expect(forwardTotalCosts(hnge27)).toBe(1119 - 313);   // 806
    expect(forwardTotalCosts(omda27)).toBe(411 - 47);     // 364
    expect(sumBoth(forwardTotalCosts(hnge27), forwardTotalCosts(omda27))).toBe(1170);
  });

  test('missing operating income → total costs null; actual columns are not forward rows', () => {
    expect(forwardTotalCosts({ ...hnge27, operatingIncome: null })).toBeNull();
    expect(forwardTotalCosts({ ...hnge27, actual: true })).toBeNull();
    expect(forwardTotalCosts(null)).toBeNull();
    expect(sumBoth(forwardTotalCosts({ ...hnge27, revenue: null }), forwardTotalCosts(omda27))).toBeNull();
  });

  test('a genuine 0 operating income is a value, not absent', () => {
    expect(forwardTotalCosts({ ...hnge27, operatingIncome: 0 })).toBe(1119);
  });

  test('label; no SG&A row is exported (addendum: FMP SG&A for HNGE exceeds its total costs)', () => {
    expect(TOTAL_COSTS_LABEL).toBe('Total costs (derived: revenue − operating income)');
    expect(Object.keys(forwardCosts).filter((k) => /sga/i.test(k))).toEqual([]);
  });
});
