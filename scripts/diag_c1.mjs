// DIAGNOSTIC (C1): prove the single-source-of-truth assembler (src/lib/deckModel.js) reproduces the
// EXACT shared numbers the current deck renders for CRM/TEAM @ $114.34 — i.e. every value that today
// is re-derived in 13–33 separate places resolves, from ONE object, to the live-dump values.
// Inputs below are the values observed in /tmp/qa_crmteam.txt (the live rendered deck).
import { buildDeckModel, describeDeckModel } from '../src/lib/deckModel.js';

// Reconstruct the props the deck builders hand each section, using the LIVE rendered values.
const acquirer = {
  ticker: 'CRM', name: 'Salesforce, Inc.',
  shares: 929.0, sharePrice: 150200 / 929.0,            // → $161.68 (CRM cap $150.2B / 929M)
  currentMarketCap: 150200, marketCap: 150200,
  revenue: 41525, ebitda: 9531, netIncome: 7457, debt: 10400, cash: 14000,
};
const target = {
  ticker: 'TEAM', name: 'Atlassian Corporation',
  shares: 262.0, sharePrice: 87.95,
  currentMarketCap: 87.95 * 262.0,                       // → $23.0B
  marketCap: 29957,                                      // overloaded: = acquisition price (NOT cap)
  revenue: 5215, ebitda: -151, netIncome: -192, debt: 988, cash: 2513,
};
const deal = {
  offerPrice: 114.34, cashPercent: 60, purchasePremium: 30.0,
  totalPrice: 29957, newSharesIssued: 74.0,
  epsAccretion: -10.2, isAccretive: false, proFormaEPS: 7.21,
  combinedRevenue: 46740, synergiesY1: 935,
  _results: { companyAEPS: 8.03 },
};

const model = buildDeckModel({ target, acquirer, deal });
const d = model.derived;
console.log('DERIVED:', describeDeckModel(model));

// Assert each shared number equals the live-dump value (within display rounding).
const approx = (a, b, tol) => a != null && Math.abs(a - b) <= tol;
const checks = [
  ['offer price $114.34',            approx(d.offerPrice, 114.34, 0.001)],
  ['current target price $87.95',    approx(d.currentPriceTarget, 87.95, 0.001)],
  ['premium 30.0%',                  approx(d.premiumPct, 30.0, 0.05)],
  ['acquirer cap $150.2B',           approx(d.marketCapAcquirer, 150200, 50)],
  ['target cap $23.0B',              approx(d.marketCapTarget, 23042.9, 50)],
  ['acquirer trading EV $146.6B',    approx(d.evAcquirer, 150200 + 10400 - 14000, 1)],
  ['new shares 74.0M',               approx(d.newShares, 74.0, 0.05)],
  ['pre-deal shares 929.0M',         approx(d.preDealShares, 929.0, 0.05)],
  ['pro-forma shares 1003.0M',       approx(d.proFormaShares, 1003.0, 0.05)],
  ['ownership 92.6% existing',       approx(d.ownershipExistingPct, 92.6, 0.05)],
  ['ownership 7.4% new',             approx(d.ownershipNewPct, 7.4, 0.05)],
  ['pro-forma equity $180.2B',       approx(d.pfEquityValue, 180157, 50)],
  ['transaction EV $28.4B',          approx(d.transactionEV, 29957 + 988 - 2513, 1)],
  ['accretion -10.2% dilutive',      approx(d.accretion.pct, -10.2, 0.05) && d.accretion.isAccretive === false],
  ['standalone EPS $8.03',           approx(d.accretion.standaloneEPS, 8.03, 0.005)],
  ['pro-forma EPS $7.21',            approx(d.accretion.proFormaEPS, 7.21, 0.005)],
  ['exchange ratio computed',        d.exchangeRatio != null && d.exchangeRatio > 0],
];

let pass = 0;
for (const [label, ok] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (ok) pass++; }
console.log(`\n${pass}/${checks.length} checks pass — C1 derived object reproduces the live deck values from a single source.`);
process.exit(pass === checks.length ? 0 : 1);
