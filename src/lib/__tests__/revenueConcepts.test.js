// Revenue resolution and the fiscal-year floor (server/services/revenueConcepts.js). No network: pure functions over
// literal companyfacts entries. Figures are Crown Castle, Williams, Duke, SAP and Toyota as filed.
const {
  REVENUE_CONCEPTS, IFRS_NO_CURRENT_YEAR, isOlderFiscalYear, resolveRevenueAt, resolveLatestRevenue, revenueSeries,
  chooseNamespace, resolveFilerRevenue, ltmRevenueConcepts,
} = require('../../../server/services/revenueConcepts');
const { computeLTM } = require('../../../server/services/ltmCalc');

const fact = (val, start, end, form = '10-K', filed = '2026-02-01') => ({ val, start, end, form, filed, accn: 'A' });
const fy = (val, year = 2025) => fact(val, `${year}-01-01`, `${year}-12-31`);
const ns = (byConcept, unit = 'USD') => Object.fromEntries(Object.entries(byConcept).map(([c, entries]) => [c, { units: { [unit]: entries } }]));
const END = '2025-12-31';
const RFC = 'RevenueFromContractWithCustomerExcludingAssessedTax';

describe('disagreeing tags', () => {
  test('picks the tie-out total, not the first listed: CCI FY25', () => {
    const r = resolveRevenueAt(ns({ [RFC]: [fy(215e6)], Revenues: [fy(4264e6)], CostsAndExpenses: [fy(2189e6)], OperatingIncomeLoss: [fy(2075e6)] }), END);
    expect(r.value).toBe(4264e6);
    expect(r.concept).toBe('Revenues');
    expect(r.status).toBe('tie-out');
    expect(r.flag).toBeNull();
    expect(r.label).toMatch(/Revenues/);
    expect(r.tieOut.residual).toBe(0);
  });

  test('picks the tie-out total when it is the smaller tag: WMB, so "take the larger" would be wrong', () => {
    const r = resolveRevenueAt(ns({ [RFC]: [fy(14899e6)], Revenues: [fy(11950e6)], CostsAndExpenses: [fy(9000e6)], OperatingIncomeLoss: [fy(2950e6)] }), END);
    expect(r.value).toBe(11950e6);
  });

  test('confirms through revenue − cost of revenue = gross profit', () => {
    const r = resolveRevenueAt(ns({ [RFC]: [fy(800e6)], Revenues: [fy(1000e6)], CostOfRevenue: [fy(400e6)], GrossProfit: [fy(600e6)] }), END);
    expect(r.value).toBe(1000e6);
  });

  test('a filed gains line between costs and operating income still ties: DUK FY25', () => {
    const r = resolveRevenueAt(ns({
      RevenueFromContractWithCustomerIncludingAssessedTax: [fy(31741e6)], RegulatedAndUnregulatedOperatingRevenue: [fy(32237e6)],
      CostsAndExpenses: [fy(23656e6)], GainLossOnSaleOfOtherAssets: [fy(45e6)], OperatingIncomeLoss: [fy(8626e6)],
    }), END);
    expect(r.value).toBe(32237e6);
    expect(r.concept).toBe('RegulatedAndUnregulatedOperatingRevenue');
  });

  test('nothing confirms: keeps today\'s pick, flags tags and values, sums nothing', () => {
    const r = resolveRevenueAt(ns({ [RFC]: [fy(21569e6)], Revenues: [fy(21593e6)] }), END);
    expect(r.value).toBe(21569e6);
    expect(r.status).toBe('unconfirmed');
    expect(r.flag).toBe('revenue tags disagree: RevenueFromContractWithCustomerExcludingAssessedTax $21,569M, Revenues $21,593M');
  });

  test('two different values both tying is not a confirmation', () => {
    const r = resolveRevenueAt(ns({
      [RFC]: [fy(800e6)], Revenues: [fy(1000e6)], CostsAndExpenses: [fy(500e6)], OperatingIncomeLoss: [fy(300e6)], OperatingExpenses: [fy(500e6)],
      CostOfRevenue: [fy(400e6)], GrossProfit: [fy(600e6)],
    }), END);
    expect(r.status).toBe('unconfirmed');
    expect(r.value).toBe(800e6);
  });

  test('a tie-out input from another year cannot confirm', () => {
    const r = resolveRevenueAt(ns({ [RFC]: [fy(215e6)], Revenues: [fy(4264e6)], CostsAndExpenses: [fy(2189e6, 2024)], OperatingIncomeLoss: [fy(2075e6, 2024)] }), END);
    expect(r.status).toBe('unconfirmed');
  });
});

