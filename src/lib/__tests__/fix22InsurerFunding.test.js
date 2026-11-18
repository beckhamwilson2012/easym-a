// Fix 22 Task 1: an insurer pair takes the bank funding path: no balance-sheet cash, no target debt repaid.
import { acquisitionNewDebt, calculate, fundingExempt, insurerFundingDeal } from '../../utils/dealCalc';
import { companyInputs, BASIS_FY } from '../companyBasis';

const base = {
  applySourcesOfFunds: true, companyASic: '6311', companyBSic: '6311',
  companyAShares: 650, companyADilutedShares: 650, companyANetIncome: 5000, companyAEPS: 7.7, companyARevenue: 80000, companyALtmRevenue: 80000,
  companyACash: 27000, companyASti: 0, companyADebt: 15000, currentSharePriceA: 80,
  companyBShares: 343, companyBNetIncome: 3800, companyBEPS: 11, companyBRevenue: 60000, companyBLtmRevenue: 60000,
  companyBCash: 18692, companyBSti: null, companyBDebt: 19768, currentSharePriceB: 100, offerPricePerShare: 130, cashPercent: 50,
};

describe('insurer funding exemption', () => {
  test('both insurers: cash is not used and the whole cash part is new debt', () => {
    const s = acquisitionNewDebt(base);
    expect(s.bank).toBe(true);
    expect(s.newDebt).toBeCloseTo(130 * 343 * 0.5, 6);
    expect(s.excessCashUsed).toBeNull();
    expect(s.targetDebtRepaid).toBeNull();
  });
  test('Sources = Uses, with a genuine zero of cash used', () => {
    const r = calculate(base);
    expect(r.bankFinancing).toBe(true);
    expect(r.insurerFinancing).toBe(true);
    expect(parseFloat(r.totalSources)).toBeCloseTo(parseFloat(r.totalUses), 0);
    expect(parseFloat(r.totalUses)).toBeCloseTo(130 * 343, 0);
    expect(r.capitalization.cashUsed).toBe(0);
  });
  test.each(['6311', '6321', '6324', '6331', '6351', '6361', '6399', '6411'])('SIC %s is exempt', (sic) => {
    expect(fundingExempt({ ...base, companyASic: sic, companyBSic: sic })).toBe(true);
  });
  test('one insurer and one ordinary company stay on the cash-funded path', () => {
    const i = { ...base, companyASic: '2080' };
    expect(fundingExempt(i)).toBe(false);
    expect(acquisitionNewDebt(i).bank).toBe(false);
    expect(acquisitionNewDebt(i).excessCashUsed).toBeGreaterThan(0);
  });
  test('an unknown SIC is not treated as an insurer', () => {
    expect(fundingExempt({ ...base, companyBSic: null })).toBe(false);
  });
  test('a bank deal stays a bank deal, not an insurer deal', () => {
    const i = { ...base, bankDeal: true, companyASic: '6021', companyBSic: '6021' };
    expect(fundingExempt(i)).toBe(true);
    expect(insurerFundingDeal(i)).toBe(false);
    expect(calculate(i).insurerFinancing).toBe(false);
  });
  test('the peer screen (no sources of funds) is not marked as exempt', () => {
    expect(acquisitionNewDebt({ ...base, applySourcesOfFunds: false }).bank).toBe(false);
  });
  test('companyInputs carries the SIC, null when absent', () => {
    expect(companyInputs('B', { sic: '6311' }, BASIS_FY).companyBSic).toBe('6311');
    expect(companyInputs('B', {}, BASIS_FY).companyBSic).toBeNull();
  });
});
