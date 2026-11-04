// DIAGNOSTIC. Runs the REAL dealCalc.calculate() with GAAP vs non-GAAP-overridden inputs (the exact
// override the App input-assembly flip applies) to verify steps 4-6: applied accretion vs the +3.2%
// prediction, the do-nothing consistency, and that the financing drag is preserved. Reads the cached
// /quote + /api/nongaap JSON pulled earlier this session.
import { calculate } from '../src/utils/dealCalc.js';
import { readFileSync } from 'fs';
const j = (p) => JSON.parse(readFileSync(p));
const qA = j('/tmp/q_ADBE.json'), qB = j('/tmp/q_CRM.json');
const nA = j('/tmp/p1_ADBE.json'), nB = j('/tmp/p1_CRM.json'); // post-Part-1 payloads (incl. dilutedShares)

// Base GAAP inputs for ADBE (A) acquires CRM (B) at the live deal terms.
const baseGAAP = {
  companyARevenue: qA.revenue, companyAEBITDA: qA.ebitda, companyANetIncome: qA.netIncome,
  companyAEPS: qA.eps, companyAShares: qA.shares, companyADilutedShares: qA.dilutedShares,
  companyADebt: qA.debt, currentSharePriceA: 194.90,
  companyBRevenue: qB.revenue, companyBEBITDA: qB.ebitda, companyBNetIncome: qB.netIncome,
  companyBEPS: qB.eps, companyBShares: qB.shares, companyBCash: qB.cash, companyBDebt: qB.debt,
  currentSharePriceB: 150.12,
  offerPricePerShare: 195.16, cashPercent: 60,
  synergiesY1: 831, synergiesY2: 831, synergiesY3: 831,
};
// The flip override (resolveAccretionBasis): only these four fields move to non-GAAP.
const overlayNG = {
  companyANetIncome: nA.nonGaap.netIncome, companyAEPS: nA.nonGaap.dilutedEPS,
  companyADilutedShares: nA.nonGaap.dilutedShares, companyBNetIncome: nB.nonGaap.netIncome,
};
const baseNG = { ...baseGAAP, ...overlayNG };

const show = (label, r) => {
  console.log(`\n── ${label} ──`);
  console.log(`  standalone EPS (baseline): $${r.companyAEPS}   proFormaEPS: $${r.proFormaEPS}   accretion: ${r.epsChangePct}%  ${r.isAccretive?'ACCRETIVE':'DILUTIVE'}`);
  console.log(`  newSharesIssued: ${r.newSharesIssued}   afterTaxFinancing: ${r.newInterestAfterTax}   afterTaxSynergies: ${r.afterTaxSynergies}`);
};

console.log('============ STEP 4 & 6 — applied accretion (real calculate()) ============');
console.log(`override: A.NI ${baseGAAP.companyANetIncome}→${baseNG.companyANetIncome}  A.EPS ${baseGAAP.companyAEPS}→${baseNG.companyAEPS}  A.dilShares ${baseGAAP.companyADilutedShares}→${baseNG.companyADilutedShares}  B.NI ${baseGAAP.companyBNetIncome}→${baseNG.companyBNetIncome}`);
const g  = calculate(baseGAAP); show('GAAP (expect -18.0%, $13.70)', g);
const ng = calculate(baseNG);  show('NON-GAAP (expect +3.2%, baseline $20.94, pro-forma $21.61)', ng);
console.log(`\n  SIGN CHANGE: ${g.epsChangePct}% → ${ng.epsChangePct}%   |   financing drag identical: ${g.newInterestAfterTax === ng.newInterestAfterTax ? 'YES ('+g.newInterestAfterTax+')' : 'NO ('+g.newInterestAfterTax+' vs '+ng.newInterestAfterTax+')'}   |   new shares identical: ${g.newSharesIssued===ng.newSharesIssued?'YES ('+g.newSharesIssued+')':'NO'}`);

console.log('\n============ STEP 5 — do-nothing (no target effect: target NI 0, offer 0, synergy 0; cover shares kept) ============');
// Keep companyBShares (avoids the companyBShares===0 guard in calcProFormaEPS that nulls the %). With
// offer 0 → no new shares / no financing, and target NI 0, pro-forma collapses to the acquirer leg:
// proFormaEPS = A.NI / A.dilShares, which must equal the standalone baseline → ~0%.
const nullDeal = (b) => ({ ...b, companyBNetIncome: 0, offerPricePerShare: 0, synergiesY1: 0, synergiesY2: 0, synergiesY3: 0 });
for (const [lbl, b] of [['GAAP', baseGAAP], ['NON-GAAP', baseNG]]) {
  const r = calculate(nullDeal(b));
  const pfFull = b.companyANetIncome / b.companyADilutedShares; // A.NI / A.dilShares, full precision
  console.log(`  ${lbl.padEnd(8)}: baseline $${r.companyAEPS}  proFormaEPS(full) ${pfFull.toFixed(4)}  accretion ${r.epsChangePct}%  (must be ~0)`);
}
