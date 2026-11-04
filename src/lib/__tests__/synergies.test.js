import {
  presetYears, totalOperatingExpenses, costSynergyBase, revenueSynergyBase, combinedGrossMargin,
  synergySchedule, fmtSynergy, marginSentence, NONE_ENTERED,
} from '../synergies';
import { calculate, calcProFormaEPS, TAX_RATE } from '../../utils/dealCalc';

// NET/DDOG and IRDM figures as /quote returned them on Nov 3, 2026 ($M).
const netDdog = {
  companyAName: 'NET', companyBName: 'DDOG',
  companyARevenue: 2168, companyAGrossProfit: 1615, companyAGrossProfitSource: 'sec_edgar', companyAPeriodLabel: 'FY ended Dec 31, 2025',
  companyBRevenue: 3427, companyBGrossProfit: 2740, companyBGrossProfitSource: 'sec_edgar', companyBPeriodLabel: 'FY ended Dec 31, 2025',
  companyBOperatingIncome: -44, companyBCostOfRevenue: 687, companyBCostOfRevenueSource: 'SEC EDGAR companyfacts (CostOfGoodsAndServicesSold)', companyBDataSource: 'sec_edgar',
};
const irdmTarget = {
  companyBRevenue: 872, companyBGrossProfit: 624, companyBGrossProfitSource: 'sec_edgar', companyBOperatingIncome: 236,
  companyBCostOfRevenue: 248, companyBCostOfRevenueSource: '10-K 0001418819-26-000009 XBRL instance', companyBDataSource: 'sec_edgar', companyBPeriodLabel: 'FY ended Dec 31, 2025',
};

describe('presets', () => {
  test('percent of base, on the 40/70/100 ramp', () => {
    expect(presetYears(636, 2)).toEqual([5.088, 8.904, 12.72]);
    expect(presetYears(636, 3.5)).toEqual([8.904, 15.582, 22.26]);
    expect(presetYears(636, 5)).toEqual([12.72, 22.26, 31.8]);
  });
  test('an edited or blank percent', () => {
    expect(presetYears(100, 10)).toEqual([4, 7, 10]);
    expect(presetYears(100, '')).toBeNull();
    expect(presetYears(null, 2)).toBeNull();
  });
  test('IRDM cost base is cost of revenue + total operating expenses', () => {
    const b = costSynergyBase(irdmTarget);
    expect(b.costOfRevenue).toBe(248);
    expect(b.operatingExpenses).toBe(388);
    expect(b.amount).toBe(636);
    expect(b.period).toBe('FY ended Dec 31, 2025');
    expect(b.source).toContain('0001418819-26-000009');
  });
  test('a missing base figure names itself and leaves no base', () => {
    const noCost = costSynergyBase({ ...irdmTarget, companyBCostOfRevenue: null });
    expect(noCost.amount).toBeNull();
    expect(noCost.missing).toEqual(['cost of revenue']);
    const noOpex = costSynergyBase({ ...irdmTarget, companyBGrossProfit: null });
    expect(noOpex.amount).toBeNull();
    expect(noOpex.missing).toEqual(['total operating expenses']);
    expect(costSynergyBase({}).missing).toEqual(['cost of revenue', 'total operating expenses']);
  });
  test('opex keeps a real 0, and null stays null', () => {
    expect(totalOperatingExpenses(100, 100)).toBe(0);
    expect(totalOperatingExpenses(null, 100)).toBeNull();
    expect(totalOperatingExpenses(100, null)).toBeNull();
  });
  test('revenue base', () => {
    expect(revenueSynergyBase(irdmTarget).amount).toBe(872);
    expect(revenueSynergyBase({}).amount).toBeNull();
    expect(revenueSynergyBase({}).missing).toEqual(['revenue']);
  });
});

describe('combined gross margin', () => {
  test('NET/DDOG by hand: 4,355 / 5,595', () => {
    const m = combinedGrossMargin(netDdog);
    expect(m.pct).toBeCloseTo(77.837, 3);
    expect(marginSentence(m)).toContain('77.8%');
    expect(marginSentence(m)).toContain('$1,615M + $2,740M');
  });
  test('null with a reason: no gross profit, not filed, different bases', () => {
    expect(combinedGrossMargin({ ...netDdog, companyBGrossProfit: null }).pct).toBeNull();
    expect(combinedGrossMargin({ ...netDdog, companyBGrossProfit: null }).reason).toContain('DDOG');
    expect(combinedGrossMargin({ ...netDdog, companyAGrossProfitSource: 'fmp' }).reason).toContain('not from a filing');
    expect(combinedGrossMargin({ ...netDdog, basisMismatch: true }).reason).toBe('companies on different bases');
  });
});

