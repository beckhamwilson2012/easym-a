#!/usr/bin/env node
// Run with: node server/services/__tests__/peerSelect.test.js
// The peer picker (Fix 24: one rule for every target) against an in-memory world: no network. Each test names the rule.
'use strict';
const assert = require('assert');
const { createPeerSelector, summarizeSubmissions, filerKind, keywordOf } = require('../peerSelect');
const { createSicCompanies, parseSicPage } = require('../sicCompanies');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const NOW = new Date('2026-11-19T12:00:00Z');
const tenQ = { form: ['10-Q', '8-K'], filingDate: ['2026-10-30', '2026-10-01'] };
const twentyF = { form: ['20-F', '6-K'], filingDate: ['2026-03-17', '2026-05-01'] };
const stale = { form: ['10-K', '8-K'], filingDate: ['2025-02-01', '2026-01-05'] };
const SW = 'Software - Application', TECH = 'Technology';

// Target TGT: cap $10B, SIC 7372, FMP "Software - Application" / Technology, a 10-Q filer.
// sec: ticker → { cik, sic, filings }; uni: the band screen (ticker → { cap, industry, sector }); data: ticker → missing fields.
function world(over = {}) {
  const w = {
    targetCap: 10e9,
    target: { sic: '7372', industry: SW, sector: TECH, filings: tenQ },
    sec: {}, uni: {}, profiles: {}, sicLists: {}, missing: {}, blocks: {},
    stockPeers: [], overrides: {},
    calls: { subs: 0, data: 0, sicList: 0, universe: 0, peers: 0 },
    ...over,
  };
  w.sec.TGT = { cik: '0000000001', sic: w.target.sic, filings: w.target.filings };
  if (!w.sec.ACQ) w.sec.ACQ = { cik: '0000000002', sic: '7372', filings: tenQ };
  const byCik = {};
  for (const [t, v] of Object.entries(w.sec)) { byCik[v.cik] = byCik[v.cik] || { ...v, tickers: [] }; byCik[v.cik].tickers.push(t); }
  const sel = createPeerSelector({
    overrides: w.overrides,
    cikFor: (t) => (w.sec[t] ? w.sec[t].cik : null),
    tickersForCik: (cik) => (byCik[cik] ? byCik[cik].tickers : []),
    fetchSubmissions: async (cik) => { w.calls.subs++; const v = byCik[cik]; return { sic: v.sic, tickers: v.tickers, filings: { recent: v.filings } }; },
    fmpStockPeers: async () => { w.calls.peers++; if (w.peersFail) throw new Error('HTTP 503'); return w.stockPeers.map((s) => ({ symbol: s })); },
    fmpProfile: async (t) => (t === 'TGT' ? { industry: w.target.industry, sector: w.target.sector, country: w.target.country || 'US' } : (w.profiles[t] || null)),
    fmpUniverse: async (lo, hi) => {
      w.calls.universe++; w.band = [lo, hi];
      return Object.entries(w.uni).filter(([, u]) => u.cap >= lo && u.cap <= hi)
        .map(([symbol, u]) => ({ symbol, marketCap: u.cap, industry: u.industry, sector: u.sector || TECH, exchangeShortName: 'NYSE' }));
    },
    sicCompanies: async (sic) => { w.calls.sicList++; if (w.sicFail) throw new Error('HTTP 429'); return w.sicLists[sic] || []; },
    registrationBlock: async (t) => w.blocks[t] || null,
    targetMarketCap: async () => ({ value: w.targetCap, detail: null }),
    dataAvailable: async (t) => {
      w.calls.data++;
      const m = w.missing[t] || [];
      return { price: !m.includes('price'), shares: !m.includes('shares'), revenue: !m.includes('revenue'), transient: m.includes('price') };
    },
    now: () => NOW,
  });
  return { w, sel };
}
// A candidate: SEC registrant + its band-screen row.
let nextCik = 100;
function co(w, t, { sic = '7372', industry = SW, sector = TECH, cap = 10e9, filings = tenQ, cik } = {}) {
  w.sec[t] = { cik: cik || String(nextCik++).padStart(10, '0'), sic, filings };
  if (cap != null) w.uni[t] = { cap, industry, sector };
}
function build(setup, over = {}) {
  const base = { sec: {}, uni: {}, profiles: {}, sicLists: {}, missing: {}, blocks: {}, stockPeers: [], overrides: {}, ...over };
  setup(base);
  return world(base);
}
const ruleOf = (r, t) => (r.dropped.find((d) => d.ticker === t) || {}).rule;

