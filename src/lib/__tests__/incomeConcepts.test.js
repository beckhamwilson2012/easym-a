// Cost of revenue and gross profit resolution (server/services/incomeConcepts.js). No network: pure functions
// over literal companyfacts entries and a literal XBRL instance built from IRDM's FY25 10-K facts.
const {
  sumComponents, calculateGrossProfit, resolveGrossProfit, grossFromCostOfRevenue, pickAnnualAt,
  annualIncomeLines, componentSumEntries, parseInstanceCosts, COST_OF_REVENUE_CONCEPTS, FILING_INSTANCE_CONCEPT,
} = require('../../../server/services/incomeConcepts');

const fact = (val, start, end, form = '10-K', filed = '2026-02-01') => ({ val, start, end, form, filed, accn: 'A' });
const ns = (byConcept) => Object.fromEntries(Object.entries(byConcept).map(([c, entries]) => [c, { units: { USD: entries } }]));

const context = (id, start, end, member) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="s">1</xbrli:identifier>${
  member ? `<xbrli:segment><xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">${member}</xbrldi:explicitMember></xbrli:segment>` : ''
}</xbrli:entity><xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period></xbrli:context>`;
const cost = (ctx, val, concept = 'CostOfGoodsAndServicesSold', unit = 'usd') => `<us-gaap:${concept} contextRef="${ctx}" decimals="-3" unitRef="${unit}" id="f${ctx}">${val}</us-gaap:${concept}>`;
const usdUnit = '<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>';
const FY25 = ['2025-01-01', '2025-12-31'], FY24 = ['2024-01-01', '2024-12-31'];
const META = { form: '10-K', accn: '0001418819-26-000009', filed: '2026-02-12' };

describe('sumComponents', () => {
  test('sums when every component is present', () => expect(sumComponents([197577000, 50426000])).toBe(248003000));
  test('one missing component returns null, not a partial sum', () => {
    expect(sumComponents([197577000, null])).toBeNull();
    expect(sumComponents([undefined, 50426000])).toBeNull();
  });
  test('a zero component is a filed value and is summed', () => expect(sumComponents([100, 0])).toBe(100));
  test('no components returns null', () => expect(sumComponents([])).toBeNull());
});

describe('resolveGrossProfit', () => {
  test('filed wins over calculated', () => expect(resolveGrossProfit(500, 900, 300)).toEqual({ value: 500, basis: 'filed' }));
  test('calculated when nothing is filed', () => expect(resolveGrossProfit(null, 871659000, 248003000)).toEqual({ value: 623656000, basis: 'calculated' }));
  test('a filed zero stays zero', () => expect(resolveGrossProfit(0, 900, 300)).toEqual({ value: 0, basis: 'filed' }));
  test('no cost means null, never revenue', () => {
    expect(resolveGrossProfit(null, 900, null)).toEqual({ value: null, basis: null });
    expect(calculateGrossProfit(null, 300)).toBeNull();
  });
  test('LTM gross is built per leg, and null if any cost leg is absent', () => {
    const rev = { annual: 100, latestYTD: 80, priorYTD: 70, ltm: 110, conceptName: 'R' };
    expect(grossFromCostOfRevenue(rev, { annual: 40, latestYTD: 30, priorYTD: 25, ltm: 45, conceptName: 'C' })).toMatchObject({ annual: 60, latestYTD: 50, priorYTD: 45, ltm: 65, derived: true });
    expect(grossFromCostOfRevenue(rev, { annual: 40, latestYTD: null, priorYTD: 25, ltm: null, conceptName: 'C' })).toBeNull();
  });
});

describe('concept order', () => {
  test('the list is the agreed order, with sums and the filing last', () => {
    expect(COST_OF_REVENUE_CONCEPTS.gaap.slice(0, 4)).toEqual(['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfServices']);
    expect(COST_OF_REVENUE_CONCEPTS.gaap[5]).toBe(FILING_INSTANCE_CONCEPT);
  });
  test('earlier concept wins for the same period', () => {
    const g = ns({ CostOfGoodsSold: [fact(1, ...FY25)], CostOfRevenue: [fact(2, ...FY25)] });
    expect(pickAnnualAt(g, COST_OF_REVENUE_CONCEPTS.gaap, FY25[1]).val).toBe(2);
  });
  test('a stale tag cannot supply a later period', () => {
    const g = ns({ CostOfGoodsSold: [fact(9, '2017-01-01', '2017-12-31')] });
    expect(pickAnnualAt(g, COST_OF_REVENUE_CONCEPTS.gaap, FY25[1])).toBeNull();
  });
  test('a quarter ending on the same date is not an annual value', () => {
    const g = ns({ CostOfRevenue: [fact(3, '2025-10-01', '2025-12-31')] });
    expect(pickAnnualAt(g, COST_OF_REVENUE_CONCEPTS.gaap, FY25[1])).toBeNull();
  });
  test('the latest-filed restatement wins', () => {
    const g = ns({ CostOfRevenue: [fact(1, ...FY25, '10-K', '2026-01-01'), fact(2, ...FY25, '10-K', '2027-01-01')] });
    expect(pickAnnualAt(g, COST_OF_REVENUE_CONCEPTS.gaap, FY25[1]).val).toBe(2);
  });
});

describe('componentSumEntries', () => {
  const G = 'CostOfGoodsSoldExcludingDepreciationDepletionAndAmortization', S = 'CostOfServicesExcludingDepreciationDepletionAndAmortization';
  test('sums a period where every component is filed', () => {
    const [e, ...rest] = componentSumEntries(ns({ [G]: [fact(10, ...FY25)], [S]: [fact(5, ...FY25)] }));
    expect(e.val).toBe(15);
    expect(rest).toHaveLength(0);
  });
  test('a period with one component missing gets no entry', () => {
    const out = componentSumEntries(ns({ [G]: [fact(10, ...FY25), fact(9, ...FY24)], [S]: [fact(5, ...FY25)] }));
    expect(out.map((e) => e.end)).toEqual([FY25[1]]);
  });
  test('resolves to null through annualIncomeLines when a component is missing', () => {
    const entries = componentSumEntries(ns({ [G]: [fact(10, ...FY25)] }));
    expect(entries).toEqual([]);
    const lines = annualIncomeLines(ns({ [G]: [fact(10, ...FY25)] }), FY25[1], 100);
    expect(lines.costOfRevenue.value).toBeNull();
    expect(lines.grossProfit.value).toBeNull();
  });
});

describe('parseInstanceCosts', () => {
  const contexts = context('t25', ...FY25) + context('s25', ...FY25, 'us-gaap:ServiceMember') + context('p25', ...FY25, 'us-gaap:ManufacturedProductOtherMember')
    + context('s24', ...FY24, 'us-gaap:ServiceMember') + context('p24', ...FY24, 'us-gaap:ManufacturedProductOtherMember');

  test('IRDM FY25: sums the two dimensional members and labels the filing', () => {
    const [e] = parseInstanceCosts(usdUnit + contexts + cost('s25', 197577000) + cost('p25', 50426000), META);
    expect(e.val).toBe(248003000);
    expect(e).toMatchObject({ form: '10-K', accn: META.accn, start: FY25[0], end: FY25[1], concept: FILING_INSTANCE_CONCEPT });
    expect(e.components.map((c) => c.val)).toEqual([197577000, 50426000]);
  });
  test('a period missing one of the filing\'s members gets no entry', () => {
    const out = parseInstanceCosts(usdUnit + contexts + cost('s25', 197577000) + cost('p25', 50426000) + cost('s24', 178140000), META);
    expect(out.map((e) => e.end)).toEqual([FY25[1]]);
  });
  test('a single member alone is not a total', () => {
    expect(parseInstanceCosts(usdUnit + contexts + cost('s25', 197577000), META)).toEqual([]);
  });
  test('an undimensioned total is used in preference to a sum', () => {
    const [e] = parseInstanceCosts(usdUnit + contexts + cost('t25', 300) + cost('s25', 200) + cost('p25', 50), META);
    expect(e.val).toBe(300);
    expect(e.components).toBeNull();
  });
  test('a sum above filed CostsAndExpenses is overlapping members and is rejected', () => {
    const xml = usdUnit + contexts + cost('s25', 200) + cost('p25', 150) + cost('t25', 300, 'CostsAndExpenses');
    expect(parseInstanceCosts(xml, META)).toEqual([]);
  });
  test('a non-USD fact is ignored', () => {
    const xml = usdUnit + '<xbrli:unit id="eur"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>' + contexts + cost('s25', 200, undefined, 'eur') + cost('p25', 150, undefined, 'eur');
    expect(parseInstanceCosts(xml, META)).toEqual([]);
  });
  test('a context on another axis is a different cut and is ignored', () => {
    const other = '<xbrli:context id="x"><xbrli:entity><xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">a:SegMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>';
    const [e] = parseInstanceCosts(usdUnit + contexts + other + cost('s25', 200) + cost('p25', 50) + cost('x', 999), META);
    expect(e.val).toBe(250);
  });
});

describe('annualIncomeLines', () => {
  test('IRDM shape: no filed gross, cost from the filing, gross calculated and tied', () => {
    const g = ns({ [FILING_INSTANCE_CONCEPT]: parseInstanceCosts(usdUnit
      + context('s25', ...FY25, 'us-gaap:ServiceMember') + context('p25', ...FY25, 'us-gaap:ManufacturedProductOtherMember')
      + cost('s25', 197577000) + cost('p25', 50426000), META) });
    const lines = annualIncomeLines(g, FY25[1], 871659000);
    expect(lines.costOfRevenue).toMatchObject({ value: 248003000, kind: 'filing-instance', accn: META.accn });
    expect(lines.costOfRevenue.label).toBe('10-K 0001418819-26-000009 XBRL instance (Service + ManufacturedProductOther)');
    expect(lines.grossProfit).toMatchObject({ value: 623656000, basis: 'calculated' });
    expect(lines.grossProfit.value).toBe(871659000 - lines.costOfRevenue.value);
  });
  test('filed gross with no cost tag: cost is the identity, and labeled calculated', () => {
    const lines = annualIncomeLines(ns({ GrossProfit: [fact(70, ...FY25)] }), FY25[1], 100);
    expect(lines.grossProfit).toMatchObject({ value: 70, basis: 'filed' });
    expect(lines.costOfRevenue).toMatchObject({ value: 30, kind: 'calculated' });
  });
  test('nothing filed: both null', () => {
    const lines = annualIncomeLines(ns({}), FY25[1], 100);
    expect(lines.costOfRevenue.value).toBeNull();
    expect(lines.grossProfit.value).toBeNull();
  });
});

describe('utility SIC list', () => {
  const { UTILITY_SIC, UTILITY_GROSS_REASON } = require('../utilitySic');
  const { isUtility, UTILITY_GROSS_NOTE } = require('../../components/deck/shared/deckTokens');
  test('electric, gas, combination and water are utilities', () => {
    ['4911', '4922', '4923', '4924', '4931', '4932', '4939', '4941'].forEach((sic) => {
      expect(UTILITY_SIC).toContain(sic);
      expect(isUtility({ sic })).toBe(true);
    });
  });
  test('satellite, software and an absent SIC are not', () => {
    ['4899', '7372', '3760', null, undefined].forEach((sic) => expect(isUtility({ sic })).toBe(false));
    expect(isUtility(null)).toBe(false);
  });
  test('the note carries the reason', () => {
    expect(UTILITY_GROSS_REASON).toBe('not meaningful for utilities');
    expect(UTILITY_GROSS_NOTE).toContain('n/m, not meaningful for utilities');
  });
});
