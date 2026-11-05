/** @jest-environment node */
// D&A, capex, EBITDA and free cash flow (server/services/cashFlowConcepts), the statement reader (filingStatements), the cost
// tie-out (incomeConcepts). Figures are from the filings named in each test.
const { resolveDepreciationAt, resolveCapexAt, resolveOperatingCashFlowAt, computeEbitda, computeFreeCashFlow } = require('../../../server/services/cashFlowConcepts');
const { parseStatementPage, selectStatementReports } = require('../../../server/services/filingStatements');
const { statementCostResolutions, annualIncomeLines, STATEMENT_LINE_CONCEPT } = require('../../../server/services/incomeConcepts');

const END = '2025-12-31';
const fact = (val, end = END) => ({ start: `${end.slice(0, 4)}-01-01`, end, val, form: '10-K', filed: `${Number(end.slice(0, 4)) + 1}-02-01`, accn: 'acc' });
const ns = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { units: { USD: v } }]));
const row = (tag, label, value, namespace = 'us-gaap') => ({ ns: namespace, tag, label, values: [value] });
const statement = (rows) => ({ scale: 1e6, periods: [END], rows, form: '10-K' });
const OCF_ROW = row('NetCashProvidedByUsedInOperatingActivities', 'Net cash provided by operating activities', 1000e6);
const INV_ROW = row('NetCashProvidedByUsedInInvestingActivities', 'Net cash used in investing', -500e6);

describe('free cash flow: operating cash flow minus capex', () => {
  test('capex is subtracted, not added. AMZN FY25: 139,514 − 131,819 = 7,695, not 271,333', () => {
    const r = computeFreeCashFlow({ value: 139514e6, end: END }, { value: 131819e6, end: END });
    expect(r.value).toBe(7695e6);
    expect(r.reason).toBeNull();
  });
  test('no capex: null with the reason, never operating cash flow alone', () => {
    const r = computeFreeCashFlow({ value: 100, end: END }, { value: null, reason: 'no capex total tag filed' });
    expect(r.value).toBeNull();
    expect(r.reason).toBe('no capex total tag filed');
  });
  test('inputs from different fiscal years: null with the reason', () => {
    const r = computeFreeCashFlow({ value: 100, end: END }, { value: 10, end: '2016-12-31' });
    expect(r.value).toBeNull();
    expect(r.reason).toMatch(/2016-12-31/);
  });
  test('a filed zero capex is a real zero, not an absence', () => {
    expect(computeFreeCashFlow({ value: 100, end: END }, { value: 0, end: END }).value).toBe(100);
  });
});

describe('EBITDA: a missing D&A never becomes 0', () => {
  test('operating income + D&A for one fiscal year', () => {
    expect(computeEbitda({ value: 3694, end: END }, { value: 3004, end: END })).toEqual({ value: 6698, reason: null });
  });
  test('no D&A: null with the reason, never operating income relabeled as EBITDA', () => {
    const r = computeEbitda({ value: 2544, end: END }, { value: null, reason: 'no D&A line' });
    expect(r.value).toBeNull();
    expect(r.reason).toBe('no D&A line');
  });
  test('no operating income: null with the reason', () => {
    expect(computeEbitda({ value: null, reason: 'no operating income tag' }, { value: 780, end: END })).toEqual({ value: null, reason: 'no operating income tag' });
  });
  test('inputs from different fiscal years: null with the reason', () => {
    expect(computeEbitda({ value: 1, end: END }, { value: 1, end: '2019-12-31' }).value).toBeNull();
  });
  test('a filed zero D&A is a real zero', () => {
    expect(computeEbitda({ value: 5, end: END }, { value: 0, end: END }).value).toBe(5);
  });
});

