#!/usr/bin/env node
// Run with: node server/services/__tests__/peerSelect.test.js
// The peer picker against an in-memory world: no network. Each test names the rule it pins.
'use strict';
const assert = require('assert');
const { createPeerSelector, summarizeSubmissions } = require('../peerSelect');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const NOW = new Date('2026-11-11T12:00:00Z');
const recent10Q = { form: ['10-Q', '8-K'], filingDate: ['2026-10-30', '2026-10-01'] };
const only20F = { form: ['20-F', '6-K'], filingDate: ['2026-03-17', '2026-05-01'] };
const stale10K = { form: ['10-K', '8-K'], filingDate: ['2025-02-01', '2026-01-05'] };

// A small world. Target TGT: cap $10B, SIC 7372. Everything is keyed by ticker.
function world(over = {}) {
  const w = {
    targetCap: 10e9,
    targetSic: '7372',
    industry: 'Software - Application',
    // ticker → { cik, sic, filings, revenue }
    sec: {
      TGT: { cik: '0000000001', sic: '7372', filings: recent10Q, revenue: true },
      ACQ: { cik: '0000000002', sic: '7372', filings: recent10Q, revenue: true },
      P1: { cik: '0000000011', sic: '7372', filings: recent10Q, revenue: true },
      P2: { cik: '0000000012', sic: '3577', filings: recent10Q, revenue: true },
      P3: { cik: '0000000013', sic: '7370', filings: recent10Q, revenue: true },
      P4: { cik: '0000000014', sic: '7371', filings: recent10Q, revenue: true },
      P5: { cik: '0000000015', sic: '7372', filings: recent10Q, revenue: true },
      P6: { cik: '0000000016', sic: '7372', filings: recent10Q, revenue: true },
      F20: { cik: '0000000020', sic: '7372', filings: only20F, revenue: true },
      OLD: { cik: '0000000021', sic: '7372', filings: stale10K, revenue: true },
      NOREV: { cik: '0000000022', sic: '7372', filings: recent10Q, revenue: false },
      S1: { cik: '0000000031', sic: '7371', filings: recent10Q, revenue: true },
      S2: { cik: '0000000032', sic: '7389', filings: recent10Q, revenue: true },
      S3: { cik: '0000000033', sic: '7372', filings: recent10Q, revenue: true },
    },
    stockPeers: [],
    screener: [],
    overrides: {},
    calls: { subs: 0, rev: 0, peers: 0 },
    ...over,
  };
  const byCik = Object.fromEntries(Object.entries(w.sec).map(([t, v]) => [v.cik, v]));
  const sel = createPeerSelector({
    overrides: w.overrides,
    cikFor: (t) => (w.sec[t] ? w.sec[t].cik : null),
    fetchSubmissions: async (cik) => { w.calls.subs++; const v = byCik[cik]; return { sic: v.sic, filings: { recent: v.filings } }; },
    fmpStockPeers: async () => { w.calls.peers++; if (w.peersFail) throw new Error('HTTP 503'); return w.stockPeers; },
    fmpIndustry: async () => w.industry,
    fmpScreener: async () => w.screener,
    targetMarketCap: async () => ({ value: w.targetCap, detail: null }),
    revenueAvailable: async (t) => { w.calls.rev++; return !!(w.sec[t] && w.sec[t].revenue); },
    now: () => NOW,
  });
  return { w, sel };
}
const sp = (symbol, mktCap) => ({ symbol, mktCap });
const row = (symbol, marketCap, isActivelyTrading = true) => ({ symbol, marketCap, isActivelyTrading });
const reasonOf = (r, t) => (r.dropped.find((d) => d.ticker === t) || {}).rule;

test('rule 1: an override wins and skips every filter (even a 20-F filer and the acquirer)', async () => {
  const { w, sel } = world({ overrides: { TGT: ['F20', 'ACQ', 'NOPE'] }, stockPeers: [sp('P1', 10e9)] });
  const r = await sel.selectPeers('TGT', { acquirer: 'ACQ' });
  assert.deepStrictEqual(r.peers, ['F20', 'ACQ', 'NOPE']);
  assert.strictEqual(r.source, 'override');
  assert.strictEqual(r.trust, 'trusted');
  assert.deepStrictEqual(r.peerSources, { F20: 'override', ACQ: 'override', NOPE: 'override' });
  assert.strictEqual(w.calls.peers, 0, 'FMP is not called for an override');
});

test('rule 3: target and acquirer are dropped', async () => {
  const { sel } = world({ stockPeers: [sp('TGT', 10e9), sp('ACQ', 10e9), sp('P1', 9e9), sp('P5', 8e9), sp('P6', 7e9)] });
  const r = await sel.selectPeers('TGT', { acquirer: 'ACQ' });
  assert.strictEqual(reasonOf(r, 'TGT'), 'target-or-acquirer');
  assert.strictEqual(reasonOf(r, 'ACQ'), 'target-or-acquirer');
  assert.ok(!r.peers.includes('ACQ') && !r.peers.includes('TGT'));
});

