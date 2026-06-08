import { calculate, DEBT_INTEREST_RATE, TAX_RATE } from '../src/utils/dealCalc.js';

// ── What this test guards ─────────────────────────────────────────────────────
// The model's DEFAULT includes an incremental acquisition-financing cost: the cash portion is
// funded by new debt at DEBT_INTEREST_RATE (5%), charged after tax. So:
//   proFormaEPS = (A.NI + B.NI + after-tax synergies − cashPortion×rate×(1−tax)) ÷ combined shares
// These expected values are the ACTUAL output of calculate() with that default — recomputed by hand
// below so the test asserts reality, not the other way around. If DEBT_INTEREST_RATE changes, the
// expected values below must be recomputed to match.
console.log(`(assumptions: DEBT_INTEREST_RATE=${DEBT_INTEREST_RATE}, TAX_RATE=${TAX_RATE})`);

let pass = 0, fail = 0;
function check(label, got, want, tol = 0.05) {
  const g = parseFloat(got), w = parseFloat(want);
  const ok = (want === null) ? (got === null)
    : (typeof want === 'boolean') ? (got === want)
    : Number.isNaN(w) ? (got === want) : Math.abs(g - w) <= tol;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}: got ${got}  want ${want}`);
  ok ? pass++ : fail++;
}

// Guard the assumption itself so a silent flip to OFF fails loudly.
check('DEBT_INTEREST_RATE default is 0.05 (financing ON)', DEBT_INTEREST_RATE, 0.05, 0);

// ── Hand-worked example: CRM acquires TEAM @ $150, 60% cash, A.price 188, synY1 935 ──
// dealValue = 150×262 = 39,300 ; cashPortion = 23,580 ; stockPortion = 15,720
// newShares = 15,720/188 = 83.6 ; combinedShares = 1,012.6
// afterTaxSynergies = 935×0.79 = 738.65
// financing = 23,580 × 0.05 × 0.79 = 931.4  (after-tax interest on the cash portion)
// proFormaNI = 7457 − 257 + 738.65 − 931.4 = 7,007.3 ; proFormaEPS = 7,007.3/1,012.6 = $6.92
// standaloneEPS = 7457/929 = $8.03 → accretion = 6.92/8.03 − 1 = −13.8%, DILUTIVE
console.log('\n── CRM acquires TEAM @ $150, 60% cash (financing ON) ──');
const ex = {
  companyAShares: 929, companyAEPS: 8.03, companyANetIncome: 7457, companyADebt: 0,
  companyARevenue: 41525, companyAEBITDA: 9531, currentSharePriceA: 188,
  companyBShares: 262, companyBEPS: -0.98, companyBNetIncome: -257, companyBCash: 0, companyBDebt: 0,
  companyBRevenue: 5215, companyBEBITDA: -38, currentSharePriceB: 116,
  offerPricePerShare: 150, cashPercent: 60, transactionFees: 0,
  synergiesY1: 935, synergiesY2: 1636, synergiesY3: 2337,
};
const r = calculate(ex);
check('dealValue = 39,300', r.totalPurchasePrice, 39300, 1);
check('premium ≈ +29.3%', r.purchasePremium, 29.3, 0.3);
check('newSharesIssued ≈ 83.6M (NOT 0)', r.newSharesIssued, 84, 1);
check('newSharesIssued != 0', r.newSharesIssued !== '0', true);
check('afterTaxSynergies ≈ 739', r.afterTaxSynergies, 739, 2);
check('newInterestAfterTax ≈ 931 (financing ON)', r.newInterestAfterTax, 931, 3);
check('acquirer standalone EPS ≈ $8.03 (NI/shares)', r.companyAEPS, 8.03, 0.02);
check('proFormaEPS ≈ $6.92 (NOT $0.00)', r.proFormaEPS, 6.92, 0.02);
check('proFormaEPS != 0.00', r.proFormaEPS !== '0.00', true);
check('isAccretive === false (DILUTIVE)', r.isAccretive, false);
check('epsChangePct ≈ -13.8%', r.epsChangePct, -13.8, 0.3);
check('evEBITDA N/A (TEAM EBITDA<0)', r.evEBITDA, 'N/A');
check('peRatio N/A (TEAM EPS<0)', r.peRatio, 'N/A');

// ── Reactivity ────────────────────────────────────────────────────────────────
console.log('\n── Reactivity: offer $150 → $180 ──');
const r180 = calculate({ ...ex, offerPricePerShare: 180 });
check('newShares rises (≈100)', r180.newSharesIssued, 100, 1);
check('financing rises (≈1118)', r180.newInterestAfterTax, 1118, 3);
check('proFormaEPS falls to ≈$6.63', r180.proFormaEPS, 6.63, 0.03);
check('premium rises to ≈+55.2%', r180.purchasePremium, 55.2, 0.4);

console.log('\n── Reactivity: cash 60% → 20% (less cash → less interest drag) ──');
const rc20 = calculate({ ...ex, cashPercent: 20 });
check('financing falls (≈310)', rc20.newInterestAfterTax, 310, 3);
check('newShares rises (more stock, ≈167)', rc20.newSharesIssued, 167, 2);
check('proFormaEPS ≈ $6.96 (changes vs base)', rc20.proFormaEPS, 6.96, 0.03);
check('proFormaEPS actually changed', rc20.proFormaEPS !== r.proFormaEPS, true);

console.log('\n── Reactivity: synergy Y1 935 → 2000 raises EPS ──');
const rsyn = calculate({ ...ex, synergiesY1: 2000 });
check('proFormaEPS rises to ≈$7.75', rsyn.proFormaEPS, 7.75, 0.03);

// ── Negative-EPS rule ───────────────────────────────────────────────────────────
console.log('\n── Negative-EPS rule: loss-making acquirer → no %, leans dilutive ──');
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
