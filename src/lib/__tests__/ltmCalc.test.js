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

describe('fix 3 task 2: no 10-Q after the latest 10-K', () => {
  const tenK = leg('2024-09-29', '2025-09-27', 4264e6, '10-K');
  const before = leg('2024-09-29', '2025-06-28', 3100e6, '10-Q');
  test('the fiscal year is the LTM: flagged with its label, no figure computed (AAPL, COST, V, TEAM)', () => {
    const r = computeLTM({ facts: { 'us-gaap': { Revenues: { units: { USD: [tenK, before] } } } } }, '2025-09-27');
    expect(r.ltm).toBe(false);
    expect(r.fyAsLtm).toEqual({ asOf: '2025-09-27', label: 'LTM to 2025-09-27 (latest 10-K; no later 10-Q yet)', annual: { start: '2024-09-29', end: '2025-09-27', form: '10-K', filed: '2026-02-20' } });
    expect(r.flows).toBeUndefined();
  });
  test('any 10-Q flow after the year end, under any tag, means it is not this case', () => {
    const later = { NetIncomeLoss: { units: { USD: [leg('2025-09-28', '2025-12-27', 1e6, '10-Q')] } } };
    expect(computeLTM({ facts: { 'us-gaap': { Revenues: { units: { USD: [tenK, before] } }, ...later } } }, '2025-09-27').fyAsLtm).toBeUndefined();
  });
  test('a 20-F, or a 10-K older than the latest annual filing, is never this case', () => {
    const twentyF = { ...tenK, form: '20-F' };
    expect(computeLTM({ facts: { 'us-gaap': { Revenues: { units: { USD: [twentyF, { ...before, form: '6-K' }] } } } } }, '2025-09-27').fyAsLtm).toBeUndefined();
    expect(computeLTM({ facts: { 'us-gaap': { Revenues: { units: { USD: [tenK, before] } } } } }, '2026-09-26').fyAsLtm).toBeUndefined();
  });
});

describe('fix 3 task 3: 6-K quarters are interim periods, with the same checks as a 10-Q', () => {
  const arm = (h1Start) => ({ facts: { 'us-gaap': {
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [leg('2025-04-01', '2026-03-31', 4920e6, '20-F'),
      leg(h1Start, '2026-09-30', 2732e6, '6-K'), leg(h1Start.replace('2026', '2025'), '2025-09-30', 2188e6, '6-K')] } },
  } } });
  test('ARM: 20-F year + 6-K half-year − prior 6-K half-year is a trusted LTM', () => {
    const r = computeLTM(arm('2026-04-01'), '2026-03-31');
    expect(r.ltm).toBe(true);
    expect(r.flows.revenue.ltmM).toBe(5464);
    expect(r.tieOut.trusted).toBe(true);
  });
  test('3-month 6-K quarters (not year-to-date) fail the same stub check a 10-Q would', () => {
    const r = computeLTM(arm('2026-07-01'), '2026-03-31');
    expect(r.ltm).toBe(false);
    expect(r.reason).toBe('tie-out gate failed');
  });
});

describe('fix 3 task 4: the standard "excluding D&A" cost tag, and SPGI\'s two D&A lines', () => {
  const { annualIncomeLines } = require('../../../server/services/incomeConcepts');
  const EXCL = 'CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization';
  test('DASH: cost of revenue (excl. D&A) is read at every leg, so LTM gross profit exists (6,738 + 6,270 − 4,803 = 8,205)', () => {
    const r = computeLTM(facts({ CostOfGoodsAndServicesSold: undefined, [EXCL]: { units: { USD: legs(6738e6, 6270e6, 4803e6) } } }));
    expect(r.flows.costOfRevenue.ltmM).toBe(8205);
    expect(r.flows.costOfRevenue.conceptName).toBe(EXCL);
    expect(r.flows.grossProfit.ltmM).toBe(4084 - 8205);
  });
  test('the annual cost reads it too, labeled with the tag', () => {
    const ns = { [EXCL]: { units: { USD: [leg('2025-01-01', '2025-12-31', 6738e6, '10-K')] } } };
    const lines = annualIncomeLines(ns, '2025-12-31', 13717e6);
    expect(lines.costOfRevenue.value).toBe(6738e6);
    expect(lines.costOfRevenue.label).toBe(`SEC EDGAR companyfacts (${EXCL})`);
    expect(lines.grossProfit.value).toBe(13717e6 - 6738e6);
  });
  test('listed last: a filer that also tags CostOfRevenue keeps it', () => {
    const r = computeLTM(facts({ CostOfGoodsAndServicesSold: undefined, CostOfRevenue: { units: { USD: legs(100e6, 50e6, 40e6) } }, [EXCL]: { units: { USD: legs(90e6, 45e6, 35e6) } } }));
    expect(r.flows.costOfRevenue.conceptName).toBe('CostOfRevenue');
  });

  // SPGI: DDA 1,179 annual only; the cash flow statement shows Depreciation 110 + Amortization of intangibles 1,069.
  const row = (tag, label, value) => ({ ns: 'us-gaap', tag, label, values: [value] });
  const cashFlow = { scale: 1e6, periods: ['2025-12-31'], form: '10-K', rows: [row('Depreciation', 'Depreciation', 110e6),
    row('AmortizationOfIntangibleAssets', 'Amortization of intangibles', 1069e6), row('NetCashProvidedByUsedInOperatingActivities', 'Net cash provided by operating activities', 5000e6)] };
  const spgi = (amortLegs) => ({ ...facts({ DepreciationDepletionAndAmortization: { units: { USD: [leg('2025-01-01', '2025-12-31', 1179e6, '10-K')] } },
    Depreciation: { units: { USD: legs(110e6, 86e6, 68e6) } }, AmortizationOfIntangibleAssets: { units: { USD: amortLegs } } }), filingStatements: { cashFlow } });
  test('SPGI: the statement lines that confirm the annual total are followed at every leg (1,179 + 684 − 644 = 1,219)', () => {
    const r = computeLTM(spgi(legs(1069e6, 598e6, 576e6)));
    expect(r.flows.ebitda.ltmM).toBe(1000 + 1050 > 0 ? 2075 + 1000 - 1050 + 1219 : null);
    expect(r.flows.ebitda.daConcept).toBe('Depreciation + AmortizationOfIntangibleAssets');
    expect(r.flows.ebitda.reason).toBeNull();
  });
  test('one line missing a leg: no LTM D&A, never a partial sum', () => {
    const r = computeLTM(spgi([leg('2025-01-01', '2025-12-31', 1069e6, '10-K')]));
    expect(r.flows.ebitda.ltmM).toBeNull();
    expect(r.flows.ebitda.reason).toMatch(/^no LTM D&A/);
  });
});
