#!/usr/bin/env node
// Run with: node server/services/__tests__/nonGaapTables.test.js
// Fixtures are small tables in the shape the filers use; the numbers are the filed FY2025 rows
// (NET 0001477333-26-000008, DDOG 0001628280-26-006645, IRDM 0001418819-26-000008, KO 0001628280-26-006642).
'use strict';
const assert = require('assert');
const { readNonGaapTables, reconcileCheck } = require('../nonGaapTables');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const CTX = { fiscalYear: 2025, fyEndYear: 2025, accession: '0000000000-26-000001' };
const td = (t, span) => `<td${span ? ` colspan="${span}"` : ''}>${t}</td>`;
// A row-oriented table: label + 4 columns (Q4 2025, Q4 2024, FY 2025, FY 2024), "$" in its own cell.
const rowTable = (rows, { unit = 'in thousands', groups = ['Three Months Ended December 31,', 'Year Ended December 31,'], years = ['2025', '2024', '2025', '2024'] } = {}) =>
  `<p>(${unit}, except per share amounts)</p><table>` +
  `<tr>${td('')}${groups.map(g => td(g, 2)).join('')}</tr>` +
  `<tr>${td('')}${years.map(y => td(y)).join('')}</tr>` +
  rows.map(([label, ...vals]) => `<tr>${td(label)}${vals.map(v => (String(v).startsWith('$') ? td('$') + td(String(v).slice(1)) : td(v))).join('')}</tr>`).join('') +
  `</table>`;

const NET_NI = [
  ['GAAP net loss attributable to common stockholders', '$(12,077)', '$(12,848)', '$(102,267)', '$(78,800)'],
  ['Add: Stock-based compensation and related employer payroll taxes', '132,351', '98,422', '489,938', '356,423'],
  ['Add: Amortization of acquired intangible assets', '4,312', '3,082', '14,998', '12,747'],
  ['Add: Acquisition-related and other expenses', '3,797', '462', '3,909', '702'],
  ['Add: One-time compensation charge', '—', '—', '—', '15,000'],
  ['Add: Amortization of debt issuance costs', '2,440', '989', '7,070', '3,959'],
  ['Add: Lease impairment charges', '1,257', '—', '5,097', '—'],
  ['Add: Legal reserve and settlements', '(2,886)', '—', '(2,886)', '—'],
  ['Income tax effect of non-GAAP adjustments', '(22,411)', '(21,300)', '(72,977)', '(41,018)'],
  ['Non-GAAP net income', '$106,783', '$68,807', '$342,882', '$269,013'],
];
const NET_EPS = [
  ['GAAP net loss per share, basic', '$(0.03)', '$(0.04)', '$(0.29)', '$(0.23)'],
  ['GAAP net loss per share, diluted', '$(0.03)', '$(0.04)', '$(0.29)', '$(0.23)'],
  ['Add: Stock-based compensation and related employer payroll taxes', '0.38', '0.29', '1.41', '1.04'],
  ['Add: Amortization of acquired intangible assets', '0.01', '0.01', '0.04', '0.04'],
  ['Add: Acquisition-related and other expenses', '0.01', '—', '0.01', '—'],
  ['Add: One-time compensation charge', '—', '—', '—', '0.04'],
  ['Add: Amortization of debt issuance costs', '0.01', '—', '0.02', '0.01'],
  ['Add: Lease impairment charges', '—', '—', '0.01', '—'],
  ['Add: Legal reserve and settlements', '(0.01)', '—', '(0.01)', '—'],
  ['Income tax effect of non-GAAP adjustments', '(0.06)', '(0.06)', '(0.21)', '(0.12)'],
  ['Effect of dilutive shares', '(0.03)', '(0.01)', '(0.05)', '(0.03)'],
  ['Non-GAAP net income per share, diluted(1)', '$0.28', '$0.19', '$0.93', '$0.75'],
  ['Weighted-average shares used in computing non-GAAP net income per share attributable to common stockholders, diluted', '375,478', '359,255', '370,274', '357,686'],
];

