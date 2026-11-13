import { selectForwardYears, CONSENSUS_BASIS, NO_GAAP_FORECAST } from '../forwardYears';
import { applyReportingBasis, resolveReportingBasis, NON_GAAP } from '../reportingBasis';
import { dealVerdict } from '../dealVerdict';
import { highestAccretivePremium } from '../offerPremium';

// Fix 10 Task 2: forward EPS follows the GAAP | Non-GAAP toggle, and never sits beside a different-basis Year 1.
const col = (fy, eps) => ({ fy, label: `FY${fy}E`, actual: false, eps, revenue: 100, netIncome: 10 });
const hngeFwd = [col(2026, 2.51792), col(2027, 3.12917), col(2028, 4.226)];
const tdocFwd = [col(2026, -0.83205), col(2027, -0.61303), col(2028, -0.52864)];
const fy = { companyABasis: 'fy', companyBBasis: 'fy', companyAFiscalYearEnd: '2025-12-31', companyBFiscalYearEnd: '2025-12-31' };

describe('Fix 10 Task 2 — forward EPS follows the toggle', () => {
  test('the label is "FMP consensus (non-GAAP)"', () => {
    expect(CONSENSUS_BASIS).toBe('FMP consensus (non-GAAP)');
  });
  test('GAAP deal: every forward year is "—" with the reason; the columns stay for the tables', () => {
    const s = selectForwardYears({ inputs: fy, acquirerFwd: hngeFwd, targetFwd: tdocFwd });
    expect(s.gaap).toBe(true);
    expect(s.slots.map(x => x.epsOk)).toEqual([false, false, false]);
    expect(s.slots.map(x => x.reason)).toEqual([NO_GAAP_FORECAST, NO_GAAP_FORECAST, NO_GAAP_FORECAST]);
    expect(NO_GAAP_FORECAST).toBe('consensus is non-GAAP; no GAAP forecast');
    expect(s.slots[0].a.fy).toBe(2026);
  });
  test('Non-GAAP deal: forward years compute on consensus', () => {
    const s = selectForwardYears({ inputs: { ...fy, reportingBasis: NON_GAAP }, acquirerFwd: hngeFwd, targetFwd: tdocFwd, acquirerName: 'HNGE', targetName: 'TDOC' });
    expect(s.slots.map(x => [x.year, x.label, x.epsOk])).toEqual([[2, 'FY2026E', true], [3, 'FY2027E', true], [4, 'FY2028E', true]]);
  });
  test('a missing consensus year is "—" with the reason, never filled', () => {
    const s = selectForwardYears({ inputs: { ...fy, reportingBasis: NON_GAAP }, acquirerFwd: hngeFwd.slice(0, 2), targetFwd: tdocFwd, acquirerName: 'HNGE', targetName: 'TDOC' });
    expect(s.slots[2]).toMatchObject({ epsOk: false, reason: 'no FMP consensus EPS for HNGE FY2028' });
  });
  test('Non-GAAP with no target adjusted EPS: Year 1 "—"; the verdict uses a forward year and says so', () => {
    const ng = { status: 'reported', figures: { eps: { value: 2.62 }, netIncome: { value: 161.348 }, dilutedShares: { value: 61.471 } }, reasons: {} };
    const tdoc = { status: 'reported', figures: {}, reasons: { eps: 'no adjusted EPS reported' } };
    const base = { ...fy, companyANetIncome: -424, companyAEPS: -7.77, companyADilutedShares: 85, currentSharePriceA: 121, companyAShares: 81.27,
      companyBNetIncome: -200, companyBEPS: -1.14, companyBShares: 178, companyBDilutedShares: 181, currentSharePriceB: 8.69, companyBDebt: 0,
      cashPercent: 0, offerPricePerShare: 11.30 };
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA: ng, ngB: tdoc, inputs: base, tickerA: 'HNGE', tickerB: 'TDOC' });
    const inputs = applyReportingBasis(base, plan);
    expect(inputs.companyAEPS).toBeNull();
    const deal = { offerPrice: 11.30, _inputs: inputs, _results: {}, synergies: { years: [1, 2, 3].map(y => ({ year: y, ebitda: 0, entered: false })) } };
    const v = dealVerdict({ deal, model: { derived: {}, verifiedData: { acquirer: {} } }, acquirerFwd: hngeFwd, targetFwd: tdocFwd, acquirerName: 'HNGE', targetName: 'TDOC' });
    expect(v.step).toBe(2);
    expect(v.year).toBe('FY2026E');
    expect(v.tag).toBe('EPS test, FY2026E (first profitable year) · FMP consensus (non-GAAP)');
    expect(v.line).toMatch(/Verdict and breakeven use Year 2 \(FY2026E\); Year 1 —: Year 1 non-GAAP EPS not available: TDOC doesn’t report adjusted EPS\./);
  });
  test('premium solve: a forward reason ends the solve with it', () => {
    const r = highestAccretivePremium({ calcInputs: {}, spot: 10, synergyY1: 0, acquirerFwd: null, targetFwd: null, forwardReason: NO_GAAP_FORECAST, pnlLoading: false });
    expect(r).toEqual({ premium: null, reason: 'Year 2 is “—”: consensus is non-GAAP; no GAAP forecast.' });
  });
});

