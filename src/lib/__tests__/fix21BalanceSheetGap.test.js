import { balanceSheetGap, dealBalanceSheetGap, enterpriseValue, netCashDebt } from '../netDebt';
import { calculate } from '../../utils/dealCalc';

// Fix 21 Task 4: a missing target cash or debt blanks EV, net debt and leverage with one reason, and is never $0.
const inputs = (over = {}) => ({
  companyANetIncome: 300, companyAEPS: 3, companyADilutedShares: 100, companyAShares: 100, currentSharePriceA: 60, companyACash: 500, companyADebt: 200,
  companyAEBITDA: 400, companyARevenue: 2000, companyALtmRevenue: 2000, companyBNetIncome: 50, companyBEPS: 1, companyBShares: 50, companyBDilutedShares: 50,
  currentSharePriceB: 25, companyBCash: 20, companyBDebt: 10, companyBEBITDA: 100, companyBRevenue: 500, companyBLtmRevenue: 500,
  cashPercent: 50, offerPricePerShare: 30, applySourcesOfFunds: true, ...over,
});

describe('balanceSheetGap', () => {
  test('names the missing leg', () => {
    expect(balanceSheetGap('FND', { cash: null, debt: 196 })).toBe('FND cash is not in its filing data');
    expect(balanceSheetGap('S', { cash: 5, debt: null, debtReason: 'no debt tag' })).toBe('S total debt is not shown: no debt tag');
    expect(balanceSheetGap('X', { cash: null, debt: null })).toBe('X cash is not in its filing data; X total debt is not shown: no total debt figure in its filing data');
  });
  test('a filed $0 is a figure, not a gap', () => {
    expect(balanceSheetGap('HNGE', { cash: 10, debt: 0 })).toBeNull();
    expect(balanceSheetGap('Z', { cash: 0, debt: 0 })).toBeNull();
  });
  test('both companies, for the combined figures', () => {
    expect(dealBalanceSheetGap('A', { cash: 1, debt: 1 }, 'B', { cash: null, debt: 1 })).toBe('B cash is not in its filing data');
    expect(dealBalanceSheetGap('A', { cash: 1, debt: 1 }, 'B', { cash: 1, debt: 1 })).toBeNull();
  });
});

describe('null cash or debt never computes as 0', () => {
  test('net debt and EV are null', () => {
    expect(netCashDebt(196, null, null)).toBeNull();
    expect(netCashDebt(null, 20, null)).toBeNull();
    expect(enterpriseValue(1000, 196, null, null, null)).toBeNull();
  });
  test.each([['companyBCash', 'cash'], ['companyBDebt', 'targetDebt']])('deal with %s null: EV, new debt and leverage are absent', (field, gap) => {
    const r = calculate(inputs({ [field]: null }));
    expect(r.enterpriseValue).toBeNull();
    expect(r.newDebt).toBeNull();
    expect(r.debtEBITDA).toBe('N/A');
    expect(r.debtEBITDAReason).toBeNull();
    expect(r.fundingGap).toBe(gap);
    expect(r.capitalization.proFormaNetDebt).toBeNull();
    expect(r.proFormaEPS).toBeNull();
  });
  test('with both present the same deal computes', () => {
    const r = calculate(inputs());
    expect(r.enterpriseValue).toBe('1490');
    expect(r.newDebt).not.toBeNull();
  });
});
