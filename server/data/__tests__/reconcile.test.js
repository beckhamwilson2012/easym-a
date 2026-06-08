#!/usr/bin/env node
// Run with: node server/data/__tests__/reconcile.test.js
'use strict';
const assert = require('assert');
const { reconcile } = require('../reconcile');
const { periodsMatch, periodGuardExcludes, sanePriceTarget } = require('../../services/verifiedLookup');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const priceField   = { key: 'price',   sources: ['fmp','yahoo'], sot: 'fmp',   tol: 0.005 };
const revenueField = { key: 'revenue', sources: ['edgar','fmp'], sot: 'edgar', tol: 0.002, period: true };
const targetField  = { key: 'analystTargetMean', sources: ['fmp'], sot: 'fmp', tol: 0, single: true };

console.log('\nreconcile() unit tests\n');

test('verified — two sources agree within tol', () => {
  const r = reconcile(priceField, { fmp: 189.30, yahoo: 189.28 });
  assert.strictEqual(r.status, 'verified');
  assert.strictEqual(r.value, 189.30);
  assert.strictEqual(r.chosenSource, 'fmp');
});

test('flagged — two sources disagree beyond tol', () => {
  const r = reconcile(priceField, { fmp: 189.30, yahoo: 188.00 });
  assert.strictEqual(r.status, 'flagged');
  assert.strictEqual(r.value, 189.30, 'SOT value must be used even when flagged');
  assert(r.maxDev > 0.005);
});

test('single — one non-declared-single source', () => {
  const r = reconcile(revenueField, { edgar: 5215, fmp: null });
  assert.strictEqual(r.status, 'single');
  assert.strictEqual(r.value, 5215);
});

test('verified — declared single-source field with one source', () => {
  const r = reconcile(targetField, { fmp: 210.0 });
  assert.strictEqual(r.status, 'verified');
  assert.strictEqual(r.value, 210.0);
});

test('missing — all sources null', () => {
  const r = reconcile(priceField, { fmp: null, yahoo: null });
  assert.strictEqual(r.status, 'missing');
  assert.strictEqual(r.value, null);
});

test('EDGAR wins on conflict — value is SOT, status flagged', () => {
  const r = reconcile(revenueField, { edgar: 5215, fmp: 5300 });
  // |5300-5215|/5215 = 0.0163 > 0.002
  assert.strictEqual(r.status, 'flagged');
  assert.strictEqual(r.value, 5215, 'EDGAR is SOT, must be used');
});

test('verified financials within tight tol', () => {
  const r = reconcile(revenueField, { edgar: 5215, fmp: 5213 });
  // |5213-5215|/5215 = 0.000384 < 0.002
  assert.strictEqual(r.status, 'verified');
});

test('SOT absent — falls back to first present source', () => {
  const r = reconcile(revenueField, { edgar: null, fmp: 5215 });
  assert.strictEqual(r.status, 'single');
  assert.strictEqual(r.chosenSource, 'fmp');
  assert.strictEqual(r.value, 5215);
});

test('NaN values treated as absent', () => {
  const r = reconcile(priceField, { fmp: NaN, yahoo: 189.30 });
  assert.strictEqual(r.status, 'single');
  assert.strictEqual(r.chosenSource, 'yahoo');
});

// ── Period-match guard (the FY25-vs-FY26 class of error) ──────────────────────
const EDGAR_FY26 = { fy: 2026, fp: 'FY', form: '10-K' };

test('periodsMatch — same fiscal year', () => {
  assert.strictEqual(periodsMatch(EDGAR_FY26, { calendarYear: '2026', period: 'FY' }), true);
  assert.strictEqual(periodsMatch(EDGAR_FY26, { calendarYear: '2025', period: 'FY' }), false);
});

test('periodGuardExcludes — excludes a non-EDGAR source from a DIFFERENT fiscal year', () => {
  // revenueField has period:true. FMP FY2025 vs EDGAR FY2026 → excluded.
  assert.strictEqual(periodGuardExcludes(revenueField, 'fmp', EDGAR_FY26, { calendarYear: '2025' }), true);
  // Same year → not excluded (allowed to compare).
  assert.strictEqual(periodGuardExcludes(revenueField, 'fmp', EDGAR_FY26, { calendarYear: '2026' }), false);
  // EDGAR itself is never excluded; non-period fields never excluded.
  assert.strictEqual(periodGuardExcludes(revenueField, 'edgar', EDGAR_FY26, { calendarYear: '2025' }), false);
  assert.strictEqual(periodGuardExcludes(priceField, 'yahoo', EDGAR_FY26, { calendarYear: '2025' }), false);
});

test('guard prevents FALSE agreement — different period, same value → single (not verified)', () => {
  // EDGAR FY2026 = 41525; FMP FY2025 happens to also = 41525. Comparing them would falsely "verify".
  const fmpExcluded = periodGuardExcludes(revenueField, 'fmp', EDGAR_FY26, { calendarYear: '2025' });
  const values = { edgar: 41525, fmp: fmpExcluded ? null : 41525 };
  const r = reconcile(revenueField, values);
  assert.strictEqual(r.status, 'single', 'cross-period match must NOT be reported as verified');
  assert.strictEqual(r.value, 41525);
});

test('guard prevents FALSE disagreement — different period, different value → single (not flagged)', () => {
  // EDGAR FY2026 = 41525; FMP FY2025 = 35000. Comparing them would falsely "flag" a disagreement.
  const fmpExcluded = periodGuardExcludes(revenueField, 'fmp', EDGAR_FY26, { calendarYear: '2025' });
  const values = { edgar: 41525, fmp: fmpExcluded ? null : 35000 };
  const r = reconcile(revenueField, values);
  assert.strictEqual(r.status, 'single', 'cross-period mismatch must NOT be reported as flagged');
  assert.strictEqual(r.value, 41525);
});

test('guard allows SAME-period comparison through to reconcile', () => {
  const fmpExcluded = periodGuardExcludes(revenueField, 'fmp', EDGAR_FY26, { calendarYear: '2026' });
  const values = { edgar: 41525, fmp: fmpExcluded ? null : 41520 };
  const r = reconcile(revenueField, values);
  assert.strictEqual(r.status, 'verified', 'same-period agreeing sources → verified');
});

// ── Analyst-target sanity band (parse-error guard) ───────────────────────────
test('sanePriceTarget — accepts a plausible target within [0.2x, 5x] of price', () => {
  assert.strictEqual(sanePriceTarget(557.64, 411.74), true);  // MSFT mean vs price = 1.35x
  assert.strictEqual(sanePriceTarget(130.45, 97.89), true);   // TEAM
});

test('sanePriceTarget — rejects parse errors (10x misread, decimal slip, non-positive)', () => {
  assert.strictEqual(sanePriceTarget(4117.40, 411.74), false); // 10x misread
  assert.strictEqual(sanePriceTarget(41.17, 411.74), false);   // 0.1x (decimal slip / wrong field)
  assert.strictEqual(sanePriceTarget(0, 411.74), false);
  assert.strictEqual(sanePriceTarget(-50, 411.74), false);
  assert.strictEqual(sanePriceTarget(null, 411.74), false);
});

test('sanePriceTarget — no price to band-check → accept any positive value', () => {
  assert.strictEqual(sanePriceTarget(557.64, null), true);
  assert.strictEqual(sanePriceTarget(557.64, 0), true);
  assert.strictEqual(sanePriceTarget(-1, null), false); // still must be positive
});

console.log(`\n${passed}/17 tests passed\n`);
