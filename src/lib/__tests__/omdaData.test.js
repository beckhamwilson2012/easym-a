// Fix 14 Task 5: OMDA data on the Target Profile and the target P&L.
import { segmentMismatch } from '../../components/deck/sections/SectionTargetOverview';
import { resolveReportingBasis } from '../reportingBasis';
import { dealNonGaap } from '../../components/deck/shared/deckTokens';

const FY = [{ fy: 2023, revenue: 123 }, { fy: 2024, revenue: 170 }, { fy: 2025, revenue: 260 }];

describe('segments must sum to filed revenue within 2%', () => {
  test('OMDA FY2025: $278.5M of segments against $260M filed → not shown, with both figures', () => {
    const seg = { ok: true, year: '2025', converted: false, segments: [{ label: 'Service', value: 241043000 }, { label: 'Hardware', value: 37432000 }] };
    const m = segmentMismatch(seg, FY);
    expect(m.revenue).toBe(260);
    expect(m.sum).toBeCloseTo(278.475, 6);
  });
  test('within 2% → shown; no filed revenue for the year, or converted currency → not checked', () => {
    expect(segmentMismatch({ ok: true, year: '2025', segments: [{ label: 'A', value: 200e6 }, { label: 'B', value: 62e6 }] }, FY)).toBeNull();
    expect(segmentMismatch({ ok: true, year: '2022', segments: [{ label: 'A', value: 999e6 }] }, FY)).toBeNull();
    expect(segmentMismatch({ ok: true, year: '2025', converted: true, segments: [{ label: 'A', value: 999e6 }] }, FY)).toBeNull();
  });
});

describe('a fiscal-year adjusted EBITDA on an LTM card', () => {
  const omda = { figures: { ebitda: { value: 6.482, name: 'Adjusted EBITDA', rowLabel: 'Adjusted EBITDA', label: 'non-GAAP, company reported, FY2025, 0001628280-26-015153' } }, fiscalYear: 2025, reasons: {} };
  test('the deal still has no LTM figure (value null) but the FY2025 figure is kept for its own column', () => {
    const plan = resolveReportingBasis({ selected: 'Non-GAAP', ngA: { figures: {}, reasons: {} }, ngB: omda, inputs: { companyABasis: 'ltm', companyBBasis: 'ltm' }, tickerA: 'HNGE', tickerB: 'OMDA' });
    expect(plan.ebitda.B.value).toBeNull();
    expect(plan.ebitda.B.fyValue).toBe(6.482);
    const ng = dealNonGaap({ reportingBasis: plan }, 'B');
    expect(ng.ebitda).toMatchObject({ value: null, fyValue: 6.482, fiscalYear: 2025 });
  });
});
