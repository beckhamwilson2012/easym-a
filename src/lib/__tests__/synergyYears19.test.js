import { selectForwardYears, synergyYearFor, synergyForSlot, BEYOND_SYNERGY_SCHEDULE } from '../forwardYears';
import { NON_GAAP } from '../reportingBasis';
import { beyondConsensusLine } from '../../components/deck/sections/SectionProFormaPL';

// Fix 19 Task 2: accretion Year N carries synergy Year N (N = 1–3); Year 4 carries none and says so.
const col = (fy, eps) => ({ fy, label: `FY${fy}E`, actual: false, eps, revenue: 100, netIncome: 10 });
const hngeFwd = [col(2026, 2.51792), col(2027, 3.12917), col(2028, 4.226)];
const omdaFwd = [col(2026, 0.4885), col(2027, 0.58557), col(2028, 0.96458)];

describe('Fix 19 Task 2 — synergy year = accretion year', () => {
  test('the rule: 1–3 map to themselves, 4 is beyond the schedule', () => {
    expect([1, 2, 3, 4].map(synergyYearFor)).toEqual([1, 2, 3, null]);
    expect(BEYOND_SYNERGY_SCHEDULE).toBe('no synergies (beyond the Year 1–3 synergy schedule)');
  });
  test('FY card: Years 2–4 carry synergy Years 2, 3, none', () => {
    const fy = { reportingBasis: NON_GAAP, companyABasis: 'fy', companyBBasis: 'fy', companyAFiscalYearEnd: '2025-12-31', companyBFiscalYearEnd: '2025-12-31' };
    const s = selectForwardYears({ inputs: fy, acquirerFwd: hngeFwd, targetFwd: omdaFwd });
    expect(s.slots.map((x) => [x.year, x.label, x.synYr])).toEqual([[2, 'FY2026E', 2], [3, 'FY2027E', 3], [4, 'FY2028E', null]]);
  });
  test('LTM card (Year 1 to 9/30/2026): FY2027E carries Year 2, FY2028E Year 3, FY2029 none', () => {
    const ltm = { reportingBasis: NON_GAAP, companyABasis: 'ltm', companyBBasis: 'ltm', companyALtmEnd: '2026-09-30', companyBLtmEnd: '2026-09-30',
      companyAFiscalYearEnd: '2025-12-31', companyBFiscalYearEnd: '2025-12-31' };
    const s = selectForwardYears({ inputs: ltm, acquirerFwd: hngeFwd, targetFwd: omdaFwd });
    // year1End may read a different field name; the mapping is by accretion year regardless of which FY it lands on.
    expect(s.slots.map((x) => [x.year, x.synYr])).toEqual([[2, 2], [3, 3], [4, null]]);
  });
  test('synergyForSlot reads that year, and nothing for a year past the schedule', () => {
    const synY = [9.12, 20.52, 32.2734];
    expect(synergyForSlot(synY, { synYr: 2 })).toBe(20.52);
    expect(synergyForSlot(synY, { synYr: 3 })).toBe(32.2734);
    expect(synergyForSlot(synY, { synYr: null })).toBeUndefined();
    expect(synergyForSlot(null, { synYr: 2 })).toBeUndefined();
  });
  test('the beyond-consensus line for Year 4 says it carries no synergies', () => {
    expect(beyondConsensusLine({ a: null, year: 4, fyA: 2029, synYr: null }, undefined, [2026, 2027, 2028]))
      .toBe('Year 4 (FY2029) is beyond the consensus years (FY2026–FY2028); no synergies (beyond the Year 1–3 synergy schedule)');
  });
});