test('rule 2a/3: same industry or same SIC is kept and labeled by tier; neither is dropped as industry-mismatch', async () => {
  const { sel } = build((w) => {
    co(w, 'SPIND', { sic: '7370' });                           // FMP peer + same industry: tier (a)
    co(w, 'EBOTH', { cap: 9e9 });                              // EDGAR list, same industry + SIC: tier (b)
    co(w, 'SPSIC', { industry: 'Software - Infrastructure' }); // FMP peer, SIC only: tier (c)
    co(w, 'NONE', { sic: '7510', industry: 'Rental & Leasing Services', sector: 'Industrials' });
    w.stockPeers = ['NONE', 'SPSIC', 'SPIND'];
    w.sicLists = { 7372: [w.sec.EBOTH.cik] };
  });
  const r = await sel.selectPeers('TGT', { acquirer: 'ACQ' });
  assert.deepStrictEqual(r.peers, ['SPIND', 'EBOTH', 'SPSIC']);
  assert.deepStrictEqual(r.peerSources, { SPIND: 'fmp-industry', EBOTH: 'industry-sic', SPSIC: 'sic' });
  assert.deepStrictEqual(r.screened.map((c) => c.tier), [0, 1, 2]);
  assert.strictEqual(ruleOf(r, 'NONE'), 'industry-mismatch');
  assert.strictEqual(r.trust, 'trusted');
});

test('rule 1: EDGAR registrants with the target\'s 4-digit SIC are candidates beside the stock-peers', async () => {
  const { sel, w } = build((w) => {
    co(w, 'SP1'); co(w, 'E1', { cap: 9e9 }); co(w, 'E2', { cap: 12e9 }); co(w, 'GONE', { cap: null });
    w.stockPeers = ['SP1'];
    w.sicLists = { 7372: [w.sec.E1.cik, w.sec.E2.cik, w.sec.GONE.cik, '0000000001'] };   // TGT's own CIK is on its list
  });
  const r = await sel.selectPeers('TGT');
  assert.deepStrictEqual(r.peers, ['SP1', 'E1', 'E2']);
  assert.strictEqual(r.screened.find((c) => c.ticker === 'E1').stage, 'edgar-sic');
  assert.strictEqual(ruleOf(r, 'GONE'), 'not-in-screen');
  assert.strictEqual(w.calls.sicList, 1);
});

test('rule 1 + TRAPS: a catch-all target SIC (7389, 6798) uses no EDGAR list and a shared catch-all SIC is not a match', async () => {
  for (const sic of ['7389', '6798']) {
    const { sel, w } = build((w) => {
      co(w, 'FICO', { sic });                                                                   // same industry: tier (a), not (b)
      co(w, 'CAR', { sic, industry: 'Rental & Leasing Services', sector: 'Industrials' });     // the catch-all alone: no match
      w.stockPeers = ['CAR', 'FICO'];
      w.sicLists = { [sic]: [w.sec.CAR.cik] };
    }, { target: { sic, industry: SW, sector: TECH, filings: tenQ } });
    const r = await sel.selectPeers('TGT');
    assert.strictEqual(w.calls.sicList, 0);
    assert.strictEqual(r.peerSources.FICO, 'fmp-industry');
    assert.strictEqual(ruleOf(r, 'CAR'), 'industry-mismatch');
    assert.match(r.sicList, /catch-all/);
  }
});

