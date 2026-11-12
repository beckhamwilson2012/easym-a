#!/usr/bin/env node
// Run with: node server/services/__tests__/coverShares.test.js
// The multi-class cover count, against inline XBRL snippets: no network. Each test names the rule it pins.
'use strict';
const assert = require('assert');
const { classLabel, parseCoverShares, sumCoverClasses, latestPeriodicFiling, coverInCompanyFacts, multiClassCoverShares } = require('../coverShares');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const ctx = (id, instant, member, dim = 'us-gaap:StatementClassOfStockAxis') => `
  <context id="${id}"><entity><identifier scheme="http://www.sec.gov/CIK">0001673743</identifier>${member ? `<segment><xbrldi:explicitMember dimension="${dim}">${member}</xbrldi:explicitMember></segment>` : ''}</entity>
  <period>${instant ? `<instant>${instant}</instant>` : '<startDate>2026-01-01</startDate><endDate>2026-09-30</endDate>'}</period></context>`;
const fact = (id, val) => `<dei:EntityCommonStockSharesOutstanding contextRef="${id}" decimals="INF" unitRef="shares">${val}</dei:EntityCommonStockSharesOutstanding>`;

// HNGE's Q3 2026 10-Q cover, as filed (0001628280-26-072251): Class A 68,485,043 and Class B 12,786,259 at 2026-10-29.
const HNGE_Q3 = `<xbrl>${ctx('c-1', null, null)}${ctx('c-2', '2026-10-29', 'us-gaap:CommonClassAMember')}${ctx('c-3', '2026-10-29', 'us-gaap:CommonClassBMember')}
  ${fact('c-2', 68485043)}${fact('c-3', 12786259)}</xbrl>`;
const Q3_FILING = { form: '10-Q', accn: '0001628280-26-072251', filed: '2026-11-09', reportDate: '2026-09-30' };

test('HNGE: Class A + Class B on the same cover date sum to 81,271,302, labeled with the form and filing date', () => {
  const r = sumCoverClasses(parseCoverShares(HNGE_Q3), Q3_FILING);
  assert.strictEqual(r.value, 81271302);
  assert.strictEqual(r.date, '2026-10-29');
  assert.strictEqual(r.label, 'Class A + Class B, cover of 10-Q filed 2026-11-09');
});

test('single class, even when dimensioned: not a multi-class cover → null (existing resolution kept)', () => {
  const xml = `<xbrl>${ctx('c-2', '2026-10-29', 'us-gaap:CommonStockMember')}${fact('c-2', 1000)}</xbrl>`;
  const r = sumCoverClasses(parseCoverShares(xml), Q3_FILING);
  assert.strictEqual(r.value, null);
  assert.match(r.reason, /1 share class/);
});

test('undimensioned cover only → null', () => {
  const xml = `<xbrl>${ctx('c-9', '2026-10-29', null)}${fact('c-9', 5000)}</xbrl>`;
  const p = parseCoverShares(xml);
  assert.deepStrictEqual(p.undimensioned, { shares: 5000, date: '2026-10-29' });
  assert.strictEqual(sumCoverClasses(p, Q3_FILING).value, null);
});

test('only the latest cover date is summed; an older date is never added in', () => {
  const xml = `<xbrl>${ctx('a1', '2026-10-29', 'us-gaap:CommonClassAMember')}${ctx('b1', '2026-10-29', 'us-gaap:CommonClassBMember')}
    ${ctx('a0', '2026-07-30', 'us-gaap:CommonClassAMember')}${fact('a1', 100)}${fact('b1', 20)}${fact('a0', 999)}</xbrl>`;
  assert.strictEqual(sumCoverClasses(parseCoverShares(xml), Q3_FILING).value, 120);
});

