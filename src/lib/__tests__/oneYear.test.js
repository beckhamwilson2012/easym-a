import { calcProFormaEPS, proFormaBreakdown, forwardYearInputs } from '../../utils/dealCalc';

// Fix 16 Task 3: one pro forma calculation. proFormaBreakdown is the lines calcProFormaEPS was always built from; the
// Deal Summary prints them for the verdict's forecast year when Year 1 is "—".
const base = {
  companyANetIncome: 188.403, companyAEPS: 2.24, companyADilutedShares: 85, companyAShares: 81, currentSharePriceA: 120,
  companyBNetIncome: 26.44, companyBShares: 62.04, companyBDilutedShares: 65, companyBDebt: 0, companyBCash: 243,
  companyACash: 212, companyADebt: 0, companyARevenue: 801, companyBRevenue: 333, cashPercent: 50, offerPricePerShare: 18.3, applySourcesOfFunds: true,
};

describe('proFormaBreakdown — the one pro forma EPS, with its lines', () => {
  test('eps equals calcProFormaEPS, and net income ÷ shares is that eps', () => {
    for (const cash of [0, 50, 100]) {
      const i = { ...base, cashPercent: cash };
      const b = proFormaBreakdown(18.3, 8.4, i);
      expect(b.eps).toBe(calcProFormaEPS(18.3, 8.4, i));
      expect(b.netIncome / b.totalShares).toBe(b.eps);
      expect(b.afterTaxSynergies).toBeCloseTo(8.4 * 0.79, 12);
      expect(b.netIncome).toBeCloseTo(188.403 + 26.44 + 8.4 * 0.79 - b.fin.total, 9);
    }
  });

  test('null exactly where calcProFormaEPS is null (Year 1 "—": net income absent)', () => {
    const i = { ...base, companyANetIncome: null, companyBNetIncome: null };
    expect(calcProFormaEPS(18.3, 8.4, i)).toBeNull();
    expect(proFormaBreakdown(18.3, 8.4, i)).toBeNull();
  });

  test('on a forecast year the lines are that year’s: consensus EPS × diluted shares', () => {
    const fwd = forwardYearInputs({ ...base, companyANetIncome: null, companyBNetIncome: null }, 3.12917, 0.58557);
    const b = proFormaBreakdown(18.3, 14.6, fwd);
    expect(b.acquirerNetIncome).toBeCloseTo(3.12917 * 85, 9);
    expect(b.targetNetIncome).toBeCloseTo(0.58557 * 65, 9);
    expect(b.eps).toBe(calcProFormaEPS(18.3, 14.6, fwd));
  });
});