test('rule 2b: 0.1×–10× inclusive, from one USD screen at 0.05×–20×; outside drops; a missing cap drops (never 0)', async () => {
  const { sel, w } = build((w) => {
    co(w, 'LO', { cap: 1e9 }); co(w, 'HI', { cap: 100e9 }); co(w, 'MID', { cap: 10e9 });
    co(w, 'TINY', { cap: 0.99e9 }); co(w, 'BIG', { cap: 100.1e9 }); co(w, 'FAR', { cap: 300e9 });
    w.stockPeers = ['LO', 'HI', 'MID', 'TINY', 'BIG', 'FAR'];
    w.profiles = { FAR: { exchange: 'NYSE', currency: 'USD', marketCap: 300e9 } };
  });
  const r = await sel.selectPeers('TGT');
  assert.deepStrictEqual([...r.peers].sort(), ['HI', 'LO', 'MID']);
  assert.deepStrictEqual(w.band, [0.5e9, 200e9]);
  assert.strictEqual(ruleOf(r, 'TINY'), 'size-band');   // 3 passed, so the size step never ran
  assert.strictEqual(ruleOf(r, 'BIG'), 'size-band');
  assert.strictEqual(ruleOf(r, 'FAR'), 'size-band');
  assert.strictEqual(r.broadened, undefined);
});

test('rule 2b/2c: an OTC listing, a non-USD cap and a non-SEC-filer drop with their own rule', async () => {
  const { sel } = build((w) => {
    co(w, 'P1'); co(w, 'P2'); co(w, 'P3');
    co(w, 'OTCY', { cap: null }); co(w, 'KRW', { cap: null });
    w.profiles = { OTCY: { exchange: 'OTC', currency: 'USD', marketCap: 9e9 }, KRW: { exchange: 'NYSE', currency: 'KRW', marketCap: 9e12 } };
    w.stockPeers = ['P1', 'P2', 'P3', 'OTCY', 'KRW', '005380.KS'];
  });
  const r = await sel.selectPeers('TGT');
  assert.strictEqual(ruleOf(r, 'OTCY'), 'not-us-listed');
  assert.strictEqual(ruleOf(r, 'KRW'), 'no-market-cap');
  assert.strictEqual(ruleOf(r, '005380.KS'), 'not-sec-filer');
});

test('rule 2e: a 20-F filer is no peer of a domestic target; of a foreign target only with the same FMP industry', async () => {
  const setup = (w) => {
    co(w, 'D1'); co(w, 'D2'); co(w, 'ADR', { filings: twentyF }); co(w, 'ADRX', { filings: twentyF, industry: 'Software - Infrastructure' });
    w.stockPeers = ['D1', 'D2', 'ADR', 'ADRX'];
  };
  const dom = await build(setup).sel.selectPeers('TGT');
  assert.strictEqual(ruleOf(dom, 'ADR'), 'foreign-filer');
  const fgn = await build(setup, { target: { sic: '7372', industry: SW, sector: TECH, filings: twentyF } }).sel.selectPeers('TGT');
  assert.strictEqual(fgn.targetForeign, true);
  assert.ok(fgn.peers.includes('ADR'));
  assert.strictEqual(ruleOf(fgn, 'ADRX'), 'foreign-filer');
});

test('rule 2c: no periodic report in 12 months drops; Fix 21 deregistration drops', async () => {
  const { sel } = build((w) => {
    co(w, 'P1'); co(w, 'P2'); co(w, 'P3'); co(w, 'OLD', { filings: stale }); co(w, 'DEAD');
    w.blocks = { DEAD: { name: 'Dead Co', date: '2026-08-27', form: '15-12G' } };
    w.stockPeers = ['P1', 'P2', 'P3', 'OLD', 'DEAD'];
  });
  const r = await sel.selectPeers('TGT');
  assert.strictEqual(ruleOf(r, 'OLD'), 'no-recent-periodic-report');
  assert.strictEqual(ruleOf(r, 'DEAD'), 'deregistered');
  assert.deepStrictEqual(r.peers.sort(), ['P1', 'P2', 'P3']);
});

test('rule 2d: no price, share count or revenue drops; a price that failed to load is not cached', async () => {
  const { sel, w } = build((w) => {
    co(w, 'P1'); co(w, 'P2'); co(w, 'P3'); co(w, 'NOSH'); co(w, 'NOPX');
    w.missing = { NOSH: ['shares'], NOPX: ['price'] };
    w.stockPeers = ['P1', 'P2', 'P3', 'NOSH', 'NOPX'];
  });
  const r = await sel.selectPeers('TGT');
  assert.strictEqual(ruleOf(r, 'NOSH'), 'no-data');
  assert.match(r.dropped.find((d) => d.ticker === 'NOPX').detail, /no price/);
  await sel.selectPeers('TGT');
  assert.strictEqual(w.calls.universe, 2); // not cached: the price may load next time
});

