import { ltmAvailability, basisLabel, companyInputs, basesDiffer, combination, BASIS_FY, BASIS_LTM, DIFFERENT_BASES, DIFFERENT_FY_MONTHS } from '../companyBasis';
import { calculate, calcProFormaEPS, epsAccretionPct, forwardYearInputs } from '../../utils/dealCalc';
import { combinedGrossMargin } from '../synergies';
import { forwardNetIncomeLabel } from '../composeSourceLine';

// RKLB and IRDM as /quote returned them on Nov 3, 2026 ($M).
const rklb = {
  revenue: 602, ebitda: -185, netIncome: -198, operatingIncome: -229, grossProfit: 207, freeCashFlow: -9, eps: -0.37, dilutedShares: 531,
  dilutedSharesPeriod: { basis: 'weighted average', end: '2025-12-31' }, costOfRevenue: 395, costOfRevenueSource: 'companyfacts',
  grossProfitSource: 'sec_edgar', grossProfitBasis: 'filed', fiscalYearEnd: '2025-12-31',
  ltm: { trusted: true, asOf: '2026-06-30', revenue: 769, ebitda: -161, netIncome: -165, operatingIncome: -223, grossProfit: 287, freeCashFlow: -74, eps: -0.27, dilutedShares: 618, costOfRevenue: 483, costOfRevenueSource: 'companyfacts' },
};
const irdm = {
  revenue: 872, ebitda: 446, netIncome: 114, operatingIncome: 236, grossProfit: 624, freeCashFlow: 500, eps: 1.06, dilutedShares: 108,
  costOfRevenue: 248, grossProfitSource: 'sec_edgar', grossProfitBasis: 'calculated', fiscalYearEnd: '2025-12-31',
  ltm: { trusted: true, asOf: '2026-09-30', revenue: 903, ebitda: 394, netIncome: 163, operatingIncome: 172, grossProfit: 645, freeCashFlow: 503, eps: 1.5, dilutedShares: 108, costOfRevenue: 258, audit: { breakdown: { grossProfit: { derived: true } } } },
};
const market = { companyAShares: 544, companyBShares: 105, companyADebt: 0, companyBDebt: 0, companyBCash: 0, currentSharePriceA: 54, currentSharePriceB: 44, offerPricePerShare: 57, cashPercent: 60 };
const deal = (a, b) => ({ ...market, ...companyInputs('A', rklb, a), ...companyInputs('B', irdm, b) });

describe('availability and label', () => {
  test('trusted LTM is available, and the label names the period', () => {
    expect(ltmAvailability(rklb).available).toBe(true);
    expect(basisLabel(rklb, BASIS_FY)).toBe('FY ended Dec 31, 2025');
    expect(basisLabel(rklb, BASIS_LTM)).toBe('LTM to Jun 30, 2026');
  });
  test('no trusted LTM gives the reason', () => {
    const r = ltmAvailability({ ltm: { trusted: false, reason: 'no annual revenue frame' } });
    expect(r).toEqual({ available: false, reason: 'no annual revenue frame' });
    expect(ltmAvailability({}).available).toBe(false);
    expect(ltmAvailability(null).available).toBe(false);
    expect(ltmAvailability(rklb, { bank: true }).available).toBe(false);
  });
});

describe('the switch', () => {
  test('Fiscal year reads the annual fields', () => {
    const f = companyInputs('A', rklb, BASIS_FY);
    expect(f.companyARevenue).toBe(602);
    expect(f.companyAEPS).toBe(-0.37);
    expect(f.companyAPeriodLabel).toBe('FY ended Dec 31, 2025');
    expect(f.companyADilutedSharesPeriod.interim).toBeUndefined();
  });
  test('LTM reads data.ltm, every flow figure', () => {
    const f = companyInputs('A', rklb, BASIS_LTM);
    expect([f.companyARevenue, f.companyAEBITDA, f.companyANetIncome, f.companyAOperatingIncome, f.companyAGrossProfit, f.companyAFreeCashFlow, f.companyAEPS, f.companyADilutedShares, f.companyACostOfRevenue])
      .toEqual([769, -161, -165, -223, 287, -74, -0.27, 618, 483]);
    expect(f.companyAPeriodLabel).toBe('LTM to Jun 30, 2026');
  });
  test('a null LTM field stays null: no fallback to the annual figure', () => {
    const f = companyInputs('A', { ...rklb, ltm: { ...rklb.ltm, grossProfit: null, netIncome: null } }, BASIS_LTM);
    expect(f.companyAGrossProfit).toBeNull();
    expect(f.companyANetIncome).toBeNull();
    expect(f.companyAGrossProfitSource).toBeNull();
  });
  test('the balance sheet and prices are not touched', () => {
    const f = companyInputs('A', rklb, BASIS_LTM);
    ['companyACash', 'companyADebt', 'companyAShares', 'currentSharePriceA'].forEach((k) => expect(k in f).toBe(false));
  });
});

