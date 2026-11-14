#!/usr/bin/env node
// Run with: node server/services/__tests__/debtZero.test.js
// Debt that is zero by a filing's own statement, never by absence. Inline filings: no network.
'use strict';
const assert = require('assert');
const { nonZeroDebtFacts, nothingDrawnStatement, noteNumber, filedZero, resolveZeroDebt, classifyLiability, finalDebt } = require('../debtZero');

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

test('no debt concept, no debt note, no readable balance sheet → null with the reason (absence is never zero)', async () => {
  const r = await resolveZeroDebt('1673743', { Assets: { units: { USD: [{ end: '2026-09-30', val: 1, form: '10-Q' }] } } }, '2025-12-31', { readSubmissions: sub('10-Q', 'h', '2026-09-30'), readInstanceXml: async () => emptyQ3, readPrimaryDocument: async () => null, readPresentationXml: async () => null });
  assert.strictEqual(r.value, null);
  assert.strictEqual(r.reason, 'no debt concept is tagged in any 10-K or 10-Q, and no filing states zero debt (checked through the 10-Q 9/30/2026); the balance sheet does not prove zero: its balance sheet could not be read from the filing');
});

// ── C. Balance-sheet proof (Fix 9) ──
// A filing's balance sheet as its presentation linkbase and instance carry it: `current` lines under the current heading
// with the LiabilitiesCurrent subtotal, `noncurrent` lines after it, then Total liabilities. Values in dollars.
function bsFiling({ current, noncurrent = [], total, currentTotal, date = '2026-09-30', negate = [], noTotal = false }) {
  let n = 0;
  const loc = (qn) => { const l = `loc_${qn.replace(':', '_')}_${n++}`; return { l, xml: `<link:loc xlink:type="locator" xlink:label="${l}" xlink:href="x.xsd#${qn.replace(':', '_')}"/>` }; };
  const parts = []; const arc = (from, to, order, qn) => parts.push(`<link:presentationArc order="${order}" xlink:arcrole="parent-child" xlink:from="${from}" xlink:to="${to}"${negate.includes(qn) ? ' preferredLabel="http://www.xbrl.org/2009/role/negatedLabel"' : ''}/>`);
  const node = (qn) => { const x = loc(qn); parts.push(x.xml); return x.l; };
  const root = node('us-gaap:StatementLineItems');
  const assets = node('us-gaap:Assets'); arc(root, assets, 1, 'us-gaap:Assets');
  const lse = node('us-gaap:LiabilitiesAndStockholdersEquityAbstract'); arc(root, lse, 2);
  const liab = node('us-gaap:LiabilitiesAbstract'); arc(lse, liab, 1);
  const cur = node('us-gaap:LiabilitiesCurrentAbstract'); arc(liab, cur, 1);
  current.forEach(([qn], i) => arc(cur, node(qn), i + 1, qn));
  arc(cur, node('us-gaap:LiabilitiesCurrent'), current.length + 1);
  noncurrent.forEach(([qn], i) => arc(liab, node(qn), i + 2, qn));
  if (!noTotal) arc(liab, node('us-gaap:Liabilities'), noncurrent.length + 2);
  arc(lse, node('us-gaap:LiabilitiesAndStockholdersEquity'), 9);
  const pre = `<link:linkbase><link:presentationLink xlink:role="http://x.com/role/CONDENSEDCONSOLIDATEDBALANCESHEETS" xlink:type="extended">${parts.join('')}</link:presentationLink></link:linkbase>`;
  const fact = (qn, v) => `<${qn} contextRef="c-1" decimals="-3" unitRef="usd">${v}</${qn}>`;
  const all = [...current, ...noncurrent];
  const xml = `<xbrl>${ctx('c-1', date)}${ctx('c-2', date, revolverDims)}<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>`
    + all.filter(([, v]) => v != null).map(([qn, v]) => fact(qn, v)).join('')
    + fact('us-gaap:LiabilitiesCurrent', currentTotal ?? current.reduce((a, [, v]) => a + (v || 0), 0))
    + (noTotal ? '' : fact('us-gaap:Liabilities', total ?? all.reduce((a, [, v]) => a + (v || 0), 0))) + '</xbrl>';
  return { xml, pre };
}
// HNGE's Q3 2026 10-Q (0001628280-26-072251) balance sheet, as filed.
const HNGE_BS = {
  current: [['us-gaap:AccountsPayableAndAccruedLiabilitiesCurrent', 80816000], ['us-gaap:OperatingLeaseLiabilityCurrent', 4721000], ['us-gaap:ContractWithCustomerLiabilityCurrent', 459174000]],
  noncurrent: [['us-gaap:OperatingLeaseLiabilityNoncurrent', 29157000], ['us-gaap:DeferredIncomeTaxLiabilitiesNet', 795000]],
};
const runC = (f, opts) => resolveZeroDebt('1673743', {}, '2025-12-31', { readSubmissions: sub('10-Q', '0001628280-26-072251', '2026-09-30'), readInstanceXml: async () => f.xml, readPrimaryDocument: async () => null, readPresentationXml: async () => f.pre }, opts);