test('rule 2f: the acquirer, the target and another class of either are dropped; GOOGL/GOOG is one entry', async () => {
  const { sel } = build((w) => {
    co(w, 'P1'); co(w, 'P2');
    co(w, 'GOOGL', { cap: 11e9, cik: '0000001652' }); co(w, 'GOOG', { cap: 11e9, cik: '0000001652' });
    w.sec.ACQ = { cik: '0000000002', sic: '7372', filings: tenQ };
    w.sec.ACQB = { cik: '0000000002', sic: '7372', filings: tenQ }; w.uni.ACQB = { cap: 10e9, industry: SW };
    w.stockPeers = ['P1', 'P2', 'GOOG', 'GOOGL', 'ACQ', 'ACQB', 'TGT'];
  });
  const r = await sel.selectPeers('TGT', { acquirer: 'ACQ' });
  assert.deepStrictEqual(r.peers.sort(), ['GOOG', 'P1', 'P2']);
  assert.strictEqual(ruleOf(r, 'GOOGL'), 'same-company');
  assert.strictEqual(ruleOf(r, 'ACQ'), 'target-or-acquirer');
  assert.strictEqual(ruleOf(r, 'ACQB'), 'target-or-acquirer');
  assert.strictEqual(ruleOf(r, 'TGT'), 'target-or-acquirer');
});

test('rule 3: (a) FMP peer + industry, (b) industry + SIC, (c) one of them; closeness within each; top 5, the rest ranked-out', async () => {
  const { sel } = build((w) => {
    co(w, 'SP_IND', { sic: '7370', cap: 40e9 });                              // (a), far
    co(w, 'E_B1', { cap: 11e9 }); co(w, 'E_B2', { cap: 3e9 });                 // (b)
    co(w, 'E_S1', { industry: 'Software - Infrastructure', cap: 10e9 });        // (c)
    co(w, 'SP_S', { industry: 'Software - Infrastructure', cap: 10.5e9 });      // (c)
    co(w, 'E_S2', { industry: 'Software - Infrastructure', cap: 2.5e9 });       // (c), farthest
    w.stockPeers = ['SP_S', 'SP_IND'];
    w.sicLists = { 7372: ['E_B1', 'E_B2', 'E_S1', 'E_S2'].map((t) => w.sec[t].cik) };
  });
  const r = await sel.selectPeers('TGT');
  assert.deepStrictEqual(r.peers, ['SP_IND', 'E_B1', 'E_B2', 'E_S1', 'SP_S']);
  assert.strictEqual(ruleOf(r, 'E_S2'), 'ranked-out');
});

test('rule 4: fewer than 3 → size to 0.05×–20× first ("broadened: size"), then the 3-digit SIC ("broadened: industry")', async () => {
  const { sel } = build((w) => {
    co(w, 'P1');
    co(w, 'SMALLIND', { cap: 0.7e9 });                                                     // 0.07×: same industry + SIC
    co(w, 'SP737', { sic: '7371', industry: 'Information Technology Services' });
    co(w, 'E7374', { sic: '7374', industry: 'Information Technology Services', cap: 8e9 });
    co(w, 'E7389', { sic: '7389', industry: 'Specialty Business Services', cap: 9e9 });  // catch-all code: never a SIC match
    w.stockPeers = ['P1', 'SMALLIND', 'SP737'];
    w.sicLists = { 7374: [w.sec.E7374.cik], 7389: [w.sec.E7389.cik] };
  });
  const r = await sel.selectPeers('TGT');
  assert.deepStrictEqual(r.peers, ['P1', 'SMALLIND', 'SP737', 'E7374']);
  assert.deepStrictEqual(r.peerSources, { P1: 'fmp-industry', SMALLIND: 'broadened-size', SP737: 'broadened-industry', E7374: 'broadened-industry' });
  assert.deepStrictEqual(r.broadened.map((b) => [b.kind, b.step, b.added]), [['size', 'size band 0.05×–20×', 1], ['industry', '3-digit SIC 737', 2]]);
  assert.match(r.broadened[0].why, /only 1 company matched within 0\.1×–10×/);
  assert.strictEqual(r.trust, 'trusted');
  assert.ok(!r.peers.includes('E7389'));
});

