/** @jest-environment node */
// Stage 15 — the PRIMARY proof of the FMP wrap→boundary→null path (no live-canary sweep; 12 major FMP
// tickers all have complete data). Calls the REAL buildFmpCompany against mocked FMP income/balance/profile.
// USD payloads → resolveFmpRates is a strict no-op (rates 1, no network). Runtime require sidesteps CRA's
// outside-src guard.
const path = require('path');
const { buildFmpCompany, toMillions } = require(path.resolve(__dirname, '../../../server'));
const { unwrapCompany } = require('../financialSchema');

const income  = (over = {}) => ({ revenue: 5_000_000_000, netIncome: 800_000_000, eps: 1.23,
  ebitda: 1_200_000_000, operatingIncome: 900_000_000, depreciationAndAmortization: 300_000_000,
  grossProfit: 2_000_000_000, weightedAverageShsOutDil: 305_000_000, reportedCurrency: 'USD', date: '2024-12-31', ...over });
const balance = (over = {}) => ({ cashAndCashEquivalents: 400_000_000, totalDebt: 600_000_000, reportedCurrency: 'USD', ...over });
const profile = (over = {}) => ({ companyName: 'Mock FMP Co', sharesOutstanding: 300_000_000, price: 42.5, marketCap: 12_750_000_000, currency: 'USD', ...over });

describe('buildFmpCompany — wrap→boundary→null (mocked FMP payload)', () => {
  it('MISSING sharesOutstanding / ebitda / debt → {value:null, status:"missing"}', async () => {
    const c = await buildFmpCompany(
      income({ ebitda: undefined, operatingIncome: undefined, depreciationAndAmortization: undefined }),
      balance({ totalDebt: undefined, longTermDebt: undefined }),
      profile({ sharesOutstanding: undefined, marketCap: undefined }),   // shares underivable
      'MOCK');
    for (const k of ['ebitda', 'debt', 'shares']) {
      expect(c[k]).toEqual(expect.objectContaining({ value: null, status: 'missing' }));
    }
  });

  it('shares specifically → null, NOT 0 (server-honest)', async () => {
    const c = await buildFmpCompany(income(), balance(),
      profile({ sharesOutstanding: undefined, marketCap: undefined }), 'MOCK');
    expect(c.shares.value).toBe(null);
    expect(c.shares.value).not.toBe(0);
    expect(c.shares.status).toBe('missing');
  });

  it('PRESENT field → {value:N, status:"verified", source:"fmp"}', async () => {
    const c = await buildFmpCompany(income(), balance(), profile(), 'MOCK');
    expect(c.revenue).toEqual(expect.objectContaining({ value: 5000, status: 'verified', source: 'fmp' }));
    expect(c.shares).toEqual(expect.objectContaining({ value: 300, status: 'verified' }));
  });

  it('a GENUINE reported 0 debt → {value:0, status:"verified"} (survives)', async () => {
    const c = await buildFmpCompany(income(), balance({ totalDebt: 0, longTermDebt: undefined }), profile(), 'MOCK');
    expect(c.debt).toEqual(expect.objectContaining({ value: 0, status: 'verified' }));
    expect(c.debt.value).not.toBe(null);
  });

  // E3 — guard audit on the four shapes (mirrors the :816 rewrite `!(revenueM>0) && !(sharesM>0)`)
  it('guard: both-absent → null (falls through); one-present → kept; both-present → kept', async () => {
    const empty   = await buildFmpCompany(income({ revenue: undefined }), balance(), profile({ sharesOutstanding: undefined, marketCap: undefined }), 'E');
    const revOnly = await buildFmpCompany(income(),                        balance(), profile({ sharesOutstanding: undefined, marketCap: undefined }), 'R');
    const both    = await buildFmpCompany(income(),                        balance(), profile(), 'B');
    expect(empty).toBe(null);            // both revenue & shares absent → fall through the waterfall
    expect(revOnly).not.toBe(null);      // revenue present, shares absent → kept
    expect(both).not.toBe(null);
  });

  // E4 — INERTNESS chain, as a defect report, not a fix: server honest → read site re-coerces → $0
  it('E4 defect chain: null shares → App.js:781 (price*null) → 0 → §B renders $0 (read-site phase)', async () => {
    const c = await buildFmpCompany(income(), balance(),
      profile({ sharesOutstanding: undefined, marketCap: undefined }), 'MOCK');
    const bare = unwrapCompany(c);
    expect(c.shares).toEqual(expect.objectContaining({ value: null, status: 'missing' })); // server: honest
    expect(bare.shares).toBe(null);                                                          // boundary: null
    const price = 42.5;
    expect(price * bare.shares).toBe(0);   // App.js:781 currentMarketCap = price * null → 0 (NOT NaN)
    // → §B "Equity value (mkt cap)" renders "$0M", not "—". VISIBLY INERT pending the read-site guard.
  });

  it('END TO END: unwrapCompany → bare (present→N, missing→null, real 0→0)', async () => {
    const bare = unwrapCompany(await buildFmpCompany(
      income({ ebitda: undefined, operatingIncome: undefined, depreciationAndAmortization: undefined }),
      balance({ totalDebt: 0, longTermDebt: undefined }), profile(), 'MOCK'));
    expect(bare.revenue).toBe(5000);   // present
    expect(bare.ebitda).toBe(null);    // missing
    expect(bare.debt).toBe(0);         // genuine 0
    expect(bare.dataSource).toBe('fmp');
  });
});

// E1 — toMillions is now shared by BOTH builders; assert it directly so a future FMP-driven edit that
// changes it can't silently break Yahoo.
describe('toMillions (shared Yahoo+FMP converter)', () => {
  it('null-honest: undefined/null/NaN → null; 0 → 0; 1.5e9 → 1500', () => {
    expect(toMillions(undefined)).toBe(null);
    expect(toMillions(null)).toBe(null);
    expect(toMillions(NaN)).toBe(null);
    expect(toMillions(0)).toBe(0);
    expect(toMillions(1.5e9)).toBe(1500);
  });
});
