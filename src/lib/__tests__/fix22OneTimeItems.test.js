// Fix 22 Task 3: one-time items inside GAAP net income are flagged and never adjusted.
import { oneTimeItems, oneTimeNotes, oneTimeText } from '../oneTimeItems';
import { dealVerdict, verdictFlags } from '../dealVerdict';
import { calculate } from '../../utils/dealCalc';

const { unusualItemsLtm, unusualItemsFy } = require('../../../server/services/unusualItems');

// LYFT's filed figures, $M, LTM to 2026-09-30.
const lyft = { basis: 'ltm', netIncome: 2809.866, incomeTax: -2853.511, pretaxIncome: -43.645, taxConcept: 'IncomeTaxExpenseBenefit', items: [], incomplete: [] };

describe('the rule', () => {
  test('a tax benefit above 25% of |pre-tax income| flags, with the filed amount', () => {
    const [f] = oneTimeItems(lyft);
    expect(f).toMatchObject({ key: 'incomeTaxBenefit', name: 'income tax benefit' });
    expect(oneTimeText('Lyft, Inc.', f, 'LTM to Sep 30, 2026')).toBe('Lyft, Inc. GAAP net income includes a $2,854M income tax benefit (LTM to Sep 30, 2026); the GAAP result reflects it. See Non-GAAP.');
  });
  test('tax is tested only as a benefit: ordinary tax expense never flags', () => {
    expect(oneTimeItems({ netIncome: 790, incomeTax: 210, pretaxIncome: 1000, items: [] })).toEqual([]);
  });
  test('exactly 25% does not flag; just above does', () => {
    expect(oneTimeItems({ netIncome: 1000, pretaxIncome: 1000, incomeTax: -250, items: [] })).toEqual([]);
    expect(oneTimeItems({ netIncome: 1000, pretaxIncome: 1000, incomeTax: -250.01, items: [] })).toHaveLength(1);
    const item = (value) => ({ key: 'goodwillImpairment', kind: 'charge', label: 'goodwill impairment', value });
    expect(oneTimeItems({ netIncome: -1000, items: [item(250)] })).toEqual([]);
    expect(oneTimeItems({ netIncome: -1000, items: [item(251)] })[0].name).toBe('goodwill impairment');
  });
  test('gains and losses are named by their filed sign', () => {
    const it = (value) => ({ key: 'investments', kind: 'gainLoss', label: 'investments', value });
    expect(oneTimeItems({ netIncome: 100, items: [it(50)] })[0].name).toBe('gain on investments');
    expect(oneTimeItems({ netIncome: 100, items: [it(-50)] })[0].name).toBe('loss on investments');
  });
  test('absent figures are no test: nothing is treated as 0', () => {
    expect(oneTimeItems(null)).toEqual([]);
    expect(oneTimeItems({ netIncome: null, incomeTax: -500, pretaxIncome: null, items: [{ key: 'x', kind: 'charge', label: 'x', value: 900 }] })).toEqual([]);
    expect(oneTimeItems({ netIncome: 100, items: [{ key: 'x', kind: 'charge', label: 'x', value: null }] })).toEqual([]);
  });
  test('a filed zero never flags, and an aggregate equal to a listed charge is said once', () => {
    expect(oneTimeItems({ netIncome: 0, items: [{ key: 'x', kind: 'charge', label: 'x', value: 0 }] })).toEqual([]);
    const two = oneTimeItems({ netIncome: 100, items: [{ key: 'g', kind: 'charge', label: 'goodwill impairment', value: 60 }, { key: 'a', kind: 'charge', label: 'asset impairment charge', value: 60 }] });
    expect(two.map((x) => x.key)).toEqual(['g']);
  });
  test('either company can raise it', () => {
    const notes = oneTimeNotes([{ name: 'Uber', unusual: { netIncome: 9000, incomeTax: 100, pretaxIncome: 9100, items: [] }, period: 'LTM' }, { name: 'Lyft', unusual: lyft, period: 'LTM' }]);
    expect(notes.map((n) => n.company)).toEqual(['Lyft']);
  });
});

