// Before/after for the BANK-mode synergy fix, through the real dealCalc.calculate().
// OLD bank preset: combined non-interest expense × rate.  NEW: target NIE × rate (the fix).
// Bank synergy rates {Y1:5%, Y2:8%, Y3:11%}. Run against fixed server on :3002.
import http from 'http';
import { calculate, calcProFormaEPS } from '../src/utils/dealCalc.js';

const g = (p) => new Promise((res) => { http.get('http://localhost:3002' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', () => res(null)); });
const B = (m) => '$' + (Math.abs(m) >= 10000 ? (m / 1000).toFixed(1) + 'B' : Math.round(m).toLocaleString() + 'M');
const RATES = { 1: 0.05, 2: 0.08, 3: 0.11 };

async function run(at, an, tt, tn) {
  const acq = await g('/quote?symbol=' + at), tgt = await g('/quote?symbol=' + tt);
  const acqBF = await g('/api/bank-facts/' + at), tgtBF = await g('/api/bank-facts/' + tt);
  const priceA = (await g('/api/price/' + at))?.price || 0, priceB = (await g('/api/price/' + tt))?.price || 0;
  const acqNIE = acqBF?.nonInterestExpense || 0, tgtNIE = tgtBF?.nonInterestExpense || 0;
  const offer = +(priceB * 1.30).toFixed(2);
  const combinedNIE = acqNIE + tgtNIE;
  const base = (nieBasis) => ({
    companyARevenue: acq.revenue, companyAEBITDA: acq.ebitda, companyANetIncome: acq.netIncome,
    companyAShares: acq.shares, companyADilutedShares: acq.dilutedShares, companyAEPS: acq.eps,
    companyACash: acq.cash, companyADebt: acq.debt, currentSharePriceA: priceA,
    companyBRevenue: tgt.revenue, companyBEBITDA: tgt.ebitda, companyBNetIncome: tgt.netIncome,
    companyBShares: tgt.shares, companyBDilutedShares: tgt.dilutedShares, companyBEPS: tgt.eps,
    companyBCash: tgt.cash, companyBDebt: tgt.debt, currentSharePriceB: priceB,
    offerPricePerShare: offer, cashPercent: 60, transactionFees: 100,
    synergiesY1: Math.round(nieBasis * RATES[1]), synergiesY2: Math.round(nieBasis * RATES[2]), synergiesY3: Math.round(nieBasis * RATES[3]),
  });
  const inOld = base(combinedNIE), inNew = base(tgtNIE);
  const rOld = calculate(inOld), rNew = calculate(inNew);

  console.log(`\n══════════ ${at} acquires ${tt} (BANK MODE)  ·  acquirer NIE ${B(acqNIE)} / target NIE ${B(tgtNIE)}  (${(acqNIE / tgtNIE).toFixed(1)}× gap) ══════════`);
  console.log(`  Acquirer standalone EPS $${rNew.companyAEPS} · target net income ${B(tgt.netIncome)}`);
  console.log(`  SYNERGIES        Year 1        Year 2        Year 3`);
  console.log(`   OLD (combined): ${B(inOld.synergiesY1).padEnd(12)} ${B(inOld.synergiesY2).padEnd(12)} ${B(inOld.synergiesY3)}   ← ${(inOld.synergiesY1 / tgt.netIncome * 100).toFixed(0)}% of target net income`);
  console.log(`   NEW (target):   ${B(inNew.synergiesY1).padEnd(12)} ${B(inNew.synergiesY2).padEnd(12)} ${B(inNew.synergiesY3)}   ← ${(inNew.synergiesY1 / tgt.netIncome * 100).toFixed(0)}% of target net income`);
  console.log(`  ACCRETION (Year 1):  OLD ${rOld.epsChangePct}%   →   NEW ${rNew.epsChangePct}%`);
  console.log(`  Recomputed accretion table (NEW, target-scaled synergies):`);
  const baseEps = parseFloat(rNew.companyAEPS);
  for (const y of [1, 2, 3]) {
    const syn = inNew['synergiesY' + y];
    const pf = calcProFormaEPS(offer, syn, inNew);
    const pct = ((pf - baseEps) / baseEps) * 100;
    console.log(`     Year ${y} (${B(syn)} syn):  Acquirer EPS $${baseEps.toFixed(2)}   Pro Forma EPS $${pf.toFixed(2)}   ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%   ${pf > baseEps ? 'Accretive' : 'Dilutive'}`);
  }
}

await run('USB', 'U.S. Bancorp', 'KEY', 'KeyCorp');
await run('JPM', 'JPMorgan', 'HBAN', 'Huntington');  // extreme size gap → synergy figure most inflated
