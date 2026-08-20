// agent/tests/2b-null-not-zero.js — queue item 2b, "unavailable target debt coerced to $0 at the
// render boundary" (GATE-2A root: debt-dropped).
//
// Exit codes are the harness contract (GATE_SPEC §12):
//   0 = PASS   the defect is absent
//   1 = FAIL   the defect is present
//   2 = ERROR  the test could not run (precondition unmet, module unloadable) — NOT a fail
//
// SUBJECT: the values src/utils/dealCalc.js `calculate()` hands the deck — r.targetDebtRepaid,
// r.newDebt, r.excessCashUsed. Those are the figures §10 Sources & Uses renders, so the assertions are
// stated in the item's own vocabulary (the rendered figure), not in the shape of any particular fix.
//
// The module is ESM with one extensionless relative import ('../lib/netDebt'), which bare node cannot
// resolve. It is loaded by rewriting ONLY that specifier to an inlined copy of the real netDebt.js and
// importing the result as a data: module. No logic is replicated here — every function body executed
// below is the shipped source, read off disk at run time.
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const err  = (msg) => { console.error(`ERROR: ${msg}`); process.exit(2); };

const inline = (rel) => 'data:text/javascript;base64,' +
  Buffer.from(fs.readFileSync(path.join(ROOT, rel), 'utf8')).toString('base64');

// RKLB/IRDM. Only companyBDebt varies across the cases; everything else is held constant, so any
// difference in the rendered figures is attributable to the target-debt input alone.
const BASE = {
  applySourcesOfFunds: true, bankDeal: false,
  offerPricePerShare: 55, companyBShares: 110, cashPercent: 50,
  companyACash: 400, companyASti: null, companyBCash: 184, companyBSti: null,
  companyALtmRevenue: 436, companyBLtmRevenue: 872,
  companyADebt: 1200,
  companyARevenue: 436, companyBRevenue: 872, companyAEBITDA: -100, companyBEBITDA: 236,
  companyANetIncome: -190, companyBNetIncome: 40, companyAEPS: -0.40, companyBEPS: 0.36,
  companyAShares: 460, companyADilutedShares: 460,
  currentSharePriceA: 22, currentSharePriceB: 48.45,
  synergiesY1: 30, synergiesY2: 45, synergiesY3: 60, transactionFees: 60,
};
const REAL_DEBT = 1749; // IRDM total debt, /quote?symbol=IRDM, sec_edgar, $M

