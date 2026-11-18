#!/usr/bin/env node
// Run with: node server/services/__tests__/registrationStatus.test.js
// Deregistered or not, from the submissions JSON alone. Shapes are the filings EDGAR showed on 2026-11-18. No network.
'use strict';
const assert = require('assert');
const { deregistration, deregisteredMessage } = require('../registrationStatus');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const sub = (name, tickers, rows) => ({ name, tickers, filings: { recent: { form: rows.map((r) => r[0]), filingDate: rows.map((r) => r[1]) } } });

test('TALK: 15-12G after the last 10-Q, no ticker left: blocked on the Form 15, not the earlier 25-NSE', () => {
  const d = deregistration(sub('Talkspace, Inc.', [], [['15-12G', '2026-08-27'], ['25-NSE', '2026-08-17'], ['10-Q', '2026-08-06']]), 'TALK');
  assert.deepStrictEqual(d, { name: 'Talkspace, Inc.', date: '2026-08-27', form: '15-12G' });
  assert.strictEqual(deregisteredMessage(d), 'Talkspace, Inc. deregistered with the SEC on 2026-08-27 (Form 15-12G); no current filings');
});
test('WBD: a 15-12G among same-day 15-15Ds names the event', () => {
  const d = deregistration(sub('Warner Bros. Discovery, Inc.', [], [['15-15D', '2026-10-16'], ['15-12G', '2026-10-16'], ['15-15D', '2026-10-16'], ['10-Q', '2026-08-06']]), 'WBD');
  assert.strictEqual(d.form, '15-12G');
});
test('a 25-NSE alone blocks only a registrant with no listed ticker', () => {
  assert.strictEqual(deregistration(sub('Gone Co', [], [['25-NSE', '2026-09-01'], ['10-Q', '2026-08-01']]), 'GONE').form, '25-NSE');
  assert.strictEqual(deregistration(sub('Renamed Co', ['NEWT'], [['25-NSE', '2026-09-01'], ['10-Q', '2026-08-01']]), 'OLDT'), null);
});
test('AAPL: a 25-NSE on a note after the 10-K, ticker still listed: not blocked', () => {
  assert.strictEqual(deregistration(sub('Apple Inc.', ['AAPL'], [['25-NSE', '2026-11-09'], ['10-K', '2026-11-03']]), 'AAPL'), null);
});
test('a Form 15 for another class while the ticker is listed: not blocked', () => {
  assert.strictEqual(deregistration(sub('ONEOK INC', ['OKE'], [['15-12G', '2026-09-28'], ['10-Q', '2026-08-01']]), 'OKE'), null);
});
test('a periodic report after the Form 15 clears it', () => {
  assert.strictEqual(deregistration(sub('Back Co', [], [['10-Q', '2026-10-01'], ['15-12G', '2026-09-01']]), 'BACK'), null);
});
test('TM: a 20-F filer with no 10-Q is not blocked', () => {
  assert.strictEqual(deregistration(sub('TOYOTA MOTOR CORP/', ['TM', 'TOYOF'], [['6-K', '2026-11-01'], ['20-F', '2026-06-10']]), 'TM'), null);
});
test('a 40-F counts as a periodic report', () => {
  assert.strictEqual(deregistration(sub('Canada Co', [], [['40-F', '2026-03-01'], ['15-12B', '2026-02-01']]), 'CANA'), null);
});
test('an amended 10-K/A does not hide a later deregistration', () => {
  assert.strictEqual(deregistration(sub('Late Co', [], [['10-K/A', '2026-10-01'], ['15-12G', '2026-09-01'], ['10-Q', '2026-08-01']]), 'LATE').form, '15-12G');
});
test('no filings at all, or a malformed payload: unknown, so not blocked', () => {
  assert.strictEqual(deregistration(sub('Empty', [], []), 'E'), null);
  assert.strictEqual(deregistration({}, 'E'), null);
  assert.strictEqual(deregistration(null, 'E'), null);
});

for (const [name, fn] of tests) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n${e.stack}`); process.exitCode = 1; }
}
console.log(`${passed}/${tests.length} passed`);
