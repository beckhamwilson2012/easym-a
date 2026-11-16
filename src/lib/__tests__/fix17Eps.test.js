import { calculate, calcProFormaEPS, proFormaBreakdown, acquirerStandaloneEPS, acquirerReportedEPS, epsAccretionPct, forwardYearInputs } from '../../utils/dealCalc';
import { reportedEpsReference } from '../dealVerdict';

// Fix 17 Task 1: before and after on one method. Standalone EPS = the acquirer's net income ÷ the same share count the pro
// forma divides by; the company's reported EPS is a labeled reference line, never the comparison base.
const base = {
  companyANetIncome: 188.403, companyAEPS: 2.24, companyADilutedShares: 85, companyAShares: 81, currentSharePriceA: 120,
  companyBNetIncome: 26.44, companyBShares: 62.04, companyBDilutedShares: 65, companyBDebt: 0, companyBCash: 243,
  companyACash: 212, companyADebt: 0, companyARevenue: 801, companyBRevenue: 333, cashPercent: 25, offerPricePerShare: 18.3, applySourcesOfFunds: true,
};

describe('standalone EPS: net income ÷ the pro forma share count', () => {
  test('HNGE: 188.403 ÷ 85.0 = $2.2165, not the reported $2.24', () => {
    expect(acquirerStandaloneEPS(base)).toBeCloseTo(188.403 / 85, 12);
    expect(acquirerReportedEPS(base)).toBe(2.24);
  });

  test('the base is the pro forma acquirer leg with no deal: same numerator, same count', () => {
    const b = proFormaBreakdown(18.3, 0, base);
    expect(b.acquirerNetIncome / (b.totalShares - (b.totalShares - 85))).toBeCloseTo(acquirerStandaloneEPS(base), 12);
  });

  test('accretion, calculate() and breakeven all use it', () => {
    const sa = 188.403 / 85;
    const pf = calcProFormaEPS(18.3, 9.12, base);
    expect(epsAccretionPct(18.3, 9.12, base)).toBeCloseTo((pf / sa - 1) * 100, 10);
    const r = calculate({ ...base, synergiesY1: 9.12 });
    expect(r.companyAEPS).toBe(sa.toFixed(2));
    // breakeven synergy: pro forma EPS at the breakeven equals the standalone EPS
    const at0 = calcProFormaEPS(18.3, 0, base), at1 = calcProFormaEPS(18.3, 1, base);
    const be = (sa - at0) / (at1 - at0);
    expect(calcProFormaEPS(18.3, be, base)).toBeCloseTo(sa, 10);
  });

  test('absent net income is an absent EPS, even with a reported EPS loaded', () => {
    expect(acquirerStandaloneEPS({ ...base, companyANetIncome: null })).toBeNull();
    expect(acquirerStandaloneEPS({ ...base, companyANetIncome: '' })).toBeNull();
  });

  test('a forward year is unchanged: consensus EPS × count ÷ count', () => {
    const fwd = forwardYearInputs(base, 3.12917, 0.58557);
    expect(acquirerStandaloneEPS(fwd)).toBeCloseTo(3.12917, 12);
  });

  test('no diluted count: the count derived from reported EPS, so NI ÷ count = reported (as the pro forma uses)', () => {
    const i = { ...base, companyADilutedShares: 0 };
    expect(acquirerStandaloneEPS(i)).toBeCloseTo(2.24, 12);
  });
});

describe('reportedEpsReference — the labeled reference line', () => {
  const h1 = { year: 'Year 1', standaloneEPS: 2.2165 };
  const ngDeal = (A) => ({ _inputs: { ...base, reportingBasis: 'Non-GAAP' }, reportingBasis: { eps: { nonGaap: true, A } } });

  test('non-GAAP, reported LTM: the sum of four quarterly releases', () => {
    expect(reportedEpsReference(h1, ngDeal({ ltmReported: true })).text).toBe('Reported: $2.24 (sum of four quarterly releases)');
  });
  test('non-GAAP, FY release', () => {
    expect(reportedEpsReference(h1, ngDeal({ fiscalYearEnd: '2025-12-31' })).text).toBe('Reported: $2.24 (FY2025 earnings release)');
  });
  test('a computed EPS is not reported: no line', () => {
    expect(reportedEpsReference(h1, ngDeal({ computed: true }))).toBeNull();
  });
  test('GAAP LTM: the filed-quarters label', () => {
    const d = { _inputs: { ...base, companyAEPS: 1.95, companyABasis: 'ltm', companyAEpsLabel: 'sum of 4 filed quarters: quarter to 2025-12-31 $0.37 + 9 months to 2026-09-30 $1.58' } };
    expect(reportedEpsReference(h1, d).text).toBe('Reported: $1.95 (sum of 4 filed quarters: quarter to 2025-12-31 $0.37 + 9 months to 2026-09-30 $1.58)');
  });
  test('a forecast-year headline has no reported line', () => {
    expect(reportedEpsReference({ year: 'FY2027E', standaloneEPS: 3.13 }, ngDeal({ ltmReported: true }))).toBeNull();
  });
  test('no reported EPS: no line (absent, not $0.00)', () => {
    expect(reportedEpsReference(h1, { _inputs: { ...base, companyAEPS: null } })).toBeNull();
  });
});
