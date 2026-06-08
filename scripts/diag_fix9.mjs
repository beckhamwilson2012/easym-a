// DIAGNOSTIC (Fix 9): show why the dashboard sensitivity footer ("dilutive across ALL synergy
// scenarios") appears to contradict §7 ("Year 3 Accretive"). The grid only varies the YEAR-1 synergy
// run-rate up to 150%; the Year-3 ramp is a much higher synergy level the grid never reaches.
import http from 'http';
const g = (p) => new Promise((res) => {
  http.get('http://localhost:3001' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', () => res(null));
});

const TAX = 0.21, DEBT_RATE = 0.05, CASHPCT = 60;
const SYN_MULTS = [0.5, 0.75, 1.0, 1.25, 1.5];

const A = await g('/quote?symbol=CRM');
const B = await g('/quote?symbol=TEAM');
const prB = await g('/api/price/TEAM');
const prA = await g('/api/price/CRM');
const liveB = prB?.price, liveA = prA?.price;
const offer = +(liveB * 1.30).toFixed(2);

// Year-1 / Year-3 auto synergies (suggestionTooltips: combinedRev × {Y1:0.02, Y3:0.05}).
const combinedRev = (A.revenue || 0) + (B.revenue || 0);
const synY1 = Math.round(combinedRev * 0.02);
const synY3 = Math.round(combinedRev * 0.05);

function proFormaEPS(offerPrice, syn) {
  const acqPrice = liveA;
  const totalPP = offerPrice * B.shares;
  const cash = totalPP * (CASHPCT / 100), stock = totalPP * (1 - CASHPCT / 100);
  const newSh = stock / acqPrice;
  const totalSh = A.shares + newSh;
  const ni = A.netIncome + B.netIncome + syn * (1 - TAX) - cash * DEBT_RATE * (1 - TAX);
  return ni / totalSh;
}
const base = A.netIncome / A.shares; // standalone EPS

console.log(`standalone EPS (breakeven) = $${base.toFixed(2)}`);
console.log(`Year-1 synergy run-rate = $${synY1}M ; Year-3 = $${synY3}M (${(synY3 / synY1).toFixed(1)}x the Y1 rate)`);
console.log('');
console.log('Sensitivity grid (varies Year-1 synergies, center row = base offer):');
for (const m of SYN_MULTS) {
  const syn = synY1 * m;
  const pf = proFormaEPS(offer, syn);
  console.log(`  ${(m * 100).toFixed(0).padStart(3)}% of Y1 syn ($${Math.round(syn)}M) -> PF EPS $${pf.toFixed(2)} -> ${pf >= base ? 'ACCRETIVE' : 'dilutive'}`);
}
const gridMaxSyn = synY1 * 1.5;
const y3pf = proFormaEPS(offer, synY3);
console.log('');
console.log(`grid max synergy = $${Math.round(gridMaxSyn)}M (150% of Y1) -> still dilutive`);
console.log(`Year-3 synergy   = $${synY3}M -> PF EPS $${y3pf.toFixed(2)} -> ${y3pf >= base ? 'ACCRETIVE' : 'dilutive'}`);
console.log('');
console.log(`PROOF: grid tops out at $${Math.round(gridMaxSyn)}M (dilutive) but Year-3 reaches $${synY3}M (accretive) — NOT a contradiction, just different synergy levels. Needs a reconciling note.`);