describe('schedule', () => {
  test('cost only: EBITDA moves dollar for dollar', () => {
    const s = synergySchedule({ ...netDdog, synergiesY1: 69, synergiesY2: 120, synergiesY3: 171 });
    expect(s.years.map((y) => y.ebitda)).toEqual([69, 120, 171]);
    expect(s.years.every((y) => y.revenue === null)).toBe(true);
  });
  test('revenue synergy reaches EBITDA at the margin', () => {
    const s = synergySchedule({ ...netDdog, revenueSynergiesY1: 100 });
    expect(s.years[0].revenueEbitda).toBeCloseTo(100 * 4355 / 5595, 9);
    expect(s.years[0].ebitda).toBeCloseTo(77.837, 3);
    expect(s.revenueOnly).toBe(false);
  });
  test('null margin: revenue only, nothing in EBITDA, flagged', () => {
    const s = synergySchedule({ ...netDdog, companyBGrossProfit: null, revenueSynergiesY1: 100, synergiesY1: 10 });
    expect(s.years[0].revenue).toBe(100);
    expect(s.years[0].revenueEbitda).toBeNull();
    expect(s.years[0].ebitda).toBe(10);
    expect(s.revenueOnly).toBe(true);
  });
  test('empty is not entered; a typed 0 is', () => {
    const empty = synergySchedule(netDdog);
    expect(empty.anyEntered).toBe(false);
    expect(empty.years[0].cost).toBeNull();
    const zero = synergySchedule({ ...netDdog, synergiesY1: 0 });
    expect(zero.anyEntered).toBe(true);
    expect(zero.years[0].cost).toBe(0);
    expect(fmtSynergy(zero.years[0].cost)).toBe('$0M');
    expect(fmtSynergy(empty.years[0].cost)).toBe(NONE_ENTERED);
  });
});

describe('deal model', () => {
  const deal = {
    ...netDdog,
    companyAEBITDA: -17, companyBEBITDA: 5, companyANetIncome: -102, companyBNetIncome: 108,
    companyAEPS: -0.29, companyADilutedShares: 348, companyAShares: 348, companyBShares: 347, companyBDebt: 0, companyADebt: 0, companyBCash: 0,
    currentSharePriceA: 200, currentSharePriceB: 200, offerPricePerShare: 260, cashPercent: 50,
  };
  test('cost synergy flows to EBITDA and after tax to net income', () => {
    const none = calculate(deal), cost = calculate({ ...deal, synergiesY1: 100 });
    expect(none.combinedEBITDA).toBe('-12');
    expect(cost.combinedEBITDA).toBe('88');
    expect(parseFloat(cost.proFormaNetIncome) - parseFloat(none.proFormaNetIncome)).toBeCloseTo(100 * (1 - TAX_RATE), 0);
  });
  test('revenue synergy: pro forma revenue up by the dollars, EBITDA by dollars × margin', () => {
    const r = calculate({ ...deal, revenueSynergiesY1: 100 });
    expect(r.combinedRevenue).toBe('5595');
    expect(r.proFormaRevenue).toBe('5695');
    expect(parseFloat(r.combinedEBITDA)).toBeCloseTo(-12 + 77.837, 0);
    expect(r.synergiesY1).toBeCloseTo(77.837, 3);
  });
  test('null margin: revenue synergy adds nothing to EBITDA or net income', () => {
    const noGp = { ...deal, companyBGrossProfit: null };
    const r = calculate({ ...noGp, revenueSynergiesY1: 100 }), base = calculate(noGp);
    expect(r.proFormaRevenue).toBe('5695');
    expect(r.combinedEBITDA).toBe(base.combinedEBITDA);
    expect(r.proFormaNetIncome).toBe(base.proFormaNetIncome);
  });
  test('the grid helper takes the entered total, and nothing when none is entered', () => {
    expect(calculate(deal).synergiesY1).toBe(0);
    const at0 = calcProFormaEPS(260, 0, deal), at100 = calcProFormaEPS(260, 100, deal);
    expect(at100).toBeGreaterThan(at0);
    expect(parseFloat(calculate(deal).proFormaEPS)).toBeCloseTo(at0, 2);
  });
});