test('rule 4: the size step alone can reach 3; the industry step then does not run', async () => {
  const { sel } = build((w) => {
    co(w, 'P1'); co(w, 'P2'); co(w, 'BIGIND', { cap: 150e9 });   // 15×: same industry + SIC
    co(w, 'SP737', { sic: '7371', industry: 'Information Technology Services' });
    w.stockPeers = ['P1', 'P2', 'BIGIND', 'SP737'];
  });
  const r = await sel.selectPeers('TGT');
  assert.deepStrictEqual(r.peers, ['P1', 'P2', 'BIGIND']);
  assert.deepStrictEqual(r.broadened.map((b) => b.kind), ['size']);
  assert.strictEqual(ruleOf(r, 'SP737'), 'industry-mismatch');
});

test('rule 4: a catch-all target SIC widens to FMP sector + industry keyword, over the stock-peers only', async () => {
  const { sel } = build((w) => {
    co(w, 'VIA', { sic: '7372' });
    co(w, 'INFRA', { sic: '3576', industry: 'Software - Infrastructure' });             // Technology + "Software": broadened
    co(w, 'CAR', { sic: '7510', industry: 'Rental & Leasing Services', sector: 'Industrials' });
    w.stockPeers = ['VIA', 'INFRA', 'CAR'];
  }, { target: { sic: '7389', industry: SW, sector: TECH, filings: tenQ } });
  const r = await sel.selectPeers('TGT');
  assert.deepStrictEqual(r.peers, ['VIA', 'INFRA']);
  assert.strictEqual(r.peerSources.INFRA, 'broadened-industry');
  assert.strictEqual(r.broadened.find((b) => b.kind === 'industry').step, 'FMP sector Technology + industry keyword "Software"');
  assert.strictEqual(r.broadened.find((b) => b.kind === 'size').added, 0);
  assert.strictEqual(ruleOf(r, 'CAR'), 'industry-mismatch');
  // still fewer than 3: the peers there are, untrusted, with the reason; never a default list
  assert.strictEqual(r.trust, 'untrusted');
  assert.match(r.reason, /^Only 2 companies passed the peer screen \(need 3\): .*CAR/);
});

test('rule 4: zero survivors → no peers, untrusted, a reason; never a default list', async () => {
  const { sel } = build((w) => { co(w, 'FAR', { cap: 500e9 }); w.stockPeers = ['FAR']; w.profiles = { FAR: { exchange: 'NYSE', currency: 'USD', marketCap: 500e9 } }; });
  const r = await sel.selectPeers('TGT');
  assert.deepStrictEqual(r.peers, []);
  assert.strictEqual(r.source, 'none');
  assert.match(r.reason, /Only 0 companies passed the peer screen \(need 3\): 1 outside 0\.05×–20× .*\(FAR\)/);   // after the size step
});

test('rule 6: a foreign target with no qualifying peer says "No comparable US-listed peers found"', async () => {
  const { sel } = build((w) => { co(w, 'FAR', { cap: 500e9, filings: twentyF }); w.stockPeers = ['FAR', '7203.T']; w.profiles = { FAR: { exchange: 'NYSE', currency: 'USD', marketCap: 500e9 } }; },
    { target: { sic: '3711', industry: 'Auto - Manufacturers', sector: 'Consumer Cyclical', filings: twentyF } });
  const r = await sel.selectPeers('TGT');
  assert.deepStrictEqual(r.peers, []);
  assert.match(r.reason, /^No comparable US-listed peers found: /);
});

