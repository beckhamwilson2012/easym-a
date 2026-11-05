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
