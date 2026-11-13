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

test('GSAT: preferred stock on the cover is not common stock → one common class → not multi-class (existing resolution kept)', () => {
  const xml = `<xbrl>${ctx('c', '2026-10-30', 'us-gaap:CommonStockMember')}${ctx('p', '2026-10-30', 'us-gaap:PreferredStockMember')}${fact('c', 129619359)}${fact('p', 149425)}</xbrl>`;
  const parsed = parseCoverShares(xml);
  assert.deepStrictEqual(parsed.classes.map((x) => x.member), ['us-gaap:CommonStockMember']);
  assert.strictEqual(sumCoverClasses(parsed, Q3_FILING).value, null);
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
  assert.deepStrictEqual(latestPeriodicFiling(sub), { form: '10-Q', accn: 'q3', filed: '2026-11-09', reportDate: '2026-09-30', primaryDocument: null });
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

// ── Fix 7b Task 8: classes with no economic stake ──
// ASTS's Q3 2026 10-Q (0001193125-26-453759): cover Class A 300,731,460 / B 11,215,111 / C 78,163,078 at 2026-11-05;
// EPS is tagged on CommonClassAMember only; Note 9 says B and C "are non-economic", Note 12 that they "do not participate
// in the earnings or losses of the Company".
const eps = (id, val, name = 'EarningsPerShareBasic') => `<us-gaap:${name} contextRef="${id}" decimals="2" unitRef="usdPerShare">${val}</us-gaap:${name}>`;
const ASTS_Q3 = `<xbrl>${ctx('c-a', '2026-11-05', 'us-gaap:CommonClassAMember')}${ctx('c-b', '2026-11-05', 'us-gaap:CommonClassBMember')}${ctx('c-c', '2026-11-05', 'us-gaap:CommonClassCMember')}
  ${ctx('d-a', null, 'us-gaap:CommonClassAMember')}
  ${fact('c-a', 300731460)}${fact('c-b', 11215111)}${fact('c-c', 78163078)}${eps('d-a', -0.42)}${eps('d-a', -0.42, 'EarningsPerShareDiluted')}</xbrl>`;
const ASTS_TEXT = 'Shares of Class B Common Stock were issued to then existing equity holders of AST LLC and are non-economic, but entitle the holder to one vote per share. '
  + 'Shares of Class C Common Stock were issued to Mr. Avellan and are non-economic, but entitle the holder to ten votes per share. '
  + 'Shares of Class B Common Stock and Class C Common Stock do not participate in the earnings or losses of the Company and are therefore not participating securities.';
const ASTS_FILING = { form: '10-Q', accn: '0001193125-26-453759', filed: '2026-11-09', reportDate: '2026-09-30' };
const { epsClassMembers, nonEconomicClassesInText, economicClasses, needsEconomicCheck } = require('../coverShares');

test('ASTS: XBRL reports EPS for Class A only AND the text calls B and C non-economic → Class A alone, 300,731,460', () => {
  const p = parseCoverShares(ASTS_Q3);
  assert.deepStrictEqual(p.epsMembers, ['us-gaap:CommonClassAMember']);
  assert.strictEqual(needsEconomicCheck(p), true);
  const r = sumCoverClasses(p, ASTS_FILING, economicClasses(p, ASTS_TEXT));
  assert.strictEqual(r.value, 300731460);
  assert.strictEqual(r.label, 'Class A, cover of 10-Q filed 2026-11-09; Class B and Class C excluded: non-economic (no share of earnings or dividends, per the 10-Q)');
  assert.deepStrictEqual(r.excludedClasses.map((x) => x.label), ['Class B', 'Class C']);
});

test('one signal is never enough: the XBRL gap without the text keeps every class (390,109,649)', () => {
  const p = parseCoverShares(ASTS_Q3);
  assert.strictEqual(sumCoverClasses(p, ASTS_FILING, economicClasses(p, 'Holders of Class B vote with Class A.')).value, 390109649);
  assert.strictEqual(sumCoverClasses(p, ASTS_FILING, economicClasses(p, null)).value, 390109649);
});

test('one signal is never enough: the text without an XBRL gap keeps every class (HNGE: one combined EPS)', () => {
  const xml = HNGE_Q3.replace('</xbrl>', `${ctx('d-0', null, null)}${eps('d-0', 0.66)}</xbrl>`);
  const p = parseCoverShares(xml);
  assert.deepStrictEqual(p.epsMembers, []);
  assert.strictEqual(needsEconomicCheck(p), false);
  assert.strictEqual(sumCoverClasses(p, Q3_FILING, economicClasses(p, 'Class B shares are non-economic.')).value, 81271302);
});

test('EPS reported for every class (DDOG two-class, equal amounts) → nothing to check, both classes count', () => {
  const xml = `<xbrl>${ctx('c-a', '2026-10-28', 'us-gaap:CommonClassAMember')}${ctx('c-b', '2026-10-28', 'us-gaap:CommonClassBMember')}
    ${ctx('d-a', null, 'us-gaap:CommonClassAMember')}${ctx('d-b', null, 'us-gaap:CommonClassBMember')}
    ${fact('c-a', 337307033)}${fact('c-b', 23735512)}${eps('d-a', 0.33)}${eps('d-b', 0.33)}</xbrl>`;
  const p = parseCoverShares(xml);
  assert.strictEqual(needsEconomicCheck(p), false);
  assert.strictEqual(sumCoverClasses(p, Q3_FILING, economicClasses(p, null)).value, 361042545);
});

test('the text reader attributes "non-economic" only to the classes named in that sentence', () => {
  const said = nonEconomicClassesInText('Class A common stock carries one vote. ' + ASTS_TEXT);
  assert.deepStrictEqual(Object.keys(said).sort(), ['B', 'C']);
  assert.deepStrictEqual(epsClassMembers('<xbrl></xbrl>', {}), []);
});

test('end to end: the filing text is read only when the XBRL singles a class out', async () => {
  const sub = async () => ({ filings: { recent: { form: ['10-Q'], accessionNumber: [ASTS_FILING.accn], filingDate: [ASTS_FILING.filed], reportDate: [ASTS_FILING.reportDate] } } });
  let reads = 0;
  const r = await multiClassCoverShares('1780312', {}, { readSubmissions: sub, readCover: async () => parseCoverShares(ASTS_Q3), readText: async () => { reads++; return ASTS_TEXT; } });
  assert.strictEqual(r.value, 300731460);
  assert.strictEqual(reads, 1);
  const h = await multiClassCoverShares('1673743', {}, { readSubmissions: sub, readCover: async () => parseCoverShares(HNGE_Q3), readText: async () => { reads++; return ''; } });
  assert.strictEqual(h.value, 81271302);
  assert.strictEqual(reads, 1);   // HNGE: no EPS by class → no text read
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  process.exit(passed === tests.length ? 0 : 1);
})();