test('C: HNGE — the lines tie exactly to Total liabilities and none is a borrowing → $0, labeled', async () => {
  const r = await runC(bsFiling(HNGE_BS), { balanceSheetAsOf: '2026-09-30' });
  assert.strictEqual(r.value, 0);
  assert.strictEqual(r.label, '$0, no borrowings on the balance sheet; liabilities tie to total, 10-Q 9/30/2026');
  assert.strictEqual(r.basis, 'balance sheet');
  assert.strictEqual(r.source.totalLiabilities, 574663000);
  assert.strictEqual(r.source.lines.length, 5);
  assert.deepStrictEqual(r.source.lines.map((l) => l.category), ['payables and accrued', 'operating lease', 'deferred revenue', 'operating lease', 'tax']);
  assert.strictEqual(r.source.subtotals[0].value, 544711000);
});

test('C: the lines miss Total liabilities by one filed unit → "—" with the sums', async () => {
  const r = await runC(bsFiling({ ...HNGE_BS, total: 574664000 }));
  assert.strictEqual(r.value, null);
  assert.match(r.reason, /does not prove zero: its liability lines sum to \$574,663,000, not Total liabilities \$574,664,000$/);
});

test('C: a current subtotal that does not tie → "—"', async () => {
  const r = await runC(bsFiling({ ...HNGE_BS, currentTotal: 544712000, total: 574663000 }));
  assert.strictEqual(r.value, null);
  assert.match(r.reason, /LiabilitiesCurrent lines sum to \$544,711,000, not \$544,712,000/);
});

test('C: an unknown concept → "—", even when everything ties ("other" liabilities and extensions are never "not debt")', async () => {
  for (const qn of ['us-gaap:OtherLiabilitiesNoncurrent', 'pgny:AccruedLiabilitiesAndOtherLiabilitiesCurrent', 'us-gaap:DerivativeLiabilitiesNoncurrent']) {
    const r = await runC(bsFiling({ ...HNGE_BS, noncurrent: [...HNGE_BS.noncurrent, [qn, 1000]] }));
    assert.strictEqual(r.value, null, qn);
    assert.match(r.reason, new RegExp(`cannot classify as debt or not \\(${qn}\\)`));
  }
  // A zero-valued unknown line still blocks: its concept is unknown, whatever it holds today.
  const z = await runC(bsFiling({ ...HNGE_BS, noncurrent: [...HNGE_BS.noncurrent, ['us-gaap:OtherLiabilitiesNoncurrent', 0]] }));
  assert.strictEqual(z.value, null);
});

test('C: a finance lease is debt → "—" (and an operating lease is not)', async () => {
  for (const qn of ['us-gaap:FinanceLeaseLiabilityNoncurrent', 'us-gaap:FinanceLeaseLiabilityCurrent', 'us-gaap:CapitalLeaseObligationsNoncurrent']) {
    const r = await runC(bsFiling({ ...HNGE_BS, noncurrent: [...HNGE_BS.noncurrent, [qn, 2500000]] }));
    assert.strictEqual(r.value, null, qn);
    assert.match(r.reason, new RegExp(`carries a borrowing line \\(${qn} \\$2,500,000\\)`));
  }
  assert.strictEqual(classifyLiability('us-gaap:OperatingLeaseLiabilityNoncurrent').kind, 'not borrowing');
  assert.strictEqual(classifyLiability('us-gaap:FinanceLeaseLiability').kind, 'borrowing');
  assert.strictEqual(classifyLiability('cloud:ConvertibleSeniorNotesNoncurrent').kind, 'borrowing');
});

