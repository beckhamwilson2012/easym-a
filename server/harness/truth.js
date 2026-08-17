// server/harness/truth.js — the "truth" side of the gate IS the app's existing EDGAR/XBRL path
// (server/services/edgarClient.fetchFields), so revenue / EBIT / net income / cash / total debt are
// defined EXACTLY as the app defines them — no reinvention (ruling 3). That also makes net income
// NetIncomeLoss = attributable to parent (ruling 1) and revenue the app's concept priority (ruling 2)
// for free. edgarClient returns $millions; we return actual USD to match the extraction's scaledValue.
//
// D&A is not one of edgarClient's fields, so it is pulled here — with the corrected concept priority
// (ruling 8): DepreciationAndAmortization (which matches the printed cash-flow line, e.g. MCD $2,199M)
// ranks ABOVE DepreciationDepletionAndAmortization (MCD's $457M, a different/smaller concept).
const { fetchFields } = require('../services/edgarClient');
const { companyFacts } = require('./edgar');

const DA_PRIORITY = ['DepreciationAndAmortization', 'DepreciationDepletionAndAmortization', 'DepreciationAmortizationAndAccretionNet'];
const days = (a, b) => Math.abs(new Date(b) - new Date(a)) / 86400000;

function pickDA(facts, reportDate) {
  const G = (facts.facts && facts.facts['us-gaap']) || {};
  for (const c of DA_PRIORITY) {
    const arr = G[c] && G[c].units && G[c].units.USD;
    if (!arr) continue;
    const annual = arr.filter(f => f.end === reportDate && f.start && days(f.start, f.end) >= 350 && days(f.start, f.end) <= 380 && (f.form === '10-K' || f.form === '20-F'));
    if (!annual.length) continue;
    const chosen = annual.reduce((a, e) => ((e.filed || '') > (a.filed || '') ? e : a), annual[0]);
    return { concept: c, val: chosen.val };
  }
  return null;
}

async function getTruth(cik, reportDate) {
  const a = await fetchFields(cik);                 // the app's EDGAR path — $millions
  const toUsd = f => (f && f.value != null) ? f.value * 1e6 : null;
  const da = pickDA(companyFacts(cik), reportDate); // raw facts only for the one field edgarClient lacks
  return {
    reportDate,
    revenue:   toUsd(a.revenue),
    ebit:      toUsd(a.operatingIncome),
    netIncome: toUsd(a.netIncome),
    cash:      toUsd(a.cash),
    totalDebt: toUsd(a.totalDebt),
    da:        da ? da.val : null,
    concepts: {
      netIncome: 'NetIncomeLoss (attributable to parent)',
      totalDebt: 'edgarClient debtEntry: LongTermDebt → LongTermDebtNoncurrent → lease',
      debtAsOf: a.totalDebt && a.totalDebt.asOf,
      da: da && da.concept,
    },
  };
}

module.exports = { getTruth };
