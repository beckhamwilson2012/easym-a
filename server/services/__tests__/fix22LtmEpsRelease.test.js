#!/usr/bin/env node
// Run with: node server/services/__tests__/fix22LtmEpsRelease.test.js
// Fix 22 Task 4: a release whose EPS row does not say "diluted" is read only when that row's full-year figure is the filed
// diluted EPS. Shapes are PRU's and MET's FY2025 releases, cut down to the rows that matter. No network.
'use strict';
const assert = require('assert');
const { releaseQuarterEps } = require('../ltmEps');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const table = (rows) => `<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
const head = [['', 'Three Months Ended December 31,', '', 'Year Ended December 31,', ''], ['', '2025', '2024', '2025', '2024']];

const pru = table([...head,
  ['Earnings per share of Common Stock:', '', '', '', ''],
  ['Net income (loss) attributable to Prudential Financial, Inc.', '2.55', '(0.17)', '9.99', '7.50'],
  ['Weighted average number of outstanding common shares - diluted', '350.9', '357.3', '353.7', '359.3'],
  ['For earnings per share of Common Stock calculation:', '', '', '', ''],
  ['Net income (loss) attributable to Prudential Financial, Inc.', '905', '(57)', '3,576', '2,727'],
]);

test('PRU: the row under the EPS header, tied to the filed 9.99', () => {
  assert.strictEqual(releaseQuarterEps(pru, { fyEndYear: 2025, fyEps: 9.99 }).value, 2.55);
});
test('MET: "Net income (loss) per share"', () => {
  const met = table([...head, ['Net income (loss) per share', '1.17', '1.78', '4.71', '5.94']]);
  assert.strictEqual(releaseQuarterEps(met, { fyEndYear: 2025, fyEps: 4.71 }).value, 1.17);
});
test('a full-year figure that does not tie gives no value, with the reason', () => {
  const r = releaseQuarterEps(pru, { fyEndYear: 2025, fyEps: 10.05 });
  assert.strictEqual(r.value, undefined);
  assert.ok(r.reason.includes('ties to the filed FY EPS 10.05'));
});
test('basic and adjusted rows are never read', () => {
  const basic = table([...head, ['Net income per share - basic', '2.60', '0', '9.99', '0']]);
  const adjusted = table([...head, ['Adjusted net income per share', '3.30', '0', '9.99', '0']]);
  assert.strictEqual(releaseQuarterEps(basic, { fyEndYear: 2025, fyEps: 9.99 }).value, undefined);
  assert.strictEqual(releaseQuarterEps(adjusted, { fyEndYear: 2025, fyEps: 9.99 }).value, undefined);
});
test('two tied rows with different Q4 figures give no value', () => {
  const two = table([...head, ['Net income per share', '1.00', '0', '4.00', '0'], ['Net earnings per share', '1.10', '0', '4.00', '0']]);
  assert.ok(releaseQuarterEps(two, { fyEndYear: 2025, fyEps: 4 }).reason.includes('two different Q4'));
});
test('a row that says diluted still wins, by the original rule', () => {
  const both = table([...head, ['Net income per share', '9.00', '0', '4.00', '0'], ['Diluted earnings per share', '1.00', '0', '4.00', '0']]);
  assert.strictEqual(releaseQuarterEps(both, { fyEndYear: 2025, fyEps: 4 }).value, 1);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  process.exit(passed === tests.length ? 0 : 1);
})();