test('rule 5: an override skips the industry test and the size band; registration, data and the deal parties still apply', async () => {
  const { sel, w } = build((w) => {
    co(w, 'H1', { sic: '8011', industry: 'Medical - Care Facilities' }); co(w, 'H2', { sic: '8090', industry: 'Medical - Healthcare Plans' });
    co(w, 'H3', { sic: '2834', industry: 'Drug Manufacturers - General' }); co(w, 'HUGE', { cap: 900e9 });
    co(w, 'DEAD'); co(w, 'NODATA'); co(w, 'OTCH', { cap: null });
    w.blocks = { DEAD: { name: 'Dead Co', date: '2022-11-08', form: '25-NSE' } };
    w.missing = { NODATA: ['revenue'] };
    w.profiles = { HUGE: { exchange: 'NASDAQ', currency: 'USD', marketCap: 900e9, industry: SW }, OTCH: { exchange: 'OTC', currency: 'USD', marketCap: 5e9 } };
    w.overrides = { TGT: ['ACQ', 'H1', 'H2', 'H3', 'HUGE', 'DEAD', 'NODATA', 'OTCH'] };
  });
  const r = await sel.selectPeers('TGT', { acquirer: 'ACQ' });
  assert.deepStrictEqual(r.peers.sort(), ['H1', 'H2', 'H3', 'HUGE']);
  assert.strictEqual(r.screened.find((c) => c.ticker === 'HUGE').ratio, 90);   // 90×, kept: hand-set names have no size band
  assert.ok(Object.values(r.peerSources).every((s) => s === 'override'));
  assert.strictEqual(r.source, 'override');
  assert.strictEqual(ruleOf(r, 'ACQ'), 'target-or-acquirer');
  assert.strictEqual(ruleOf(r, 'DEAD'), 'deregistered');
  assert.strictEqual(ruleOf(r, 'NODATA'), 'no-data');
  assert.strictEqual(ruleOf(r, 'OTCH'), 'not-us-listed');
  assert.strictEqual(w.calls.peers, 0);   // no FMP stock-peers, no EDGAR list, no widening for an override
  assert.strictEqual(w.calls.sicList, 0);
});

test('rule 5: an override with fewer than 3 survivors shows them with the reason and does not widen', async () => {
  const { sel } = build((w) => {
    co(w, 'H1'); co(w, 'NOREV');
    w.missing = { NOREV: ['revenue'] };
    w.overrides = { TGT: ['ACQ', 'H1', 'NOREV'] };
  });
  const r = await sel.selectPeers('TGT', { acquirer: 'ACQ' });
  assert.deepStrictEqual(r.peers, ['H1']);
  assert.strictEqual(r.source, 'override');
  assert.strictEqual(r.trust, 'untrusted');
  assert.strictEqual(r.broadened, undefined);
  assert.match(r.reason, /^Only 1 company passed the peer screen \(need 3\): of the hand-set list, /);
});

test('rule 5: an override whose every name fails keeps source "override" (the slide says set by hand), with no peers', async () => {
  const { sel } = build((w) => {
    co(w, 'NOSH');
    w.missing = { NOSH: ['shares'] };
    w.overrides = { TGT: ['ACQ', 'NOSH'] };
  });
  const r = await sel.selectPeers('TGT', { acquirer: 'ACQ' });
  assert.deepStrictEqual(r.peers, []);
  assert.strictEqual(r.source, 'override');
  assert.strictEqual(r.trust, 'untrusted');
  assert.match(r.reason, /^Only 0 companies passed the peer screen \(need 3\): of the hand-set list, /);
});

test('no target market cap → no peer set, not cached (the band is never applied to a guessed cap)', async () => {
  const { sel, w } = build((w) => { co(w, 'P1'); w.stockPeers = ['P1']; }, { targetCap: null });
  const r = await sel.selectPeers('TGT');
  assert.deepStrictEqual(r.peers, []);
  assert.match(r.reason, /^No market cap for TGT/);
  await sel.selectPeers('TGT');
  assert.strictEqual(w.calls.universe, 0);
});

test('FMP or EDGAR failure → named, and not cached (next call retries)', async () => {
  const { sel, w } = build((w) => { co(w, 'P1'); co(w, 'P2'); co(w, 'P3'); w.stockPeers = ['P1', 'P2', 'P3']; }, { peersFail: true });
  const r = await sel.selectPeers('TGT');
  assert.match(r.reason, /FMP stock-peers unavailable for TGT \(HTTP 503\)/);
  w.peersFail = false;
  w.sicFail = true;
  const r2 = await sel.selectPeers('TGT');
  assert.deepStrictEqual(r2.peers.length, 3);
  assert.match(r2.sicList, /unavailable \(HTTP 429\); FMP stock-peers only/);
  await sel.selectPeers('TGT');
  assert.strictEqual(w.calls.peers, 3);
});