describe('stale-year rejection', () => {
  test('a D&A tag that stopped in an older year returns null, not that year (AMD: DepreciationAndAmortization last FY2014)', () => {
    const gaap = ns({ DepreciationAndAmortization: [fact(200e6, '2014-12-31')] });
    const r = resolveDepreciationAt(gaap, END, { statement: statement([OCF_ROW]) });
    expect(r.value).toBeNull();
    expect(r.reason).toMatch(/no D&A total tag filed for 2025-12-31/);
  });
  test('a capex tag that stopped in an older year returns null (AMZN: PaymentsToAcquirePropertyPlantAndEquipment last FY2016)', () => {
    const gaap = ns({ PaymentsToAcquirePropertyPlantAndEquipment: [fact(6737e6, '2016-12-31')] });
    expect(resolveCapexAt(gaap, END, { statement: statement([OCF_ROW, INV_ROW]) }).value).toBeNull();
  });
  test('the current tag wins over a stale one listed first (AMZN FY25: ProductiveAssets 131,819)', () => {
    const gaap = ns({ PaymentsToAcquirePropertyPlantAndEquipment: [fact(6737e6, '2016-12-31')], PaymentsToAcquireProductiveAssets: [fact(131819e6)] });
    const st = statement([OCF_ROW, row('PaymentsToAcquireProductiveAssets', 'Purchases of property and equipment', -131819e6), INV_ROW]);
    const r = resolveCapexAt(gaap, END, { statement: st });
    expect(r.value).toBe(131819e6);
    expect(r.concept).toBe('PaymentsToAcquireProductiveAssets');
    expect(r.status).toBe('confirmed');
  });
  test('a capex tag on an acquisition row is not capex: the statement\'s capex line is used (AEP FY25: 8,453, not 3,453)', () => {
    const st = statement([OCF_ROW, row('PaymentsForConstructionInProcess', 'Construction Expenditures', -8453e6),
      row('PaymentsToAcquireProductiveAssets', 'Acquisitions of Generation Facilities', -3453e6), INV_ROW]);
    const r = resolveCapexAt(ns({ PaymentsToAcquireProductiveAssets: [fact(3453e6)] }), END, { statement: st });
    expect(r.value).toBe(8453e6);
    expect(r.statementLine).toBe('Construction Expenditures');
  });
  test('buying property is capex however it is worded (RBLX FY25: "Acquisition of property and equipment" 441)', () => {
    const st = statement([OCF_ROW, row('PaymentsToAcquirePropertyPlantAndEquipment', 'Acquisition of property and equipment', -441e6), INV_ROW]);
    const r = resolveCapexAt(ns({ PaymentsToAcquirePropertyPlantAndEquipment: [fact(441e6)] }), END, { statement: st });
    expect(r.value).toBe(441e6);
    expect(r.status).toBe('confirmed');
  });
  test('operating cash flow is read at the exact period only', () => {
    expect(resolveOperatingCashFlowAt(ns({ NetCashProvidedByUsedInOperatingActivities: [fact(5, '2020-12-31')] }), END).value).toBeNull();
  });
});

describe('component sums', () => {
  test('separate statement lines add up (AMD FY25: 750 + 2,254 = 3,004)', () => {
    const st = statement([row('OtherDepreciationAndAmortization', 'Depreciation and amortization', 750e6), row('AdjustmentForAmortization', 'Amortization', 2254e6), OCF_ROW]);
    const r = resolveDepreciationAt(ns({ OtherDepreciationAndAmortization: [fact(750e6)] }), END, { statement: st });
    expect(r.value).toBe(3004e6);
    expect(r.status).toBe('confirmed');
    expect(r.components).toHaveLength(2);
  });
  test('partial component sum returns null: an impairment-mixed line stops it (AON FY25: 188 + 778)', () => {
    const st = statement([row('Depreciation', 'Depreciation of fixed assets', 188e6), row('AmortizationAndImpairmentOfIntangibleAssets', 'Amortization and impairment of intangible assets', 778e6, 'aon'), OCF_ROW]);
    const r = resolveDepreciationAt(ns({ Depreciation: [fact(188e6)] }), END, { statement: st });
    expect(r.value).toBeNull();
    expect(r.reason).toMatch(/includes impairment/);
  });
  test('partial component sum returns null: an unclassified investing line stops it (GSAT FY25: 97 + 5.5, with 442 beside them)', () => {
    const st = statement([OCF_ROW,
      row('PaymentsForConstructionInProcess', 'Payments for network upgrades, Phase 1', -97e6),
      row('PaymentsForServicesAgreements', 'Payments for network upgrades, Extended MSS Network', -442e6, 'gsat'),
      row('PaymentsToAcquireOtherPropertyPlantAndEquipment', 'Payments for network upgrades, product development', -5.5e6), INV_ROW]);
    const r = resolveCapexAt(ns({ PaymentsToAcquireOtherPropertyPlantAndEquipment: [fact(5.5e6)] }), END, { statement: st });
    expect(r.value).toBeNull();
    expect(r.reason).toMatch(/gsat:PaymentsForServicesAgreements/);
  });
  test('a partial tag alone is not a total: no line on the statement means null (ABNB FY25: Depreciation 17)', () => {
    const r = resolveDepreciationAt(ns({ Depreciation: [fact(17e6)] }), END, { statement: statement([OCF_ROW]) });
    expect(r.value).toBeNull();
    expect(r.reason).toMatch(/no depreciation or amortization line/);
  });
  test('amortization alone is not D&A', () => {
    const st = statement([row('AmortizationOfIntangibleAssets', 'Amortization of intangible assets', 36e6), OCF_ROW]);
    expect(resolveDepreciationAt(ns({}), END, { statement: st }).value).toBeNull();
  });
  test('capex lines of standard tags add up (ALK FY25: 1,063 + 216 + 309 = 1,588)', () => {
    const st = statement([OCF_ROW, row('PaymentsForFlightEquipment', 'Aircraft and aircraft purchase deposits', -1063e6),
      row('PaymentsToAcquireOtherProductiveAssets', 'Other flight equipment', -216e6), row('PaymentsToAcquireOtherPropertyPlantAndEquipment', 'Other property and equipment', -309e6), INV_ROW]);
    expect(resolveCapexAt(ns({}), END, { statement: st }).value).toBe(1588e6);
  });
  test('a statement line that cannot be read keeps the sum from happening: no statement, no sum', () => {
    expect(resolveDepreciationAt(ns({}), END, { statement: null }).reason).toMatch(/could not be read/);
  });
});