test('C: a borrowing line on the face (even at $0), a missing value, a negated line, no Total liabilities → "—"', async () => {
  const zeroLoan = await runC(bsFiling({ ...HNGE_BS, noncurrent: [...HNGE_BS.noncurrent, ['us-gaap:NotesAndLoansPayable', 0]] }));
  assert.match(zeroLoan.reason, /borrowing line \(us-gaap:NotesAndLoansPayable \$0\)/);
  const missing = await runC(bsFiling({ ...HNGE_BS, noncurrent: [...HNGE_BS.noncurrent, ['us-gaap:DeferredRevenueNoncurrent', null]] }));
  assert.match(missing.reason, /line us-gaap:DeferredRevenueNoncurrent has no USD value at 2026-09-30/);
  const neg = await runC(bsFiling({ ...HNGE_BS, negate: ['us-gaap:DeferredIncomeTaxLiabilitiesNet'] }));
  assert.match(neg.reason, /shown negated/);
  const ko = await runC(bsFiling({ ...HNGE_BS, noTotal: true }));   // KO's balance sheet has no Total liabilities line
  assert.match(ko.reason, /it shows no Total liabilities line$/);
  [zeroLoan, missing, neg, ko].forEach((r) => assert.strictEqual(r.value, null));
});

test('C: a balance sheet at another date than the deck\'s cash → "—"', async () => {
  const r = await runC(bsFiling(HNGE_BS), { balanceSheetAsOf: '2026-06-30' });
  assert.strictEqual(r.value, null);
  assert.match(r.reason, /not at the deck's balance-sheet date \(6\/30\/2026\)/);
});

test('C runs last: a facility note (B) or a filed zero (A) keeps its own label; a non-zero debt fact blocks C', async () => {
  const f = bsFiling(HNGE_BS);
  const b = await resolveZeroDebt('1', {}, '2025-12-31', { readSubmissions: sub('10-Q', 'a', '2026-09-30'), readInstanceXml: async () => f.xml.replace('</xbrl>', `<us-gaap:DebtDisclosureTextBlock contextRef="c-1">${PGNY_NOTE}</us-gaap:DebtDisclosureTextBlock></xbrl>`), readPrimaryDocument: async () => PGNY_DOC, readPresentationXml: async () => f.pre });
  assert.strictEqual(b.basis, 'facility note');
  const a = await resolveZeroDebt('1', omdaGaap, '2025-12-31', { readSubmissions: sub('10-Q', 'a', '2026-09-30'), readInstanceXml: async () => f.xml, readPrimaryDocument: async () => null, readPresentationXml: async () => { throw new Error('C must not run'); } });
  assert.strictEqual(a.basis, 'filed zero');
  const drawn = await resolveZeroDebt('1', {}, '2025-12-31', { readSubmissions: sub('10-Q', 'a', '2026-09-30'), readInstanceXml: async () => f.xml.replace('</xbrl>', '<us-gaap:LineOfCredit contextRef="c-2" unitRef="usd">40000000</us-gaap:LineOfCredit></xbrl>'), readPrimaryDocument: async () => null, readPresentationXml: async () => f.pre });
  assert.strictEqual(drawn.value, null);
  assert.match(drawn.reason, /LineOfCredit 40,000,000/);
});

test('filed debt wins: a resolved figure is returned as is and the zero check never runs', async () => {
  const never = { readSubmissions: async () => { throw new Error('zero check must not run'); } };
  assert.deepStrictEqual(await finalDebt(4442000000, '1477333', {}, '2025-12-31', {}, never), { debt: 4442000000, label: null, reason: null, source: null });
  assert.deepStrictEqual(await finalDebt(0, '1', {}, '2025-12-31', {}, never), { debt: 0, label: null, reason: null, source: null });   // a resolved 0 is a figure too
  const f = bsFiling(HNGE_BS);
  const deps = { readSubmissions: sub('10-Q', 'h', '2026-09-30'), readInstanceXml: async () => f.xml, readPrimaryDocument: async () => null, readPresentationXml: async () => f.pre };
  const z = await finalDebt(null, '1673743', {}, '2025-12-31', { balanceSheetAsOf: '2026-09-30' }, deps);
  assert.strictEqual(z.debt, 0);
  assert.strictEqual(z.label, '$0, no borrowings on the balance sheet; liabilities tie to total, 10-Q 9/30/2026');
  const u = await finalDebt(null, '1673743', {}, '2025-12-31', {}, { ...deps, readPresentationXml: async () => null });
  assert.strictEqual(u.debt, null);
  assert.match(u.reason, /could not be read/);
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
