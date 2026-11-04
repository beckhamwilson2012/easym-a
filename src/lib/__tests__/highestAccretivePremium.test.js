import { highestAccretivePremium, firstForwardColumn, offerFromPremium } from '../offerPremium';
import { epsAccretionPct, forwardYearInputs } from '../../utils/dealCalc';

const deal = {
  companyANetIncome: 100, companyAEPS: 1, companyADilutedShares: 100, companyAShares: 100, currentSharePriceA: 50,
  companyACash: 500, companyASti: null, companyALtmRevenue: 1000,
  companyBNetIncome: 50, companyBShares: 50, companyBDilutedShares: 50, companyBCash: 100, companyBSti: null, companyBLtmRevenue: 500,
  companyBDebt: 100, cashPercent: 60, applySourcesOfFunds: true, bankDeal: false,
};
const base = { calcInputs: deal, spot: 20, synergyY1: 10, acquirerFwd: { eps: 2 }, targetFwd: { eps: 2 }, acquirerName: 'AAA', targetName: 'BBB' };

describe('highest premium still accretive in Year 2', () => {
  test('the answer is accretive and one step higher is not, by the deal model itself', () => {
    const r = highestAccretivePremium({ ...base, calcInputs: { ...deal, currentSharePriceA: 30 }, spot: 30, targetFwd: { eps: 1.6 } });
    expect(r.premium).toBeGreaterThan(0);
    expect(r.premium).toBeLessThan(100);
    const fwd = forwardYearInputs({ ...deal, currentSharePriceA: 30 }, 2, 1.6);
    expect(epsAccretionPct(offerFromPremium(30, r.premium), 10, fwd)).toBeGreaterThan(0);
    expect(epsAccretionPct(offerFromPremium(30, r.premium + 1), 10, fwd)).toBeLessThanOrEqual(0);
  });

  test.each([
    ['negative acquirer EPS', { acquirerFwd: { eps: -0.29 } }, /AAA's Year 2 consensus EPS is \$-0\.29/],
    ['zero acquirer EPS', { acquirerFwd: { eps: 0 } }, /isn't positive/],
    ['no acquirer consensus', { acquirerFwd: null }, /no Year 2 consensus EPS for AAA/],
    ['no target consensus', { targetFwd: { eps: null } }, /no Year 2 consensus EPS for BBB/],
    ['no spot', { spot: null }, /no live price for BBB/],
    ['no acquirer price', { calcInputs: { ...deal, currentSharePriceA: 0 } }, /no live price for AAA/],
    ['no synergies', { synergyY1: null }, /no Year 1 synergy/],
    ['target debt unavailable', { calcInputs: { ...deal, companyBDebt: null } }, /total debt is unavailable/],
    ['no target shares', { calcInputs: { ...deal, companyBShares: 0 } }, /share count is missing/],
    ['loading', { pnlLoading: true }, /still loading/],
  ])('%s gives no value and a reason', (_n, patch, reason) => {
    const r = highestAccretivePremium({ ...base, ...patch });
    expect(r.premium).toBeNull();
    expect(r.reason).toMatch(reason);
  });

  test('dilutive even at 0% says so', () => {
    const r = highestAccretivePremium({ ...base, targetFwd: { eps: 0.01 }, synergyY1: 0, spot: 100 });
    expect(r.premium).toBeNull();
    expect(r.reason).toMatch(/dilutive in Year 2 even at a 0% premium/);
  });

  test('forward column skips actuals', () => {
    expect(firstForwardColumn({ columns: [{ actual: true, eps: 1 }, { actual: false, fy: 2026, eps: 2 }, { actual: false, fy: 2027, eps: 3 }] }).fy).toBe(2026);
    expect(firstForwardColumn(null)).toBeNull();
  });
});