describe('confirmation against the cash flow statement', () => {
  test('own row, same value: confirmed', () => {
    const st = statement([row('DepreciationDepletionAndAmortization', 'Depreciation and amortization', 630e6), OCF_ROW]);
    expect(resolveDepreciationAt(ns({ DepreciationDepletionAndAmortization: [fact(630e6)] }), END, { statement: st }).status).toBe('confirmed');
  });
  test('on the statement with another D&A line beside it: value kept, confirmed, and flagged (HD FY26: 3,514, amortization 607)', () => {
    const st = statement([row('DepreciationDepletionAndAmortization', 'Depreciation and amortization, excluding amortization of intangible assets', 3514e6), row('AmortizationOfIntangibleAssets', 'Amortization of intangible assets', 607e6), OCF_ROW]);
    const r = resolveDepreciationAt(ns({ DepreciationDepletionAndAmortization: [fact(3514e6)] }), END, { statement: st });
    expect(r.value).toBe(3514e6);
    expect(r.status).toBe('confirmed');
    expect(r.flag).toMatch(/also shows.*\$607M/);
  });
  test('stock compensation amortization is not D&A (PGR FY25: Depreciation 313, not 445)', () => {
    const st = statement([row('Depreciation', 'Depreciation', 313e6), row('RestrictedStockExpense', 'Amortization of equity-based compensation', 132e6), OCF_ROW]);
    expect(resolveDepreciationAt(ns({}), END, { statement: st }).value).toBe(313e6);
  });
  test("the statement's own lines adding to the tag: confirmed (SPGI FY25: 110 + 1,069 = 1,179)", () => {
    const st = statement([row('Depreciation', 'Depreciation', 110e6), row('AmortizationOfIntangibleAssets', 'Amortization of intangibles', 1069e6), OCF_ROW]);
    expect(resolveDepreciationAt(ns({ DepreciationDepletionAndAmortization: [fact(1179e6)] }), END, { statement: st }).status).toBe('confirmed');
  });
  test('no match keeps the value and flags it, naming the statement line (CRM FY26: 1,200 vs 3,631)', () => {
    const st = statement([row('DepreciationAndAmortization', 'Depreciation and amortization', 3631e6), OCF_ROW]);
    const r = resolveDepreciationAt(ns({ DepreciationDepletionAndAmortization: [fact(1200e6)], DepreciationAndAmortization: [fact(3631e6)] }), END, { statement: st });
    expect(r.value).toBe(1200e6);
    expect(r.status).toBe('unconfirmed');
    expect(r.flag).toMatch(/\$1,200M does not match.*\$3,631M/);
  });
  test('statement unreadable: value kept, flagged', () => {
    const r = resolveCapexAt(ns({ PaymentsToAcquirePropertyPlantAndEquipment: [fact(50e6)] }), END, { statement: null });
    expect(r.value).toBe(50e6);
    expect(r.status).toBe('unconfirmed');
    expect(r.flag).toMatch(/could not be read/);
  });
});

