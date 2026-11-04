'use strict';
// server/services/revenueConcepts.js — the ONE place revenue is resolved, so /quote, /api/pnl, /api/segments, the
// LTM legs and the §16 verification (edgarClient) all resolve identically. Same style as incomeConcepts.js.
//
// WHICH TAG, per fiscal period:
//   1. Every candidate filed for that exact period, full-year, latest-filed on a restatement (pickAnnualAt).
//   2. All agree: the first listed wins, exactly the order the app has always used.
//   3. They disagree: the one that is the income statement's total wins, confirmed by a tie-out from filed numbers
//      only: candidate − total costs = operating income, or candidate − cost of revenue = gross profit. Crown Castle
//      FY25: RevenueFromContractWithCustomerExcludingAssessedTax 215 fails, Revenues 4,264 ties. Williams shows why
//      "take the larger" would be wrong: its contract-revenue tag (14,899) is larger than the statement total (11,950).
//   4. Nothing ties, or two different values tie: today's pick stays and carries a flag naming the tags and values.
//      Candidates are never summed.
//
// WHICH YEAR: the company's latest annual filing period (10-K or 20-F, from submissions) is a floor. A tag whose
// latest year is older returns nothing, rather than an old year presented as the latest. SAP's USD facts stop at
// FY2017 and Toyota's at FY2013 because they now file in EUR and JPY; both have newer 20-Fs.

const { pickAnnualAt, FILED_COST_CONCEPTS, COST_OF_REVENUE_CONCEPTS } = require('./incomeConcepts');

const REVENUE_CONCEPTS = {
  gaap: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet',
         'RevenueFromContractWithCustomerIncludingAssessedTax', 'RevenuesNetOfInterestExpense',
         'RegulatedAndUnregulatedOperatingRevenue'],
  ifrs: ['Revenue', 'RevenueFromContractsWithCustomers', 'RevenueAndOtherIncome'],
};

// Tags that are a slice of revenue by definition. Consulted only when no candidate above is filed for the period, and
// only by a caller that asks (subLines). They are never compared against a real candidate: a bank's loan interest is
// not an alternative total.
const REVENUE_SUB_LINES = {
  gaap: ['InterestAndFeeIncomeLoansAndLeases'],
  ifrs: ['OtherRevenue', 'RevenueFromSaleOfGoods'],
};

// Filed gains that some statements report between total costs and operating income.
const OPERATING_GAIN_CONCEPTS = ['GainLossOnSaleOfOtherAssets', 'DisposalGroupNotDiscontinuedOperationGainLossOnDisposal', 'GainLossOnDispositionOfAssets1'];

const IFRS_NO_CURRENT_YEAR = 'no current-year data in SEC filings (company reports under IFRS)';

const DAY = 86400000;
const FISCAL_YEAR_DRIFT_DAYS = 14;   // a 52/53-week year end moves by days, not weeks
const AGREE_TOLERANCE = 0.001;       // two tags within 0.1% are the same number at different rounding
const TIE_OUT_TOLERANCE = 0.001;     // filed figures round independently; 0.1% of revenue covers that and little else

