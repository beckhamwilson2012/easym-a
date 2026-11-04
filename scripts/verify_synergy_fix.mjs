// Before/after for the synergy-preset fix, run through the REAL dealCalc.calculate().
// OLD preset: combined revenue × rate.  NEW preset: target revenue × rate (the fix).
// Run against fixed server on :3002. node scripts/verify_synergy_fix.mjs
import http from 'http';
import { calculate, calcProFormaEPS } from '../src/utils/dealCalc.js';

const g = (p) => new Promise((res) => { http.get('http://localhost:3002' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', () => res(null)); });
const B = (m) => '$' + (Math.abs(m) >= 10000 ? (m / 1000).toFixed(1) + 'B' : Math.round(m).toLocaleString() + 'M');
const RATES = { 1: 0.02, 2: 0.035, 3: 0.05 };

async function run(at, an, tt, tn) {
  const acq = await g('/quote?symbol=' + at), tgt = await g('/quote?symbol=' + tt);
  const priceA = (await g('/api/price/' + at))?.price || 0, priceB = (await g('/api/price/' + tt))?.price || 0;
  const offer = +(priceB * 1.30).toFixed(2);
  const combinedRev = (acq.revenue || 0) + (tgt.revenue || 0), targetRev = tgt.revenue || 0;
  const base = (rev) => ({
    companyARevenue: acq.revenue, companyAEBITDA: acq.ebitda, companyANetIncome: acq.netIncome,
    companyAShares: acq.shares, companyADilutedShares: acq.dilutedShares, companyAEPS: acq.eps,
    companyACash: acq.cash, companyADebt: acq.debt, currentSharePriceA: priceA,
    companyBRevenue: tgt.revenue, companyBEBITDA: tgt.ebitda, companyBNetIncome: tgt.netIncome,
    companyBShares: tgt.shares, companyBDilutedShares: tgt.dilutedShares, companyBEPS: tgt.eps,
    companyBCash: tgt.cash, companyBDebt: tgt.debt, currentSharePriceB: priceB,
    offerPricePerShare: offer, cashPercent: 60,
    synergiesY1: Math.round(rev * RATES[1]), synergiesY2: Math.round(rev * RATES[2]), synergiesY3: Math.round(rev * RATES[3]),
  });
  const inOld = base(combinedRev), inNew = base(targetRev);
  const rOld = calculate(inOld), rNew = calculate(inNew);

  console.log(`\n══════════ ${at} acquires ${tt}  ·  acquirer rev ${B(acq.revenue)} / target rev ${B(tgt.revenue)}  (${(acq.revenue / tgt.revenue).toFixed(0)}× size gap) ══════════`);
  console.log(`  Standalone acquirer EPS (baseline): $${rNew.companyAEPS}  ·  target net income ${B(tgt.netIncome)}`);
  console.log(`  SYNERGIES        Year 1        Year 2        Year 3`);
  console.log(`   OLD (combined): ${B(inOld.synergiesY1).padEnd(12)} ${B(inOld.synergiesY2).padEnd(12)} ${B(inOld.synergiesY3)}   ← ${(inOld.synergiesY1 / tgt.netIncome * 100).toFixed(0)}% of target net income`);
  console.log(`   NEW (target):   ${B(inNew.synergiesY1).padEnd(12)} ${B(inNew.synergiesY2).padEnd(12)} ${B(inNew.synergiesY3)}   ← ${(inNew.synergiesY1 / tgt.netIncome * 100).toFixed(0)}% of target net income`);
  console.log(`  ACCRETION (Year 1 headline):  OLD ${rOld.epsChangePct}%   →   NEW ${rNew.epsChangePct}%`);
  console.log(`  Recomputed accretion table (NEW, target-scaled synergies):`);
  const baseEps = parseFloat(rNew.companyAEPS);
  for (const y of [1, 2, 3]) {
    const syn = inNew['synergiesY' + y];
    const pf = calcProFormaEPS(offer, syn, inNew);
    const pct = ((pf - baseEps) / baseEps) * 100;
    console.log(`     Year ${y} (${B(syn)} syn):  Acquirer EPS $${baseEps.toFixed(2)}   Pro Forma EPS $${pf.toFixed(2)}   ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%   ${pf > baseEps ? 'Accretive' : 'Dilutive'}`);
  }
}

await run('UNH', 'UnitedHealth', 'ADBE', 'Adobe');
await run('CRM', 'Salesforce', 'TEAM', 'Atlassian');