test('rule 3: not in SEC company_tickers.json → not-sec-filer', async () => {
  const { sel } = world({ stockPeers: [sp('300017.SZ', 10e9), sp('P1', 9e9), sp('P5', 8e9), sp('P6', 7e9)] });
  const r = await sel.selectPeers('TGT');
  assert.strictEqual(reasonOf(r, '300017.SZ'), 'not-sec-filer');
});

test('rule 3: size band is 0.1×–10× inclusive; outside drops, missing cap drops (never 0)', async () => {
  const { sel } = world({ stockPeers: [sp('P1', 1e9), sp('P2', 100e9), sp('P3', 0.99e9), sp('P4', 101e9), sp('P5', null), sp('P6', 10e9)] });
  const r = await sel.selectPeers('TGT');
  assert.ok(r.peers.includes('P1') && r.peers.includes('P2'), 'exact 0.1× and 10× are inside');
  assert.strictEqual(reasonOf(r, 'P3'), 'size-band');
  assert.strictEqual(reasonOf(r, 'P4'), 'size-band');
  assert.strictEqual(reasonOf(r, 'P5'), 'no-market-cap');
});

test('rule 3: a 20-F filer and a filer with no 10-K/10-Q in 12 months drop', async () => {
  const { sel } = world({ stockPeers: [sp('F20', 10e9), sp('OLD', 10e9), sp('P1', 9e9), sp('P5', 8e9), sp('P6', 7e9)] });
  const r = await sel.selectPeers('TGT');
  assert.strictEqual(reasonOf(r, 'F20'), 'no-recent-10k-10q');
  assert.match(r.dropped.find((d) => d.ticker === 'F20').detail, /20-F 2026-03-17/);
  assert.strictEqual(reasonOf(r, 'OLD'), 'no-recent-10k-10q');
});

test('rule 3: a 20-F filer ranked below the top 5 is still dropped for being a 20-F filer, not "ranked-out"', async () => {
  const { sel } = world({ stockPeers: [...['P1', 'P2', 'P3', 'P4', 'P5'].map((t) => sp(t, 10e9)), sp('F20', 50e9), sp('P6', 60e9)] });
  const r = await sel.selectPeers('TGT');
  assert.strictEqual(r.peers.length, 5);
  assert.strictEqual(reasonOf(r, 'F20'), 'no-recent-10k-10q');
  assert.strictEqual(reasonOf(r, 'P6'), 'ranked-out');
});

test('rule 3: no revenue drops', async () => {
  const { sel } = world({ stockPeers: [sp('NOREV', 10e9), sp('P1', 9e9), sp('P5', 8e9), sp('P6', 7e9)] });
  const r = await sel.selectPeers('TGT');
  assert.strictEqual(reasonOf(r, 'NOREV'), 'no-revenue');
});

test('rule 4: no backfill when 5 stock-peers pass', async () => {
  const { sel } = world({ stockPeers: ['P1', 'P2', 'P3', 'P4', 'P5'].map((t) => sp(t, 10e9)), screener: [row('S3', 10e9)] });
  const r = await sel.selectPeers('TGT');
  assert.strictEqual(r.peers.length, 5);
  assert.ok(Object.values(r.peerSources).every((s) => s === 'fmp-peers'));
  assert.match(r.backfill, /not needed/);
});

test('rule 4: backfill needs the same 3-digit SIC (737x passes, 7389 fails) and active trading', async () => {
  const { sel } = world({
    stockPeers: [sp('P1', 10e9)],
    screener: [row('S1', 10e9), row('S2', 10e9), row('S3', 10e9, false), row('P5', 10e9), row('P6', 12e9)],
  });
  const r = await sel.selectPeers('TGT');
  assert.strictEqual(reasonOf(r, 'S2'), 'sic-mismatch');
  assert.strictEqual(reasonOf(r, 'S3'), 'not-actively-trading');
  assert.deepStrictEqual(r.peers, ['P1', 'P5', 'S1', 'P6']);
  assert.strictEqual(r.peerSources.S1, 'fmp-industry-sic');
  assert.strictEqual(r.peerSources.P1, 'fmp-peers');
  assert.strictEqual(r.sic3, '737');
});

test('rule 4: a stock-peer that failed a filter is not readmitted by the screener', async () => {
  const { sel } = world({ stockPeers: [sp('P1', 10e9), sp('P5', 200e9)], screener: [row('P5', 10e9), row('S1', 10e9), row('P6', 10e9)] });
  const r = await sel.selectPeers('TGT');
  assert.ok(!r.peers.includes('P5'));
  assert.strictEqual(reasonOf(r, 'P5'), 'size-band');
});

