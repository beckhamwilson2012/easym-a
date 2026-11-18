import { buildNarrative } from '../../utils/dealCalc';
import { headlineEps } from '../dealVerdict';

// Fix 20 Task 3: the Deal Summary sentence reads the headline object. RKLB/IRDM Non-GAAP on 4f5be4a: Year 1 −$0.11 → −$0.14
// (n/m), verdict step 2 FY2028E $0.19 → $0.13 (−35.0%); the sentence printed Year 1 under the FY2028E headline.
const results = { companyAEPS: '-0.11', proFormaEPS: '-0.14', epsChangePct: null, accretionMeaningful: false, isAccretive: false, totalPurchasePrice: 6155 };
const inputs = { offerPricePerShare: 57.98, companyABasis: 'ltm', reportingBasis: 'nonGaap' };
const deal = { _inputs: inputs, _results: results };

describe('buildNarrative reads the headline', () => {
  test('a forecast-year verdict: the sentence is the headline year and EPS', () => {
    const verdict = { step: 2, year: 'FY2028E', verdict: 'dilutive', pct: -35.04, standaloneEPS: 0.1923, proFormaEPS: 0.1255 };
    const h = headlineEps(verdict, deal);
    const s = buildNarrative(results, inputs, 'Rocket Lab Corp', 'Iridium Communications Inc.', [], h);
    expect(s).toBe("Rocket Lab Corp's acquisition of Iridium Communications Inc. at $57.98/share ($6.2B total) would be dilutive in FY2028E on FMP consensus (non-GAAP), decreasing EPS by 35.0% from $0.19 to $0.13.");
    expect(s).not.toMatch(/−\$0\.11|−\$0\.14/);
  });
  test('a Year 1 headline gives exactly the sentence the results gave', () => {
    const r1 = { companyAEPS: '3.32', proFormaEPS: '3.68', epsChangePct: '10.8', accretionMeaningful: true, isAccretive: true, totalPurchasePrice: 251597 };
    const d1 = { _inputs: { offerPricePerShare: 184.626, companyABasis: 'ltm' }, _results: r1 };
    const h = headlineEps({ step: 1 }, d1);
    const withH = buildNarrative(r1, d1._inputs, 'Coca Cola Co', 'Pepsico Inc', [], h);
    const without = buildNarrative(r1, d1._inputs, 'Coca Cola Co', 'Pepsico Inc', []);
    expect(withH).toBe(without);
    expect(withH).toBe("Coca Cola Co's acquisition of Pepsico Inc at $184.63/share ($251.6B total) would be accretive, increasing EPS by 10.8% from $3.32 to $3.68.");
  });
  test('Year 1 not meaningful (NET/DDOG GAAP shape) is unchanged', () => {
    const r = { companyAEPS: '-0.67', proFormaEPS: '-2.77', epsChangePct: null, accretionMeaningful: false, isAccretive: false, totalPurchasePrice: 77500 };
    const d = { _inputs: { offerPricePerShare: 214.73, companyABasis: 'ltm' }, _results: r };
    const h = headlineEps({ step: null }, d);
    expect(buildNarrative(r, d._inputs, 'A', 'B', [], h)).toBe(buildNarrative(r, d._inputs, 'A', 'B', []));
    expect(buildNarrative(r, d._inputs, 'A', 'B', [], h)).toMatch(/moves pro forma EPS from −\$0\.67 to −\$2\.77 — accretion\/\(dilution\) is not meaningful/);
  });
});