console.log('\nnonGaapTables unit tests\n');

test('reconcileCheck is the one shared check (server.js imports it from here)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../../server.js'), 'utf8');
  assert.ok(/require\('\.\/server\/services\/nonGaapTables'\)/.test(src));
  assert.ok(!/function reconcileCheck\(/.test(src), 'server.js must not define a second reconcileCheck');
  assert.strictEqual(reconcileCheck({ gaap: 1, adjustments: [{ value: 2 }], nonGaap: 3, unit: 'millions' }).residual, 0);
});

test('tie passes: NET EPS $0.93 from the filed per-share rows, with net income and shares', () => {
  const r = readNonGaapTables(rowTable([...NET_NI, ...NET_EPS]), CTX);
  assert.strictEqual(r.eps.value, 0.93);
  assert.strictEqual(r.eps.tieOut.residual, 0);
  assert.strictEqual(r.eps.tieOut.gaap.label, 'GAAP net loss per share, diluted');       // diluted, not basic
  assert.strictEqual(r.eps.tieOut.gaap.value, -0.29);
  assert.strictEqual(r.eps.tieOut.adjustments.length, 9);
  assert.strictEqual(r.eps.rowLabel, 'Non-GAAP net income per share, diluted');
  assert.strictEqual(r.eps.label, 'non-GAAP, company reported, FY2025, 0000000000-26-000001');
  assert.strictEqual(r.netIncome.value, 342.882);                                        // thousands → $M
  assert.strictEqual(r.dilutedShares.value, 370.274);
  assert.ok(/Year Ended December 31, 2025/.test(r.eps.period));
});