test('a fact on a non-class dimension (co-registrant) is not a class', () => {
  const xml = `<xbrl>${ctx('a1', '2026-10-29', 'us-gaap:CommonClassAMember')}${ctx('x1', '2026-10-29', 'abc:SubsidiaryMember', 'dei:LegalEntityAxis')}
    ${fact('a1', 100)}${fact('x1', 50)}</xbrl>`;
  const r = sumCoverClasses(parseCoverShares(xml), Q3_FILING);
  assert.strictEqual(r.value, null);
});

test('three classes (A, B, C) all summed', () => {
  const xml = `<xbrl>${ctx('a', '2026-10-20', 'us-gaap:CommonClassAMember')}${ctx('b', '2026-10-20', 'us-gaap:CommonClassBMember')}${ctx('c', '2026-10-20', 'us-gaap:CommonClassCMember')}
    ${fact('a', 5)}${fact('b', 1)}${fact('c', 6)}</xbrl>`;
  const r = sumCoverClasses(parseCoverShares(xml), { form: '10-K', filed: '2027-02-01' });
  assert.strictEqual(r.value, 12);
  assert.strictEqual(r.label, 'Class A + Class B + Class C, cover of 10-K filed 2027-02-01');
});

test('class labels: us-gaap members and custom members', () => {
  assert.strictEqual(classLabel('us-gaap:CommonClassAMember'), 'Class A');
  assert.strictEqual(classLabel('xyz:SeriesOneCommonStockMember'), 'Series One Common Stock');
});

test('latest periodic filing: 10-Q/10-K only, newest filed; 8-K and Form 4 ignored', () => {
  const sub = { filings: { recent: { form: ['144', '10-Q', '8-K', '10-K'], accessionNumber: ['x', 'q3', 'k8', 'k'], filingDate: ['2026-11-10', '2026-11-09', '2026-11-02', '2026-03-03'], reportDate: ['', '2026-09-30', '2026-10-29', '2025-12-31'] } } };
  assert.deepStrictEqual(latestPeriodicFiling(sub), { form: '10-Q', accn: 'q3', filed: '2026-11-09', reportDate: '2026-09-30' });
});

test('companyfacts already holds an undimensioned cover count from that filing → single class, no instance read', async () => {
  const dei = { EntityCommonStockSharesOutstanding: { units: { shares: [{ accn: 'q3', val: 4301e6, end: '2026-10-20' }] } } };
  assert.strictEqual(coverInCompanyFacts(dei, { accn: 'q3' }), true);
  let read = 0;
  const r = await multiClassCoverShares('1', dei, {
    readSubmissions: async () => ({ filings: { recent: { form: ['10-Q'], accessionNumber: ['q3'], filingDate: ['2026-11-01'], reportDate: ['2026-09-30'] } } }),
    readCover: async () => { read++; return parseCoverShares(HNGE_Q3); },
  });
  assert.strictEqual(r, null);
  assert.strictEqual(read, 0);
});

test('multi-class filer end to end: no dei in companyfacts → instance read → summed', async () => {
  const r = await multiClassCoverShares('1673743', {}, {
    readSubmissions: async () => ({ filings: { recent: { form: ['10-Q'], accessionNumber: [Q3_FILING.accn], filingDate: [Q3_FILING.filed], reportDate: [Q3_FILING.reportDate] } } }),
    readCover: async () => parseCoverShares(HNGE_Q3),
  });
  assert.strictEqual(r.value, 81271302);
  assert.strictEqual(r.accn, Q3_FILING.accn);
});

test('unreadable instance or submissions → null, never a guess, never throws', async () => {
  const sub = async () => ({ filings: { recent: { form: ['10-Q'], accessionNumber: ['q'], filingDate: ['2026-11-09'], reportDate: ['2026-09-30'] } } });
  assert.strictEqual(await multiClassCoverShares('1', {}, { readSubmissions: sub, readCover: async () => null }), null);
  assert.strictEqual(await multiClassCoverShares('1', {}, { readSubmissions: async () => { throw new Error('503'); } }), null);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  process.exit(passed === tests.length ? 0 : 1);
})();
