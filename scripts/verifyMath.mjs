import { calculate } from '../src/utils/dealCalc.js';

let pass = 0, fail = 0;
function check(label, got, want, tol = 0.05) {
  const g = parseFloat(got), w = parseFloat(want);
  const ok = (want === null) ? (got === null)
    : (typeof want === 'boolean') ? (got === want)
    : Number.isNaN(w) ? (got === want) : Math.abs(g - w) <= tol;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}: got ${got}  want ${want}`);
  ok ? pass++ : fail++;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 hand-worked acceptance example (from the prompt). Acquirer = CRM, Target = TEAM.
// All financing-cost drag is excluded from the base accretion check (DEBT_INTEREST_RATE = 0).
console.log('── Hand-worked example: CRM acquires TEAM @ $150, 60% cash, A.price 188, synY1 935 ──');
const ex = {
  companyAShares: 929, companyAEPS: 8.03, companyANetIncome: 7457, companyADebt: 0,
  companyARevenue: 41525, companyAEBITDA: 9531, currentSharePriceA: 188,
  companyBShares: 262, companyBEPS: -0.98, companyBNetIncome: -257, companyBCash: 0, companyBDebt: 0,
  companyBRevenue: 5215, companyBEBITDA: -38, currentSharePriceB: 116,
  offerPricePerShare: 150, cashPercent: 60, transactionFees: 0,
  synergiesY1: 935, synergiesY2: 1636, synergiesY3: 2337,
};
const r = calculate(ex);
check('dealValue (totalPurchasePrice) = 39,300', r.totalPurchasePrice, 39300, 1);
check('premium ≈ +29.3%', r.purchasePremium, 29.3, 0.3);
check('newSharesIssued ≈ 83.6M (NOT 0)', r.newSharesIssued, 84, 1);     // 15720/188 = 83.6 → 84
check('newSharesIssued != 0', r.newSharesIssued !== '0', true);
check('acquirer standalone EPS ≈ $8.03 (NI/shares)', r.companyAEPS, 8.03, 0.02);
check('proFormaEPS ≈ $7.84 (NOT $0.00)', r.proFormaEPS, 7.84, 0.02);
check('proFormaEPS != 0.00', r.proFormaEPS !== '0.00', true);
check('isAccretive === false (DILUTIVE)', r.isAccretive, false);
check('epsChangePct ≈ -2.4%', r.epsChangePct, -2.4, 0.2);
check('newInterestAfterTax = 0 (no financing drag)', r.newInterestAfterTax, 0, 0.5);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Reactivity (same deal, change offer $150 → $180) ──');
const r180 = calculate({ ...ex, offerPricePerShare: 180 });
check('newShares rises', parseFloat(r180.newSharesIssued) > parseFloat(r.newSharesIssued), true);
check('proFormaEPS changes', r180.proFormaEPS !== r.proFormaEPS, true);
check('premium rises', parseFloat(r180.purchasePremium) > parseFloat(r.purchasePremium), true);
console.log(`   offer150 EPS ${r.proFormaEPS} → offer180 EPS ${r180.proFormaEPS}`);

console.log('\n── Reactivity: cash 60% → 20% (more stock → more shares → lower EPS) ──');
const rc20 = calculate({ ...ex, cashPercent: 20 });
check('newShares rises with more stock', parseFloat(rc20.newSharesIssued) > parseFloat(r.newSharesIssued), true);
check('proFormaEPS changes', rc20.proFormaEPS !== r.proFormaEPS, true);

console.log('\n── Reactivity: synergy Y1 935 → 2000 raises EPS ──');
const rsyn = calculate({ ...ex, synergiesY1: 2000 });
check('proFormaEPS rises with synergies', parseFloat(rsyn.proFormaEPS) > parseFloat(r.proFormaEPS), true);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Negative-EPS rule: loss-making acquirer must not show a % or "accretive" ──');
const flipped = calculate({
  ...ex,
  companyAShares: 262, companyANetIncome: -257, companyAEPS: -0.98, currentSharePriceA: 116,
  companyBShares: 929, companyBNetIncome: 7457, companyBEPS: 8.03, currentSharePriceB: 188,
  offerPricePerShare: 240,
});
check('epsChangePct is null (not -100%)', flipped.epsChangePct, null);
check('accretionMeaningful === false', flipped.accretionMeaningful, false);
check('isAccretive === false (leans dilutive)', flipped.isAccretive, false);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ ' + fail + ' FAILED'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
