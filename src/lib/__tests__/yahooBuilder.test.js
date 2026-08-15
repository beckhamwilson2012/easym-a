/** @jest-environment node */
// Stage 14 — the ONLY end-to-end proof of the Yahoo wrap→boundary→null path. No live ticker reaches
// the Yahoo builder in this environment (FMP shadows it; when reached, Yahoo 429s), so we exercise the
// REAL buildYahooCompany — extracted from fetchFromYahoo and exported from server.js — against mocked
// quoteSummary payloads. Runtime require (not a static import) sidesteps CRA's outside-src module guard.
const path = require('path');
const { buildYahooCompany } = require(path.resolve(__dirname, '../../../server'));
const { unwrapCompany } = require('../financialSchema');

// A Yahoo quoteSummary `result` with revenue+shares+eps+price PRESENT but ebitda/cash/debt ABSENT.
const partial = () => ({
  financialData: {
    totalRevenue: { raw: 5_000_000_000 },   // present → 5000M
    // ebitda / totalCash / totalDebt: intentionally absent
    currentPrice: { raw: 42.5 },
  },
  defaultKeyStatistics: { sharesOutstanding: { raw: 300_000_000 }, trailingEps: { raw: 1.23 } },
  incomeStatementHistory: { incomeStatementHistory: [{ netIncome: { raw: 800_000_000 } }] },
  quoteType: { longName: 'Mock Foreign Co' },
});

describe('buildYahooCompany — wrap→boundary→null (mocked payload)', () => {
  it('MISSING field → {value:null, status:"missing"}, NOT {value:0, status:"verified"}', () => {
    const c = buildYahooCompany(partial(), 'MOCK');
    for (const k of ['ebitda', 'cash', 'debt']) {
      expect(c[k]).toEqual(expect.objectContaining({ value: null, status: 'missing' }));
      expect(c[k]).not.toEqual(expect.objectContaining({ value: 0, status: 'verified' }));
    }
  });

  it('PRESENT field → {value:N, status:"verified"}', () => {
    const c = buildYahooCompany(partial(), 'MOCK');
    expect(c.revenue).toEqual(expect.objectContaining({ value: 5000, status: 'verified', source: 'yahoo' }));
    expect(c.shares).toEqual(expect.objectContaining({ value: 300, status: 'verified' }));
    expect(c.eps).toEqual(expect.objectContaining({ value: 1.23, status: 'verified' }));
  });

  it('a GENUINE reported 0 → {value:0, status:"verified"} (not over-corrected to missing)', () => {
    const p = partial(); p.financialData.totalDebt = { raw: 0 };   // company genuinely reports zero debt
    const c = buildYahooCompany(p, 'MOCK');
    expect(c.debt).toEqual(expect.objectContaining({ value: 0, status: 'verified' }));
    expect(c.debt.value).not.toBe(null);
  });

  it('the usability guard returns null when BOTH revenue and shares are absent', () => {
    const empty = { financialData: {}, defaultKeyStatistics: {}, incomeStatementHistory: { incomeStatementHistory: [{}] }, quoteType: {} };
    expect(buildYahooCompany(empty, 'EMPTY')).toBe(null);
  });

  it('a partial response (revenue present, shares absent) is KEPT, not discarded', () => {
    const p = partial(); delete p.defaultKeyStatistics.sharesOutstanding; // shares absent, revenue present
    expect(buildYahooCompany(p, 'MOCK')).not.toBe(null);
  });

  it('END TO END: unwrapCompany(build) → bare number-or-null (missing→null, present→N, real 0→0)', () => {
    const p = partial(); p.financialData.totalDebt = { raw: 0 };
    const bare = unwrapCompany(buildYahooCompany(p, 'MOCK'));
    expect(bare.revenue).toBe(5000);       // present → number
    expect(bare.ebitda).toBe(null);        // missing → null (was a fabricated 0 pre-Stage-14)
    expect(bare.cash).toBe(null);          // missing → null
    expect(bare.debt).toBe(0);             // genuine 0 → 0 (survives)
    expect(bare.dataSource).toBe('yahoo'); // bare string passthrough
  });
});
