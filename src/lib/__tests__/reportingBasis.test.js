import {
  GAAP, NON_GAAP, FY_ONLY, reportedNonGaap, nonGaapAvailability, effectiveBasis,
  resolveReportingBasis, applyReportingBasis, ebitdaBasesDiffer,
} from '../reportingBasis';
import { calculate } from '../../utils/dealCalc';
import { BASIS_FY, BASIS_LTM } from '../companyBasis';

// /api/nongaap payloads in the route's shape, with the FY2025 figures the reader returns from the filed tables.
const fig = (value, extra = {}) => ({ value, rowLabel: 'row', label: `non-GAAP, company reported, FY2025, ${extra.acc || 'acc'}`, period: 'Year Ended December 31, 2025', accession: extra.acc || 'acc', ...extra });
const payload = ({ eps, ni, sh, ebitda, ebitdaName, acc = 'acc' }) => ({
  status: 'reported', fiscalYear: 2025, fiscalYearEnd: '2025-12-31', sourceAccession: acc,
  figures: {
    eps: eps != null ? fig(eps, { acc }) : null, netIncome: ni != null ? fig(ni, { acc }) : null,
    dilutedShares: sh != null ? fig(sh, { acc }) : null, ebitda: ebitda != null ? fig(ebitda, { acc, name: ebitdaName }) : null,
  },
  reasons: {
    eps: eps != null ? null : 'no adjusted (non-GAAP) diluted EPS row in the reconciliation tables',
    netIncome: ni != null ? null : 'no non-GAAP net income row in the reconciliation tables',
    dilutedShares: sh != null ? null : 'no adjusted EPS',
    ebitda: ebitda != null ? null : 'no adjusted EBITDA row in the reconciliation tables',
  },
});
const NET = payload({ eps: 0.93, ni: 342.882, sh: 370.274, acc: '0001477333-26-000008' });
const DDOG = payload({ eps: 2.05, ni: 746.582, sh: 363.471, acc: '0001628280-26-006645' });
const RKLB = payload({ ebitda: -101.19, ebitdaName: 'Adjusted EBITDA', acc: '0001819994-26-000012' });
const IRDM = payload({ ebitda: 495.33, ebitdaName: 'Operational EBITDA', acc: '0001418819-26-000008' });
const NONE = payload({});

const base = {
  companyABasis: BASIS_FY, companyBBasis: BASIS_FY,
  companyANetIncome: -102.267, companyAEPS: -0.29, companyADilutedShares: 348.421, companyAShares: 350, companyAEBITDA: -50,
  companyBNetIncome: 107.741, companyBEPS: 0.31, companyBShares: 350, companyBEBITDA: 100,
  companyARevenue: 2000, companyBRevenue: 3400, companyADebt: 3000, companyBDebt: 1000, companyACash: 1000, companyBCash: 500,
  currentSharePriceA: 200, currentSharePriceB: 120, offerPricePerShare: 156, cashPercent: 0,
};