describe('combining', () => {
  test('same basis combines', () => {
    expect(basesDiffer(deal(BASIS_FY, BASIS_FY))).toBe(false);
    expect(combination(deal(BASIS_FY, BASIS_FY))).toEqual({ comparable: true, note: null });
    const r = calculate(deal(BASIS_FY, BASIS_FY));
    expect(r.combinedRevenue).toBe('1474');
    expect(r.combinedEBITDA).toBe('261');
  });
  test('different bases: every combined figure null, with the reason', () => {
    const d = deal(BASIS_LTM, BASIS_FY);
    expect(combination(d)).toEqual({ comparable: false, note: DIFFERENT_BASES });
    const r = calculate(d);
    expect(r.basesDiffer).toBe(true);
    ['combinedRevenue', 'proFormaRevenue', 'combinedEBITDA', 'proFormaNetIncome', 'combinedNetIncome', 'proFormaEPS', 'epsChangePct'].forEach((k) => expect(r[k]).toBeNull());
    expect(r.debtEBITDA).toBe('N/A');
    expect(calcProFormaEPS(57, 0, d)).toBeNull();
    expect(epsAccretionPct(57, 0, d)).toBeNull();
    expect(combinedGrossMargin(d).pct).toBeNull();
    expect(combinedGrossMargin(d).reason).toBe(DIFFERENT_BASES);
  });
  test('both on LTM adds the LTM figures', () => {
    const d = deal(BASIS_LTM, BASIS_LTM);
    const r = calculate(d);
    expect(r.combinedRevenue).toBe(String(769 + 903));
    expect(r.combinedEBITDA).toBe(String(-161 + 394));
    expect(combinedGrossMargin(d).pct).toBeCloseTo((287 + 645) / (769 + 903) * 100, 9);
    expect(combination(d).note).toContain('different dates');
  });
  test('fiscal years ending in different months keep their values, with the note', () => {
    const d = { ...deal(BASIS_FY, BASIS_FY), companyBFiscalYearEnd: '2026-03-31' };
    expect(combination(d)).toEqual({ comparable: true, note: DIFFERENT_FY_MONTHS });
    expect(calculate(d).combinedRevenue).toBe('1474');
  });
  test('same month in different years is not a different month', () => {
    const d = { ...deal(BASIS_FY, BASIS_FY), companyBFiscalYearEnd: '2024-12-31' };
    expect(combination(d).note).toBeNull();
  });
  test('private companies carry no basis, so they never differ', () => {
    expect(basesDiffer({ companyAPrivate: true })).toBe(false);
    expect(combination({}).comparable).toBe(true);
  });
  test('forward years are consensus on both sides, so a basis difference does not block them', () => {
    const fwd = forwardYearInputs(deal(BASIS_LTM, BASIS_FY), 0.5, 1.2);
    expect(basesDiffer(fwd)).toBe(false);
    expect(calcProFormaEPS(57, 0, fwd)).not.toBeNull();
  });
  test('the forward share label names an interim period on LTM', () => {
    expect(forwardNetIncomeLabel(deal(BASIS_LTM, BASIS_FY))).toContain('latest interim period ended June 30, 2026');
    expect(forwardNetIncomeLabel(deal(BASIS_FY, BASIS_FY))).toContain('fiscal year ended December 31, 2025');
  });
});
