#!/usr/bin/env node
// Run with: node server/services/__tests__/debtZero.test.js
// Debt that is zero by a filing's own statement, never by absence. Inline filings: no network.
'use strict';
const assert = require('assert');
const { nonZeroDebtFacts, nothingDrawnStatement, noteNumber, filedZero, resolveZeroDebt } = require('../debtZero');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const ctx = (id, instant, dims = '') => `<context id="${id}"><entity><identifier scheme="x">1</identifier>${dims ? `<segment>${dims}</segment>` : ''}</entity><period><instant>${instant}</instant></period></context>`;
const revolverDims = '<xbrldi:explicitMember dimension="us-gaap:CreditFacilityAxis">us-gaap:RevolvingCreditFacilityMember</xbrldi:explicitMember>';
// PGNY's Q3 2026 debt note, as filed (0001551306-26-000170), HTML-escaped inside the text block the way the instance carries it.
const PGNY_NOTE = '&lt;span&gt;Debt&lt;/span&gt;&lt;div&gt;On July 1, 2025, the Company entered into a revolving credit facility (the &#x201c;Facility&#x201d;) pursuant to a Credit Agreement. The Credit Agreement makes available to the Company a maximum aggregate amount of $200 million. As of the date of this filing, no amounts were drawn under the Facility.&lt;/div&gt;';
const pgnyXml = (lineOfCredit = 0) => `<xbrl>${ctx('c-91', '2026-09-30', revolverDims)}<us-gaap:LineOfCredit contextRef="c-91" decimals="0" unitRef="usd">${lineOfCredit}</us-gaap:LineOfCredit>
  <us-gaap:LineOfCreditFacilityMaximumBorrowingCapacity contextRef="c-91" unitRef="usd">200000000</us-gaap:LineOfCreditFacilityMaximumBorrowingCapacity>
  <us-gaap:DebtDisclosureTextBlock contextRef="c-1" id="f-474">${PGNY_NOTE}</us-gaap:DebtDisclosureTextBlock></xbrl>`;
const PGNY_DOC = '<p>5. Leases ...</p><p>6. Debt</p><p>On July 1, 2025, the Company entered into a revolving credit facility. As of the date of this filing, no amounts were drawn under the Facility.</p><p>7. Stockholders</p>';
const sub = (form, accn, reportDate) => async () => ({ filings: { recent: { form: [form], accessionNumber: [accn], filingDate: ['2026-11-05'], reportDate: [reportDate], primaryDocument: ['doc.htm'] } } });
const omdaGaap = { LongTermDebt: { units: { USD: [
  { end: '2024-12-31', val: 29771000, form: '10-K', filed: '2026-03-06', accn: 'k' },
  { end: '2025-06-30', val: 29966000, form: '10-Q', filed: '2025-08-08', accn: 'q2' },
  { end: '2025-09-30', val: 0, form: '10-Q', filed: '2025-11-07', accn: 'q3' },
  { end: '2025-12-31', val: 0, form: '10-K', filed: '2026-03-06', accn: '0001628280-26-015637' },
] } } };
const emptyQ3 = `<xbrl>${ctx('c-1', '2026-09-30')}</xbrl>`;

test('PGNY: the debt note says nothing is drawn → $0, labeled with form, date and note number', async () => {
  const r = await resolveZeroDebt('1551306', {}, '2025-12-31', { readSubmissions: sub('10-Q', '0001551306-26-000170', '2026-09-30'), readInstanceXml: async () => pgnyXml(0), readPrimaryDocument: async () => PGNY_DOC });
  assert.strictEqual(r.value, 0);
  assert.strictEqual(r.label, '$0, nothing drawn on revolver, 10-Q 9/30/2026 note 6');
  assert.match(r.source.sentence, /no amounts were drawn under the Facility/);
});

test('a drawn balance on the facility (any dimension) contradicts the note → null, not 0', async () => {
  const r = await resolveZeroDebt('1', {}, '2025-12-31', { readSubmissions: sub('10-Q', 'a', '2026-09-30'), readInstanceXml: async () => pgnyXml(40000000), readPrimaryDocument: async () => PGNY_DOC });
  assert.strictEqual(r.value, null);
  assert.match(r.reason, /LineOfCredit 40,000,000/);
});

test('OMDA: LongTermDebt 0 in the FY2025 10-K, nothing later → $0, "10-K FY2025, no later debt tag"', async () => {
  const r = await resolveZeroDebt('1611115', omdaGaap, '2025-12-31', { readSubmissions: sub('10-Q', 'q3-26', '2026-09-30'), readInstanceXml: async () => emptyQ3, readPrimaryDocument: async () => null });
  assert.strictEqual(r.value, 0);
  assert.strictEqual(r.label, '$0, 10-K FY2025, no later debt tag');
  assert.strictEqual(r.source.concept, 'LongTermDebt');
  assert.strictEqual(r.source.accn, '0001628280-26-015637');
});

