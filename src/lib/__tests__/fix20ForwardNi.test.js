import { forwardNetIncome, forwardShareCount, forwardYearInputs } from '../../utils/dealCalc';

// Fix 20 Task 2: one forward net income per company. CRM/TEAM on 4f5be4a: CRM FY2028E consensus EPS $16.06647, CRM's one
// diluted count 845M (LTM weighted average to 2026-07-31). Pro Forma printed $13,576; the Standalone P&L printed FMP's
// netIncomeAvg $15,858 (an implied 987M shares). Both now read forwardNetIncome.
const inputs = { companyADilutedShares: 845, companyBDilutedShares: 263.5, companyBShares: 260 };

describe('forwardNetIncome', () => {
  test('acquirer: consensus EPS × the one diluted share count', () => {
    expect(forwardShareCount(inputs, 'A')).toBe(845);
    expect(Math.round(forwardNetIncome(inputs, 'A', 16.06647))).toBe(13576);
  });
  test('target: diluted count, else shares outstanding', () => {
    expect(forwardShareCount(inputs, 'B')).toBe(263.5);
    expect(forwardShareCount({ companyBShares: 260 }, 'B')).toBe(260);
  });
  test('forwardYearInputs reads the same function: its net incomes are unchanged', () => {
    const f = forwardYearInputs(inputs, 16.06647, 6.53);
    expect(f.companyANetIncome).toBe(forwardNetIncome(inputs, 'A', 16.06647));
    expect(f.companyBNetIncome).toBe(forwardNetIncome(inputs, 'B', 6.53));
    expect(f.companyANetIncome).toBeCloseTo(16.06647 * 845, 9);
    expect(f.companyBNetIncome).toBeCloseTo(6.53 * 263.5, 9);
    expect(f.companyADilutedShares).toBe(845);
    expect(f.companyAEPS).toBe(16.06647);
    // ties: forward net income ÷ the share count = the consensus EPS the P&L prints
    expect(f.companyANetIncome / f.companyADilutedShares).toBeCloseTo(16.06647, 9);
  });
});
