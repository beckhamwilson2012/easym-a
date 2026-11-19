// Fix 22 Task 2: the market cap check compares two market caps, and never removes a figure.
import { buildCompany, comparablesCellText, marketCapNote } from '../../components/deck/sections/SectionComparables';
import { marketCapCheck } from '../marketCap';

// GM-shaped: profitable and worth well under 0.8× revenue, which the old rule blanked.
const gm = (over = {}) => ({ revenue: 185000, shares: 930, livePrice: 80, debt: 130000, cash: 20000, operatingIncome: 9000, netIncome: 6000, eps: 6, name: 'General Motors', ...over });
const EQ = { label: 'Equity Value', get: (c) => c.mktCap, fmt: (v) => (v == null ? '—' : Math.round(v).toLocaleString()), flagged: (c) => c.mktCapFlagged };

describe('marketCapCheck', () => {
  test('within 25%: not flagged; just over: flagged; both directions', () => {
    expect(marketCapCheck(125, 100).flagged).toBe(false);
    expect(marketCapCheck(75, 100).flagged).toBe(false);
    expect(marketCapCheck(125.1, 100).flagged).toBe(true);
    expect(marketCapCheck(74.9, 100).flagged).toBe(true);
  });
  test('no independent figure: not checked, not flagged, and never a zero', () => {
    const r = marketCapCheck(100, null);
    expect(r).toMatchObject({ checked: false, flagged: false, appCapM: 100, independentCapM: null, diffPct: null });
    expect(marketCapCheck(100, 0).checked).toBe(false);
    expect(marketCapCheck(null, 100).checked).toBe(false);
  });
});

describe('buildCompany', () => {
  test('a real company under 0.8× revenue keeps equity value and EV, unflagged', () => {
    const c = buildCompany('GM', gm({ profile: { marketCapM: 74400 } }), false);
    expect(c.mktCap).toBe(74400);
    expect(c.ev).toBe(184400);
    expect(c.mktCapFlagged).toBe(false);
    expect(comparablesCellText(EQ, c)).toBe('74,400');
    expect(marketCapNote([c])).toBeNull();
  });
  test('planted unit error (shares × 1000) is flagged, keeps its figures, and the legend gives both caps', () => {
    const c = buildCompany('GM', gm({ shares: 930000, profile: { marketCapM: 74400 } }), false);
    expect(c.mktCapFlagged).toBe(true);
    expect(c.mktCap).toBe(74400000);
    expect(c.ev).toBe(74510000);
    expect(comparablesCellText(EQ, c)).toBe('74,400,000 ⚠');
    expect(marketCapNote([c])).toContain('GM: price × shares $74,400,000M vs FMP market cap $74,400M');
    expect(marketCapNote([c])).toContain('more than 25%');
  });
  test('no FMP figure: figures stay, no ⚠, and the legend says the check did not run', () => {
    const c = buildCompany('GM', gm(), false);
    expect(c.mktCap).toBe(74400);
    expect(comparablesCellText(EQ, c)).toBe('74,400');
    expect(marketCapNote([c])).toBe('Market cap check not run for GM: no FMP market cap.');
  });
  test('an FMP-sourced company is never compared with FMP itself', () => {
    const c = buildCompany('TM', gm({ dataSource: 'fmp', profile: { marketCapM: 74400 } }), false);
    expect(c.capCheck.checked).toBe(false);
    expect(c.mktCapFlagged).toBe(false);
    expect(c.mktCap).toBe(74400);
    expect(marketCapNote([c])).toBe("Market cap check not run for TM: the share count comes from FMP's own market cap, so there is no independent figure.");
  });
  test('no price: nothing to check and nothing printed', () => {
    const c = buildCompany('GM', gm({ livePrice: null, profile: { marketCapM: 74400 } }), false);
    expect(c.mktCap).toBeNull();
    expect(c.mktCapFlagged).toBe(false);
    expect(marketCapNote([c])).toBeNull();
  });
});