test('rule 5: stock-peers rank before backfill, then closest market cap; top 5 kept, the rest ranked-out', async () => {
  const { sel } = world({
    stockPeers: [sp('P2', 5e9), sp('P1', 30e9)],
    screener: [row('S1', 10e9), row('S3', 11e9), row('P5', 9e9), row('P6', 20e9), row('NOREV', 10e9)],
  });
  const r = await sel.selectPeers('TGT');
  // P2 (|ln .5|=.69) before P1 (|ln 3|=1.10); then backfill by closeness: S1 (0), P5 (.105) / S3 (.095)…
  assert.deepStrictEqual(r.peers.slice(0, 2), ['P2', 'P1']);
  assert.deepStrictEqual(r.peers.slice(2), ['S1', 'S3', 'P5']);
  assert.strictEqual(reasonOf(r, 'P6'), 'ranked-out');
});

test('rule 6: fewer than 3 survive → no peer set, untrusted, with the reason; never a default list', async () => {
  const { sel } = world({ stockPeers: [sp('P1', 10e9), sp('F20', 10e9)], screener: [row('S2', 10e9)] });
  const r = await sel.selectPeers('TGT');
  assert.deepStrictEqual(r.peers, []);
  assert.strictEqual(r.trust, 'untrusted');
  assert.strictEqual(r.source, 'none');
  assert.match(r.reason, /Only 1 company passed the peer screen \(need 3\)/);
  assert.deepStrictEqual(r.screened.map((s) => s.ticker), ['P1']);
});

test('rule 6: exactly 3 survive → shown', async () => {
  const { sel } = world({ stockPeers: [sp('P1', 10e9), sp('P5', 10e9), sp('P6', 10e9)] });
  const r = await sel.selectPeers('TGT');
  assert.strictEqual(r.peers.length, 3);
  assert.strictEqual(r.trust, 'trusted');
});

test('no target market cap → no peer set (band never applied to a guessed cap)', async () => {
  const { sel } = world({ targetCap: null, stockPeers: [sp('P1', 10e9), sp('P5', 10e9), sp('P6', 10e9)] });
  const r = await sel.selectPeers('TGT');
  assert.deepStrictEqual(r.peers, []);
  assert.match(r.reason, /No market cap/);
});

test('FMP failure → no peer set naming it, and it is not cached (next call retries)', async () => {
  const { w, sel } = world({ peersFail: true, stockPeers: [sp('P1', 10e9), sp('P5', 10e9), sp('P6', 10e9)] });
  const r1 = await sel.selectPeers('TGT');
  assert.deepStrictEqual(r1.peers, []);
  assert.match(r1.reason, /unavailable/);
  w.peersFail = false;
  const r2 = await sel.selectPeers('TGT');
  assert.strictEqual(r2.peers.length, 3);
});

test('determinism: input order does not matter, and a fresh selector equals a warm one', async () => {
  const list = [sp('P1', 9e9), sp('P2', 11e9), sp('P3', 4e9), sp('P4', 25e9), sp('P5', 10.5e9), sp('P6', 9.5e9), sp('F20', 10e9)];
  const a = world({ stockPeers: list });
  const b = world({ stockPeers: [...list].reverse() });
  const ra = await a.sel.selectPeers('TGT');
  const rb = await b.sel.selectPeers('TGT');
  assert.deepStrictEqual(ra.peers, rb.peers);
  assert.deepStrictEqual(ra.dropped, rb.dropped);
  // warm: same selector after unrelated lookups
  await a.sel.selectPeers('P1');
  const ra2 = await a.sel._select('TGT', null);
  assert.deepStrictEqual(ra2.peers, ra.peers);
  assert.deepStrictEqual(ra2.dropped, ra.dropped);
});

test('ties in market-cap distance break by ticker', async () => {
  const { sel } = world({ stockPeers: [sp('P6', 20e9), sp('P5', 5e9), sp('P1', 20e9), sp('P2', 5e9)] });
  const r = await sel.selectPeers('TGT');
  assert.deepStrictEqual(r.peers, ['P1', 'P2', 'P5', 'P6']);
});

test('summarizeSubmissions: latest 10-K/10-Q family filing and the SIC', () => {
  const s = summarizeSubmissions({ sic: 4899, filings: { recent: { form: ['8-K', '10-Q', '10-K', '20-F'], filingDate: ['2026-11-01', '2026-10-30', '2026-02-20', '2020-01-01'] } } });
  assert.strictEqual(s.sic, '4899');
  assert.deepStrictEqual(s.lastPeriodic, { form: '10-Q', date: '2026-10-30' });
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