describe('the filed figures (companyfacts shape)', () => {
  const f = (start, end, val, form) => ({ start, end, val: val * 1e6, form, filed: form === '10-K' ? '2026-02-11' : '2026-11-06' });
  const series = (a, y, p) => ({ units: { USD: [f('2025-01-01', '2025-12-31', a, '10-K'), f('2026-01-01', '2026-09-30', y, '10-Q'), f('2025-01-01', '2025-09-30', p, '10-Q')] } });
  const periods = { annual: { end: '2025-12-31' }, latestInterim: { end: '2026-09-30', span: 272 }, priorInterim: { end: '2025-09-30' } };
  const gaap = {
    NetIncomeLoss: series(2844.008, 54.813, 88.955),
    IncomeTaxExpenseBenefit: series(-2897.255, 49.209, 5.465),
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: series(-53.247, 104.022, 94.42),
    GoodwillImpairmentLoss: { units: { USD: [f('2025-01-01', '2025-12-31', 700, '10-K')] } },
  };
  test('LTM = annual + latest YTD − prior YTD, same window for every figure, sign as filed', () => {
    const u = unusualItemsLtm(gaap, periods);
    expect(u.incomeTax).toBeCloseTo(-2853.511, 3);
    expect(u.netIncome).toBeCloseTo(2809.866, 3);
    expect(u.pretaxIncome).toBeCloseTo(-43.645, 3);
  });
  test('a tag missing an LTM leg has no value and is not treated as 0', () => {
    const u = unusualItemsLtm(gaap, periods);
    expect(u.items).toEqual([]);
    expect(u.incomplete).toHaveLength(1);
    expect(u.incomplete[0]).toMatchObject({ key: 'goodwillImpairment', concept: 'GoodwillImpairmentLoss' });
    expect(u.incomplete[0].legs).toEqual({ annual: 700, latestYTD: null, priorYTD: null });
  });
  test('the fiscal year reads the 10-K value', () => {
    const u = unusualItemsFy(gaap, '2025-12-31');
    expect(u.incomeTax).toBeCloseTo(-2897.255, 3);
    expect(u.items[0]).toMatchObject({ key: 'goodwillImpairment', value: 700 });
  });
});

describe('on the verdict', () => {
  const inputs = {
    companyAShares: 2000, companyADilutedShares: 2000, companyANetIncome: 4000, companyAEPS: 2, currentSharePriceA: 80, companyARevenue: 50000, companyADebt: 0, companyACash: 0,
    companyBShares: 400, companyBNetIncome: 2810, companyBEPS: 6.8, currentSharePriceB: 20, offerPricePerShare: 26, companyBRevenue: 7000, companyBDebt: 0, companyBCash: 0, cashPercent: 50,
    companyBUnusualItems: lyft, companyBPeriodLabel: 'LTM to Sep 30, 2026',
  };
  const deal = (over = {}) => { const i = { ...inputs, ...over }; return { _inputs: i, _results: calculate(i), offerPrice: 26 }; };
  const args = (d) => ({ deal: d, model: {}, acquirerName: 'UBER', targetName: 'LYFT', targetDisplayName: 'Lyft, Inc.', acquirerFwd: null, targetFwd: null });

  test('GAAP: the note sits on the verdict and in the risk flags, and the verdict figures do not move', () => {
    const d = deal();
    const v = dealVerdict(args(d));
    const without = dealVerdict(args(deal({ companyBUnusualItems: null })));
    expect(v.oneTimeNotes[0].text).toContain('$2,854M income tax benefit');
    expect(verdictFlags(v).some((f) => f.text.startsWith('Lyft, Inc. GAAP net income includes a $2,854M'))).toBe(true);
    const { oneTimeNotes: _, ...rest } = v;
    expect(rest).toEqual(without);
    expect(d._results.proFormaEPS).toBe(deal({ companyBUnusualItems: null })._results.proFormaEPS);
  });
  test('Non-GAAP: no note', () => {
    const v = dealVerdict(args(deal({ reportingBasis: 'Non-GAAP' })));
    expect(v.oneTimeNotes).toBeUndefined();
    expect(verdictFlags(v).some((f) => /GAAP net income includes/.test(f.text))).toBe(false);
  });
});
