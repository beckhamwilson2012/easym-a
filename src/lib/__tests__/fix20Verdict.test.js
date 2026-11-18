import { dealVerdict, verdictFlags } from '../dealVerdict';

// Fix 20 Task 4: the "Synergies cover / don't cover the premium" test uses the verdict's year and basis. When Year 1 is on
// different bases (one company LTM, the other fiscal year), it is blank with that reason on both bases.
// Same fixture as dealVerdict.test.js: acquirer EPS 2, price 40; target 50 shares at 25; offer 30.
const inputs = (over = {}) => ({
  companyANetIncome: 200, companyAEPS: 2, companyADilutedShares: 100, companyAShares: 100, currentSharePriceA: 40,
  companyBNetIncome: null, companyBShares: 50, companyBDilutedShares: 50, currentSharePriceB: 25, companyBDebt: 0,
  cashPercent: 0, offerPricePerShare: 30, ...over,
});
const years = (y1, y2, y3) => ({ years: [y1, y2, y3].map((v, i) => ({ year: i + 1, ebitda: v ?? 0, entered: v != null })) });
const deal = (inp, results = {}) => ({
  offerPrice: inp.offerPricePerShare, _inputs: inp, _results: results,
  synergiesY1: 10, synergiesY2: 20, synergiesY3: 30, synergies: years(10, 20, 30),
});
const model = { derived: { evAcquirer: 4000 }, verifiedData: { acquirer: { price: 40, ebitda: 400 } } };

describe('step 3 follows the verdict year and basis', () => {
  test('same bases: step 3 runs as before (P/E 20x, after tax)', () => {
    const v = dealVerdict({ deal: deal(inputs()), model, acquirerFwd: [], targetFwd: [] });
    expect(v.step).toBe(3);
    expect(v.text).toBe('Synergies cover the premium');
  });
  test('different bases on GAAP (P/E computable): blank, with the different-bases reason', () => {
    const v = dealVerdict({ deal: deal(inputs(), { basesDiffer: true }), model, acquirerFwd: [], targetFwd: [] });
    expect(v.step).toBeNull();
    expect(v.text).toBe('—');
    expect(v.breakeven).toBeUndefined();
    expect(v.line).toMatch(/^No test can be computed: Year 1 combines companies on different bases/);
    expect(v.line.match(/different bases/g)).toHaveLength(1);
  });
  test('different bases on Non-GAAP (no Year 1 EPS, so EV/EBITDA would have been used): blank with the same leading reason', () => {
    const inp = inputs({ companyANetIncome: null, reportingBasis: 'Non-GAAP', year1Reason: 'Year 1 non-GAAP EPS not available' });
    const v = dealVerdict({ deal: deal(inp, { basesDiffer: true }), model, acquirerFwd: [], targetFwd: [] });
    expect(v.step).toBeNull();
    expect(v.text).toBe('—');
    expect(v.line).toMatch(/^No test can be computed: Year 1 combines companies on different bases; Year 1 —: Year 1 non-GAAP EPS not available/);
  });
  test('the risk flag names the reason, not a covers/short figure', () => {
    const v = dealVerdict({ deal: deal(inputs(), { basesDiffer: true }), model, acquirerFwd: [], targetFwd: [] });
    const f = verdictFlags(v);
    expect(f).toHaveLength(1);
    expect(f[0].text).toMatch(/^No deal verdict: no test can be computed — Year 1 combines companies on different bases/);
  });
});
