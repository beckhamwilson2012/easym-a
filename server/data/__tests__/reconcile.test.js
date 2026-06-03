#!/usr/bin/env node
// Run with: node server/data/__tests__/reconcile.test.js
'use strict';
const assert = require('assert');
const { reconcile } = require('../reconcile');

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

console.log(`\n${passed}/9 tests passed\n`);