const fmtM = (v) => `$${(v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;

// True when `end` belongs to a fiscal year before `floorEnd`. No floor means nothing can be judged, so false.
function isOlderFiscalYear(end, floorEnd) {
  if (!end || !floorEnd) return false;
  return (Date.parse(floorEnd) - Date.parse(end)) > FISCAL_YEAR_DRIFT_DAYS * DAY;
}

// subLines: true for both namespaces, 'gaap' for a us-gaap filer only, false for neither.
const wantsSubLines = (subLines, useIfrs) => subLines === true || (subLines === 'gaap' && !useIfrs);

const conceptList = (useIfrs, subLines) => {
  const key = useIfrs ? 'ifrs' : 'gaap';
  return wantsSubLines(subLines, useIfrs) ? [...REVENUE_CONCEPTS[key], ...REVENUE_SUB_LINES[key]] : REVENUE_CONCEPTS[key];
};

function fullYearEnds(ns, names) {
  const ends = new Set();
  for (const concept of names) {
    for (const e of ns[concept]?.units?.USD || []) {
      if (e.form !== '10-K' && e.form !== '20-F') continue;
      if (e.start) {
        const span = (Date.parse(e.end) - Date.parse(e.start)) / DAY;
        if (!(span >= 350 && span <= 380)) continue;
      }
      ends.add(e.end);
    }
  }
  return [...ends].sort();
}

const candidatesAt = (ns, names, end) => names
  .map((concept) => pickAnnualAt(ns, [concept], end))
  .filter(Boolean)
  .map((entry) => ({ concept: entry.concept, value: entry.val, entry }));

const disagree = (a, b) => Math.abs(a - b) > Math.max(Math.abs(a), Math.abs(b)) * AGREE_TOLERANCE;

// Every tie-out this candidate can be tested on, from filed numbers for the same period. Absent inputs give no test.
function tieOutTests(ns, end, value, useIfrs) {
  const filed = (concept) => {
    const entry = pickAnnualAt(ns, [concept], end);
    return entry ? entry.val : null;
  };
  const tests = [];
  const add = (cost, costName, result, resultName) => {
    if (cost == null || result == null) return;
    const residual = value - cost - result;
    tests.push({ test: `revenue − ${costName} = ${resultName}`, cost, result, residual,
      pass: Math.abs(residual) <= Math.abs(value) * TIE_OUT_TOLERANCE });
  };
  const gross = filed('GrossProfit');
  for (const c of useIfrs ? COST_OF_REVENUE_CONCEPTS.ifrs : FILED_COST_CONCEPTS) {
    add(filed(c), c, gross, 'GrossProfit');
  }
  if (!useIfrs) {
    const operating = filed('OperatingIncomeLoss');
    const pretax = filed('IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest')
      ?? filed('IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments');
    add(filed('CostsAndExpenses'), 'CostsAndExpenses', operating, 'OperatingIncomeLoss');
    add(filed('OperatingExpenses'), 'OperatingExpenses', operating, 'OperatingIncomeLoss');
    // Some statements put a gains line between total costs and operating income. Duke FY25: 32,237 − 23,656 + 45 = 8,626.
    for (const gain of OPERATING_GAIN_CONCEPTS) {
      const g = filed(gain);
      if (g == null) continue;
      for (const costs of ['CostsAndExpenses', 'OperatingExpenses']) {
        const c = filed(costs);
        if (c != null) add(c - g, `${costs} + ${gain}`, operating, 'OperatingIncomeLoss');
      }
    }
    add(filed('CostsAndExpenses'), 'CostsAndExpenses', pretax, 'pre-tax income');
    add(filed('BenefitsLossesAndExpenses'), 'BenefitsLossesAndExpenses', pretax, 'pre-tax income');
  }
  return tests;
}

// The resolution for one period, or null when no candidate is filed for it. `value` is raw dollars.
function resolveRevenueAt(ns, end, { useIfrs = false, subLines = false } = {}) {
  let candidates = candidatesAt(ns, REVENUE_CONCEPTS[useIfrs ? 'ifrs' : 'gaap'], end);
  if (!candidates.length && wantsSubLines(subLines, useIfrs)) candidates = candidatesAt(ns, REVENUE_SUB_LINES[useIfrs ? 'ifrs' : 'gaap'], end);
  if (!candidates.length) return null;

  const first = candidates[0];
  const base = { end, candidates: candidates.map(({ concept, value }) => ({ concept, value })) };
  const hasDisagreement = candidates.some((c) => disagree(c.value, first.value));
  if (!hasDisagreement) {
    return { ...base, value: first.value, concept: first.concept, entry: first.entry,
      status: candidates.length > 1 ? 'agreed' : 'single', tieOut: null, flag: null,
      label: `SEC EDGAR companyfacts (${first.concept})` };
  }

  const tested = candidates.map((c) => {
    const tests = tieOutTests(ns, end, c.value, useIfrs);
    return { ...c, passing: tests.find((t) => t.pass) || null };
  });
  const confirmed = tested.filter((c) => c.passing);
  if (confirmed.length && !confirmed.some((c) => disagree(c.value, confirmed[0].value))) {
    const winner = confirmed[0];
    return { ...base, value: winner.value, concept: winner.concept, entry: winner.entry, status: 'tie-out',
      tieOut: { test: winner.passing.test, cost: winner.passing.cost, result: winner.passing.result, residual: winner.passing.residual }, flag: null,
      label: `SEC EDGAR companyfacts (${winner.concept}), income statement total: ${winner.passing.test}` };
  }
  return { ...base, value: first.value, concept: first.concept, entry: first.entry, status: 'unconfirmed', tieOut: null,
    flag: `revenue tags disagree: ${candidates.map((c) => `${c.concept} ${fmtM(c.value)}`).join(', ')}`,
    label: `SEC EDGAR companyfacts (${first.concept}), not confirmed against the income statement` };
}

// The latest period the filer tags. The app's "latest revenue".
function resolveLatestRevenue(ns, opts = {}) {
  const ends = fullYearEnds(ns, conceptList(!!opts.useIfrs, opts.subLines));
  return ends.length ? resolveRevenueAt(ns, ends[ends.length - 1], opts) : null;
}

// { 'YYYY-MM-DD': resolution } for every full year the filer tags, for the multi-year P&L.
function revenueSeries(ns, opts = {}) {
  const out = {};
  for (const end of fullYearEnds(ns, conceptList(!!opts.useIfrs, opts.subLines))) out[end] = resolveRevenueAt(ns, end, opts);
  return out;
}

// Which namespace is current. A pure filer reads its own. A filer with both reads us-gaap, unless us-gaap has stopped
// and ifrs-full has a USD revenue for the latest annual filing period.
function chooseNamespace(facts, floorEnd = null) {
  const gaap = facts?.facts?.['us-gaap'] || {};
  const ifrs = facts?.facts?.['ifrs-full'] || {};
  const gaapCount = Object.keys(gaap).length, ifrsCount = Object.keys(ifrs).length;
  let useIfrs = ifrsCount > 0 && gaapCount === 0;
  if (ifrsCount > 0 && gaapCount > 0 && floorEnd) {
    const current = (ns, isIfrs) => {
      const latest = resolveLatestRevenue(ns, { useIfrs: isIfrs });
      return !!latest && !isOlderFiscalYear(latest.end, floorEnd);
    };
    useIfrs = !current(gaap, false) && current(ifrs, true);
  }
  return { useIfrs, ns: useIfrs ? ifrs : gaap, hasIfrs: ifrsCount > 0 };
}

// Currency and last year of the filer's ifrs-full revenue, when it files in something the app does not read here.
function ifrsCurrencyNote(facts) {
  const ifrs = facts?.facts?.['ifrs-full'] || {};
  const found = [];
  for (const concept of [...REVENUE_CONCEPTS.ifrs, ...REVENUE_SUB_LINES.ifrs]) {
    for (const [unit, entries] of Object.entries(ifrs[concept]?.units || {})) {
      if (unit === 'USD') continue;
      const annual = entries.filter((e) => e.form === '10-K' || e.form === '20-F');
      if (annual.length) found.push({ concept, unit, end: annual.reduce((m, e) => (e.end > m ? e.end : m), '') });
    }
  }
  if (!found.length) return null;
  const latest = found.reduce((a, f) => (f.end > a.end ? f : a), found[0]);
  return `ifrs-full ${latest.concept} is filed in ${latest.unit} through ${latest.end}; this path reads USD only`;
}

// The whole decision for a filer. `revenue` is the resolution, or null with `unavailableReason` when SEC filings give
// no current year. A US-GAAP filer that has simply never tagged revenue has neither: pre-revenue is not a stale year.
function resolveFilerRevenue(facts, floorEnd = null, opts = {}) {
  const { useIfrs, ns, hasIfrs } = chooseNamespace(facts, floorEnd);
  const latest = resolveLatestRevenue(ns, { useIfrs, subLines: opts.subLines });
  const unavailable = (reason, latestEnd) => ({ useIfrs, ns, revenue: null, floorEnd, latestTaggedEnd: latestEnd,
    unavailableReason: reason, unavailableDetail: hasIfrs ? ifrsCurrencyNote(facts) : null });
  if (latest && isOlderFiscalYear(latest.end, floorEnd)) {
    return unavailable(hasIfrs ? IFRS_NO_CURRENT_YEAR
      : `no current-year revenue in SEC filings: latest revenue tag ends ${latest.end}, latest annual filing period is ${floorEnd}`, latest.end);
  }
  // No candidate, but a current USD sub-line (Novartis): the year is filed, only not as a total, so "no current-year
  // data" would be untrue. The caller's usual "no revenue tagged" path applies.
  const subLineCurrent = () => {
    const sub = resolveLatestRevenue(ns, { useIfrs, subLines: true });
    return !!sub && !isOlderFiscalYear(sub.end, floorEnd);
  };
  if (!latest && hasIfrs && !subLineCurrent()) return unavailable(IFRS_NO_CURRENT_YEAR, null);
  return { useIfrs, ns, revenue: latest, floorEnd, latestTaggedEnd: latest ? latest.end : null, unavailableReason: null, unavailableDetail: null };
}

// Revenue concepts in the order the LTM should try them: the tie-out's winner first, otherwise the usual order.
function ltmRevenueConcepts(ns, useIfrs) {
  const names = REVENUE_CONCEPTS[useIfrs ? 'ifrs' : 'gaap'];
  const latest = resolveLatestRevenue(ns, { useIfrs });
  if (!latest || latest.status !== 'tie-out') return names;
  return [latest.concept, ...names.filter((n) => n !== latest.concept)];
}

module.exports = {
  REVENUE_CONCEPTS, REVENUE_SUB_LINES, IFRS_NO_CURRENT_YEAR,
  isOlderFiscalYear, resolveRevenueAt, resolveLatestRevenue, revenueSeries, chooseNamespace, resolveFilerRevenue, ltmRevenueConcepts,
};
