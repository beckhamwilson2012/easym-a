/** @jest-environment node */
// LTM cost of revenue and gross profit when the annual cost was corrected from the income statement (server/services/ltmCalc).
const { computeLTM } = require('../../../server/services/ltmCalc');
const { STATEMENT_LINE_CONCEPT, LTM_COST_DISAGREES_REASON } = require('../../../server/services/incomeConcepts');

const leg = (start, end, val, form) => ({ start, end, val, form, filed: form === '10-K' ? '2026-02-20' : '2026-07-30', accn: 'a' });
// Annual FY2025 + H1 2026 − H1 2025, the shape every LTM leg takes.
const legs = (annual, h1, priorH1) => [leg('2025-01-01', '2025-12-31', annual, '10-K'), leg('2026-01-01', '2026-06-30', h1, '10-Q'), leg('2025-01-01', '2025-06-30', priorH1, '10-Q')];
const facts = (extra = {}) => ({ facts: { 'us-gaap': {
  Revenues: { units: { USD: legs(4264e6, 2050e6, 2230e6) } },
  CostOfGoodsAndServicesSold: { units: { USD: legs(113e6, 55e6, 54e6) } },       // Crown Castle's partial tag
  OperatingIncomeLoss: { units: { USD: legs(2075e6, 1000e6, 1050e6) } },
  ...extra,
} } });
const statementSum = { [STATEMENT_LINE_CONCEPT]: { units: { USD: [{ start: null, end: '2025-12-31', val: 1105e6, form: '10-K', accn: 'a', concept: STATEMENT_LINE_CONCEPT }] } } };

describe('LTM gross margin when the annual cost was corrected from the income statement', () => {
  test('LTM cost of revenue and gross profit are null with the reason, never the tag-based figure (CCI)', () => {
    const r = computeLTM(facts(statementSum));
    expect(r.ltm).toBe(true);
    expect(r.flows.revenue.ltmM).toBe(4084);
    expect(r.flows.costOfRevenue.ltmM).toBeNull();
    expect(r.flows.grossProfit.ltmM).toBeNull();
    expect(r.flows.costOfRevenue.reason).toBe('LTM cost tags disagree with the income statement; annual figure corrected from the statement');
    expect(r.flows.costOfRevenue.sourceLabel).toBe(LTM_COST_DISAGREES_REASON);
    expect(r.flows.grossProfit.reason).toBe(LTM_COST_DISAGREES_REASON);
  });
  test('a filed GrossProfit tag does not bring the figure back either', () => {
    const r = computeLTM(facts({ ...statementSum, GrossProfit: { units: { USD: legs(4151e6, 1995e6, 2176e6) } } }));
    expect(r.flows.grossProfit.ltmM).toBeNull();
  });
  test('no statement correction: the LTM is built from the tags exactly as before', () => {
    const r = computeLTM(facts());
    expect(r.flows.costOfRevenue.ltmM).toBe(114);
    expect(r.flows.grossProfit.ltmM).toBe(3970);
    expect(r.flows.costOfRevenue.reason).toBeNull();
    expect(r.flows.grossProfit.reason).toBeNull();
  });
  test('a correction for a different year does not touch this LTM', () => {
    const older = { [STATEMENT_LINE_CONCEPT]: { units: { USD: [{ start: null, end: '2024-12-31', val: 1090e6, form: '10-K', accn: 'a' }] } } };
    expect(computeLTM(facts(older)).flows.grossProfit.ltmM).toBe(3970);
  });
});

describe('fix 3 task 1: the LTM revenue tag uses the fiscal-year floor', () => {
  const nvdaLike = (stale) => ({ facts: { 'us-gaap': {
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: stale } },
    Revenues: { units: { USD: legs(4264e6, 2050e6, 2230e6) } },
    OperatingIncomeLoss: { units: { USD: legs(2075e6, 1000e6, 1050e6) } },
  } } });
  const oldAnnual = [leg('2021-01-01', '2021-12-31', 900e6, '10-K')];
  test('a first-listed tag that stopped years ago does not block the current one (NVDA, T, UBER, HOOD)', () => {
    const r = computeLTM(nvdaLike(oldAnnual), '2025-12-31');
    expect(r.ltm).toBe(true);
    expect(r.conceptName).toBe('Revenues');
    expect(r.flows.revenue.ltmM).toBe(4084);
  });
  test('a tag whose annual is current but whose last 10-Q is old does not block one that has every leg (JPM)', () => {
    const jpm = { facts: { 'us-gaap': {
      Revenues: { units: { USD: [leg('2025-01-01', '2025-12-31', 4264e6, '10-K'), leg('2014-01-01', '2014-09-30', 700e6, '10-Q')] } },
      RevenuesNetOfInterestExpense: { units: { USD: legs(4264e6, 2050e6, 2230e6) } },
    } } };
    const r = computeLTM(jpm, '2025-12-31');
    expect(r.ltm).toBe(true);
    expect(r.conceptName).toBe('RevenuesNetOfInterestExpense');
  });
  test('without a floor, or when no tag is current and complete, the degrade is unchanged', () => {
    expect(computeLTM(nvdaLike(oldAnnual)).ltm).toBe(false);
    const allStale = { facts: { 'us-gaap': { Revenues: { units: { USD: [leg('2025-01-01', '2025-12-31', 4264e6, '10-K'), leg('2025-01-01', '2025-09-30', 3100e6, '10-Q')] } } } } };
    expect(computeLTM(allStale, '2025-12-31').reason).toBe('no interim period past the latest fiscal year-end (LTM == annual)');
  });
});
