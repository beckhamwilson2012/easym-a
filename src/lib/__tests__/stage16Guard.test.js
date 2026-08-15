/** @jest-environment node */
// Stage 16 — the FIRST rendered change: null shares → "—", not $0. Proves the chain end to end with
// the outcome inverted from E4 (which showed the inertness). Real buildFmpCompany + unwrapCompany +
// buildDeckModel; App.js's guard is exercised as the exact expression the deck uses.
const path = require('path');
const { buildFmpCompany } = require(path.resolve(__dirname, '../../../server'));
const { unwrapCompany } = require('../financialSchema');
const { buildDeckModel } = require('../deckModel');

const income  = () => ({ revenue: 5e9, netIncome: 8e8, eps: 1.23, ebitda: 1.2e9, grossProfit: 2e9, reportedCurrency: 'USD', date: '2024-12-31' });
const balance = () => ({ cashAndCashEquivalents: 4e8, totalDebt: 6e8, reportedCurrency: 'USD' });
const profileNoShares = () => ({ companyName: 'Mock', price: 42.5, sharesOutstanding: undefined, marketCap: undefined, currency: 'USD' });

// deal terms that make newShares non-null: stock consideration 4000 ÷ acquirer price 150 ≈ 26.67
const deal = () => ({ totalPrice: 10000, cashPercent: 60, offerPrice: 52, newSharesIssued: 27 });

describe('Stage 16 — read-site guard: null shares renders "—", not $0', () => {
  it('G4 chain: server null → unwrap null → market cap null (was 0) → deckModel null → ownership null', async () => {
    const c = await buildFmpCompany(income(), balance(), profileNoShares(), 'MOCK');
    expect(c.shares).toEqual(expect.objectContaining({ value: null, status: 'missing' }));   // server: honest
    const bare = unwrapCompany(c);
    expect(bare.shares).toBe(null);                                                            // boundary: null

    // App.js:782/784 currentMarketCap — the EXACT guard the deck now uses (both operands):
    const price = 42.5, shares = bare.shares;
    const currentMarketCap = (price > 0 && shares > 0) ? price * shares : null;
    expect(currentMarketCap).toBe(null);   // Stage 16: null → §B renders "—". (Pre-Stage-16: price*null = 0 → "$0M".)

    // deckModel: null acquirer shares → preDealShares null → proFormaShares null → ownership null → §8/§9 "—"
    const model = buildDeckModel({
      acquirer: { shares: bare.shares, sharePrice: 150, currentMarketCap },
      target:   { shares: 500, sharePrice: 40 },
      deal:     deal(),
    });
    expect(model.derived.preDealShares).toBe(null);          // was 0 (A.shares || 0)
    expect(model.derived.proFormaShares).toBe(null);         // was newShares (the :82 sum trap)
    expect(model.derived.ownershipExistingPct).toBe(null);   // → "—"
    expect(model.derived.ownershipNewPct).toBe(null);        // → "—"
  });

  it('G4 negative: the :82 trap — `null + newShares` === newShares; the guarded model must stay null (FAILS if :82 reverted)', () => {
    // Documents the trap: if deckModel:82 were reverted to `newShares != null ? preDealShares + newShares : null`,
    // then with preDealShares=null, `null + newShares` fabricates newShares — a plausible number, worse than a 0%.
    const newShares = 26.67;
    expect(null + newShares).toBe(newShares);   // JS coerces null→0 in addition

    const model = buildDeckModel({ acquirer: { shares: null, sharePrice: 150 }, target: { shares: 500, sharePrice: 40 }, deal: deal() });
    // The guarded :82 must stay null. Reverting to `preDealShares + newShares` would make this ≈ 26.67
    // (null+newShares) — so this exact assertion FAILS if the :82 guard is removed. That is the tripwire.
    expect(model.derived.proFormaShares).toBe(null);
  });

  it('sibling: a company WITH shares still computes normally (guard does not over-fire)', () => {
    const model = buildDeckModel({ acquirer: { shares: 1000, sharePrice: 150, currentMarketCap: 150000 }, target: { shares: 500, sharePrice: 40 }, deal: deal() });
    expect(model.derived.preDealShares).toBe(1000);          // present shares → unchanged
    expect(model.derived.proFormaShares).toBeGreaterThan(1000);  // 1000 + ~26.67
    expect(model.derived.ownershipExistingPct).toBeGreaterThan(90);
  });
});
