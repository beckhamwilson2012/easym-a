#!/usr/bin/env node
// Run with: node server/services/__tests__/adjustedComponents.test.js
// The filed inputs of a computed adjusted figure (Fix 13). Inline facts and filings: no network.
'use strict';
const assert = require('assert');
const { adjustedComponents, amortizationBreakdown, fullValuationAllowance, disclosedNonGaapTaxRate, taxEvidence } = require('../adjustedComponents');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

// companyfacts-shaped entries ($, full units)
const fy = (val, end = '2025-12-31', start = '2025-01-01') => ({ val, start, end, form: '10-K', filed: '2026-02-26' });
const q = (val, start, end) => ({ val, start, end, form: '10-Q', filed: '2026-11-05' });
const legs = (a, l, p) => [fy(a), q(l, '2026-01-01', '2026-09-30'), q(p, '2025-01-01', '2025-09-30')];
const facts = (concepts) => ({ facts: { 'us-gaap': Object.fromEntries(Object.entries(concepts).map(([k, v]) => [k, { units: { USD: v } }])) } });
const edgar = (extra = {}) => ({
  fiscalYear: 2025, fiscalYearEnd: '2025-12-31', netIncome: -200, operatingIncome: -263, ebitda: 101, ebitdaReason: null,
  ltm: { trusted: true, asOf: '2026-09-30', netIncome: -155, operatingIncome: -163, ebitda: 206,
    audit: { periods: { annual: { end: '2025-12-31' }, latestInterim: { end: '2026-09-30', span: 272 }, priorInterim: { end: '2025-09-30', span: 272 } } } },
  ...extra,
});

test('TDOC-shaped facts: FY and LTM add-backs from filed concepts; LTM = annual + YTD − prior YTD', () => {
  const f = facts({
    ShareBasedCompensation: legs(80414000, 35528000, 64503000),
    RestructuringCharges: [fy(18785000)],                         // FY only: cannot supply the LTM legs
    RestructuringCosts: legs(18785000, 17283000, 11989000),       // supplies all three → LTM uses it
    GoodwillImpairmentLoss: legs(71763000, 0, 71763000),
  });
  const c = adjustedComponents(f, edgar());
  assert.strictEqual(c.fy.sbc.value, 80.414);
  assert.strictEqual(c.fy.oneTime.find((x) => x.key === 'restructuring').concept, 'RestructuringCharges');
  assert.ok(Math.abs(c.ltm.sbc.value - 51.439) < 1e-9);
  const r = c.ltm.oneTime.find((x) => x.key === 'restructuring');
  assert.strictEqual(r.concept, 'RestructuringCosts');
  assert.ok(Math.abs(r.value - 24.079) < 1e-9);
  assert.strictEqual(c.ltm.oneTime.find((x) => x.key === 'goodwillImpairment').value, 0);   // a filed 0 is found at 0
  assert.strictEqual(c.fy.netIncome, -200);
  assert.strictEqual(c.ltm.ebitda, 206);
});

test('an untagged one-time item is listed as not found, never 0', () => {
  const c = adjustedComponents(facts({ ShareBasedCompensation: legs(1e6, 1e6, 1e6) }), edgar());
  assert.deepStrictEqual(c.fy.oneTime, []);
  assert.ok(c.fy.oneTimeNotFound.includes('litigation settlements'));
  assert.strictEqual(c.fy.amortization, null);
  assert.match(c.fy.amortizationReason, /not tagged for FY2025/);
});

test('missing stock comp → sbc null with the reason', () => {
  const c = adjustedComponents(facts({ AllocatedShareBasedCompensationExpense: legs(1e6, 1e6, 1e6) }), edgar());
  assert.strictEqual(c.fy.sbc, null);
  assert.match(c.fy.sbcReason, /stock-based compensation \(ShareBasedCompensation\) is not tagged for FY2025/);
  assert.strictEqual(c.ltm.sbc, null);
});

test('a concept missing one LTM leg has no LTM value (no second LTM method)', () => {
  const c = adjustedComponents(facts({ ShareBasedCompensation: legs(1e6, 1e6, 1e6), RestructuringCharges: [q(161711000, '2026-01-01', '2026-09-30'), q(0, '2025-01-01', '2025-09-30')] }), edgar());
  assert.ok(!c.ltm.oneTime.some((x) => x.key === 'restructuring'));
  assert.ok(c.ltm.oneTimeNotFound.includes('restructuring'));
});

test('no trusted LTM → ltm null with the reason', () => {
  const c = adjustedComponents(facts({ ShareBasedCompensation: [fy(1e6)] }), edgar({ ltm: { trusted: false, reason: 'tie-out gate failed' } }));
  assert.strictEqual(c.ltm, null);
  assert.strictEqual(c.reasons.ltm, 'tie-out gate failed');
});

