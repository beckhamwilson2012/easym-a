#!/usr/bin/env node
// Run with: node server/services/__tests__/fix23StandardLtmEps.test.js
// Fix 23 Task 1: LTM diluted EPS = FY + current YTD − prior YTD, every figure filed, when the four-quarter sum cannot resolve.
// Shapes are LYFT's filings (companyfacts, us-gaap). No network.
'use strict';
const assert = require('assert');
const { standardLtmEps, resolveLtmEps } = require('../ltmEps');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const e = (start, end, val, form, accn, filed) => ({ start, end, val, form, accn, filed });
const K = '0001628280-26-006960', Q = '0001628280-26-071225', OLDQ = '0001628280-25-049999';
const sh = (start, end, val, accn = Q) => e(start, end, val, '10-Q', accn, '2026-11-06');
const lyft = (extra = {}) => ({
  WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [
    e('2025-01-01', '2025-12-31', 417.7e6, '10-K', K, '2026-02-11'), sh('2026-01-01', '2026-09-30', 391.3e6), sh('2025-01-01', '2025-09-30', 420.3e6)] } },
  EarningsPerShareDiluted: { units: { 'USD/shares': [
    e('2025-01-01', '2025-12-31', 6.81, '10-K', K, '2026-02-11'),
    e('2026-01-01', '2026-09-30', 0.14, '10-Q', Q, '2026-11-06'),
    e('2025-01-01', '2025-09-30', 0.21, '10-Q', Q, '2026-11-06'),
    e('2025-01-01', '2025-09-30', 0.22, '10-Q', OLDQ, '2025-11-05'),   // the same period as first filed a year ago: never used
  ] } },
  ...extra,
});
const periods = { annual: { start: '2025-01-01', end: '2025-12-31' }, latestInterim: { start: '2026-01-01', end: '2026-09-30', span: 272 }, priorInterim: { start: '2025-01-01', end: '2025-09-30', span: 272 } };

test('LYFT: 6.81 + 0.14 − 0.21 = 6.74, prior YTD from the latest 10-Q comparative, labeled', () => {
  const r = standardLtmEps(lyft(), periods);
  assert.strictEqual(r.value, 6.74);
  assert.strictEqual(r.label, 'LTM EPS = FY25 + 9M YTD − prior YTD (filed): $6.81 + $0.14 − $0.21');
  assert.deepStrictEqual(r.legs.map((l) => l.source), [`10-K ${K}`, `10-Q ${Q}`, `10-Q ${Q}`]);
});
test('a loss is valid: negative EPS is kept', () => {
  const ns = lyft(); ns.EarningsPerShareDiluted.units['USD/shares'][1].val = -3.7;
  assert.strictEqual(standardLtmEps(ns, periods).value, 2.9);
});
test('no comparative in the latest 10-Q: null with the reason (the old 10-Q is not used)', () => {
  const ns = lyft(); ns.EarningsPerShareDiluted.units['USD/shares'].splice(2, 1);
  const r = standardLtmEps(ns, periods);
  assert.strictEqual(r.value, null);
  assert.ok(r.reason.includes(`latest 10-Q (${Q}) files no prior-year diluted EPS`));
});
test('missing FY or YTD: null with the reason', () => {
  const noFy = lyft(); noFy.EarningsPerShareDiluted.units['USD/shares'].splice(0, 1);
  assert.ok(standardLtmEps(noFy, periods).reason.startsWith('no filed FY diluted EPS'));
  const noYtd = lyft(); noYtd.EarningsPerShareDiluted.units['USD/shares'].splice(1, 1);
  assert.ok(standardLtmEps(noYtd, periods).reason.startsWith('no filed year-to-date diluted EPS'));
});
test('a split inside the window: null', () => {
  const r = standardLtmEps(lyft({ StockholdersEquityNoteStockSplitConversionRatio1: { units: { pure: [{ end: '2026-06-15', val: 10, form: '10-Q' }] } } }), periods);
  assert.strictEqual(r.value, null);
  assert.ok(r.reason.includes('stock split'));
});
test('a split before the window does not block', () => {
  const r = standardLtmEps(lyft({ StockholdersEquityNoteStockSplitConversionRatio1: { units: { pure: [{ end: '2024-07-12', val: 10, form: '10-K' }] } } }), periods);
  assert.strictEqual(r.value, 6.74);
});
test('a diluted share count restated more than 20% for a window period: null', () => {
  const ns = lyft(); ns.WeightedAverageNumberOfDilutedSharesOutstanding.units.shares.push(e('2025-01-01', '2025-09-30', 42.03e6, '10-Q', OLDQ, '2025-11-05'));
  const r = standardLtmEps(ns, periods);
  assert.strictEqual(r.value, null);
  assert.ok(r.reason.includes('split or share-class change'));
});
test('a count filed in thousands in one filing is a unit difference, not a restatement', () => {
  const ns = lyft(); ns.WeightedAverageNumberOfDilutedSharesOutstanding.units.shares.push(e('2025-01-01', '2025-09-30', 420300, '10-Q', OLDQ, '2025-11-05'));
  assert.strictEqual(standardLtmEps(ns, periods).value, 6.74);
});
test('VIA (IPO in the window): share counts 16.8M, 32.9M, 81.4M → null, never +$0.79', () => {
  const ns = lyft();
  ns.WeightedAverageNumberOfDilutedSharesOutstanding.units.shares = [e('2025-01-01', '2025-12-31', 32.9e6, '10-K', K, '2026-02-11'), sh('2026-01-01', '2026-09-30', 81.4e6), sh('2025-01-01', '2025-09-30', 16.8e6)];
  const r = standardLtmEps(ns, periods);
  assert.strictEqual(r.value, null);
  assert.strictEqual(r.reason, 'diluted shares moved inside the window (FY 32.9M, YTD 81.4M, prior YTD 16.8M), so FY and YTD EPS are not comparable');
});
test('no share count for a period: null, comparability unconfirmed', () => {
  const ns = lyft(); ns.WeightedAverageNumberOfDilutedSharesOutstanding.units.shares.pop();
  assert.ok(standardLtmEps(ns, periods).reason.startsWith('no diluted share count is filed for all three periods'));
});
test('resolveLtmEps: (a) still wins when the four filed quarters resolve; (b) only when (a) cannot', async () => {
  const withQ4 = lyft(); withQ4.EarningsPerShareDiluted.units['USD/shares'].push(e('2025-10-01', '2025-12-31', 6.6, '10-K', K, '2026-02-11'));
  const a = await resolveLtmEps(withQ4, periods, { fyEps: 6.81, readRelease: async () => null });
  assert.ok(a.label.startsWith('sum of 4 filed quarters'));
  assert.strictEqual(a.value, 6.74);
  const b = await resolveLtmEps(lyft(), periods, { fyEps: 6.81, readRelease: async () => ({ reason: 'release unreadable' }) });
  assert.ok(b.label.startsWith('LTM EPS = FY25'));
  const none = await resolveLtmEps({}, periods, { fyEps: null, readRelease: async () => null });
  assert.strictEqual(none.value, null);
  assert.ok(none.reason.startsWith('four filed quarters: no diluted EPS is tagged; FY + YTD − prior YTD: no diluted EPS is tagged'));
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  process.exit(passed === tests.length ? 0 : 1);
})();