test('determinism: input order does not matter, and a fresh selector equals a warm one', async () => {
  const setup = (order) => (w) => {
    co(w, 'A1', { cap: 9e9, cik: '0000000901' }); co(w, 'A2', { cap: 12e9, cik: '0000000902' }); co(w, 'A3', { sic: '7370', cap: 5e9, cik: '0000000903' });
    co(w, 'A4', { industry: 'Software - Infrastructure', cap: 20e9, cik: '0000000904' }); co(w, 'A5', { cap: 30e9, cik: '0000000905' }); co(w, 'A6', { cap: 3e9, cik: '0000000906' });
    w.stockPeers = order;
    w.sicLists = { 7372: [...order].reverse().map((t) => w.sec[t].cik) };
  };
  const a = await build(setup(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'])).sel.selectPeers('TGT');
  const { sel } = build(setup(['A6', 'A5', 'A4', 'A3', 'A2', 'A1']));
  const b = await sel.selectPeers('TGT');
  const c = await sel.selectPeers('TGT');
  assert.deepStrictEqual(b.peers, a.peers);
  assert.deepStrictEqual(b.dropped, a.dropped);
  assert.deepStrictEqual(c, b);
});

test('summarizeSubmissions / filerKind / keywordOf', () => {
  const s = summarizeSubmissions({ sic: 4899, filings: { recent: { form: ['8-K', '10-Q', '10-K', '20-F'], filingDate: ['2026-11-01', '2026-10-30', '2026-02-20', '2020-01-01'] } } });
  assert.strictEqual(s.sic, '4899');
  assert.deepStrictEqual(s.lastPeriodic, { form: '10-Q', date: '2026-10-30' });
  assert.strictEqual(filerKind(s), 'domestic');
  assert.strictEqual(filerKind(summarizeSubmissions({ filings: { recent: twentyF } })), 'foreign');
  assert.strictEqual(filerKind(summarizeSubmissions({ filings: { recent: { form: ['8-K'], filingDate: ['2026-01-01'] } } })), null);
  assert.strictEqual(keywordOf('Software - Application'), 'Software');
  assert.strictEqual(keywordOf('Restaurants'), 'Restaurants');
  assert.strictEqual(keywordOf(null), null);
});

test('sicCompanies: parses EDGAR Atom pages, pages until a short page, caches, never caches a failure', async () => {
  const entry = (cik, sic) => `<entry><content type="text/xml"><company-info><cik>${cik}</cik><name>X</name><sic>${sic}</sic></company-info></content></entry>`;
  const feed = (n, off) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${Array.from({ length: n }, (_, i) => entry(String(off + i), '3711')).join('')}</feed>`;
  assert.deepStrictEqual(parseSicPage(feed(2, 7), '3711'), { ciks: ['0000000007', '0000000008'], entries: 2 });
  let calls = 0, fail = true;
  const sc = createSicCompanies({ getText: async (url) => { calls++; if (fail) throw new Error('HTTP 503'); const start = +new URL(url).searchParams.get('start'); return start === 0 ? feed(100, 1) : feed(3, 101); }, sleep: async () => {} });
  await assert.rejects(sc.ciksForSic('3711'), /HTTP 503/);
  fail = false;
  const ciks = await sc.ciksForSic('3711');
  assert.strictEqual(ciks.length, 103);
  const n = calls;
  await sc.ciksForSic('3711');
  assert.strictEqual(calls, n);
  const empty = createSicCompanies({ getText: async () => '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>', sleep: async () => {} });
  assert.deepStrictEqual(await empty.ciksForSic('3719'), []);
  const html = createSicCompanies({ getText: async () => '<html>error</html>', sleep: async () => {} });
  await assert.rejects(html.ciksForSic('3711'), /not an Atom feed/);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