(async () => {
  let DC;
  try {
    let src = fs.readFileSync(path.join(ROOT, 'src/utils/dealCalc.js'), 'utf8');
    const before = src;
    src = src.split("'../lib/netDebt'").join(JSON.stringify(inline('src/lib/netDebt.js')));
    if (src === before) err('src/utils/dealCalc.js no longer imports \'../lib/netDebt\' — loader shim stale, cannot vouch for what ran');
    DC = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  } catch (e) {
    err(`could not load src/utils/dealCalc.js — ${e.message}`);
  }
  if (typeof DC.calculate !== 'function' || typeof DC.acquisitionNewDebt !== 'function') {
    err('dealCalc.js does not export calculate/acquisitionNewDebt — wrong module loaded');
  }

  const render = (debt) => DC.calculate({ ...BASE, companyBDebt: debt });
  const absent = render(null);
  const zero   = render(0);
  const real   = render(REAL_DEBT);

  // PRECONDITION, not an assertion. This item is about the sources-of-funds construction. If that
  // branch did not execute (bank deal, applySourcesOfFunds off, combined cash unresolvable) then the
  // line under test never ran and every "not zero" reading below would pass vacuously. An unmeasurable
  // premise is ERROR, never PASS (GATE_SPEC §8).
  if (real.bankFinancing !== false) err(`precondition unmet — bankFinancing=${JSON.stringify(real.bankFinancing)}, expected false (bank branch skips the line under test)`);
  if (real.combinedCash == null)    err('precondition unmet — combinedCash null, the sources-of-funds branch did not resolve');
  if (real.targetDebtRepaid !== String(REAL_DEBT)) err(`precondition unmet — a REAL debt of ${REAL_DEBT} rendered as ${JSON.stringify(real.targetDebtRepaid)}; the construction under test is not the one running`);

  console.log('calculate() @ RKLB/IRDM, companyBDebt varied, all else held constant:');
  for (const [label, r] of [['ABSENT (null)', absent], ['GENUINE $0', zero], [`REAL $${REAL_DEBT}M`, real]]) {
    console.log(`  ${label.padEnd(14)} targetDebtRepaid=${JSON.stringify(r.targetDebtRepaid)}  newDebt=${JSON.stringify(r.newDebt)}  excessCashUsed=${JSON.stringify(r.excessCashUsed)}`);
  }

  const fail = [];

  // 1. THE ITEM. An unavailable figure renders blank/null, never $0 (charter: "Unavailable data is an
  //    honest blank — never zero, never a substituted proxy").
  if (absent.targetDebtRepaid !== null)
    fail.push(`companyBDebt=null -> targetDebtRepaid=${JSON.stringify(absent.targetDebtRepaid)}, want null (renders as a dash)`);

  // 2. A GENUINE zero must still render as $0. Null-honesty that also blanks a real zero trades one
  //    fabrication for another — this is the no-op half of the fix.
  if (zero.targetDebtRepaid !== '0')
    fail.push(`companyBDebt=0 -> targetDebtRepaid=${JSON.stringify(zero.targetDebtRepaid)}, want "0" (a real zero is a real value)`);

  // 3. Absent and zero are different states and must render differently. This is the assertion the
  //    defect fails on most directly: today both produce the identical "0".
  if (absent.targetDebtRepaid === zero.targetDebtRepaid)
    fail.push(`absent and genuine-zero render identically (${JSON.stringify(zero.targetDebtRepaid)}) — an unknown debt is indistinguishable from a repaid-nothing debt`);

  // 4. Pattern B: the unknown must not be absorbed as 0 inside the sums that consume it. newDebt =
  //    cashConsideration + targetDebtRepaid − excessCashAvail and excessCashUsed both take the unknown
  //    as an addend, so with the addend unknown the totals are unknown too — and must not silently
  //    equal the genuine-zero-debt totals, which is exactly what a coerced null produces.
  if (absent.newDebt !== null)
    fail.push(`companyBDebt=null -> newDebt=${JSON.stringify(absent.newDebt)}, want null (an unknown addend makes the sum unknown)`);
  if (absent.excessCashUsed !== null)
    fail.push(`companyBDebt=null -> excessCashUsed=${JSON.stringify(absent.excessCashUsed)}, want null (same sum, same unknown)`);
  if (absent.newDebt !== null && absent.newDebt === zero.newDebt)
    fail.push(`newDebt is ${JSON.stringify(zero.newDebt)} whether the target's debt is unknown or genuinely zero — the null was coerced to 0 inside the sum`);

  // 5. NO-OP half. A deal with real debt on both sides is untouched: the faculty construction still
  //    assumes 100% repaid and still funds it. 55 × 110 × 50% = 3025 cash consideration;
  //    excess cash = (400 + 184) − 2% × (436 + 872) = 584 − 26.16 = 557.84; newDebt = 3025 + 1749 − 557.84.
  if (real.newDebt !== '4216')
    fail.push(`REAL debt ${REAL_DEBT} -> newDebt=${JSON.stringify(real.newDebt)}, want "4216" (3025 + 1749 − 558) — the working path moved`);
  if (real.excessCashUsed !== '558')
    fail.push(`REAL debt ${REAL_DEBT} -> excessCashUsed=${JSON.stringify(real.excessCashUsed)}, want "558" — the working path moved`);

  if (fail.length) {
    console.error(`FAIL (${fail.length}):`);
    for (const f of fail) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`PASS: unknown target debt renders blank · a genuine $0 still renders $0 · the two differ · the sums consuming it go blank rather than absorbing the unknown as zero · real-debt deal unchanged (newDebt ${real.newDebt}, excess cash used ${real.excessCashUsed})`);
})();
