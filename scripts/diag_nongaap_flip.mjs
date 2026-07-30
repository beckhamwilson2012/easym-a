// DIAGNOSTIC (no code changes). Hand-computes GAAP vs NON-GAAP pro-forma EPS / accretion for the
// loaded deal, mirroring dealCalc.calculate() exactly, so we have a predicted non-GAAP number to
// verify the eventual flip against. Prints every input. Also runs the do-nothing consistency check.
const TAX = 0.21, DEBT_RATE = 0.05;

// ── Inputs (A = acquirer ADBE, B = target CRM), from /quote (GAAP) + /api/nongaap (non-GAAP) + /api/price.
const A = {
  name: 'ADBE',
  gaap:    { ni: 7130, eps: 16.70, dil: 427 },   // /quote: netIncome, eps, dilutedShares
  nongaap: { ni: 8941, eps: 20.94 },             // /api/nongaap (allReconciled:true); dil implied = ni/eps
  coverShares: 413, price: 194.90,               // companyAShares (cover-page), live price (cnbc)
};
const B = {
  name: 'CRM',
  gaap:    { ni: 7457 },                          // /quote netIncome
  nongaap: { ni: 11969 },                         // /api/nongaap (allReconciled:true)
  shares: 929,                                    // companyBShares (cover-page) — used for purchase price
};
// Deal terms observed in the live render (auto-suggested by the app):
const deal = { offer: 195.16, cashPct: 60, synY1: 831 };  // fees ($544M) are excluded from recurring EPS

function impliedDil(ng){ return ng.ni / ng.eps; }  // the denominator the company itself used for non-GAAP EPS

// One basis. baselineEps + acquirer NI/dilShares come from the chosen basis; target NI from same basis.
function run({label, aNi, aEps, aDil, bNi, offer, cashPct, synY1}) {
  const totalPP    = offer * B.shares;
  const cashPortion = totalPP * (cashPct/100);
  const stockPortion = totalPP * (1 - cashPct/100);
  const newShares  = A.price > 0 ? stockPortion / A.price : 0;
  const totalShares = aDil + newShares;
  const afterTaxSyn = synY1 * (1 - TAX);
  const afterTaxFin = cashPortion * DEBT_RATE * (1 - TAX);
  const pfNi  = aNi + bNi + afterTaxSyn - afterTaxFin;
  const pfEps = pfNi / totalShares;
  const baseline = aEps;
  const accr = (baseline > 0 && pfEps > 0) ? ((pfEps - baseline)/baseline)*100 : null;
  console.log(`\n── ${label} ──`);
  console.log(`  baseline standalone EPS  : $${baseline.toFixed(2)}   (acquirer reported ${label.includes('NON')?'non-GAAP':'GAAP'} diluted EPS)`);
  console.log(`  acquirer NI / dil shares : ${aNi} / ${aDil.toFixed(1)} = $${(aNi/aDil).toFixed(2)}  (≈ baseline → same basis)`);
  console.log(`  target NI (numerator)    : ${bNi}`);
  console.log(`  totalPP=${totalPP.toFixed(0)}  cash=${cashPortion.toFixed(0)}  stock=${stockPortion.toFixed(0)}  newShares=${newShares.toFixed(1)}`);
  console.log(`  afterTaxSyn=${afterTaxSyn.toFixed(1)}  afterTaxFin=${afterTaxFin.toFixed(1)}`);
  console.log(`  proFormaNI = ${aNi} + ${bNi} + ${afterTaxSyn.toFixed(1)} - ${afterTaxFin.toFixed(1)} = ${pfNi.toFixed(1)}`);
  console.log(`  totalShares = ${aDil.toFixed(1)} + ${newShares.toFixed(1)} = ${totalShares.toFixed(1)}`);
  console.log(`  proFormaEPS = ${pfNi.toFixed(1)} / ${totalShares.toFixed(1)} = $${pfEps.toFixed(2)}`);
  console.log(`  ACCRETION = (${pfEps.toFixed(2)} - ${baseline.toFixed(2)}) / ${baseline.toFixed(2)} = ${accr==null?'n/m':accr.toFixed(1)+'%'}  ${accr==null?'':(accr>=0?'ACCRETIVE':'DILUTIVE')}`);
  return { pfEps, baseline, accr };
}

console.log('========================================================================');
console.log(' DEAL: ADBE acquires CRM   |   offer $195.16/sh, 60% cash, Y1 synergy $831M');
console.log(' Acquirer non-GAAP diluted shares (implied NI/EPS) =', impliedDil(A.nongaap).toFixed(1), '(GAAP diluted', A.gaap.dil + ')');
console.log('========================================================================');

const g  = run({label:'GAAP basis (CURRENT — validation vs render -18.0%/$13.70)', aNi:A.gaap.ni, aEps:A.gaap.eps, aDil:A.gaap.dil, bNi:B.gaap.ni, ...deal});
const ng = run({label:'NON-GAAP basis (PREDICTED after flip)', aNi:A.nongaap.ni, aEps:A.nongaap.eps, aDil:impliedDil(A.nongaap), bNi:B.nongaap.ni, ...deal});

console.log('\n========================================================================');
console.log(' SUMMARY:  GAAP', g.accr.toFixed(1)+'%  →  NON-GAAP', ng.accr.toFixed(1)+'%   (baseline $'+g.baseline.toFixed(2)+' → $'+ng.baseline.toFixed(2)+')');
console.log('========================================================================');

// ── Do-nothing consistency: empty target (bNi=0, offer 0, synergy 0) → pro-forma must equal baseline.
console.log('\n── DO-NOTHING test (null deal: target NI 0, offer 0, synergy 0) — must net to ~0% ──');
for (const [lbl, aNi, aEps, aDil] of [['GAAP', A.gaap.ni, A.gaap.eps, A.gaap.dil], ['NON-GAAP', A.nongaap.ni, A.nongaap.eps, impliedDil(A.nongaap)]]) {
  const pfEps = aNi / aDil;  // newShares 0, bNi 0, syn 0, fin 0
  const accr = ((pfEps - aEps)/aEps)*100;
  console.log(`  ${lbl.padEnd(8)}: proFormaEPS ${aNi}/${aDil.toFixed(1)} = $${pfEps.toFixed(4)}  vs baseline $${aEps.toFixed(2)}  → ${accr.toFixed(2)}%`);
}
