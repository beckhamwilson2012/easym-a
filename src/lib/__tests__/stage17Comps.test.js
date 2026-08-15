// Stage 17 — §2 comps revenue null-honesty (SectionComparables:39). Exercises the exported, pure
// buildCompany. Absent revenue → col.revenue null (→ "—" via fmtIntParens); a genuine reported 0 → 0
// (→ "0"); the three derived consumers (evRev, margins, mktCapSane-gated mktCap/EV) already render "—".
import { buildCompany } from '../../components/deck/sections/SectionComparables';

const peer = (over = {}) => ({
  revenue: 5000, shares: 300, livePrice: 42.5, debt: 600, cash: 400,
  operatingIncome: 800, grossProfit: 2000, freeCashFlow: 1500, netIncome: 500, eps: 2,
  name: 'Peer Co', dataSource: 'fmp', ...over,
});

describe('SectionComparables.buildCompany — Stage 17 revenue null-honesty', () => {
  it('ABSENT revenue → col.revenue null (renders "—"); all derived null', () => {
    const c = buildCompany('PEER', peer({ revenue: undefined }), false, 'Peer');
    expect(c.revenue).toBe(null);   // fmtIntParens(null) → "—"
    expect(c.evRev).toBe(null);
    expect(c.mktCap).toBe(null);
    expect(c.ev).toBe(null);
    expect(c.fcfMargin).toBe(null);
  });

  it('GENUINE reported 0 revenue → col.revenue 0 (renders "0"), NOT null', () => {
    const c = buildCompany('PEER', peer({ revenue: 0 }), false, 'Peer');
    expect(c.revenue).toBe(0);
    expect(c.revenue).not.toBe(null);
  });

  it('PRESENT revenue → col.revenue N; market cap & multiples compute', () => {
    const c = buildCompany('PEER', peer(), false, 'Peer');
    expect(c.revenue).toBe(5000);
    expect(c.mktCap).toBeGreaterThan(0);      // 42.5 × 300 = 12,750
    expect(c.evRev).toBeGreaterThan(0);
  });

  it('mktCapSane UNCHANGED (defect #5 untouched): mktCap/EV withheld for BOTH null and 0 revenue', () => {
    // `rev > 0` is false for null AND 0, so mktCapSane is identical either way — the fix does not move #5.
    const absent = buildCompany('PEER', peer({ revenue: undefined }), false, 'Peer');
    const zero   = buildCompany('PEER', peer({ revenue: 0 }), false, 'Peer');
    expect(absent.mktCap).toBe(null);
    expect(zero.mktCap).toBe(null);
    expect(absent.evRev).toBe(zero.evRev);   // both null — byte-identical behavior
  });
});