describe('tags that agree or stand alone', () => {
  test('one tag: that tag, no flag', () => {
    const r = resolveRevenueAt(ns({ Revenues: [fy(100e6)] }), END);
    expect([r.value, r.status, r.flag]).toEqual([100e6, 'single', null]);
  });
  test('tags that agree: first listed, no tie-out needed', () => {
    const r = resolveRevenueAt(ns({ [RFC]: [fy(871659000)], Revenues: [fy(871659000)] }), END);
    expect([r.concept, r.status]).toEqual([RFC, 'agreed']);
  });
  test('no candidate for the period: null, never 0', () => {
    expect(resolveRevenueAt(ns({ Revenues: [fy(100e6, 2024)] }), END)).toBeNull();
    expect(resolveLatestRevenue(ns({ Assets: [fy(100e6)] }))).toBeNull();
  });
  test('sub-lines are used only when asked and only when nothing else is filed', () => {
    const bank = ns({ Revenues: [fy(113097e6)], InterestAndFeeIncomeLoansAndLeases: [fy(63080e6)] });
    expect(resolveRevenueAt(bank, END, { subLines: true }).status).toBe('single');
    const nvs = ns({ OtherRevenue: [fy(2142e6)], RevenueFromSaleOfGoods: [fy(54532e6)], CostOfSales: [fy(13699e6)], GrossProfit: [fy(42975e6)] });
    expect(resolveRevenueAt(nvs, END, { useIfrs: true })).toBeNull();
    const r = resolveRevenueAt(nvs, END, { useIfrs: true, subLines: true });
    expect(r.value).toBe(2142e6);
    expect(r.flag).toMatch(/^revenue tags disagree: OtherRevenue \$2,142M, RevenueFromSaleOfGoods \$54,532M$/);
    expect(resolveRevenueAt(nvs, END, { useIfrs: true, subLines: 'gaap' })).toBeNull();
  });
  test('a quarter is not a year; latest-filed wins a restatement', () => {
    expect(resolveRevenueAt(ns({ Revenues: [fact(25e6, '2025-10-01', END)] }), END)).toBeNull();
    const r = resolveRevenueAt(ns({ Revenues: [fact(90e6, '2025-01-01', END, '10-K', '2026-02-01'), fact(95e6, '2025-01-01', END, '10-K', '2027-02-01')] }), END);
    expect(r.value).toBe(95e6);
  });
  test('the series resolves each year on its own', () => {
    const s = revenueSeries(ns({ [RFC]: [fy(215e6), fy(90e6, 2024)], Revenues: [fy(4264e6)], CostsAndExpenses: [fy(2189e6)], OperatingIncomeLoss: [fy(2075e6)] }));
    expect(s['2025-12-31'].value).toBe(4264e6);
    expect(s['2024-12-31'].value).toBe(90e6);
  });
});

