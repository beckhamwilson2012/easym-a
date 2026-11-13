// Task 6 (FIX7A): text a CFO saw. The narrative never prints "$null" or "Company B"; the toggle says, in one line, why
// Non-GAAP changes nothing for a pair; the payloads are the live HNGE / TDOC / OMDA / PGNY /api/nongaap results.
import { buildNarrative } from '../../utils/dealCalc';
import { NON_GAAP, GAAP, resolveReportingBasis } from '../reportingBasis';
import { BASIS_LTM } from '../companyBasis';

const payload = ({ eps = null, ni = null, sh = null, ebitda = null, ebitdaReason }) => ({
  status: 'reported', fiscalYear: 2025, fiscalYearEnd: '2025-12-31', sourceAccession: 'acc',
  figures: {
    eps: eps != null ? { value: eps } : null, netIncome: ni != null ? { value: ni } : null,
    dilutedShares: sh != null ? { value: sh } : null, ebitda: ebitda != null ? { value: ebitda, name: 'Adjusted EBITDA' } : null,
  },
  reasons: {
    eps: eps != null ? null : 'no adjusted (non-GAAP) diluted EPS row in the reconciliation tables',
    netIncome: ni != null ? null : 'no non-GAAP net income row in the reconciliation tables',
    dilutedShares: sh != null ? null : 'no adjusted EPS',
    ebitda: ebitda != null ? null : (ebitdaReason || 'no adjusted EBITDA row in the reconciliation tables'),
  },
});
const HNGE = payload({ eps: 2.62, ni: 161.348, sh: 61.471 });
const TDOC = payload({ ebitdaReason: "reconciliation doesn't tie: 481418.14 (EBITDA, table 0, Adjusted EBITDA (1))" });
const OMDA = payload({ ebitda: 6.482 });

describe('buildNarrative', () => {
  const base = { totalPurchasePrice: 1149, isAccretive: false, basesDiffer: false };

  test('OMDA before Task 2: pro forma EPS null → the EPS clause is dropped, no "$null"', () => {
    const t = buildNarrative({ ...base, companyAEPS: 1.98, proFormaEPS: null, epsChangePct: null }, { offerPricePerShare: 19.81 }, 'Hinge Health, Inc.', 'Omada Health, Inc.', []);
    expect(t).toBe("Hinge Health, Inc.'s acquisition of Omada Health, Inc. at $19.81/share ($1.1B total).");
    expect(t).not.toMatch(/null/);
  });

  test('private target: the deck name, never "Company B"; no "$0.00/share"; "non-positive" only for a non-positive base', () => {
    const t = buildNarrative({ ...base, totalPurchasePrice: 300, companyAEPS: 1.98, proFormaEPS: 1.99, epsChangePct: null }, { offerPricePerShare: 0, offerValueTotal: 300 }, 'Hinge Health, Inc.', 'Target Company', []);
    expect(t).toBe("Hinge Health, Inc.'s acquisition of Target Company for $300M moves pro forma EPS from $1.98 to $1.99.");   // Fix 7b: "for $300M"
    expect(t).not.toMatch(/Company B|\$0\.00|non-positive/);
  });

  test('no name at all still never says "Company B"', () => {
    const t = buildNarrative({ ...base, companyAEPS: -7.77, proFormaEPS: -9.57, epsChangePct: null }, { offerPricePerShare: 0 }, '', '', []);
    expect(t).not.toMatch(/Company [AB]/);
    expect(t).toMatch(/non-positive EPS base/);
  });

  test('known values print exactly as before (public deck, % change)', () => {
    const t = buildNarrative({ ...base, totalPurchasePrice: 3938, companyAEPS: 1.98, proFormaEPS: 1.87, epsChangePct: -5.4 }, { offerPricePerShare: 47.45 }, 'Hinge Health, Inc.', 'Progyny, Inc.', []);
    expect(t).toBe("Hinge Health, Inc.'s acquisition of Progyny, Inc. at $47.45/share ($3.9B total) would be dilutive, decreasing EPS by 5.4% from $1.98 to $1.87.");
  });
});

describe('reporting-basis toggle: one line when Non-GAAP changes nothing', () => {
  test('HNGE/TDOC: names who lacks what; TDOC\'s EBITDA is "doesn\'t tie", never "doesn\'t report"', () => {
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA: HNGE, ngB: TDOC, inputs: {}, tickerA: 'HNGE', tickerB: 'TDOC' });
    expect(plan.noChange).toBe('On Non-GAAP, Year 1 EPS is “—” (TDOC doesn’t report adjusted EPS) and the forward years use FMP consensus (non-GAAP). EBITDA stays computed: HNGE doesn’t report adjusted EBITDA; TDOC’s adjusted EBITDA doesn’t tie to GAAP in its release.');
  });

  test('HNGE/OMDA: OMDA\'s Adjusted EBITDA is a real change → no "nothing" line', () => {
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA: HNGE, ngB: OMDA, inputs: {}, tickerA: 'HNGE', tickerB: 'OMDA' });
    expect(plan.noChange).toBeNull();
    expect(plan.ebitda.B.nonGaap).toBe(true);
  });

  test('both report adjusted EPS but a card is on LTM, and neither reports EBITDA → the line says why EPS stays GAAP', () => {
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA: HNGE, ngB: HNGE, inputs: { companyABasis: BASIS_LTM }, tickerA: 'HNGE', tickerB: 'X' });
    expect(plan.noChange).toMatch(/^On Non-GAAP, Year 1 EPS is “—” \(non-GAAP available for fiscal year only\)/);
  });

  test('GAAP selected: no line', () => {
    expect(resolveReportingBasis({ selected: GAAP, ngA: HNGE, ngB: TDOC, inputs: {} }).noChange).toBeUndefined();
  });
});
