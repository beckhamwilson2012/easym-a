// Proves the deck-path EPS fix end-to-end with the ACTUAL dealCalc code §7 renders from.
// Fetches corrected /quote + /api/price from the fixed server (:3002), builds inputs exactly as
// App.js does, and runs calculate()/calcProFormaEPS() — the same functions the accretion table uses.
// Run: node scripts/test_eps_fix.mjs   (requires fixed server on :3002)
import http from 'http';
import { calculate, calcProFormaEPS } from '../src/utils/dealCalc.js';

const g = (p) => new Promise((res) => {
  http.get('http://localhost:3002' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', () => res(null));
});

const acq = await g('/quote?symbol=UNH');
const tgt = await g('/quote?symbol=ADBE');
const priceA = (await g('/api/price/UNH'))?.price || 0;
const priceB = (await g('/api/price/ADBE'))?.price || 0;
const offer = +(priceB * 1.30).toFixed(2);

const inputs = {
  companyARevenue: acq.revenue, companyAEBITDA: acq.ebitda, companyANetIncome: acq.netIncome,
  companyAShares: acq.shares, companyADilutedShares: acq.dilutedShares, companyAEPS: acq.eps,
  companyACash: acq.cash, companyADebt: acq.debt, currentSharePriceA: priceA,
  companyBRevenue: tgt.revenue, companyBEBITDA: tgt.ebitda, companyBNetIncome: tgt.netIncome,
  companyBShares: tgt.shares, companyBDilutedShares: tgt.dilutedShares, companyBEPS: tgt.eps,
  companyBCash: tgt.cash, companyBDebt: tgt.debt, currentSharePriceB: priceB,
  offerPricePerShare: offer, cashPercent: 60,
  synergiesY1: 200, synergiesY2: 400, synergiesY3: 600,
};

const r = calculate(inputs);
console.log('=== /quote inputs (from fixed :3002) ===');
console.log(`  UNH  : eps(reported diluted)=${acq.eps}  dilutedShares=${acq.dilutedShares}  shares(point-in-time)=${acq.shares}  netIncome=${acq.netIncome}`);
console.log(`  ADBE : eps(reported diluted)=${tgt.eps}  dilutedShares=${tgt.dilutedShares}  shares(point-in-time)=${tgt.shares}`);
console.log(`  offer=$${offer} (30% prem over $${priceB}) · 60% cash`);
console.log('\n=== dealCalc.calculate() — the numbers §7 renders ===');
console.log(`  Acquirer standalone EPS (ACCRETION BASELINE): $${r.companyAEPS}   ← was net income ÷ point-in-time shares`);
console.log(`  Pro forma EPS: $${r.proFormaEPS}  ·  EPS change: ${r.epsChangePct}%  ·  ${r.isAccretive ? 'ACCRETIVE' : 'DILUTIVE'}`);

console.log('\n=== §7 accretion table (Acquirer EPS vs Pro Forma EPS, recomputed off corrected base) ===');
const base = parseFloat(r.companyAEPS);
for (const [label, syn] of [['Year 1', inputs.synergiesY1], ['Year 2', inputs.synergiesY2], ['Year 3', inputs.synergiesY3]]) {
  const pf = calcProFormaEPS(offer, syn, inputs);
  const pct = (pf != null && base > 0) ? ((pf - base) / base) * 100 : null;
  console.log(`  ${label} ($${syn}M syn): Acquirer EPS $${base.toFixed(2)}  Pro Forma EPS $${pf.toFixed(2)}  ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%  ${pf > base ? 'Accretive' : 'Dilutive'}`);
}
console.log(`\n  CHECK: baseline = $${base.toFixed(2)} ${Math.abs(base - 13.23) < 0.005 ? '✅ = 13.23 (UNH reported diluted)' : '❌ expected 13.23'}`);
