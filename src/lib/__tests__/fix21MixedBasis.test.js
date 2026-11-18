import { dealVerdict, headlineEps } from '../dealVerdict';
import { selectForwardYears, NO_GAAP_FORECAST } from '../forwardYears';
import { applyReportingBasis } from '../reportingBasis';
import { buildNarrative, calculate, forwardShareCount } from '../../utils/dealCalc';

// Fix 21 Task 6: one company on LTM, the other on a fiscal year. The verdict uses the first forward year with consensus for
// both, through the same step 2 a Non-GAAP deck uses when Year 1 is missing, and reads the same on both toggles.
const inputs = (over = {}) => ({
  companyANetIncome: 900, companyAEPS: 9, companyADilutedShares: 100, companyAShares: 100, currentSharePriceA: 200,
  companyBNetIncome: 50, companyBEPS: 1, companyBShares: 50, companyBDilutedShares: 50, currentSharePriceB: 40, companyBDebt: 0, companyBCash: 10,
  companyACash: 500, companyADebt: 0, cashPercent: 0, offerPricePerShare: 50,
  companyABasis: 'ltm', companyALtmAsOf: '2026-09-30', companyAFiscalYearEnd: '2026-06-30',
  companyBBasis: 'fy', companyBFiscalYearEnd: '2025-12-31', ...over,
});
const colsA = [2027, 2028, 2029].map((fy, i) => ({ fy, eps: 10 + i, actual: false }));
const colsB = [2026, 2027, 2028].map((fy, i) => ({ fy, eps: 2 + i, actual: false }));
const dealOf = (inp) => ({ offerPrice: 50, _inputs: inp, _results: calculate(inp), synergiesY1: 0, synergiesY2: 0, synergiesY3: 0,
  synergies: { years: [1, 2, 3].map((year) => ({ year, ebitda: 0, entered: false })) } });
const model = { derived: {}, verifiedData: { acquirer: {} } };
const run = (inp, a = colsA, b = colsB) => dealVerdict({ deal: dealOf(inp), model, acquirerFwd: a, targetFwd: b, acquirerName: 'MSFT', targetName: 'ADBE' });
const NG = { reportingBasis: 'Non-GAAP', companyAEpsBasis: 'Non-GAAP' };

describe('the forward years of a mixed-basis deal', () => {
  test('both start after the later Year 1 period, on GAAP too', () => {
    const s = selectForwardYears({ inputs: inputs(), acquirerFwd: colsA, targetFwd: colsB, acquirerName: 'MSFT', targetName: 'ADBE' });
    expect(s.gaap).toBe(false);
    expect(s.slots[0]).toMatchObject({ fyA: 2028, fyB: 2027, epsOk: true, label: 'FY2028E' });
    expect(s.slots[1]).toMatchObject({ fyA: 2029, fyB: 2028, epsOk: true });
    expect(s.slots[2].epsOk).toBe(false);
  });
  test('same-basis GAAP deals still have no forward years', () => {
    const s = selectForwardYears({ inputs: inputs({ companyBBasis: 'ltm', companyBLtmAsOf: '2026-09-30' }), acquirerFwd: colsA, targetFwd: colsB });
    expect(s.gaap).toBe(true);
    expect(s.slots[0].reason).toBe(NO_GAAP_FORECAST);
  });
});

describe('the verdict', () => {
  test('uses the first common year, labeled with both fiscal years', () => {
    const v = run(inputs());
    expect(v.step).toBe(2);
    expect(v.year).toBe('FY2028E (ADBE FY2027E)');
    expect(v.tag).toBe('EPS test, FY2028E (ADBE FY2027E) · FMP consensus (non-GAAP)');
    expect(v.line).toMatch(/use Year 2 \(FY2028E\); Year 1 —: companies on different bases\./);
    // MSFT FY2028E 11 × 100 + ADBE FY2027E 3 × 50 = 1,250 over 100 + 12.5 new shares
    expect(v.proFormaEPS).toBeCloseTo(1250 / 112.5, 10);
    expect(v.standaloneEPS).toBeCloseTo(11, 10);
  });
  test('reads the same on GAAP and Non-GAAP', () => {
    const g = run(inputs());
    const n = run(inputs({ ...NG, companyANetIncome: null, companyAEPS: null, year1Reason: 'not reported' }));
    ['step', 'text', 'tag', 'pct', 'standaloneEPS', 'proFormaEPS', 'breakeven', 'year', 'verdict'].forEach((k) => expect([k, n[k]]).toEqual([k, g[k]]));
  });
  test('the Non-GAAP plan\'s earnings-release share count does not change the answer', () => {
    const base = inputs();
    const plan = { selected: 'Non-GAAP', eps: { nonGaap: true, A: { netIncome: 950, value: 9.9, dilutedShares: 96 }, B: { netIncome: 55, value: 1.1, dilutedShares: 47 } },
      ebitda: { A: { nonGaap: false }, B: { nonGaap: false }, combinable: true } };
    const ng = applyReportingBasis(base, plan);
    expect(ng.companyADilutedShares).toBe(96);
    expect(forwardShareCount(ng, 'A')).toBe(100);
    expect(forwardShareCount(ng, 'B')).toBe(50);
    const n = run(ng), g = run(base);
    expect(n.pct).toBeCloseTo(g.pct, 10);
    expect(n.proFormaEPS).toBeCloseTo(g.proFormaEPS, 10);
  });
  test('the sentence follows the forward-year headline', () => {
    const inp = inputs();
    const d = dealOf(inp);
    const h = headlineEps(run(inp), d);
    expect(buildNarrative(d._results, inp, 'Microsoft', 'Adobe', [], h)).toMatch(/in FY2028E \(ADBE FY2027E\) on FMP consensus/);
  });
  test('no common forward year: the same line on both toggles', () => {
    const g = run(inputs(), colsA, null);
    const n = run(inputs({ ...NG, companyANetIncome: null, companyAEPS: null, year1Reason: 'not reported' }), colsA, null);
    expect(n.line).toBe(g.line);
  });
  test('no common forward year: "—" with the reason, on both toggles', () => {
    [inputs(), inputs(NG)].forEach((inp) => {
      const v = run(inp, colsA, null);
      expect(v.step).toBeNull();
      expect(v.text).toBe('—');
      expect(v.line).toMatch(/^No test can be computed: Year 1 combines companies on different bases; /);
      expect(v.line).toMatch(/no forward year has consensus for both companies: no forecast EPS for ADBE\.$/);
    });
  });
});