test('HNGE: no debt concept, no debt note → null with the reason (absence is never zero)', async () => {
  const r = await resolveZeroDebt('1673743', { Assets: { units: { USD: [{ end: '2026-09-30', val: 1, form: '10-Q' }] } } }, '2025-12-31', { readSubmissions: sub('10-Q', 'h', '2026-09-30'), readInstanceXml: async () => emptyQ3, readPrimaryDocument: async () => null });
  assert.strictEqual(r.value, null);
  assert.strictEqual(r.reason, 'no debt concept is tagged in any 10-K or 10-Q, and no filing states zero debt (checked through the 10-Q 9/30/2026)');
});

test('the latest debt tag non-zero → null (a stale balance is not zero either)', () => {
  const g = { LongTermDebt: { units: { USD: [{ end: '2025-12-31', val: 5e6, form: '10-K', filed: '2026-03-01' }] } } };
  assert.match(filedZero(g, '2025-12-31').reason, /non-zero/);
});

test('a zero older than the latest 10-K is not accepted', () => {
  const g = { LongTermDebt: { units: { USD: [{ end: '2023-12-31', val: 0, form: '10-K', filed: '2024-03-01' }] } } };
  assert.match(filedZero(g, '2025-12-31').reason, /older than the latest 10-K/);
});

test('a zero and a non-zero on the same date: contradiction → null', () => {
  const g = { LongTermDebt: { units: { USD: [{ end: '2025-12-31', val: 0, form: '10-K' }] } }, ConvertibleDebtNoncurrent: { units: { USD: [{ end: '2025-12-31', val: 9e8, form: '10-K' }] } } };
  assert.strictEqual(filedZero(g, '2025-12-31').end, undefined);
});

test('duration facts (repayments) never count as a balance', () => {
  const g = { LongTermDebt: { units: { USD: [{ start: '2025-01-01', end: '2025-12-31', val: 0, form: '10-K' }] } } };
  assert.match(filedZero(g, '2025-12-31').reason, /no debt concept/);
});

test('unreadable latest filing → null with the reason; never throws', async () => {
  const r = await resolveZeroDebt('1', omdaGaap, '2025-12-31', { readSubmissions: sub('10-Q', 'x', '2026-09-30'), readInstanceXml: async () => null });
  assert.strictEqual(r.value, null);
  assert.match(r.reason, /could not be read/);
  const r2 = await resolveZeroDebt('1', omdaGaap, '2025-12-31', { readSubmissions: async () => { throw new Error('503'); } });
  assert.strictEqual(r2.value, null);
});

test('a debt note that only describes a facility (no "nothing drawn" sentence) is not a statement of zero', () => {
  const xml = `<xbrl><us-gaap:DebtDisclosureTextBlock contextRef="c">Debt On July 1, 2025, we entered into a revolving credit facility of $200 million. Borrowings may be repaid at any time.</us-gaap:DebtDisclosureTextBlock></xbrl>`;
  assert.strictEqual(nothingDrawnStatement(xml), null);
});

test('FFIV: "At the time of expiration, there were no outstanding borrowings" is about a past facility → not a statement of zero', () => {
  const xml = '<xbrl><us-gaap:DebtDisclosureTextBlock contextRef="c">Debt In 2021 we entered into a revolving credit facility. The Revolving Credit Facility expired in April 2026. At the time of expiration, there were no outstanding borrowings under the Revolving Credit Facility.</us-gaap:DebtDisclosureTextBlock></xbrl>';
  assert.strictEqual(nothingDrawnStatement(xml), null);
});

test('MNST: "As of September 30, 2026, no borrowings were outstanding under the Credit Facilities" → a statement of zero', () => {
  const xml = '<xbrl><us-gaap:DebtDisclosureTextBlock contextRef="c">Debt The Company has a revolving credit facility. As of September 30, 2026, no borrowings were outstanding under the Credit Facilities, and the Company was in compliance with all covenants.</us-gaap:DebtDisclosureTextBlock></xbrl>';
  assert.match(nothingDrawnStatement(xml).sentence, /^As of September 30, 2026, no borrowings were outstanding/);
});

test('helpers: non-zero facts only at the balance-sheet date; note number nearest before the sentence', () => {
  const xml = `<xbrl>${ctx('a', '2026-09-30')}${ctx('b', '2025-12-31')}<us-gaap:LongTermDebt contextRef="b">7</us-gaap:LongTermDebt><us-gaap:LongTermDebt contextRef="a">0</us-gaap:LongTermDebt></xbrl>`;
  assert.deepStrictEqual(nonZeroDebtFacts(xml, '2026-09-30'), []);
  assert.strictEqual(noteNumber(PGNY_DOC, 'Debt', 'As of the date of this filing, no amounts were drawn under the Facility.'), '6');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  process.exit(passed === tests.length ? 0 : 1);
})();
