// DIAGNOSTIC (read-only): print the Year-1 pro-forma EPS bridge component-by-component for the
// UNH-acquires-ADBE deck, using the deck's ACTUAL auto-filled inputs (suggested offer + auto
// synergies). Replicates the app's preset formulas and runs the real dealCalc.calculate().
// Run against fixed server on :3002. node scripts/diag_accretion.mjs
import http from 'http';
import { calculate, calcProFormaEPS, TAX_RATE, DEBT_INTEREST_RATE } from '../src/utils/dealCalc.js';

const g = (p) => new Promise((res) => { http.get('http://localhost:3002' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', () => res(null)); });
const M = (v) => '$' + Math.round(v).toLocaleString() + 'M';

const acq = await g('/quote?symbol=UNH');   // acquirer
const tgt = await g('/quote?symbol=ADBE');  // target
const priceA = (await g('/api/price/UNH'))?.price || 0;
const priceB = (await g('/api/price/ADBE'))?.price || 0;

// Replicate the app presets (src/lib/suggestionTooltips.js)
const offer = +(priceB * 1.30).toFixed(2);                      // calcSuggestedOfferPrice: 30% premium
const combinedRev = (tgt.revenue || 0) + (acq.revenue || 0);
const synRate = { 1: 0.02, 2: 0.035, 3: 0.05 };
const syn = (y) => Math.round(combinedRev * synRate[y]);        // calcSuggestedSynergy: combined-rev × rate
const synergiesY1 = syn(1), synergiesY2 = syn(2), synergiesY3 = syn(3);

const inputs = {
  companyARevenue: acq.revenue, companyAEBITDA: acq.ebitda, companyANetIncome: acq.netIncome,
  companyAShares: acq.shares, companyADilutedShares: acq.dilutedShares, companyAEPS: acq.eps,
  companyACash: acq.cash, companyADebt: acq.debt, currentSharePriceA: priceA,
  companyBRevenue: tgt.revenue, companyBEBITDA: tgt.ebitda, companyBNetIncome: tgt.netIncome,
  companyBShares: tgt.shares, companyBDilutedShares: tgt.dilutedShares, companyBEPS: tgt.eps,
  companyBCash: tgt.cash, companyBDebt: tgt.debt, currentSharePriceB: priceB,
  offerPricePerShare: offer, cashPercent: 60,
  synergiesY1, synergiesY2, synergiesY3,
};
const r = calculate(inputs);

console.log('════════ UNH acquires ADBE — auto-filled deal inputs ════════');
console.log(`  UNH  revenue ${M(acq.revenue)}  netIncome ${M(acq.netIncome)}  dilutedShares ${acq.dilutedShares}M  reported diluted EPS $${acq.eps}  price $${priceA}`);
console.log(`  ADBE revenue ${M(tgt.revenue)}  netIncome ${M(tgt.netIncome)}  shares ${tgt.shares}M  price $${priceB}`);
console.log(`  offer $${offer}/sh (30% prem) · 60% cash / 40% stock`);

console.log('\n════════ DEAL SIZE & FINANCING ════════');
const tpp = offer * tgt.shares, cashPortion = tpp * 0.6, stockPortion = tpp * 0.4;
const acqPrice = priceA > 0 ? priceA : acq.eps * 15;
const newShares = acqPrice > 0 ? stockPortion / acqPrice : 0;
const baseShares = acq.dilutedShares || acq.shares;
console.log(`  Total purchase price  = $${offer} × ${tgt.shares}M sh = ${M(tpp)}  (~$${(tpp/1000).toFixed(0)}B)`);
console.log(`  Cash portion (60%)    = ${M(cashPortion)}  (debt-funded)`);
console.log(`  Stock portion (40%)   = ${M(stockPortion)}`);
console.log(`  New shares issued     = ${M(stockPortion).replace('$','')} / $${acqPrice} = ${newShares.toFixed(1)}M  (vs base ${baseShares}M → +${(newShares/baseShares*100).toFixed(1)}%)`);

console.log('\n════════ SYNERGIES (the auto-preset) ════════');
console.log(`  Formula: combined revenue × rate. combinedRev = ${M(combinedRev)} (UNH ${M(acq.revenue)} + ADBE ${M(tgt.revenue)})`);
console.log(`  Year 1 = ${M(combinedRev)} × 2.0%  = ${M(synergiesY1)}`);
console.log(`  Year 2 = ${M(combinedRev)} × 3.5%  = ${M(synergiesY2)}`);
console.log(`  Year 3 = ${M(combinedRev)} × 5.0%  = ${M(synergiesY3)}`);
console.log(`  ⚠ Year-1 synergy ${M(synergiesY1)} vs ADBE entire net income ${M(tgt.netIncome)} = ${(synergiesY1/tgt.netIncome*100).toFixed(0)}% of target's TOTAL earnings`);
console.log(`  ⚠ Year-1 synergy ${M(synergiesY1)} vs ADBE entire revenue   ${M(tgt.revenue)} = ${(synergiesY1/tgt.revenue*100).toFixed(0)}% of target's TOTAL revenue`);

console.log('\n════════ YEAR-1 PRO-FORMA EPS BRIDGE (component by component) ════════');
const afterTaxSyn = synergiesY1 * (1 - TAX_RATE);
const interestAT = cashPortion * DEBT_INTEREST_RATE * (1 - TAX_RATE);
const pfNI = acq.netIncome + tgt.netIncome + afterTaxSyn - interestAT;
const rows = [
  ['Acquirer net income (UNH)', acq.netIncome],
  ['+ Target net income (ADBE)', tgt.netIncome],
  [`+ After-tax synergies (${M(synergiesY1)} × ${(1-TAX_RATE)})`, afterTaxSyn],
  [`− After-tax financing cost (${M(cashPortion)} × ${DEBT_INTEREST_RATE} × ${(1-TAX_RATE)})`, -interestAT],
];
for (const [lbl, v] of rows) console.log(`  ${lbl.padEnd(52)} ${(v>=0?'+':'') + M(Math.abs(v)).replace('$', v>=0?'$':'-$')}`);
console.log(`  ${'= Pro-forma net income'.padEnd(52)} ${M(pfNI)}`);
console.log(`  ${'÷ Pro-forma shares'.padEnd(52)} ${(baseShares + newShares).toFixed(1)}M  (= ${baseShares}M base + ${newShares.toFixed(1)}M new)`);
console.log(`  ${'= Pro-forma EPS'.padEnd(52)} $${(pfNI/(baseShares+newShares)).toFixed(2)}`);
console.log(`\n  Standalone EPS (baseline) = $${r.companyAEPS}   →   Accretion = ${r.epsChangePct}%   (${r.isAccretive?'ACCRETIVE':'DILUTIVE'})`);
console.log(`  Note: one-time transaction/integration costs are EXCLUDED from pro-forma EPS by design (recurring-earnings basis).`);

console.log('\n════════ WHERE THE INFLATION COMES FROM ════════');
const niNoSyn = acq.netIncome + tgt.netIncome - interestAT;
console.log(`  Pro-forma NI WITHOUT synergies = ${M(niNoSyn)} → EPS $${(niNoSyn/(baseShares+newShares)).toFixed(2)} → accretion ${(((niNoSyn/(baseShares+newShares))/parseFloat(r.companyAEPS)-1)*100).toFixed(1)}%`);
console.log(`  Pro-forma NI WITH synergies    = ${M(pfNI)} → EPS $${(pfNI/(baseShares+newShares)).toFixed(2)} → accretion ${r.epsChangePct}%`);
console.log(`  Synergies alone add ${(((pfNI - niNoSyn)/(baseShares+newShares))/parseFloat(r.companyAEPS)*100).toFixed(1)} pts of accretion.`);
