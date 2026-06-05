import { calculate } from '../src/utils/dealCalc.js';

// Real fetched data (from /quote + /api/price): CRM acquires TEAM.
const base = {
  // Acquirer A = CRM (Salesforce)
  companyARevenue: 41525, companyAEBITDA: 9531, companyANetIncome: 7457,
  companyAShares: 929, companyAEPS: 7.85, companyACash: 7327, companyADebt: 14439,
  currentSharePriceA: 186.72,
  // Target B = TEAM (Atlassian)
  companyBRevenue: 5215, companyBEBITDA: -38, companyBNetIncome: -257,
  companyBShares: 262, companyBEPS: -0.98, companyBCash: 2513, companyBDebt: 988,
  currentSharePriceB: 98.72,
  // Deal
  offerPricePerShare: 150, cashPercent: 60, transactionFees: 118,
  synergiesY1: 935, synergiesY2: 1636, synergiesY3: 2337,
};

let pass = 0, fail = 0;
function check(label, got, want, tol = 0.05) {
  const g = parseFloat(got), w = parseFloat(want);
  const ok = Number.isNaN(w) ? (got === want) : Math.abs(g - w) <= tol;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}: got ${got}  want ${want}`);
  ok ? pass++ : fail++;
}

console.log('── CRM acquires TEAM, $150 offer, 60% cash, Y1 syn $935 ──');
const r = calculate(base);
check('totalPurchasePrice', r.totalPurchasePrice, 39300, 1);
check('newSharesIssued (84.2M, NOT 0)', r.newSharesIssued, 84, 1);
check('proFormaEPS', r.proFormaEPS, 6.92, 0.03);
check('isAccretive === false (dilutive)', r.isAccretive, false);
check('epsChangePct ≈ -11.8%', r.epsChangePct, -11.8, 0.3);
check('purchasePremium ≈ +51.9%', r.purchasePremium, 51.9, 0.3);
check('evEBITDA N/A (TEAM EBITDA<0)', r.evEBITDA, 'N/A');
check('peRatio N/A (TEAM EPS<0)', r.peRatio, 'N/A');
check('debtEBITDA ≈ 3.7x', r.debtEBITDA, 3.7, 0.1);
check('combinedRevenue', r.combinedRevenue, 46740, 1);
check('acquirer standalone EPS preserved', r.companyAEPS, 7.85, 0.01);

console.log('\n── Reactivity: offer $150 → $180 ──');
const r180 = calculate({ ...base, offerPricePerShare: 180 });
check('premium rises', r180.purchasePremium, 82.3, 0.5);
check('newShares rises (101)', r180.newSharesIssued, 101, 1);
check('proFormaEPS falls (6.62)', r180.proFormaEPS, 6.62, 0.05);
console.log(`   (offer150 EPS ${r.proFormaEPS} vs offer180 EPS ${r180.proFormaEPS} — must differ)`);
check('EPS actually changed', r.proFormaEPS !== r180.proFormaEPS, true);

console.log('\n── Reactivity: cash 60% → 20% ──');
const rc20 = calculate({ ...base, cashPercent: 20 });
check('newShares rises (168)', rc20.newSharesIssued, 168, 1);
check('proFormaEPS changes', rc20.proFormaEPS !== r.proFormaEPS, true);
console.log(`   (60% cash EPS ${r.proFormaEPS} vs 20% cash EPS ${rc20.proFormaEPS})`);

console.log('\n── Reactivity: synergy Y1 935 → 2000 ──');
const rsyn = calculate({ ...base, synergiesY1: 2000 });
check('proFormaEPS rises with synergies', parseFloat(rsyn.proFormaEPS) > parseFloat(r.proFormaEPS), true);

console.log('\n── Negative-acquirer-EPS edge (TEAM as acquirer, must not be nonsense) ──');
const flipped = {
  ...base,
  companyAShares: 262, companyAEPS: -0.98, companyANetIncome: -257, currentSharePriceA: 98.72,
  companyBShares: 929, companyBEPS: 7.85, companyBNetIncome: 7457, currentSharePriceB: 186.72,
  offerPricePerShare: 240,
};
const rf = calculate(flipped);
check('epsChangePct is null (not -100%)', rf.epsChangePct, null);
check('accretionMeaningful === false', rf.accretionMeaningful, false);
console.log(`   isAccretive=${rf.isAccretive}, proFormaEPS=${rf.proFormaEPS} (acquirer standalone -0.98)`);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ ' + fail + ' FAILED'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