describe('statement reader', () => {
  const PAGE = `<table><tr><th class="tl" colspan="2" rowspan="2"><div><strong>Statement - USD ($)<br> $ in Millions</strong></div></th><th class="th" colspan="2">12 Months Ended</th></tr>
    <tr><th class="th"><div>Dec. 31, 2025</div></th><th class="th"><div>Dec. 31, 2024</div></th></tr>
    <tr class="re"><td class="pl"><a onclick="Show.showAR( this, 'defref_us-gaap_RevenuesAbstract', window );"><strong>Net revenues:</strong></a></td><td class="th"><sup></sup></td><td class="text">&#160;<span></span></td><td class="text">&#160;<span></span></td></tr>
    <tr class="ro"><td class="pl custom"><a onclick="Show.showAR( this, 'defref_cci_Siterental', window );">Site rental</a></td><td class="th"><sup></sup></td><td class="nump">$ 4,049<span></span></td><td class="nump">$ 4,268<span></span></td></tr>
    <tr class="re"><td class="pl"><a onclick="Show.showAR( this, 'defref_us-gaap_Payments', window );">Purchases</a></td><td class="th"><sup></sup></td><td class="num">(131.5)<span></span></td><td class="num">(82)<span></span></td></tr></table>`;
  test('reads tags, namespaces, signs, scale and period columns; the footnote cell is not a column', () => {
    const p = parseStatementPage(PAGE);
    expect(p.scale).toBe(1e6);
    expect(p.periods).toEqual(['2025-12-31', '2024-12-31']);
    expect(p.rows[1]).toEqual({ ns: 'cci', tag: 'Siterental', label: 'Site rental', values: [4049e6, 4268e6] });
    expect(p.rows[2].values[0]).toBe(-131.5e6);
    expect(p.rows[0].values).toEqual([null, null]);
  });
  test('"shares in Thousands" does not scale dollars (GSAT prints dollars in full)', () => {
    expect(parseStatementPage(PAGE.replace('$ in Millions', 'shares in Thousands')).scale).toBe(1);
  });
  test('picks the primary statements, not the notes', () => {
    const xml = ['Consolidated Balance Sheets', 'Consolidated Statements of Comprehensive Income', 'Consolidated Statements of Operations', 'Consolidated Statements of Cash Flows', 'Supplemental Cash Flow Information (Details)']
      .map((n, i) => `<Report instance="a"><HtmlFileName>R${i + 2}.htm</HtmlFileName><ShortName>${n}</ShortName><MenuCategory>${i === 4 ? 'Details' : 'Statements'}</MenuCategory></Report>`).join('');
    const r = selectStatementReports(xml);
    expect(r.income.file).toBe('R4.htm');
    expect(r.cashFlow.file).toBe('R5.htm');
  });
});

