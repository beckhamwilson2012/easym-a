// Comparables never mix FY and LTM in one column unmarked: a cell that fell back from LTM to the fiscal year says so.
import { buildCompany, comparablesCellText, anyFyFallback, fiscalYearLabel, FY_FALLBACK_NOTE } from '../SectionComparables';

const pct = (v) => (v == null ? '—' : `${v.toFixed(1)}%`);
const passthru = (v) => (v == null ? '—' : v);
const GM  = { label: 'Gross Margin', get: (c) => c.grossMargin, fmt: pct, nm: (c) => c.grossNm, fyKey: 'grossMargin' };
const REV = { label: 'Revenue', get: (c) => c.revenue, fmt: (v) => (v == null ? '—' : Math.round(v).toLocaleString()), fyKey: 'revenue' };
const PE  = { label: 'P / E', get: (c) => c.peCell, fmt: passthru, fyKey: 'peCell' };
const EBITDA = { label: 'EV / EBITDA', get: (c) => c.evEbitCell, fmt: passthru, fyKey: 'evEbitCell' };
const GROWTH = { label: 'Revenue Growth', get: (c) => c.revGrowthProj, fmt: pct };

// Crown Castle as /quote returns it after fix 2c: trusted LTM, LTM gross profit null, FY figures from its 10-K.
const cci = (over = {}) => ({
  name: 'Crown Castle', revenue: 4264, grossProfit: 3159, operatingIncome: 2075, ebitda: 2765, eps: 2.5, shares: 435, cash: 100, debt: 20000,
  fiscalYearEnd: '2025-12-31', sic: '6798', livePrice: 100,
  ltm: { trusted: true, asOf: '2026-06-30', revenue: 4084, grossProfit: null, operatingIncome: 2000, ebitda: 2700, eps: 2.4, netIncome: 1000 },
  ...over,
});

describe('FY fallback markers', () => {
  test('CCI: LTM gross margin unavailable → the FY margin is shown and marked "74.1% FY25"', () => {
    const c = buildCompany('CCI', cci(), true, 'Crown Castle');
    expect(comparablesCellText(GM, c)).toBe('74.1% FY25');
    expect(comparablesCellText(REV, c)).toBe('4,084');               // LTM revenue is there: no marker
  });
  test('no trusted LTM: every LTM-labeled cell that shows a figure is marked', () => {
    const c = buildCompany('SAP', cci({ ltm: { trusted: false } }), false);
    expect(comparablesCellText(REV, c)).toBe('4,264 FY25');
    expect(comparablesCellText(GM, c)).toBe('74.1% FY25');
    expect(comparablesCellText(PE, c)).toMatch(/x FY25$/);
    expect(comparablesCellText(EBITDA, c)).toMatch(/x FY25$/);
  });
  test('LTM figures present: no marker anywhere', () => {
    const c = buildCompany('X', cci({ ltm: { trusted: true, asOf: '2026-06-30', revenue: 4084, grossProfit: 3000, operatingIncome: 2000, ebitda: 2700, eps: 2.4 } }), false);
    [GM, REV, PE, EBITDA].forEach((m) => expect(comparablesCellText(m, c)).not.toMatch(/FY/));
  });
  test('"—", "n/m" and "⚠" carry no marker: they are not figures', () => {
    const none = buildCompany('X', cci({ grossProfit: null, ltm: { trusted: false } }), false);
    expect(comparablesCellText(GM, none)).toBe('—');
    const insurer = buildCompany('UNH', cci({ sic: '6324' }), false);
    expect(comparablesCellText(GM, insurer)).toBe('n/m');
    expect(comparablesCellText({ ...REV, flagged: () => true }, insurer)).toBe('⚠');
  });
  test('rows with no LTM label (forward growth) are never marked', () => {
    const c = buildCompany('X', cci({ ltm: { trusted: false } }), false);
    expect(comparablesCellText(GROWTH, c)).not.toMatch(/FY/);
  });
  test('the values themselves do not change: the marker is text only', () => {
    expect(buildCompany('CCI', cci(), true).grossMargin).toBeCloseTo(3159 / 4264 * 100, 6);
  });
  test('fiscal year label: the year end\'s calendar year, then the FMP fallback\'s, else plain "FY"', () => {
    expect(fiscalYearLabel({ fiscalYearEnd: '2026-01-31' })).toBe('FY26');
    expect(fiscalYearLabel({ revenueTrace: { fiscalYearEnd: '2025-12-31' } })).toBe('FY25');
    expect(fiscalYearLabel({ fmpPeriodEnd: '2026-03-31' })).toBe('FY26');
    expect(fiscalYearLabel({})).toBe('FY');
  });
  test('the footnote is printed exactly when a marked cell is on the slide', () => {
    const marked = buildCompany('CCI', cci(), true), clean = buildCompany('X', cci({ ltm: { ...cci().ltm, grossProfit: 3000 } }), false);
    expect(anyFyFallback([GM], [marked, clean])).toBe(true);
    expect(anyFyFallback([GM], [clean])).toBe(false);
    expect(anyFyFallback([GROWTH], [marked])).toBe(false);
    expect(FY_FALLBACK_NOTE).toBe('FY figure shown where LTM is unavailable');
  });
});
