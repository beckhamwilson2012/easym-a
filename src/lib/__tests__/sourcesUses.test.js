import { calculate } from '../../utils/dealCalc';

const deal = {
  companyARevenue: 1000, companyAEBITDA: 200, companyANetIncome: 100, companyAEPS: 1, companyADilutedShares: 100, companyAShares: 100, currentSharePriceA: 37.13,
  companyACash: 333.3, companyASti: 11.1, companyALtmRevenue: 1100, companyADebt: 50,
  companyBRevenue: 500, companyBEBITDA: 90, companyBNetIncome: 50, companyBShares: 47.7, companyBDilutedShares: 48, companyBEPS: 1, companyBCash: 77.7, companyBSti: null, companyBLtmRevenue: 510, companyBDebt: 123.4,
  currentSharePriceB: 22.22, offerPricePerShare: 28.886, cashPercent: 60, synergiesY1: 10, synergiesY2: 20, synergiesY3: 30, applySourcesOfFunds: true,
};

describe('Sources & Uses totals', () => {
  test('foot exactly with no balancing row', () => {
    const r = calculate(deal);
    expect(r.totalSources).toBe(r.totalUses);
    expect(parseFloat(r.totalUses)).toBeCloseTo(28.886 * 47.7 + 123.4, -0.5);
  });

  test('a bank deal foots on new debt and stock alone', () => {
    const r = calculate({ ...deal, bankDeal: true });
    expect(r.totalSources).toBe(r.totalUses);
    expect(r.totalUses).toBe((28.886 * 47.7).toFixed(0));
  });

  test('unavailable target debt leaves both totals null, never a $0-debt sum', () => {
    const r = calculate({ ...deal, companyBDebt: null });
    expect(r.totalUses).toBeNull();
    expect(r.totalSources).toBeNull();
  });

  test('no fee key survives in the results', () => {
    expect(Object.keys(calculate(deal)).filter(k => /fee/i.test(k))).toEqual([]);
  });
});
