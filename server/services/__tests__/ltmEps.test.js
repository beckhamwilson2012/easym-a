#!/usr/bin/env node
// Run with: node server/services/__tests__/ltmEps.test.js
// LTM EPS from filed per-share figures, and the EPS numerator. Inline data: no network.
'use strict';
const assert = require('assert');
const { filedEpsLegs, releaseQuarterEps, resolveLtmEps, epsNumeratorAt, ltmEpsNumerator } = require('../ltmEps');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const d = (start, end, val, form = '10-Q', accn = 'a') => ({ start, end, val, form, filed: end, accn });
// HNGE as filed (companyfacts, us-gaap). No Q4 2025 three-month EPS in XBRL, as in the real filing.
const HNGE = {
  EarningsPerShareDiluted: { units: { 'USD/shares': [
    d('2025-01-01', '2025-09-30', -9.88), d('2025-07-01', '2025-09-30', -0.02), d('2025-01-01', '2025-12-31', -7.77, '10-K', 'k'),
    d('2026-01-01', '2026-03-31', 0.41), d('2026-04-01', '2026-06-30', 0.52), d('2026-07-01', '2026-09-30', 0.66),
    d('2026-01-01', '2026-09-30', 1.58, '10-Q', '0001628280-26-072251'),
  ] } },
  NetIncomeLoss: { units: { USD: [d('2025-01-01', '2025-12-31', -528261000, '10-K')] } },
  NetIncomeLossAvailableToCommonStockholdersBasic: { units: { USD: [
    d('2025-01-01', '2025-12-31', -424087000, '10-K', '0001628280-26-013808'), d('2025-01-01', '2025-09-30', -456182000), d('2026-01-01', '2026-09-30', 134166000),
  ] } },
};
const P9 = { annual: { start: '2025-01-01', end: '2025-12-31' }, latestInterim: { start: '2026-01-01', end: '2026-09-30' }, priorInterim: { start: '2025-01-01', end: '2025-09-30' } };
// The release's GAAP income statement rows, as HNGE prints them (FY2025 release EX-99.1, table 1).
const HNGE_RELEASE = `<table>
<tr><td></td><td colspan="2">Three Months Ended December 31,</td><td colspan="2">Year Ended December 31,</td></tr>
<tr><td></td><td>2025</td><td>2024</td><td>2025</td><td>2024</td></tr>
<tr><td>Net income (loss) attributable to common stockholders per share:</td></tr>
<tr><td>Basic</td><td>0.40</td><td>0.44</td><td>(7.77)</td><td>(0.88)</td></tr>
<tr><td>Diluted</td><td>0.37</td><td>0.40</td><td>(7.77)</td><td>(0.88)</td></tr>
<tr><td>Weighted average shares used in computing net income (loss) per share attributable to common stockholders:</td></tr>
<tr><td>Diluted</td><td>84,533</td><td>16,576</td><td>54,577</td><td>13,558</td></tr>
<tr><td>Non-GAAP net income (loss) per share attributable to common stockholders, diluted</td><td>0.49</td><td>0.40</td><td>2.62</td><td>(0.46)</td></tr>
</table>`;
const release = (html, accession = '0001628280-26-006826') => async () => ({ html, accession });

test('HNGE: Q4 2025 $0.37 (release) + 9M 2026 $1.58 (10-Q) = $1.95, labeled "sum of 4 filed quarters"', async () => {
  const r = await resolveLtmEps(HNGE, P9, { fyEps: -7.77, readRelease: release(HNGE_RELEASE) });
  assert.strictEqual(r.value, 1.95);
  assert.match(r.label, /^sum of 4 filed quarters: quarter to 2025-12-31 \$0\.37 \+ 9 months to 2026-09-30 \$1\.58$/);
  assert.match(r.legs[0].source, /0001628280-26-006826/);
});

test('the share-count "Diluted" row (84,533) and the non-GAAP row are never read as EPS', () => {
  assert.strictEqual(releaseQuarterEps(HNGE_RELEASE, { fyEndYear: 2025, fyEps: -7.77 }).value, 0.37);
});

test('the release Q4 is refused when the same row\'s full year does not tie to the filed FY EPS', () => {
  const r = releaseQuarterEps(HNGE_RELEASE, { fyEndYear: 2025, fyEps: -7.70 });
  assert.match(r.reason, /ties to the filed FY EPS -7.7/);
});

