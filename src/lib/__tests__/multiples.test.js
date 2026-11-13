import { multipleOf, multipleFromRatio, MULTIPLE_CAP } from '../multiples';
import { calculate, computeFlags } from '../../utils/dealCalc';

// Fix 10 Task 4: one rule for every multiple. NET/DDOG's Deal Summary printed 17,336.7x, 528.6x, 333.1x and 2,143.3x.
describe('Fix 10 Task 4 — one rule for multiples', () => {
  test('the cap is 100x, and a near-zero denominator says so', () => {
    expect(MULTIPLE_CAP).toBe(100);
    expect(multipleOf(86684, 5, { denName: 'Target EBITDA' })).toMatchObject({ value: null, text: 'n/m', reason: 'above 100x (Target EBITDA is near zero)' });
    expect(multipleOf(100, 1).text).toBe('100.0x');            // exactly 100 is shown
    expect(multipleOf(1001, 10).text).toBe('n/m');
  });
  test('zero or negative denominator → n/m with the reason; absent → "—", never 0', () => {
    expect(multipleOf(10, 0, { denName: 'EPS' })).toMatchObject({ text: 'n/m', reason: 'EPS is zero' });
    expect(multipleOf(10, -2, { denName: 'EPS' })).toMatchObject({ text: 'n/m', reason: 'EPS is negative' });
    expect(multipleOf(null, 5)).toMatchObject({ value: null, text: '—', reason: null });
    expect(multipleOf(5, null).text).toBe('—');
  });
  test('a negative multiple on a positive denominator (net cash) is a real figure', () => {
    expect(multipleOf(-2780, 394).text).toBe('-7.1x');
    expect(multipleOf(-4933, 22).text).toBe('n/m');           // NET/DDOG LTM pre-deal: |−224x| > 100
  });
  test('a ratio divided elsewhere (FMP evToEBITDA) gets the same cap', () => {
    expect(multipleFromRatio(380.2).text).toBe('n/m');
    expect(multipleFromRatio(16.8).text).toBe('16.8x');
    expect(multipleFromRatio(-3).text).toBe('n/m');
  });
  test('Deal Summary tiles (dealCalc): NET/DDOG FY EV/EBITDA and P/E become n/m with the reason', () => {
    const r = calculate({ offerPricePerShare: 239.80, companyBShares: 361, cashPercent: 60, currentSharePriceA: 318.5,
      companyANetIncome: 342.882, companyAEPS: 0.93, companyADilutedShares: 370.274, companyBNetIncome: 746.582, companyBEPS: 2.05,
      companyBEBITDA: 5, companyBDebt: 987, companyBCash: 881, companyAEBITDA: -17, companyARevenue: 2168, companyBRevenue: 3427 });
    expect(r.evEBITDA).toBe('N/A');
    expect(r.evEBITDAReason).toBe('above 100x (Target EBITDA is near zero)');
    expect(r.peRatio).toBe('N/A');                              // 239.80 ÷ 2.05 = 117.0
    expect(r.peReason).toBe('above 100x (Target EPS is near zero)');
  });
  test('Debt/EBITDA above 100x is n/m, and the leverage flag still fires with that reason', () => {
    const flags = computeFlags({ debtEBITDA: 'N/A', debtEBITDAAboveCap: true, totalPurchasePrice: '1', newSharesIssued: null, purchasePremium: '30' }, { companyAShares: 1 });
    expect(flags.map(f => f.text)).toContain('Combined leverage is very high — Debt/EBITDA is above 100x (n/m: combined EBITDA is near zero)');
  });
});