describe('stale fiscal years', () => {
  test('a 2017 year is older than a 2025 filing; a 52-week drift is not', () => {
    expect(isOlderFiscalYear('2017-12-31', '2025-12-31')).toBe(true);
    expect(isOlderFiscalYear('2025-12-28', '2025-12-31')).toBe(false);
    expect(isOlderFiscalYear('2025-12-31', null)).toBe(false);
  });

  const usd = (val, end) => fact(val, `${Number(end.slice(0, 4)) - 1}-${end.slice(5, 7) === '12' ? '12-31' : end.slice(5)}`, end, '20-F');

  test('SAP: USD facts stop at 2017, the 20-F is 2025, in EUR: rejected, null with the reason', () => {
    const sap = { facts: { 'ifrs-full': { Revenue: { units: { USD: [usd(28205e6, '2017-12-31')], EUR: [usd(36800e6, '2025-12-31')] } } } } };
    const r = resolveFilerRevenue(sap, '2025-12-31', { subLines: true });
    expect(r.revenue).toBeNull();
    expect(r.unavailableReason).toBe(IFRS_NO_CURRENT_YEAR);
    expect(r.unavailableDetail).toMatch(/EUR through 2025-12-31/);
    expect(r.latestTaggedEnd).toBe('2017-12-31');
  });

  test('TM: stale us-gaap, ifrs-full in JPY: rejected, null, and the old year is not returned', () => {
    const tm = { facts: { 'us-gaap': { Revenues: { units: { USD: [usd(234601e6, '2013-03-31')] } } }, 'ifrs-full': { Revenue: { units: { JPY: [usd(48e12, '2025-03-31')] } } } } };
    const r = resolveFilerRevenue(tm, '2026-03-31');
    expect(r.revenue).toBeNull();
    expect(r.unavailableReason).toBe(IFRS_NO_CURRENT_YEAR);
  });

  test('stale us-gaap with a current USD ifrs-full reads ifrs-full', () => {
    const facts = { facts: { 'us-gaap': { Revenues: { units: { USD: [usd(100e6, '2019-12-31')] } } }, 'ifrs-full': { Revenue: { units: { USD: [usd(900e6, '2025-12-31')] } } } } };
    expect(chooseNamespace(facts, '2025-12-31').useIfrs).toBe(true);
    const r = resolveFilerRevenue(facts, '2025-12-31');
    expect(r.revenue.value).toBe(900e6);
    expect(r.unavailableReason).toBeNull();
  });

  test('both namespaces and a current us-gaap stays on us-gaap', () => {
    const facts = { facts: { 'us-gaap': { Revenues: { units: { USD: [usd(100e6, '2025-12-31')] } } }, 'ifrs-full': { Revenue: { units: { USD: [usd(900e6, '2025-12-31')] } } } } };
    expect(chooseNamespace(facts, '2025-12-31').useIfrs).toBe(false);
  });

  test('IFRS with no USD revenue at all: null with the reason, never 0 (GSK, UL)', () => {
    const r = resolveFilerRevenue({ facts: { 'ifrs-full': { Revenue: { units: { GBP: [usd(32e9, '2025-12-31')] } } } } }, '2025-12-31');
    expect(r.revenue).toBeNull();
    expect(r.unavailableReason).toBe(IFRS_NO_CURRENT_YEAR);
  });

  test('a current USD sub-line is not "no current-year data": NVS keeps the usual no-revenue path', () => {
    const nvs = { facts: { 'ifrs-full': ns({ OtherRevenue: [fy(2142e6)], RevenueFromSaleOfGoods: [fy(54532e6)] }) } };
    const r = resolveFilerRevenue(nvs, END);
    expect(r.revenue).toBeNull();
    expect(r.unavailableReason).toBeNull();
    expect(resolveFilerRevenue(nvs, END, { subLines: true }).revenue.value).toBe(2142e6);
  });

  test('a stale pure US-GAAP filer: null, and the reason does not claim IFRS', () => {
    const r = resolveFilerRevenue({ facts: { 'us-gaap': ns({ Revenues: [fy(10e6, 2019)] }) } }, '2025-12-31');
    expect(r.revenue).toBeNull();
    expect(r.unavailableReason).toMatch(/latest revenue tag ends 2019-12-31/);
  });

  test('a pre-revenue US-GAAP filer is not a stale year', () => {
    const r = resolveFilerRevenue({ facts: { 'us-gaap': ns({ Assets: [fact(5e6, undefined, END)] }) } }, END);
    expect(r.revenue).toBeNull();
    expect(r.unavailableReason).toBeNull();
  });

  test('submissions unreadable: no floor, so today\'s latest stands', () => {
    const r = resolveFilerRevenue({ facts: { 'us-gaap': ns({ Revenues: [fy(10e6, 2019)] }) } }, null);
    expect(r.revenue.end).toBe('2019-12-31');
  });
});

describe('LTM uses the same revenue', () => {
  const q = (val, start, end, filed = '2026-08-01') => fact(val, start, end, '10-Q', filed);
  const filer = () => ({ facts: { 'us-gaap': ns({
    [RFC]: [fy(215e6), q(100e6, '2026-01-01', '2026-06-30'), q(110e6, '2025-01-01', '2025-06-30')],
    Revenues: [fy(4264e6), q(2000e6, '2026-01-01', '2026-06-30'), q(2100e6, '2025-01-01', '2025-06-30')],
    CostsAndExpenses: [fy(2189e6)], OperatingIncomeLoss: [fy(2075e6), q(1000e6, '2026-01-01', '2026-06-30'), q(1000e6, '2025-01-01', '2025-06-30')],
  }) } });

  test('the tie-out winner goes first', () => {
    expect(ltmRevenueConcepts(filer().facts['us-gaap'], false)[0]).toBe('Revenues');
  });
  test('all three legs come from the total', () => {
    const l = computeLTM(filer());
    expect(l.conceptName).toBe('Revenues');
    expect(l.flows.revenue.ltmM).toBe(4164);
  });
  test('an annual leg older than the latest annual filing degrades', () => {
    const l = computeLTM(filer(), '2026-12-31');
    expect(l.ltm).toBe(false);
    expect(l.reason).toMatch(/older than the latest annual filing/);
  });
  test('filers with no disagreement keep the usual order', () => {
    expect(ltmRevenueConcepts(ns({ [RFC]: [fy(1e6)], Revenues: [fy(1e6)] }), false)).toEqual(REVENUE_CONCEPTS.gaap);
  });
});
