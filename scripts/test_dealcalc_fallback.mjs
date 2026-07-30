// Verifies the diluted-share fallback fix in dealCalc.js (imported as a renamed .mjs copy — the file
// has no relative imports, so this exercises the REAL current source). Compares NEW behavior against a
// local replica of the OLD one-sided cover-page formula. No server, no network — pure functions.
import * as DC from '/tmp/dealCalc_test.mjs';

const TAX = 0.21, RATE = 0.05;
const acqPrice = i => { const live = parseFloat(i.currentSharePriceA) || 0; if (live > 0) return live; const e = parseFloat(i.companyAEPS) || 0; return e > 0 ? e * 15 : 0; };
// OLD pro-forma: the one-sided `companyADilutedShares || companyAShares` (cover-page) denominator.
const oldProForma = (i, offer, syn) => {
  const ap = acqPrice(i); if (ap === 0 || i.companyBShares === 0) return null;
  const tpp = offer * i.companyBShares, cash = tpp * i.cashPercent / 100, stock = tpp * (100 - i.cashPercent) / 100;
  const base = parseFloat(i.companyADilutedShares) || parseFloat(i.companyAShares) || 0; // OLD: cover-page drop
  const ts = base + stock / ap; if (ts === 0) return null;
  const ni = i.companyANetIncome + i.companyBNetIncome + syn * (1 - TAX) - cash * RATE * (1 - TAX);
  return ni / ts;
};
const oldAccretion = i => { const pf = oldProForma(i, i.offerPricePerShare, i.synergiesY1); const b = DC.acquirerStandaloneEPS(i); return (pf == null || !(b > 0) || !(pf > 0)) ? null : (pf - b) / b * 100; };
const newAccretion = i => DC.epsAccretionPct(i.offerPricePerShare, i.synergiesY1, i);
const r = x => x == null ? 'N/A' : x.toFixed(4);

// "Do-nothing" inputs: zero consideration, zero synergy, target contributes nothing → pro-forma should
// equal the standalone baseline (≈0% accretion) whenever baseline & pro-forma share one share basis.
const doNothing = over => ({
  companyAShares: 929, companyADilutedShares: 956, companyAEPS: 7.80, companyANetIncome: 7457,
  companyARevenue: 41525, companyAEBITDA: 9531, companyADebt: 14439, currentSharePriceA: 265,
  companyBShares: 1, companyBEPS: 0, companyBNetIncome: 0, companyBRevenue: 0, companyBEBITDA: 0,
  companyBCash: 0, companyBDebt: 0, currentSharePriceB: 0,
  offerPricePerShare: 0, cashPercent: 50, transactionFees: 0,
  synergiesY1: 0, synergiesY2: 0, synergiesY3: 0, ...over,
});

const show = (title, i) => {
  const dil = DC.acquirerDilutedShares(i);
  const base = DC.acquirerStandaloneEPS(i);
  const impliedFromBaseline = base > 0 ? (parseFloat(i.companyANetIncome) / base) : null;
  console.log(`\n### ${title}`);
  console.log(`  inputs: companyADilutedShares=${i.companyADilutedShares}  companyAEPS=${i.companyAEPS}  NI=${i.companyANetIncome}  cover-page(companyAShares)=${i.companyAShares}`);
  console.log(`  acquirerDilutedShares() -> shares=${dil.shares.toFixed(2)}  approximate=${dil.approximate}`);
  console.log(`  standalone baseline EPS = ${base.toFixed(4)}   (implies a diluted count of NI/baseline = ${impliedFromBaseline?.toFixed(2)})`);
  console.log(`  -> does the pro-forma share count match the baseline's implied count?  ${Math.abs(dil.shares - impliedFromBaseline) < 0.5 ? 'YES ✓ (same basis)' : 'NO ✗'}`);
  console.log(`  do-nothing accretion %:   OLD(one-sided cover-page) = ${r(oldAccretion(i))}%    NEW(effective) = ${r(newAccretion(i))}%`);
};

console.log('================= DILUTED-SHARE FALLBACK FIX — VERIFICATION =================');

// TEST 1 — normal EDGAR-tagged company (CRM, real diluted 956 present). Fix must NOT disturb it.
show('TEST 1  CRM normal (real weighted-avg diluted = 956 present)', doNothing({}));

// TEST 2 — diluted GENUINELY NULL, reported EPS present (the fallback gap). This is the stale-server
// shape for CRM: companyADilutedShares missing, companyAEPS=7.85 (basic). OLD drops to cover-page 929
// (=> phantom); NEW derives effective = NI/eps = 7457/7.85 = 950 => baseline & pro-forma agree.
show('TEST 2  diluted NULL + reported EPS 7.85 (stale-CRM shape)', doNothing({ companyADilutedShares: 0, companyAEPS: 7.85 }));

// TEST 3 — synthetic two-class-style company: diluted null, eps=5.00, NI=1000, cover=190.
show('TEST 3  synthetic: diluted NULL, eps 5.00, NI 1000, cover-page 190', doNothing({ companyADilutedShares: 0, companyAEPS: 5.00, companyANetIncome: 1000, companyAShares: 190 }));

// TEST 4 — diluted AND reported EPS both unavailable -> cover-page on BOTH sides, flagged approximate.
show('TEST 4  diluted NULL + EPS NULL (last resort: cover-page BOTH sides, approximate)', doNothing({ companyADilutedShares: 0, companyAEPS: 0 }));

// TEST 5 — full CRM/TEAM deal (consistent-basis simulation of what the live deck shows post-restart).
const crmTeam = (dil, eps) => ({
  companyAShares: 929, companyADilutedShares: dil, companyAEPS: eps, companyANetIncome: 7457,
  companyARevenue: 41525, companyAEBITDA: 9531, companyADebt: 14439, currentSharePriceA: 265,
  companyBShares: 262, companyBEPS: -0.98, companyBNetIncome: -257, companyBRevenue: 5215,
  companyBEBITDA: -38, companyBCash: 2513, companyBDebt: 988, currentSharePriceB: 82.72,
  offerPricePerShare: 107.54, cashPercent: 50, transactionFees: 85,
  synergiesY1: 104, synergiesY2: 183, synergiesY3: 261,
});
console.log('\n### TEST 5  full CRM acquires TEAM accretion (unit simulation; live render is yours post-restart)');
const stale = DC.calculate(crmTeam(0, 7.85));     // stale shape: no diluted -> NEW helper derives 950 from 7.85
const fixed = DC.calculate(crmTeam(956, 7.80));   // post-restart: real diluted 956 + reported diluted 7.80
console.log(`  stale-shape (diluted null, eps 7.85): baseline=$${stale.companyAEPS}  proFormaEPS=$${stale.proFormaEPS}  epsChange=${stale.epsChangePct}%  approx=${stale.proFormaDilutedApproximate}`);
console.log(`  post-restart (diluted 956, eps 7.80): baseline=$${fixed.companyAEPS}  proFormaEPS=$${fixed.proFormaEPS}  epsChange=${fixed.epsChangePct}%  approx=${fixed.proFormaDilutedApproximate}`);
console.log(`  baseline $${fixed.companyAEPS} == NI/diluted 7457/956 = $${(7457/956).toFixed(2)} ? ${ (7457/956).toFixed(2) === fixed.companyAEPS ? 'YES ✓ reconciled' : 'no'}`);
