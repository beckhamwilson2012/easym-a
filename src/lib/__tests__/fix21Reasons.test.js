import { dealVerdict, tagForwardYear } from '../dealVerdict';
import { explainCombinedCET1, explainProFormaEPS } from '../explanations';
import { calculate } from '../../utils/dealCalc';

// Fix 21 Task 2: a missing value is never printed as a negative, a zero, "loading" or a profitable turn.
const base = (over = {}) => ({
  companyANetIncome: 300, companyAEPS: 3, companyADilutedShares: 100, companyAShares: 100, currentSharePriceA: 60,
  companyBNetIncome: 50, companyBEPS: 1, companyBShares: 50, companyBDilutedShares: 50, currentSharePriceB: 25, companyBDebt: 10, companyBCash: 20,
  companyBEBITDA: 100, cashPercent: 0, offerPricePerShare: 30, reportingBasis: 'Non-GAAP', companyAEpsBasis: 'Non-GAAP',
  companyABasis: 'fy', companyBBasis: 'fy', companyAFiscalYearEnd: '2025-12-31', companyBFiscalYearEnd: '2025-12-31', ...over,
});
const fwd = (e26, e27) => [{ fy: 2026, eps: e26, actual: false }, { fy: 2027, eps: e27, actual: false }];
const deal = (inp) => ({ offerPrice: 30, _inputs: inp, _results: {}, synergies: { years: [1, 2, 3].map((year) => ({ year, ebitda: 0, entered: false })) } });
const model = { derived: {}, verifiedData: { acquirer: {} } };

describe('"first profitable year" needs a prior value at or below zero', () => {
  test('the tag text', () => {
    expect(tagForwardYear('FY2026E')).toBe('EPS test, FY2026E');
    expect(tagForwardYear('FY2026E', true)).toBe('EPS test, FY2026E (first profitable year)');
  });
  test('Year 1 missing (WMT, MCD): no claim', () => {
    const v = dealVerdict({ deal: deal(base({ companyANetIncome: null, companyAEPS: null, year1Reason: 'not reported' })), model, acquirerFwd: fwd(3, 4), targetFwd: fwd(1, 1) });
    expect(v.step).toBe(2);
    expect(v.tag).toBe('EPS test, FY2026E · FMP consensus (non-GAAP)');
  });
  test('Year 1 at a loss: the claim stands', () => {
    const v = dealVerdict({ deal: deal(base({ companyANetIncome: -100, companyAEPS: -1 })), model, acquirerFwd: fwd(3, 4), targetFwd: fwd(1, 1) });
    expect(v.tag).toBe('EPS test, FY2026E (first profitable year) · FMP consensus (non-GAAP)');
  });
  test('an earlier forecast year at a loss: the claim stands', () => {
    const v = dealVerdict({ deal: deal(base({ companyANetIncome: null, companyAEPS: null })), model, acquirerFwd: fwd(-1, 4), targetFwd: fwd(1, 1) });
    expect(v.year).toBe('FY2027E');
    expect(v.tag).toBe('EPS test, FY2027E (first profitable year) · FMP consensus (non-GAAP)');
  });
});

describe('multiples: absent is not negative', () => {
  test('null EBITDA gives no n/m reason; a negative one does', () => {
    expect(calculate(base({ companyBEBITDA: null })).evEBITDA).toBe('N/A');
    expect(calculate(base({ companyBEBITDA: null })).evEBITDAReason).toBeNull();
    expect(calculate(base({ companyBEBITDA: -5 })).evEBITDAReason).toBe('Target EBITDA is negative');
  });
  test('P/E: a null EPS is absent, a negative EPS is not', () => {
    expect(calculate(base({ companyBEPS: null })).peAbsent).toBe(true);
    expect(calculate(base({ companyBEPS: -1 })).peAbsent).toBe(false);
    expect(calculate(base({ companyBEPS: -1 })).peReason).toBe('Target earnings are negative');
  });
});

describe('explainers do not weight or divide a missing figure as 0', () => {
  test('CET1 with one ratio missing has no combined figure', () => {
    const e = explainCombinedCET1({ targetCET1: null, acquirerCET1: 0.108, targetRWA: 1000, acquirerRWA: 1000 });
    expect(e.result).toBe('N/A');
    expect(e.inputs[0].value).toBe('—');
  });
  test('pro forma EPS with no net income is N/A', () => {
    expect(explainProFormaEPS({ combinedNetIncome: null, synergiesY1: 0, totalShares: 100 }).result).toBe('N/A');
  });
});
