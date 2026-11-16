import { computeAdjusted, computedLabel, computedComponentsText, taxBasisOf } from '../computedAdjusted';
import { TAX_RATE } from '../taxRate';
import { TAX_RATE as DEAL_TAX_RATE } from '../../utils/dealCalc';
import {
  GAAP, NON_GAAP, resolveReportingBasis, applyReportingBasis, nonGaapAvailability, epsBasisLabel, epsSourceText,
  combinedEbitdaLabel, ebitdaRow, computedSides,
} from '../reportingBasis';
import { BASIS_FY, BASIS_LTM } from '../companyBasis';

// TDOC FY2025 as /api/nongaap returns it (server/services/adjustedComponents.js), $M.
const TDOC_FY = {
  period: { kind: 'fy', label: 'FY2025', end: '2025-12-31', source: '10-K full year' },
  netIncome: -200, operatingIncome: -263, ebitda: 101, ebitdaReason: null,
  pretax: { key: 'pretax', label: 'GAAP pre-tax income', value: -235.53, concept: 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest' },
  sbc: { key: 'sbc', label: 'stock-based compensation', value: 80.414, concept: 'ShareBasedCompensation' }, sbcReason: null,
  amortization: { key: 'amortization', label: 'amortization of acquired intangibles', value: 183.147, concept: 'AmortizationOfIntangibleAssets (acquired-intangibles member)' },
  oneTime: [
    { key: 'restructuring', label: 'restructuring', value: 18.785, concept: 'RestructuringCharges' },
    { key: 'goodwillImpairment', label: 'goodwill impairment', value: 71.763, concept: 'GoodwillImpairmentLoss' },
    { key: 'acquisition', label: 'acquisition-related costs', value: 9.01, concept: 'BusinessCombinationAcquisitionRelatedCosts' },
  ],
  oneTimeNotFound: ['intangible asset impairment', 'long-lived asset impairment', 'integration costs', 'litigation settlements'],
  tax: { basis: 'default' },
};
const OMDA_LTM = {
  period: { kind: 'ltm', label: 'LTM to 2026-09-30', end: '2026-09-30' },
  netIncome: 14, operatingIncome: 7, ebitda: 13, ebitdaReason: null,
  pretax: { key: 'pretax', label: 'GAAP pre-tax income', value: 14, concept: 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest' },
  sbc: { key: 'sbc', label: 'stock-based compensation', value: 19.436, concept: 'ShareBasedCompensation' },
  amortization: null, amortizationReason: 'not tagged',
  oneTime: [], oneTimeNotFound: ['restructuring', 'goodwill impairment'], tax: { basis: 'default' },
};

describe('computeAdjusted — the one calculation', () => {
  test('TAX_RATE is the deal model’s constant, not a copy', () => {
    expect(TAX_RATE).toBe(DEAL_TAX_RATE);
  });

  test('TDOC FY2025 by hand: (GAAP pre-tax + SBC + acquired amortization + one-time) × (1 − 21%)', () => {
    const r = computeAdjusted(TDOC_FY, { dilutedShares: 176 });
    const addBacks = 80.414 + 183.147 + 18.785 + 71.763 + 9.01;   // 363.119
    expect(r.taxRate).toBe(0.21);
    expect(r.adjustedPretax).toBeCloseTo(-235.53 + addBacks, 6);   // 127.589
    expect(r.taxEffect).toBeCloseTo((-235.53 + addBacks) * 0.21, 6);
    expect(r.netIncome).toBeCloseTo((-235.53 + addBacks) * 0.79, 6);   // 100.795
    expect(r.ebitda).toBeCloseTo(101 + 80.414 + 18.785 + 71.763 + 9.01, 6);   // amortization is already in D&A
    expect(r.eps).toBeCloseTo(r.netIncome / 176, 9);
  });

  test('missing stock comp → net income, EBITDA and EPS are null ("—") with the reason, never 0', () => {
    const r = computeAdjusted({ ...TDOC_FY, sbc: null, sbcReason: 'stock-based compensation (ShareBasedCompensation) is not tagged for FY2025' }, { dilutedShares: 176 });
    expect(r.netIncome).toBeNull();
    expect(r.ebitda).toBeNull();
    expect(r.eps).toBeNull();
    expect(r.netIncomeReason).toMatch(/stock-based compensation \(ShareBasedCompensation\) is not tagged/);
    expect(r.epsReason).toMatch(/stock-based compensation/);
  });

  test('missing GAAP pre-tax income → null with the reason (never GAAP net income in its place); EBITDA still computes', () => {
    const r = computeAdjusted({ ...TDOC_FY, pretax: null, pretaxReason: 'GAAP pre-tax income (IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest) is not tagged for FY2025' }, { dilutedShares: 176 });
    expect(r.netIncome).toBeNull();
    expect(r.eps).toBeNull();
    expect(r.netIncomeReason).toMatch(/GAAP pre-tax income .* is not tagged for FY2025/);
    expect(r.ebitda).not.toBeNull();
  });

  test('missing D&A (GAAP EBITDA null) → adjusted EBITDA null with the reason', () => {
    const r = computeAdjusted({ ...TDOC_FY, ebitda: null, ebitdaReason: 'no D&A tagged' });
    expect(r.ebitda).toBeNull();
    expect(r.ebitdaReason).toBe('no D&A tagged');
  });

  test('an untagged one-time item is not added and is listed as not found', () => {
    const r = computeAdjusted(OMDA_LTM, { dilutedShares: 60 });
    expect(r.netIncome).toBeCloseTo((14 + 19.436) * 0.79, 9);   // only SBC: amortization and every one-time item untagged
    expect(r.ebitda).toBeCloseTo(13 + 19.436, 9);
    expect(r.addBacks.map((x) => x.key)).toEqual(['sbc']);
    expect(r.notFound).toEqual(['amortization of acquired intangibles', 'restructuring', 'goodwill impairment']);
    expect(computedComponentsText(r)).toMatch(/not tagged, not added: amortization of acquired intangibles, restructuring, goodwill impairment/);
  });

  test('a filed $0 item is found at $0 (a real zero), distinct from not tagged', () => {
    const r = computeAdjusted({ ...OMDA_LTM, oneTime: [{ key: 'goodwillImpairment', label: 'goodwill impairment', value: 0, concept: 'GoodwillImpairmentLoss' }], oneTimeNotFound: ['restructuring'] });
    expect(r.addBacks.map((x) => x.key)).toEqual(['sbc', 'goodwillImpairment']);
    expect(r.notFound).toEqual(['amortization of acquired intangibles', 'restructuring']);
  });

  test('a full valuation allowance is not "no tax": the app rate applies when no company rate is stated (Fix 16)', () => {
    const r = computeAdjusted({ ...OMDA_LTM, tax: { basis: 'valuation allowance', rate: 0 } });
    expect(r.taxRate).toBe(TAX_RATE);
    expect(r.taxBasis).toBe('default');
    expect(r.label).toBe('Computed by EasyM&A: (GAAP pre-tax income + stock comp + amortization + one-time items) × (1 − 21%, app’s tax rate)');
  });

  test('the company’s own disclosed non-GAAP rate wins over the default', () => {
    const r = computeAdjusted({ ...TDOC_FY, tax: { basis: 'disclosed', rate: 0.2, accession: 'x' } });
    expect(r.taxRate).toBe(0.2);
    expect(r.netIncome).toBeCloseTo((-235.53 + 363.119) * 0.8, 6);
    expect(r.label).toBe('Computed by EasyM&A: (GAAP pre-tax income + stock comp + amortization + one-time items) × (1 − 20%, company’s own non-GAAP rate)');
  });

  test('label text on the default rate', () => {
    expect(computedLabel(TDOC_FY)).toBe('Computed by EasyM&A: (GAAP pre-tax income + stock comp + amortization + one-time items) × (1 − 21%, app’s tax rate)');
    expect(taxBasisOf({}).rate).toBe(TAX_RATE);
  });

  test('no inputs → every figure null', () => {
    const r = computeAdjusted(null);
    expect([r.netIncome, r.ebitda, r.eps]).toEqual([null, null, null]);
  });
});

// ── Precedence and the deal plan (src/lib/reportingBasis.js) ──
const reported = (eps, ni, sh, extra = {}) => ({
  status: 'reported', fiscalYear: 2025, fiscalYearEnd: '2025-12-31', sourceAccession: 'acc',
  figures: {
    eps: { value: eps, rowLabel: 'Non-GAAP diluted EPS', label: 'non-GAAP, company reported, FY2025, acc', period: 'Year Ended December 31, 2025', accession: 'acc' },
    netIncome: { value: ni }, dilutedShares: { value: sh }, ebitda: extra.ebitda ? { value: extra.ebitda, name: 'Adjusted EBITDA', rowLabel: 'Adjusted EBITDA', label: 'non-GAAP, company reported' } : null,
  },
  reasons: { eps: null, netIncome: null, dilutedShares: null, ebitda: extra.ebitda ? null : 'no adjusted EBITDA row in the reconciliation tables' },
  computed: extra.computed || null,
});
const none = (computed) => ({
  status: 'none_reported', fiscalYear: 2025, fiscalYearEnd: '2025-12-31',
  figures: { eps: null, netIncome: null, dilutedShares: null, ebitda: null },
  reasons: { eps: 'no adjusted (non-GAAP) diluted EPS row in the reconciliation tables', netIncome: 'x', dilutedShares: 'x', ebitda: 'no adjusted EBITDA row in the reconciliation tables' },
  computed,
});
const inputsFY = { companyABasis: BASIS_FY, companyBBasis: BASIS_FY, companyADilutedShares: 85, companyBDilutedShares: 181, companyANetIncome: -528, companyBNetIncome: -200, companyAEPS: -7.77 };

describe('precedence: the company’s own reconciliation always wins', () => {
  test('reported EPS and reported EBITDA win over computed inputs for the same period', () => {
    const ngA = reported(2.62, 161.348, 61.471, { ebitda: 50, computed: { fy: { ...TDOC_FY }, ltm: null } });
    const ngB = reported(1, 100, 100);
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA, ngB, inputs: inputsFY, tickerA: 'HNGE', tickerB: 'X' });
    expect(plan.eps.nonGaap).toBe(true);
    expect(plan.eps.A.computed).toBeUndefined();
    expect(plan.eps.A.value).toBe(2.62);
    expect(plan.ebitda.A.computed).toBeUndefined();
    expect(plan.ebitda.A.value).toBe(50);
    expect(computedSides(plan)).toEqual([]);
    expect(epsBasisLabel(plan)).toBe('non-GAAP EPS');   // both reported: the existing label stands
  });

  test('no reported EPS → computed EPS on the Year 1 diluted count; reported side unchanged', () => {
    const ngA = reported(2.62, 161.348, 61.471);
    const ngB = none({ fy: TDOC_FY, ltm: null, reasons: {} });
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA, ngB, inputs: inputsFY, tickerA: 'HNGE', tickerB: 'TDOC' });
    expect(plan.eps.nonGaap).toBe(true);
    expect(plan.eps.B.computed).toBe(true);
    expect(plan.eps.B.dilutedShares).toBe(181);
    expect(plan.eps.B.value).toBeCloseTo(((-235.53 + 363.119) * 0.79) / 181, 9);
    expect(epsSourceText(plan)).toBe('HNGE: company reported; TDOC: Computed by EasyM&A: (GAAP pre-tax income + stock comp + amortization + one-time items) × (1 − 21%, app’s tax rate)');
    const out = applyReportingBasis(inputsFY, plan);
    expect(out.companyANetIncome).toBe(161.348);          // reported side as before
    expect(out.companyADilutedShares).toBe(61.471);
    expect(out.companyBNetIncome).toBeCloseTo((-235.53 + 363.119) * 0.79, 9);
    expect(out.companyBDilutedShares).toBe(181);          // computed side keeps the Year 1 count
  });

  test('LTM card: a fiscal-year reported figure does not cover the LTM period, so LTM is computed', () => {
    const ngA = reported(2.62, 161.348, 61.471, { computed: { fy: null, ltm: { ...OMDA_LTM, netIncome: 168, pretax: { ...OMDA_LTM.pretax, value: 168 }, ebitda: 156 } } });
    const ngB = none({ fy: null, ltm: OMDA_LTM });
    const inputs = { ...inputsFY, companyABasis: BASIS_LTM, companyBBasis: BASIS_LTM, companyADilutedShares: 85.073, companyBDilutedShares: 60 };
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA, ngB, inputs, tickerA: 'HNGE', tickerB: 'OMDA' });
    expect(plan.eps.nonGaap).toBe(true);
    expect(plan.eps.A.computed).toBe(true);
    expect(plan.eps.A.value).toBeCloseTo((168 + 19.436) * 0.79 / 85.073, 9);
    expect(plan.ebitda.A.computed).toBe(true);
    expect(plan.ebitda.B.computed).toBe(true);
    expect(plan.ebitda.combinable).toBe(true);
    expect(combinedEbitdaLabel(plan)).toEqual({ basis: 'non-GAAP', note: null, sources: expect.stringMatching(/^HNGE: Computed by EasyM&A.*; OMDA: Computed by EasyM&A/), short: 'HNGE computed by EasyM&A, OMDA computed by EasyM&A' });
    expect(ebitdaRow(plan, 'B').label).toBe('Adjusted EBITDA (non-GAAP, computed by EasyM&A)');
  });

  test('reported EBITDA beside computed EBITDA: combinable, footnote says which is which', () => {
    const ngA = reported(2.62, 161.348, 61.471, { computed: { fy: TDOC_FY } });
    const ngB = { ...none({ fy: TDOC_FY }), figures: { eps: null, netIncome: null, dilutedShares: null, ebitda: { value: 6.482, name: 'Adjusted EBITDA', rowLabel: 'Adjusted EBITDA', label: 'non-GAAP, company reported' } }, reasons: { eps: 'no adjusted (non-GAAP) diluted EPS row', ebitda: null } };
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA, ngB, inputs: inputsFY, tickerA: 'HNGE', tickerB: 'OMDA' });
    expect(plan.ebitda.A.computed).toBe(true);
    expect(plan.ebitda.B.computed).toBeUndefined();
    expect(plan.ebitda.B.value).toBe(6.482);
    expect(plan.ebitda.combinable).toBe(true);
    expect(combinedEbitdaLabel(plan).short).toBe('HNGE computed by EasyM&A, OMDA company reported');
  });

  test('no reported EPS and computed missing stock comp → Year 1 "—" with both reasons', () => {
    const ngA = reported(2.62, 161.348, 61.471);
    const ngB = none({ fy: { ...TDOC_FY, sbc: null, sbcReason: 'stock-based compensation (ShareBasedCompensation) is not tagged for FY2025' } });
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA, ngB, inputs: inputsFY, tickerA: 'HNGE', tickerB: 'TDOC' });
    expect(plan.eps.nonGaap).toBe(false);
    expect(plan.eps.note).toBe('Year 1 non-GAAP EPS not available: TDOC doesn’t report adjusted EPS, and its computed figure is “—”: stock-based compensation (ShareBasedCompensation) is not tagged for FY2025');
    const out = applyReportingBasis(inputsFY, plan);
    expect(out.companyBNetIncome).toBeNull();
  });

  test('GAAP selected: computed inputs are ignored and the inputs pass through as the same object', () => {
    const plan = resolveReportingBasis({ selected: GAAP, ngA: none({ fy: TDOC_FY }), ngB: none({ fy: TDOC_FY }), inputs: inputsFY });
    expect(applyReportingBasis(inputsFY, plan)).toBe(inputsFY);
  });

  test('the toggle offers Non-GAAP when only computed figures exist', () => {
    const av = nonGaapAvailability({ ngA: none({ fy: TDOC_FY }), ngB: none({ fy: null }), tickerA: 'A', tickerB: 'B' });
    expect(av.available).toBe(true);
    const off = nonGaapAvailability({ ngA: none(null), ngB: none(null), tickerA: 'A', tickerB: 'B' });
    expect(off.available).toBe(false);
  });
});