// Fix 10 Task 3: no forward year overlaps Year 1.
import { firstFiscalYearAfter } from '../forwardYears';
describe('Fix 10 Task 3 — no overlapping years', () => {
  const ng = { reportingBasis: NON_GAAP };
  test('first fiscal year that begins after Year 1 ends', () => {
    expect(firstFiscalYearAfter('2026-09-30', '2025-12-31')).toBe(2027);   // HNGE LTM: FY2026 began 1/1/2026, inside Year 1
    expect(firstFiscalYearAfter('2025-12-31', '2025-12-31')).toBe(2026);   // FY card: unchanged
    expect(firstFiscalYearAfter('2026-06-30', '2026-06-30')).toBe(2027);   // TEAM FY (June)
    expect(firstFiscalYearAfter('2026-09-30', '2026-06-30')).toBe(2028);   // TEAM LTM: FY2027 began 7/1/2026, inside Year 1
    expect(firstFiscalYearAfter('2025-12-27', '2025-12-27')).toBe(2026);   // PEP 52/53-week year
    expect(firstFiscalYearAfter(null, '2025-12-31')).toBeNull();
  });
  test('HNGE/TDOC on LTM: Year 2 = FY2027, Year 3 = FY2028, Year 4 "—" (beyond the three loaded years)', () => {
    const inputs = { ...ng, companyABasis: 'ltm', companyBBasis: 'ltm', companyALtmAsOf: '2026-09-30', companyBLtmAsOf: '2026-09-30',
      companyAFiscalYearEnd: '2025-12-31', companyBFiscalYearEnd: '2025-12-31' };
    const s = selectForwardYears({ inputs, acquirerFwd: hngeFwd, targetFwd: tdocFwd, acquirerName: 'HNGE', targetName: 'TDOC' });
    expect(s.slots.map(x => x.label)).toEqual(['FY2027E', 'FY2028E', 'FY2029E']);
    expect(s.slots.map(x => x.epsOk)).toEqual([true, true, false]);
    expect(s.slots[0].a.eps).toBe(3.12917);
    expect(s.slots[2].reason).toBe('FY2029 is beyond the three forecast years the deck loads (FY2026–FY2028)');
  });
  test('HNGE/TDOC on FY: Year 2 = FY2026, unchanged', () => {
    const s = selectForwardYears({ inputs: { ...fy, ...ng }, acquirerFwd: hngeFwd, targetFwd: tdocFwd });
    expect(s.slots.map(x => x.label)).toEqual(['FY2026E', 'FY2027E', 'FY2028E']);
  });
  test('each company is shifted on its own Year 1: a FY target beside an LTM acquirer keeps its own first year', () => {
    const inputs = { ...ng, companyABasis: 'ltm', companyALtmAsOf: '2026-09-30', companyAFiscalYearEnd: '2025-12-31', companyBBasis: 'fy', companyBFiscalYearEnd: '2025-12-31' };
    const s = selectForwardYears({ inputs, acquirerFwd: hngeFwd, targetFwd: tdocFwd });
    expect([s.slots[0].a.fy, s.slots[0].b.fy]).toEqual([2027, 2026]);
  });
});
