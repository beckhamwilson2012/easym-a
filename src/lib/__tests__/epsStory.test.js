// Fix 14 Task 3: one EPS story. The headline EPS impact is the verdict's own year, labeled with its year and basis.
import { headlineEps } from '../dealVerdict';

const y1Deal = (over = {}) => ({
  _inputs: { companyABasis: 'ltm', reportingBasis: 'GAAP', ...over.inputs },
  _results: { companyAEPS: '1.95', proFormaEPS: '1.91', epsChangePct: '-2.3', accretionMeaningful: true, isAccretive: false, ...over.results },
});

describe('headlineEps', () => {
  test('Year 1 verdict: Year 1 figures, labeled "Year 1 · LTM, GAAP"', () => {
    const h = headlineEps({ step: 1, verdict: 'dilutive' }, y1Deal());
    expect(h.label).toBe('Year 1 · LTM, GAAP');
    expect(h.pct).toBe(-2.3);
    expect(h.standaloneEPS).toBe(1.95);
    expect(h.verdict).toBe('dilutive');
  });

  test('Year 1 "—" and a forecast-year verdict: the tile shows the verdict’s year and figures, never n/m', () => {
    const v = { step: 2, year: 'FY2027E', verdict: 'accretive', pct: 11.7, standaloneEPS: 3.13, proFormaEPS: 3.5 };
    const d = y1Deal({ inputs: { reportingBasis: 'Non-GAAP', year1Reason: "OMDA doesn't report adjusted EPS" }, results: { companyAEPS: null, proFormaEPS: null, epsChangePct: null, accretionMeaningful: false } });
    const h = headlineEps(v, d);
    expect(h.label).toBe('FY2027E · FMP consensus (non-GAAP)');
    expect(h.pct).toBe(11.7);
    expect(h.standaloneEPS).toBe(3.13);
    expect(h.proFormaEPS).toBe(3.5);
  });

  test('a non-positive base: n/m with the reason, still labeled', () => {
    const h = headlineEps({ step: null }, y1Deal({ inputs: { companyABasis: 'fy', companyAPeriodLabel: 'FY2025' }, results: { companyAEPS: '-7.77', proFormaEPS: '-7.29', epsChangePct: null, accretionMeaningful: false } }));
    expect(h.label).toBe('Year 1 · FY2025, GAAP');
    expect(h.pct).toBeNull();
    expect(h.reason).toMatch(/not meaningful/);
  });

  test('Year 1 absent on a Non-GAAP deck with no verdict year: the reason, labeled non-GAAP', () => {
    const h = headlineEps({ step: null }, y1Deal({ inputs: { reportingBasis: 'Non-GAAP', year1Reason: 'OMDA doesn’t report adjusted EPS' }, results: { companyAEPS: null, proFormaEPS: null, epsChangePct: null, accretionMeaningful: false } }));
    expect(h.label).toBe('Year 1 · LTM, non-GAAP');
    expect(h.reason).toBe('OMDA doesn’t report adjusted EPS');
  });
});