describe('footnote text', () => {
  test('negative GAAP base prints in parentheses; EBITDA text has no tax effect and no amortization', () => {
    const r = computeAdjusted(TDOC_FY, { dilutedShares: 176 });
    expect(computedComponentsText(r)).toMatch(/^FY2025: GAAP pre-tax income \(\$235\.5M\); stock-based compensation \$80\.4M \(ShareBasedCompensation\); amortization of acquired intangibles \$183\.1M/);
    expect(computedComponentsText(r)).toMatch(/adjusted pre-tax income \$127\.6M; tax \(\$26\.8M\) at 21%: the app’s 21% tax rate/);
    const e = computedComponentsText(r, { ebitda: true });
    expect(e).toMatch(/^FY2025: GAAP EBITDA \$101\.0M; stock-based compensation/);
    expect(e).not.toMatch(/amortization|tax|pre-tax/);
  });
});

// ── Fix 16: company-reported LTM, the sum of the last four quarterly releases, wins over a computed LTM figure ──
const q4 = (vals) => ['2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30'].map((end, i) => ({ end, value: vals[i], accession: `q${i}` }));
const ltmPayload = ({ eps, ni, ebitda, reasons = {} }) => ({
  asOf: '2026-09-30',
  eps: eps ? { value: eps.reduce((s, v) => s + v, 0), period: 'LTM to 2026-09-30 (sum of four quarters)', label: 'non-GAAP, company reported, LTM to 2026-09-30 (sum of four quarters): q0, q1, q2, q3', rowLabel: 'Non-GAAP EPS', quarters: q4(eps) } : null,
  netIncome: ni ? { value: ni.reduce((s, v) => s + v, 0), quarters: q4(ni) } : null,
  ebitda: ebitda ? { value: ebitda.reduce((s, v) => s + v, 0), name: 'Adjusted EBITDA', rowLabel: 'Adjusted EBITDA', label: 'non-GAAP, company reported, LTM', quarters: q4(ebitda) } : null,
  reasons: { eps: eps ? null : (reasons.eps || 'adjusted EPS and net income are not reported for every quarter: missing 2026-03-31'), ebitda: ebitda ? null : (reasons.ebitda || 'adjusted EBITDA is not reported for every quarter: missing 2025-12-31, 2026-03-31, 2026-06-30, 2026-09-30') },
});
describe('Fix 16: reported LTM first (four quarterly releases), computed only when not', () => {
  const inputsLTM = { ...inputsFY, companyABasis: BASIS_LTM, companyBBasis: BASIS_LTM, companyADilutedShares: 85, companyBDilutedShares: 65 };
  // HNGE: quarterly EPS 0.49 + 0.45 + 0.59 + 0.71 (8-K EX-99.1, filed); OMDA: quarterly Adjusted EBITDA 8.478 + 0.938 + 10.786 + 12.379.
  const ngA = { ...reported(2.62, 161.348, 61.471, { computed: { fy: null, ltm: { ...OMDA_LTM, netIncome: 168, pretax: { ...OMDA_LTM.pretax, value: 168 }, ebitda: 156 } } }), ltm: ltmPayload({ eps: [0.49, 0.45, 0.59, 0.71], ni: [41.127, 36.872, 49.147, 61.257] }) };
  const ngB = { ...none({ fy: null, ltm: OMDA_LTM }), figures: { eps: null, netIncome: null, dilutedShares: null, ebitda: { value: 6.482, name: 'Adjusted EBITDA', rowLabel: 'Adjusted EBITDA', label: 'non-GAAP, company reported, FY2025' } }, reasons: { eps: 'no adjusted (non-GAAP) diluted EPS row', ebitda: null }, ltm: ltmPayload({ ebitda: [8.478, 0.938, 10.786, 12.379] }) };

  test('HNGE LTM EPS is the sum of its four reported quarters, labeled company reported; Year 1 keeps its share count', () => {
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA, ngB, inputs: inputsLTM, tickerA: 'HNGE', tickerB: 'OMDA' });
    expect(plan.eps.nonGaap).toBe(true);
    expect(plan.eps.A.computed).toBeFalsy();
    expect(plan.eps.A.ltmReported).toBe(true);
    expect(Math.round(plan.eps.A.value * 100) / 100).toBe(2.24);
    expect(plan.eps.A.netIncome).toBeCloseTo(188.403, 9);
    expect(plan.eps.B.computed).toBe(true);   // OMDA reports no adjusted EPS in any quarter
    expect(epsSourceText(plan)).toMatch(/^HNGE: company reported, sum of four quarterly releases; OMDA: Computed by EasyM&A/);
    const out = applyReportingBasis(inputsLTM, plan);
    expect(out.companyAEPS).toBeCloseTo(2.24, 9);
    expect(out.companyANetIncome).toBeCloseTo(188.403, 9);
    expect(out.companyADilutedShares).toBe(85);   // not replaced: the four-quarter sum has no single filed count
  });

  test('OMDA LTM Adjusted EBITDA is the sum of its four reported quarters; the FY figure is kept for its own column', () => {
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA, ngB, inputs: inputsLTM, tickerA: 'HNGE', tickerB: 'OMDA' });
    expect(plan.ebitda.B.ltmReported).toBe(true);
    expect(plan.ebitda.B.computed).toBeFalsy();
    expect(plan.ebitda.B.value).toBeCloseTo(32.581, 9);
    expect(plan.ebitda.B.fyValue).toBe(6.482);
    expect(plan.ebitda.A.computed).toBe(true);   // HNGE reports no adjusted EBITDA
    expect(plan.ebitda.combinable).toBe(true);
    expect(ebitdaRow(plan, 'B').label).toBe('Adjusted EBITDA (non-GAAP, LTM, sum of four quarters)');
    expect(applyReportingBasis(inputsLTM, plan).companyBEBITDA).toBeCloseTo(32.581, 9);
  });

  test('a quarter missing → no reported LTM; the computed figure is used and says so', () => {
    const a3 = { ...ngA, ltm: ltmPayload({}) };
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA: a3, ngB, inputs: inputsLTM, tickerA: 'HNGE', tickerB: 'OMDA' });
    expect(plan.eps.A.computed).toBe(true);
    expect(plan.eps.A.value).toBeCloseTo((168 + 19.436) * 0.79 / 85, 9);
  });

  test('a fiscal-year card never uses the LTM sum', () => {
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA, ngB: reported(1, 100, 100), inputs: inputsFY, tickerA: 'HNGE', tickerB: 'X' });
    expect(plan.eps.A.value).toBe(2.62);
    expect(plan.eps.A.ltmReported).toBeFalsy();
  });

  test('the toggle offers Non-GAAP on a reported LTM figure alone', () => {
    const only = { ...none(null), ltm: ltmPayload({ ebitda: [1, 2, 3, 4] }) };
    expect(nonGaapAvailability({ ngA: only, ngB: none(null) }).available).toBe(true);
  });
});

