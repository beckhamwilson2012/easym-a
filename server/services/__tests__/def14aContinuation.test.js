#!/usr/bin/env node
// Run with: node server/services/__tests__/def14aContinuation.test.js
// Fix 14 Task 5: a beneficial-ownership table split across a page break is read as one (OMDA 2026 proxy). No network.
'use strict';
const assert = require('assert');
const { findOwnershipTable, parseWithContinuations, continuationTables } = require('../def14aParser');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const head = '<tr><td style="p">Name of Beneficial Owner</td><td style="p">Shares of Common Stock (#)</td><td style="p">Percent of Shares Outstanding (%)</td></tr>';
const row = (n, s, p) => `<tr><td style="p">${n}</td><td style="p">${s}</td><td style="p">${p}</td></tr>`;
// OMDA's layout, as filed (0001628280-26-027923): officers and directors, a page footer, then the 5% holders.
const T1 = `<table>${head}<tr><td style="p">Named Executive Officers and Directors:</td></tr>${row('Sean Duffy (1)', '1,971,076', '3.26')}${row('Wei-Li Shao (2)', '705,955', '1.17')}${row('All current directors and executive officers as a group (10 persons) (11)', '3,973,442', '6.38')}</table>`;
const T2 = `<table>${head}<tr><td style="p">Other Greater Than 5% Stockholders:</td></tr>${row('Entities Affiliated with Revelation Partners (12)', '5,208,034', '8.77')}${row('FMR LLC (14)', '4,911,500', '8.27')}${row('Cigna Ventures, LLC (16)', '3,444,630', '5.80')}</table>`;
const OMDA = `<p>Security Ownership of Certain Beneficial Owners and Management. The following table … more than 5% …</p>${T1}<p>Omada Health, Inc. 39 2026 Proxy Statement Table of Contents</p>${T2}<p>* Represents beneficial ownership of less than 1%.</p>`;

test('OMDA: the 5% holders after the page break are read, under the 5% heading', () => {
  const tbl = findOwnershipTable(OMDA);
  const p = parseWithContinuations(OMDA, tbl);
  assert.strictEqual(p.continuedTables, 1);
  const five = p.holders.filter((h) => h.section === '5% holder').map((h) => [h.name, h.shares, h.pct]);
  assert.deepStrictEqual(five, [['Entities Affiliated with Revelation Partners', 5208034, 8.77], ['FMR LLC', 4911500, 8.27], ['Cigna Ventures, LLC', 3444630, 5.8]]);
  assert.strictEqual(p.holders.filter((h) => h.section === 'insider').length, 3);
});

test('a table far after the ownership table, or without the beneficial-owner header, is not a continuation', () => {
  const far = `${T1}<p>${'x'.repeat(2000)}</p>${T2}`;
  assert.strictEqual(continuationTables(far, findOwnershipTable(far)).length, 0);
  const other = `${T1}<p>page</p><table><tr><td style="p">Fiscal year</td><td style="p">Fees</td></tr><tr><td style="p">Audit</td><td style="p">1,000,000</td></tr></table>`;
  assert.strictEqual(continuationTables(other, findOwnershipTable(other)).length, 0);
});

test('a single table parses exactly as before (no continuation, holders unchanged)', () => {
  const one = `${T1}<p>Equity compensation plan information follows on the next page with many words. ${'y'.repeat(700)}</p>`;
  const p = parseWithContinuations(one, findOwnershipTable(one));
  assert.strictEqual(p.continuedTables, 0);
  assert.strictEqual(p.holders.length, 3);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  process.exit(passed === tests.length ? 0 : 1);
})();