// TDOC's own breakdown of AmortizationOfIntangibleAssets (10-K 0001477449-26-000012; 10-Q 0001477449-26-000052).
const ctx = (id, s, e, mem) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier>${mem ? `<xbrli:segment><xbrldi:explicitMember dimension="us-gaap:FiniteLivedIntangibleAssetsByMajorClassAxis">${mem}</xbrldi:explicitMember></xbrli:segment>` : ''}</xbrli:entity><xbrli:period><xbrli:startDate>${s}</xbrli:startDate><xbrli:endDate>${e}</xbrli:endDate></xbrli:period></xbrli:context>`;
const am = (id, v) => `<us-gaap:AmortizationOfIntangibleAssets contextRef="${id}" unitRef="usd" decimals="-3">${v}</us-gaap:AmortizationOfIntangibleAssets>`;
const TDOC_10K = ctx('fy', '2025-01-01', '2025-12-31') + ctx('fyAcq', '2025-01-01', '2025-12-31', 'tdoc:IntangibleAssetsAcquiredMember') + am('fy', 350764000) + am('fyAcq', 183147000);
const TDOC_10Q = ctx('y', '2026-01-01', '2026-09-30') + ctx('yAcq', '2026-01-01', '2026-09-30', 'tdoc:IntangibleAssetsAcquiredMember') + ctx('ySw', '2026-01-01', '2026-09-30', 'us-gaap:SoftwareAndSoftwareDevelopmentCostsMember')
  + ctx('p', '2025-01-01', '2025-09-30') + ctx('pSw', '2025-01-01', '2025-09-30', 'us-gaap:SoftwareAndSoftwareDevelopmentCostsMember')
  + am('y', 266554000) + am('yAcq', 155112000) + am('ySw', 111442000) + am('p', 258725000) + am('pSw', 128419000);

test('amortization of ACQUIRED intangibles: the filer’s acquired member, else total less its software member', () => {
  const bd = amortizationBreakdown(TDOC_10K + TDOC_10Q);
  assert.strictEqual(bd.find((b) => b.end === '2025-12-31').acquired, 183147000);
  assert.strictEqual(bd.find((b) => b.end === '2026-09-30').acquired, 155112000);
  const prior = bd.find((b) => b.end === '2025-09-30');
  assert.strictEqual(prior.acquired, 258725000 - 128419000);
  assert.strictEqual(prior.method, 'total less capitalized-software member');
  const f = facts({ ShareBasedCompensation: legs(1e6, 1e6, 1e6), AmortizationOfIntangibleAssets: legs(350764000, 266554000, 258725000) });
  const c = adjustedComponents(f, edgar(), [TDOC_10K, TDOC_10Q]);
  assert.strictEqual(c.fy.amortization.value, 183.147);
  assert.ok(Math.abs(c.ltm.amortization.value - (183.147 + 155.112 - 130.306)) < 1e-9);
});

test('a breakdown missing for one LTM leg → no LTM amortization, with the reason (never the software-inclusive total)', () => {
  const f = facts({ ShareBasedCompensation: legs(1e6, 1e6, 1e6), AmortizationOfIntangibleAssets: legs(350764000, 266554000, 258725000) });
  const c = adjustedComponents(f, edgar(), [TDOC_10K, null]);
  assert.strictEqual(c.ltm.amortization, null);
  assert.match(c.ltm.amortizationReason, /includes capitalized software/);
});

test('no breakdown filed → the total as filed (NET, DDOG, HNGE)', () => {
  const c = adjustedComponents(facts({ ShareBasedCompensation: legs(1e6, 1e6, 1e6), AmortizationOfIntangibleAssets: legs(15e6, 23.9e6, 10.7e6) }), edgar(), [null, null]);
  assert.strictEqual(c.fy.amortization.value, 15);
  assert.ok(Math.abs(c.ltm.amortization.value - 28.2) < 1e-9);
});

const taxNote = (t) => `<us-gaap:IncomeTaxDisclosureTextBlock contextRef="fy">&lt;div&gt;${t}&lt;/div&gt;</us-gaap:IncomeTaxDisclosureTextBlock>`;
test('full valuation allowance: OMDA’s 10-K sentence is found; TDOC’s "a portion" and a released allowance are not', () => {
  const omda = 'The Company did not record a provision for income tax expense or benefit for the years ended December 31, 2025 and 2024 due to recurring losses and the maintenance of a full valuation allowance on its deferred tax assets.';
  assert.strictEqual(fullValuationAllowance(taxNote(omda)), omda);
  assert.strictEqual(fullValuationAllowance(taxNote('As of December 31, 2025, the Company had a valuation allowance of approximately $453.4 million against a portion of the U.S. and certain foreign deferred tax assets.')), null);
  assert.strictEqual(fullValuationAllowance(taxNote('In 2025 the Company released its full valuation allowance against U.S. deferred tax assets.')), null);
  assert.strictEqual(fullValuationAllowance(null), null);
});

test('disclosed non-GAAP tax rate: HNGE’s FY2025 rate is read; an outlook or another year is not', () => {
  const hnge = '<p>For the quarter and year ended December 31, 2025 we determined the projected non-GAAP tax rate to be 20% and for the quarter and year ended December 31, 2024 we determined the projected non-GAAP tax rate to be (2)% and (14)%, respectively.</p>';
  assert.strictEqual(disclosedNonGaapTaxRate(hnge, 2025).rate, 0.2);
  assert.strictEqual(disclosedNonGaapTaxRate(hnge, 2026), null);
  assert.strictEqual(disclosedNonGaapTaxRate('<p>The company’s underlying effective tax rate (non-GAAP) is estimated to be 20.9%.</p>', 2025), null);
  assert.strictEqual(disclosedNonGaapTaxRate(null, 2025), null);
});

test('tax evidence: disclosed (FY only) > full valuation allowance > default', () => {
  const t = taxEvidence({ vaSentence: 'full valuation allowance', tenK: { accn: 'k' }, disclosed: { rate: 0.2, sentence: 's' }, releaseAccession: 'r' });
  assert.strictEqual(t.fy.basis, 'disclosed');
  assert.strictEqual(t.ltm.basis, 'valuation allowance');
  assert.strictEqual(taxEvidence({}).fy.basis, 'default');
});

for (const [name, fn] of tests) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
console.log(`adjustedComponents: ${passed}/${tests.length}`);