describe('Fix 16: a private counterparty means no computed figures', () => {
  test('HNGE tuck-in (private target, no payload): HNGE EBITDA stays GAAP computed, so the combined EBITDA is on one basis', () => {
    const ngA = reported(2.62, 161.348, 61.471, { computed: { fy: null, ltm: { ...OMDA_LTM, netIncome: 168, pretax: { ...OMDA_LTM.pretax, value: 168 }, ebitda: 156 } } });
    const inputs = { ...inputsFY, companyABasis: BASIS_LTM, companyBBasis: BASIS_LTM, companyADilutedShares: 85 };
    const plan = resolveReportingBasis({ selected: NON_GAAP, ngA, ngB: null, inputs, tickerA: 'HNGE', tickerB: null });
    expect(plan.ebitda.A.nonGaap).toBe(false);
    expect(plan.ebitda.combinable).toBe(true);
    expect(plan.eps.nonGaap).toBe(false);
    expect(plan.eps.note).toBe('Year 1 non-GAAP EPS not available: the target doesn’t report adjusted EPS');   // the pre-Fix 13 wording
    // Both public: unchanged (HNGE computed).
    const both = resolveReportingBasis({ selected: NON_GAAP, ngA, ngB: none({ fy: null, ltm: OMDA_LTM }), inputs: { ...inputs, companyBDilutedShares: 65 }, tickerA: 'HNGE', tickerB: 'OMDA' });
    expect(both.ebitda.A.computed).toBe(true);
  });
});