describe('reportingBasis — the one GAAP | Non-GAAP switch', () => {
  test('GAAP selected: the inputs pass through as the same object (decks unchanged)', () => {
    const plan = resolveReportingBasis({ selected: GAAP, ngA: NET, ngB: DDOG, inputs: base, tickerA: 'NET', tickerB: 'DDOG' });
    expect(plan.selected).toBe(GAAP);
    expect(applyReportingBasis(base, plan)).toBe(base);
    expect(calculate(applyReportingBasis(base, plan))).toEqual(calculate(base));
  });

  test('availability: Non-GAAP is the default when any figure exists, disabled with the reason when none does', () => {
    const a = nonGaapAvailability({ ngA: RKLB, ngB: NONE, tickerA: 'RKLB', tickerB: 'X' });
    expect(a.available).toBe(true);
    expect(effectiveBasis(null, a)).toBe(NON_GAAP);
    expect(effectiveBasis(GAAP, a)).toBe(GAAP);
    const n = nonGaapAvailability({ ngA: NONE, ngB: NONE, tickerA: 'KO', tickerB: 'PEP' });
    expect(n.available).toBe(false);
    expect(n.reason).toMatch(/neither KO nor PEP reports an adjusted EPS or EBITDA/);
    expect(effectiveBasis(NON_GAAP, n)).toBe(GAAP);   // a stale Non-GAAP pick can't force an unavailable basis
    expect(nonGaapAvailability({ ngA: NET, ngB: null, loadingB: true }).state).toBe('loading');
    expect(nonGaapAvailability({ ngA: null, ngB: null, privateA: true, privateB: true }).available).toBe(false);
  });

  test('EPS rule: both report adjusted EPS → EPS, net income and shares are the filed non-GAAP figures', () => {
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA: NET, ngB: DDOG, inputs: base, tickerA: 'NET', tickerB: 'DDOG' });
    expect(plan.eps.nonGaap).toBe(true);
    expect(plan.eps.note).toBeNull();
    const x = applyReportingBasis(base, plan);
    expect(x.companyAEPS).toBe(0.93);
    expect(x.companyANetIncome).toBe(342.882);
    expect(x.companyADilutedShares).toBe(370.274);
    expect(x.companyADilutedSharesPeriod).toEqual({ basis: 'non-GAAP diluted', end: '2025-12-31' });
    expect(x.companyBNetIncome).toBe(746.582);
    expect(x.companyBEPS).toBe(2.05);
    // EBITDA: neither reports one → both computed, same basis, combined figure still added.
    expect(x.companyAEBITDA).toBe(-50);
    expect(ebitdaBasesDiffer(x)).toBe(false);
    expect(calculate(x).combinedEBITDA).toBe(String(-50 + 100));
  });

  test('EPS rule: one side without adjusted EPS → GAAP EPS for both, labeled with the ticker', () => {
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA: NET, ngB: IRDM, inputs: base, tickerA: 'NET', tickerB: 'IRDM' });
    expect(plan.eps.nonGaap).toBe(false);
    expect(plan.eps.note).toBe('GAAP EPS (IRDM doesn’t report adjusted EPS)');
    const x = applyReportingBasis(base, plan);
    expect(x.companyAEPS).toBe(-0.29);           // GAAP for BOTH — NET's adjusted EPS is not used alone
    expect(x.companyANetIncome).toBe(-102.267);
    expect(x.companyBNetIncome).toBe(107.741);
    const both = resolveReportingBasis({ selected: NON_GAAP, ngA: RKLB, ngB: IRDM, inputs: base, tickerA: 'RKLB', tickerB: 'IRDM' });
    expect(both.eps.note).toBe('GAAP EPS (RKLB and IRDM don’t report adjusted EPS)');
  });

  test('EBITDA rule: both adjusted (RKLB/IRDM) → each its own figure and name, combined added on one basis', () => {
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA: RKLB, ngB: IRDM, inputs: base, tickerA: 'RKLB', tickerB: 'IRDM' });
    expect(plan.ebitda.A).toMatchObject({ nonGaap: true, value: -101.19, name: 'Adjusted EBITDA' });
    expect(plan.ebitda.B).toMatchObject({ nonGaap: true, value: 495.33, name: 'Operational EBITDA' });
    expect(plan.ebitda.combinable).toBe(true);
    const r = calculate(applyReportingBasis(base, plan));
    expect(r.combinedEBITDA).toBe((-101.19 + 495.33 + r.synergiesY1).toFixed(0));
    expect(r.ebitdaBasesDiffer).toBe(false);
  });

  test('EBITDA rule: different bases → combined EBITDA and Debt/EBITDA are not added', () => {
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA: NET, ngB: IRDM, inputs: base, tickerA: 'NET', tickerB: 'IRDM' });
    expect(plan.ebitda.combinable).toBe(false);
    expect(plan.ebitda.note).toBe('companies on different bases');
    const x = applyReportingBasis(base, plan);
    expect(x.companyAEBITDA).toBe(-50);          // NET: computed
    expect(x.companyBEBITDA).toBe(495.33);       // IRDM: Operational EBITDA
    expect(ebitdaBasesDiffer(x)).toBe(true);
    const r = calculate(x);
    expect(r.combinedEBITDA).toBeNull();
    expect(r.debtEBITDA).toBe('N/A');
    expect(r.ebitdaBasesDiffer).toBe(true);
    expect(r.combinedRevenue).toBe('5400');      // only EBITDA is withheld, not every combined figure
  });

  test('LTM card: non-GAAP is fiscal-year only → EPS stays GAAP, the LTM company\'s adjusted EBITDA is "—"', () => {
    const ltm = { ...base, companyBBasis: BASIS_LTM };
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA: NET, ngB: { ...DDOG, figures: { ...DDOG.figures, ebitda: fig(900, { name: 'Adjusted EBITDA' }) } }, inputs: ltm, tickerA: 'NET', tickerB: 'DDOG' });
    expect(plan.eps.nonGaap).toBe(false);
    expect(plan.eps.note).toBe(`GAAP EPS (${FY_ONLY})`);
    expect(plan.ebitda.B).toMatchObject({ nonGaap: true, value: null, note: FY_ONLY });
    const x = applyReportingBasis(ltm, plan);
    expect(x.companyBEBITDA).toBeNull();         // "—", never the GAAP figure under a non-GAAP label
    expect(calculate(x).combinedEBITDA).toBeNull();
  });

  test('an incomplete EPS bundle (EPS without its share count) is not adjusted EPS', () => {
    const partial = payload({ eps: 3.0, ni: 12958 });
    expect(reportedNonGaap(partial).eps).toBeNull();
    expect(reportedNonGaap(partial).epsReason).toBe('no adjusted EPS');
  });

  test('NET/DDOG on Non-GAAP: pro forma EPS and accretion by hand', () => {
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA: NET, ngB: DDOG, inputs: base, tickerA: 'NET', tickerB: 'DDOG' });
    const x = applyReportingBasis(base, plan);
    const r = calculate(x);
    // all stock, no synergies: new shares = 156 × 350 ÷ 200 = 273; PF NI = 342.882 + 746.582; PF shares = 370.274 + 273
    const pf = (342.882 + 746.582) / (370.274 + 273);
    expect(r.proFormaEPS).toBe(pf.toFixed(2));
    expect(r.companyAEPS).toBe('0.93');                            // standalone = the filed adjusted EPS
    expect(parseFloat(r.epsChangePct)).toBeCloseTo((pf / 0.93 - 1) * 100, 1);
    expect(x.companyBDilutedShares).toBe(363.471);                 // forward consensus rows pair with the filed non-GAAP count
  });
});