test('tie fails → null with "reconciliation doesn\'t tie: <residual>"', () => {
  const broken = NET_EPS.map(row => (row[0].startsWith('Add: Stock-based') ? [row[0], '0.38', '0.29', '1.31', '1.04'] : row));
  const r = readNonGaapTables(rowTable([...NET_NI, ...broken]), CTX);
  assert.strictEqual(r.eps, null);
  assert.ok(/^reconciliation doesn't tie: 0\.1 /.test(r.reasons.eps), r.reasons.eps);
  assert.strictEqual(r.dilutedShares, null);
});

test('no full-year column for the deck year → null with the reason', () => {
  const html = rowTable([...NET_NI, ...NET_EPS], { groups: ['Three Months Ended December 31,', 'Three Months Ended September 30,'] });
  const r = readNonGaapTables(html, CTX);
  assert.strictEqual(r.eps, null);
  assert.ok(/no full-year column for FY2025/.test(r.reasons.eps), r.reasons.eps);
  assert.strictEqual(r.netIncome, null);
});

test('full-year column for another year only → null (FY2024 release read for FY2025)', () => {
  const r = readNonGaapTables(rowTable([...NET_NI, ...NET_EPS], { years: ['2024', '2023', '2024', '2023'] }), CTX);
  assert.strictEqual(r.eps, null);
  assert.ok(/no full-year column for FY2025/.test(r.reasons.eps));
});

const DDOG_NI = [
  ['GAAP net income', '$46,567', '$45,594', '$107,741', '$183,746'],
  ['Plus: Stock-based compensation expense', '205,386', '158,461', '750,671', '570,336'],
  ['Plus: Amortization of acquired intangibles', '1,842', '1,311', '6,373', '6,467'],
  ['Plus: Employer payroll taxes on employee stock transactions', '13,283', '10,004', '53,799', '43,126'],
  ['Plus: M&amp;A transaction costs (1)', '201', '—', '1,574', '—'],
  ['Plus: Amortization of debt discount and issuance costs', '1,046', '1,089', '5,602', '3,761'],
  ['Non-GAAP net income before non-GAAP tax adjustments', '$268,325', '$216,459', '$925,760', '$807,436'],
  ['Income tax effects and adjustments (2)', '50,895', '38,953', '179,178', '153,608'],
  ['Non-GAAP net income after non-GAAP tax adjustments', '$217,430', '$177,506', '$746,582', '$653,828'],
  ['Net income per share before non-GAAP tax adjustments - basic', '$0.76', '$0.64', '$2.67', '$2.40'],
  ['Net income per share before non-GAAP tax adjustments - diluted', '$0.73', '$0.60', '$2.55', '$2.25'],
  ['Net income per share after non-GAAP tax adjustments - basic', '$0.62', '$0.52', '$2.15', '$1.94'],
  ['Net income per share after non-GAAP tax adjustments - diluted', '$0.59', '$0.49', '$2.05', '$1.82'],
  ['Shares used in non-GAAP net income per share calculations:'],
  ['Basic', '350,892', '340,320', '347,309', '336,172'],
  ['Diluted', '365,516', '360,940', '363,471', '358,636'],
];

test('DDOG: the unsigned tax row is read as a deduction only because that ties exactly; EPS $2.05 via the identity', () => {
  const r = readNonGaapTables(rowTable(DDOG_NI), CTX);
  assert.strictEqual(r.netIncome.value, 746.582);
  assert.strictEqual(r.netIncome.tieOut.residual, 0);
  assert.strictEqual(r.netIncome.tieOut.resignedTaxRow, 'Income tax effects and adjustments (2)');
  assert.strictEqual(r.netIncome.tieOut.adjustments.length, 6);                          // the "before" subtotal is not an adjustment
  assert.strictEqual(r.eps.value, 2.05);                                                 // after tax, not the 2.55 before-tax tier
  assert.strictEqual(r.eps.method, 'net-income identity');
  assert.strictEqual(r.dilutedShares.value, 363.471);
});

test('the tax row is never re-signed when two unsigned tax rows exist', () => {
  const two = [...DDOG_NI.slice(0, 7), ['Income tax effects (2)', '25,000', '19,000', '89,589', '76,804'], ['Other tax adjustments', '25,895', '19,953', '89,589', '76,804'], ...DDOG_NI.slice(8)];
  const r = readNonGaapTables(rowTable(two), CTX);
  assert.strictEqual(r.netIncome, null);
  assert.ok(/^reconciliation doesn't tie: /.test(r.reasons.netIncome), r.reasons.netIncome);
  assert.strictEqual(r.eps, null);
});

test('EBITDA under the company\'s own name: IRDM Operational EBITDA $495.33M, ties', () => {
  const html = rowTable([
    ['GAAP net income', '$24,865', '$36,341', '$114,372', '$112,776'],
    ['Interest expense, net', '21,083', '22,428', '88,252', '91,134'],
    ['Income tax (benefit) expense', '7,989', '(6,242)', '27,618', '12,259'],
    ['Depreciation and amortization', '52,728', '51,447', '210,207', '203,127'],
    ['Share-based compensation', '7,587', '12,431', '51,579', '63,457'],
    ['Transaction related expenses(1)', '479', '289', '479', '3,074'],
    ['(Gain) loss on equity method investments', '581', '413', '2,823', '(15,251)'],
    ['Operational EBITDA', '$115,312', '$117,107', '$495,330', '$470,576'],
  ]);
  const r = readNonGaapTables(html, CTX);
  assert.strictEqual(r.ebitda.value, 495.33);
  assert.strictEqual(r.ebitda.name, 'Operational EBITDA');
  assert.strictEqual(r.ebitda.tieOut.residual, 0);
  assert.strictEqual(r.eps, null);
  assert.strictEqual(r.reasons.eps, 'no adjusted (non-GAAP) diluted EPS row in the reconciliation tables');
});

test('all-caps row label is shown in title case, value unchanged (RKLB "ADJUSTED EBITDA")', () => {
  const html = rowTable([
    ['NET LOSS', '$(52,922)', '$(52,345)', '$(198,209)', '$(190,175)'],
    ['Depreciation', '7,308', '5,854', '25,369', '20,367'],
    ['ADJUSTED EBITDA', '$(45,614)', '$(46,491)', '$(172,840)', '$(169,808)'],
  ]);
  const r = readNonGaapTables(html, CTX);
  assert.strictEqual(r.ebitda.value, -172.84);
  assert.strictEqual(r.ebitda.rowLabel, 'ADJUSTED EBITDA');
  assert.strictEqual(r.ebitda.name, 'Adjusted EBITDA');
});

test('transposed (KO): Comparable (Non-GAAP) diluted EPS $3.00 for the FY section only', () => {
  const head = (p) => `<tr>${td('')}${td(p, 6)}</tr><tr>${td('')}${td('Income taxes')}${td('Net income')}${td('Diluted net income per share')}</tr>`;
  const row = (l, a, b, c) => `<tr>${td(l)}${td(a)}${td(b)}${td(c)}</tr>`;
  const html = `<p>(In millions except per share data)</p><table>` +
    head('Three Months Ended December 31, 2025') +
    row('Reported (GAAP)', '400', '2,271', '0.53') + row('Asset Impairments', '10', '100', '0.02') + row('Comparable (Non-GAAP)', '410', '2,371', '0.55') +
    head('Year Ended December 31, 2025') +
    row('Reported (GAAP)', '2,861', '13,107', '3.04') + row('Items Impacting Comparability:', '', '', '').replace(/<td><\/td>/g, '') +
    row('Asset Impairments', '243', '867', '0.20') + row('Equity Investees', '3', '18', '—') + row('Transaction Gains/Losses', '(595)', '(66)', '(0.02)') +
    row('Restructuring', '24', '73', '0.02') + row('Other Items', '(43)', '(163)', '(0.04)') + row('Certain Tax Matters', '878', '(878)', '(0.20)') +
    row('Comparable (Non-GAAP)', '3,371', '12,958', '3.00') +
    `</table><table><tr>${td('(In millions except per share data)')}</tr><tr>${td('')}${td('Year Ended', 2)}</tr><tr>${td('')}${td('December 31, 2025')}${td('December 31, 2024')}</tr>` +
    row('Average Shares Outstanding Assuming Dilution', '4,313', '4,320', '').replace(/<td><\/td>/g, '') + `</table>`;
  const r = readNonGaapTables(html, CTX);
  assert.strictEqual(r.eps.value, 3);
  assert.strictEqual(r.eps.tieOut.residual, 0);
  assert.strictEqual(r.eps.rowLabel, 'Comparable (Non-GAAP) — Diluted net income per share');
  assert.strictEqual(r.netIncome.value, 12958);
  assert.strictEqual(r.dilutedShares.value, 4313);
});

test('a shares row that does not reproduce EPS from net income is refused', () => {
  const rows = NET_EPS.map(row => (row[0].startsWith('Weighted-average') ? [row[0], '375,478', '359,255', '400,000', '357,686'] : row));
  const r = readNonGaapTables(rowTable([...NET_NI, ...rows]), CTX);
  assert.strictEqual(r.eps.value, 0.93);
  assert.strictEqual(r.dilutedShares, null);
  assert.ok(/no filed diluted share count reproduces EPS/.test(r.reasons.dilutedShares));
});

test('no unit stated → dollar figures null, EPS unaffected', () => {
  const html = rowTable([...NET_NI, ...NET_EPS]).replace('(in thousands, except per share amounts)', '');
  const r = readNonGaapTables(html, CTX);
  assert.strictEqual(r.netIncome, null);
  assert.ok(/unit not stated/.test(r.reasons.netIncome));
  assert.strictEqual(r.eps.value, 0.93);
  assert.strictEqual(r.dilutedShares, null);
});

test('prose is never read: a reconciliation written as a paragraph yields nothing', () => {
  const html = '<p>Non-GAAP net income per share, diluted was $0.93 for the year ended December 31, 2025 compared with GAAP net loss per share of $(0.29).</p>';
  const r = readNonGaapTables(html, CTX);
  assert.strictEqual(r.eps, null); assert.strictEqual(r.netIncome, null); assert.strictEqual(r.ebitda, null);
  assert.strictEqual(r.tablesRead, 0);
});

// ── Task 5: the FY-release picker's test and the two reader fixes it needed (PGNY 0001551306-26-000012) ──
const { fullYearReconciliation } = require('../nonGaapTables');
// PGNY Annex A: a heading states the unit once; the EBITDA table under it states none; its anchor reads "Net income1".
const PGNY_ANNEX = '<p>ANNEX A PROGYNY, INC. Reconciliation of GAAP to Non-GAAP Financial Measures (unaudited) (in thousands)</p>' +
  rowTable([
    ['Net income1', '$12,485', '$10,532', '$58,520', '$54,336'],
    ['Depreciation and amortization', '1,367', '868', '4,948', '3,175'],
    ['Stock‑based compensation expense1', '34,799', '30,859', '131,867', '128,130'],
    ['Interest and other income, net', '(2,632)', '(1,871)', '(10,155)', '(15,747)'],
    ['Provision for income taxes', '5,369', '7,126', '36,912', '28,866'],
    ['Adjusted EBITDA', '$51,388', '$47,514', '$222,092', '$198,760'],
  ]).replace('<p>(in thousands, except per share amounts)</p>', '<table><tr><td>Cost of services</td><td>241,522</td></tr></table><p>Twelve months ended</p>') +
  '<p>Revenue ($ in millions)</p>';

test('PGNY: "Net income1" anchors the block (footnote digit), and the heading unit scales it → $222.092M, residual 0', () => {
  const r = readNonGaapTables(PGNY_ANNEX, CTX);
  assert.strictEqual(r.ebitda.value, 222.092);
  assert.strictEqual(r.ebitda.tieOut.residual, 0);
  assert.strictEqual(r.ebitda.nativeUnit, 'thousands');
  assert.ok(/last unit stated before table/.test(r.ebitda.unitSource));
});

test('an inherited unit never touches a per-share figure; a table that states its own unit records nothing extra', () => {
  const stated = readNonGaapTables(rowTable([...NET_NI, ...NET_EPS]), CTX);
  assert.strictEqual(stated.netIncome.unitSource, undefined);
  // The same EPS block under a heading unit with a table in between: the EPS figure keeps nativeUnit null (HNGE's payload
  // stayed byte-identical for this reason), while the net income in that table is scaled by the inherited unit.
  const inheritedHtml = '<p>(in thousands)</p><table><tr><td>x</td><td>1</td></tr></table>' +
    rowTable([...NET_NI, ...NET_EPS]).replace('<p>(in thousands, except per share amounts)</p>', '');
  const r = readNonGaapTables(inheritedHtml, CTX);
  assert.strictEqual(r.eps.value, 0.93);
  assert.strictEqual(r.eps.nativeUnit, null);
  assert.strictEqual(r.netIncome.nativeUnit, 'thousands');
  assert.ok(/last unit stated before table/.test(r.netIncome.unitSource));
});

test('picker test: a January pre-announcement with no reconciliation table is refused, with the reason', () => {
  const jan = '<p>Progyny announces preliminary fourth quarter results. Revenue is expected to be approximately $318 million.</p>';
  assert.strictEqual(fullYearReconciliation(jan, 2025), 'no non-GAAP reconciliation with a full-year 2025 column (0 tables)');
  const prelim = '<table><tr><td>Revenue</td><td>$318</td></tr></table>';
  assert.ok(/1 table/.test(fullYearReconciliation(prelim, 2025)));
});

test('picker test: the FY release with a full-year reconciliation column is accepted', () => {
  assert.strictEqual(fullYearReconciliation(PGNY_ANNEX, 2025), true);
  assert.strictEqual(fullYearReconciliation(rowTable([...NET_NI, ...NET_EPS]), 2025), true);
});

test('picker test: a reconciliation for the wrong year (a later quarterly release) is refused', () => {
  const later = PGNY_ANNEX.replace(/<td>2025<\/td>/g, '<td>2026</td>');
  assert.notStrictEqual(fullYearReconciliation(later, 2025), true);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}\n`);