describe('cost of revenue tie-out', () => {
  const SRPT_ROWS = [row('Revenues', 'Total revenues', 2198.237e6),
    row('CostOfGoodsSoldExcludingAmortization', 'Cost of sales (excluding amortization of in-licensed rights)', 839.605e6, 'srpt'),
    row('ResearchAndDevelopmentExpense', 'Research and development', 1522.066e6), row('SellingGeneralAndAdministrativeExpense', 'Selling, general and administrative', 491.716e6),
    row('RestructuringCharges', 'Restructuring charge', 42.009e6), row('AmortizationOfIntangibleAssets', 'Amortization of in-licensed rights', 2.622e6),
    row('CostsAndExpenses', 'Total cost and expenses', 2898.018e6), row('OperatingIncomeLoss', 'Operating (loss) income', -699.781e6)];
  const SRPT_STATEMENT = { ...statement(SRPT_ROWS), scale: 1e3 };

  test('the statement line beats a stray tag, confirmed by the tie-out (SRPT FY25: 839.6, not 25.5)', () => {
    const gaap = ns({ CostOfRevenue: [fact(25.5e6)] });
    const { byEnd, entries } = statementCostResolutions(gaap, SRPT_STATEMENT, { form: '10-K', accn: 'acc' });
    expect(byEnd[END].status).toBe('tie-out');
    expect(byEnd[END].tieOut.total).toBe(2898.018e6);
    expect(Math.abs(byEnd[END].tieOut.residual)).toBeLessThan(1);
    expect(entries[0].val).toBe(839.605e6);

    const lines = annualIncomeLines({ ...gaap, [STATEMENT_LINE_CONCEPT]: { units: { USD: entries } }, CostOfRevenueResolutions: byEnd }, END, 2198.237e6);
    expect(lines.costOfRevenue.value).toBe(839.605e6);
    expect(lines.costOfRevenue.kind).toBe('statement-line');
    expect(lines.costOfRevenue.concept).toBe('srpt:CostOfGoodsSoldExcludingAmortization');
    expect(lines.costOfRevenue.label).toMatch(/income statement \(srpt:CostOfGoodsSoldExcludingAmortization\)/);
    expect(lines.grossProfit.value).toBeCloseTo(1358.632e6, 0);
  });
  test('a statement that does not foot confirms nothing: today\'s pick stays, flagged', () => {
    const broken = { ...SRPT_STATEMENT, rows: SRPT_ROWS.map((r) => (r.tag === 'RestructuringCharges' ? { ...r, values: [99e6] } : r)) };
    const { byEnd, entries } = statementCostResolutions(ns({ CostOfRevenue: [fact(25.5e6)] }), broken);
    expect(entries).toEqual([]);
    expect(byEnd[END].status).toBe('unconfirmed');
    expect(byEnd[END].flag).toMatch(/CostOfRevenue \$25\.5M/);
  });
  test('partial tags are never summed: two cost lines and no total keep today\'s pick, flagged with tags and values (CCI FY25)', () => {
    const st = statement([row('Revenues', 'Net Revenues', 4264e6), row('DirectCostsOfLeasedAndRentedPropertyOrEquipment', 'Site rental', 992e6), row('CostOfGoodsAndServicesSold', 'Services and other', 113e6),
      row('SellingGeneralAndAdministrativeExpense', 'SG&A', 1084e6), row('CostsAndExpenses', 'Total operating expenses', 2189e6)]);
    const gaap = ns({ CostOfGoodsAndServicesSold: [fact(113e6)], DirectCostsOfLeasedAndRentedPropertyOrEquipment: [fact(992e6)] });
    const { byEnd, entries } = statementCostResolutions(gaap, st);
    expect(entries).toEqual([]);
    expect(byEnd[END].status).toBe('unconfirmed');
    expect(byEnd[END].flag).toMatch(/CostOfGoodsAndServicesSold \$113M, DirectCostsOfLeasedAndRentedPropertyOrEquipment \$992M/);
    const lines = annualIncomeLines({ ...gaap, CostOfRevenueResolutions: byEnd }, END, 4264e6);
    expect(lines.costOfRevenue.value).toBe(113e6);
    expect(lines.costOfRevenue.flag).toMatch(/not confirmed/);
  });
  test('disagreeing candidates: the one on the statement wins, with the tie-out', () => {
    const st = statement([row('Revenues', 'Revenue', 100e6), row('CostOfGoodsAndServicesSold', 'Cost of sales', 60e6), row('SellingGeneralAndAdministrativeExpense', 'SG&A', 20e6), row('CostsAndExpenses', 'Total costs', 80e6), row('OperatingIncomeLoss', 'Operating income', 20e6)]);
    const { byEnd, entries } = statementCostResolutions(ns({ CostOfRevenue: [fact(5e6)], CostOfGoodsAndServicesSold: [fact(60e6)] }), st, { form: '10-K', accn: 'a' });
    expect(byEnd[END].status).toBe('tie-out');
    expect(entries[0].val).toBe(60e6);
    expect(entries[0].filedConcept).toBe('CostOfGoodsAndServicesSold');
  });
  test('one candidate that is the one cost line changes nothing', () => {
    const st = statement([row('Revenues', 'Revenue', 100e6), row('CostOfRevenue', 'Cost of revenue', 60e6)]);
    const { byEnd, entries } = statementCostResolutions(ns({ CostOfRevenue: [fact(60e6)] }), st);
    expect(byEnd[END]).toMatchObject({ status: 'single', flag: null });
    expect(entries).toEqual([]);
  });
  test('a total with its parts beneath it is still one line (AAPL: products + services)', () => {
    const st = statement([row('CostOfGoodsAndServicesSold', 'Products', 215874e6), row('CostOfGoodsAndServicesSold', 'Services', 29358e6), row('CostOfGoodsAndServicesSold', 'Total cost of sales', 245232e6)]);
    expect(statementCostResolutions(ns({ CostOfGoodsAndServicesSold: [fact(245232e6)] }), st).byEnd[END].status).toBe('single');
  });
  test('no statement: nothing changes', () => {
    expect(statementCostResolutions(ns({ CostOfRevenue: [fact(5e6)] }), null)).toEqual({ byEnd: {}, entries: [] });
  });
});