test('KO layout: quarter and year in two tables with the same row label', () => {
  const t = (period, q, fy) => `<table><tr><td></td><td>${period}</td><td>${period}</td></tr><tr><td></td><td>2025</td><td>2024</td></tr>
    <tr><td>Diluted Net Income Per Share1</td><td>${q}</td><td>${fy}</td></tr></table>`;
  const html = t('Three Months Ended', '0.53', '0.51') + t('Year Ended', '3.04', '2.46');
  assert.strictEqual(releaseQuarterEps(html, { fyEndYear: 2025, fyEps: 3.04 }).value, 0.53);
});

test('PEP layout: "Diluted" header row above the per-share row; "Quarter Ended" columns', () => {
  const html = `<table><tr><td></td><td>Quarter Ended</td><td>Quarter Ended</td><td>Year Ended</td><td>Year Ended</td></tr>
    <tr><td></td><td>2025</td><td>2024</td><td>2025</td><td>2024</td></tr>
    <tr><td>Diluted</td></tr><tr><td>Net income attributable to PepsiCo per common share</td><td>1.85</td><td>1.11</td><td>6.00</td><td>6.95</td></tr></table>`;
  assert.strictEqual(releaseQuarterEps(html, { fyEndYear: 2025, fyEps: 6 }).value, 1.85);
});

test('IRDM layout: no per-share table row; the release sentence, exact wording only', () => {
  const html = '<p>Net income was $24.9 million, or $0.24 per diluted share, for the fourth quarter of 2025, as compared to $0.32 per diluted share, for the fourth quarter of 2024.</p>';
  const r = releaseQuarterEps(html, { fyEndYear: 2025, fyEps: 1.06 });
  assert.strictEqual(r.value, 0.24);
  assert.match(r.row, /^release text/);
});

test('no release → null with the reason; never LTM net income ÷ shares', async () => {
  const r = await resolveLtmEps(HNGE, P9, { fyEps: -7.77, readRelease: async () => ({ reason: 'No fiscal-year-end earnings 8-K' }) });
  assert.strictEqual(r.value, null);
  assert.match(r.reason, /Q4 ending 2025-12-31 is not in XBRL/);
});

test('a 6-month YTD needs the prior Q3 and Q4; a missing prior quarter → null', async () => {
  const ns = { EarningsPerShareDiluted: { units: { 'USD/shares': [d('2026-01-01', '2026-06-30', 1.0), d('2025-10-01', '2025-12-31', 0.3)] } } };
  const P6 = { annual: { start: '2025-01-01', end: '2025-12-31' }, latestInterim: { start: '2026-01-01', end: '2026-06-30' }, priorInterim: { start: '2025-01-01', end: '2025-06-30' } };
  assert.match(filedEpsLegs(ns, P6).reason, /not all filed \(0 of 1\)/);
  ns.EarningsPerShareDiluted.units['USD/shares'].push(d('2025-07-01', '2025-09-30', 0.2));
  const r = await resolveLtmEps(ns, P6, { fyEps: 1, readRelease: async () => { throw new Error('must not be called: Q4 is in XBRL'); } });
  assert.strictEqual(r.value, 1.5);
});

test('EPS numerator: FY2025 net loss to common $(424.087)M, not the $(528.261)M net loss', () => {
  const n = epsNumeratorAt(HNGE, '2025-12-31');
  assert.strictEqual(n.value, -424087000);
  assert.strictEqual(n.accn, '0001628280-26-013808');
});

test('EPS numerator: a to-common tag from another year never counts (IRDM 2019, TDOC 2016)', () => {
  const ns = { NetIncomeLossAvailableToCommonStockholdersDiluted: { units: { USD: [d('2019-01-01', '2019-12-31', -166193000, '10-K')] } } };
  assert.strictEqual(epsNumeratorAt(ns, '2025-12-31'), null);
});

test('LTM numerator: the three legs on the to-common concept = $166.261M; ÷ 85.073M = $1.954 → ties to $1.95', () => {
  const n = ltmEpsNumerator(HNGE, P9);
  assert.strictEqual(n.value, 166261000);
  assert.strictEqual(Math.round(n.value / 85073000 * 100) / 100, 1.95);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); }
  }
  console.log(`\n${passed}/${tests.length} passed`);
  process.exit(passed === tests.length ? 0 : 1);
})();
