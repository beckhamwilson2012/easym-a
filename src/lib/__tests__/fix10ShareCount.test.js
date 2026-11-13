import { companyInputs, BASIS_FY, BASIS_LTM } from '../companyBasis';
import { acquirerDilutedShares, forwardYearInputs, calcProFormaEPS } from '../../utils/dealCalc';
import { accretionShareCountLabel, forwardNetIncomeLabel } from '../composeSourceLine';

// Fix 10 Task 1: one diluted share count for Year 1 and every forward year — the latest filed weighted-average diluted
// count, never an older fiscal-year average (HNGE /quote dilutedShares 55, FY2025, from before its IPO conversion).
const hnge = {
  revenue: 588, ebitda: -541, netIncome: -528, epsNetIncome: -424, eps: -7.77, dilutedShares: 55,
  dilutedSharesPeriod: { basis: 'weighted average', end: '2025-12-31' }, fiscalYearEnd: '2025-12-31',
  ltm: { trusted: true, asOf: '2026-09-30', revenue: 801, eps: 1.95, epsNetIncome: 166, netIncome: 168, dilutedShares: 85 },
};

describe('Fix 10 Task 1 — forward share count', () => {
  test('FY card uses the latest interim diluted count, not the FY2025 average', () => {
    const fy = companyInputs('A', hnge, BASIS_FY);
    expect(fy.companyADilutedShares).toBe(85);
    expect(fy.companyADilutedSharesPeriod).toEqual({ basis: 'weighted average', end: '2026-09-30', interim: true });
    expect(acquirerDilutedShares(fy).shares).toBe(85);
  });
  test('LTM card is unchanged (85)', () => {
    expect(companyInputs('A', hnge, BASIS_LTM).companyADilutedShares).toBe(85);
  });
  test('no trusted LTM → the fiscal-year count stays', () => {
    const fy = companyInputs('A', { ...hnge, ltm: { trusted: false } }, BASIS_FY);
    expect(fy.companyADilutedShares).toBe(55);
    expect(fy.companyADilutedSharesPeriod).toEqual({ basis: 'weighted average', end: '2025-12-31' });
  });
  test('a trusted LTM with no diluted count keeps the fiscal-year count (never null → 0)', () => {
    const fy = companyInputs('A', { ...hnge, ltm: { ...hnge.ltm, dilutedShares: null } }, BASIS_FY);
    expect(fy.companyADilutedShares).toBe(55);
  });
  test('forward year uses the same count as Year 1: HNGE/TDOC FY2026E by hand', () => {
    const inputs = { ...companyInputs('A', hnge, BASIS_FY), companyBDilutedShares: 181, companyBShares: 178,
      offerPricePerShare: 11.30, cashPercent: 60, currentSharePriceA: 120.99, currentSharePriceB: 8.69,
      companyBNetIncome: -200, companyBDebt: 998, companyBCash: 850 };
    const fwd = forwardYearInputs(inputs, 2.51792, -0.83205);
    expect(fwd.companyANetIncome).toBeCloseTo(2.51792 * 85, 6);
    expect(acquirerDilutedShares(fwd).shares).toBe(acquirerDilutedShares(inputs).shares);
    // 100%-debt convention here (no applySourcesOfFunds): drag = 0.6 × 11.30 × 178 × 5% × 0.79
    const newSh = 0.4 * 11.30 * 178 / 120.99;
    const drag = 0.6 * 11.30 * 178 * 0.05 * 0.79;
    const hand = (2.51792 * 85 - 0.83205 * 181 - drag) / (85 + newSh);
    expect(calcProFormaEPS(11.30, 0, fwd)).toBeCloseTo(hand, 9);
  });
  test('labels name the count and its period', () => {
    const fy = companyInputs('A', hnge, BASIS_FY);
    expect(accretionShareCountLabel(fy)).toBe('Pro forma EPS, every year, uses one acquirer share count: 85.0M diluted (weighted average, latest interim period ended September 30, 2026) plus the new shares issued.');
    expect(forwardNetIncomeLabel(fy)).toBe('Acquirer net income = consensus EPS × current diluted shares (85.0M, weighted average, latest interim period ended September 30, 2026)');
    expect(accretionShareCountLabel({})).toBeNull();
  });
});
