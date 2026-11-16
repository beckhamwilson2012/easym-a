#!/usr/bin/env node
// Run with: node server/services/__tests__/cashYield.test.js
// Fix 14 Task 2: a company's realized yield on cash = interest income ÷ average (cash + short-term investments). No network.
'use strict';
const assert = require('assert');
const { realizedYield, yearEarlierDate, bucketAt } = require('../cashYield');
const { fyCashYield } = require('../ltmCalc');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
const inst = (end, val) => ({ end, val, form: '10-Q', filed: '2026-11-06' });

// OMDA-like balance sheet: cash at 2025-09-30 and 2026-09-30, short-term investments only at the later date.
const gaap = {
  CashAndCashEquivalentsAtCarryingValue: { units: { USD: [inst('2024-12-31', 100e6), inst('2025-09-30', 200e6), inst('2025-12-31', 198.4e6), inst('2026-09-30', 243e6)] } },
  ShortTermInvestments: { units: { USD: [inst('2026-09-30', 0.8e6)] } },
  InvestmentIncomeInterest: { units: { USD: [{ start: '2025-01-01', end: '2025-12-31', val: 5.3e6, form: '10-K', fy: 2025, fp: 'FY', filed: '2026-03-05' }] } },
};

test('LTM yield: interest ÷ average of the two ends, cash + ST investments (none tagged → cash only)', () => {
  const y = realizedYield(gaap, { value: 7.5e6, concept: 'InvestmentIncomeInterest', period: 'LTM' }, '2026-09-30');
  assert.strictEqual(y.start, '2025-09-30');
  assert.ok(Math.abs(y.value - 7.5 / ((200 + 243.8) / 2)) < 1e-12);
  assert.ok(/^3\.4% realized: LTM interest income \$7\.5M ÷ average cash & short-term investments \$221\.9M \(2025-09-30 and 2026-09-30\)$/.test(y.label), y.label);
});

test('FY yield reads the 10-K full-year interest income', () => {
  const y = fyCashYield({ facts: { 'us-gaap': gaap } }, '2025-12-31');
  assert.ok(Math.abs(y.value - 5.3 / ((100 + 198.4) / 2)) < 1e-12);
  assert.ok(y.label.startsWith('3.6% realized: FY2025 interest income $5.3M'));
});

test('no interest-income tag (e.g. only "interest and other income") → null with the reason, never a yield', () => {
  const y = realizedYield(gaap, null, '2026-09-30');
  assert.strictEqual(y.value, null);
  assert.ok(/no interest income tagged/.test(y.reason));
  const fy = fyCashYield({ facts: { 'us-gaap': { ...gaap, InvestmentIncomeInterest: undefined } } }, '2025-12-31');
  assert.strictEqual(fy.value, null);
});

test('cash missing at either end → null; a non-positive interest figure → null', () => {
  assert.strictEqual(realizedYield(gaap, { value: 1e6, period: 'LTM' }, '2026-06-30').value, null);
  assert.strictEqual(realizedYield(gaap, { value: -1e6, period: 'LTM' }, '2026-09-30').value, null);
});

test('helpers: a year earlier within 10 days; IFRS is not read', () => {
  assert.strictEqual(yearEarlierDate(gaap, '2026-09-30'), '2025-09-30');
  assert.strictEqual(bucketAt(gaap, '2026-09-30').val, 243.8e6);
  assert.strictEqual(fyCashYield({ facts: {} }, '2025-12-31', true).value, null);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  process.exit(passed === tests.length ? 0 : 1);
})();
