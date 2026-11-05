'use strict';
const { get } = require('../utils/httpGet');
const { resolveTotalDebt } = require('./debtConcepts'); // shared total-debt resolution (deal EV / comps / §16 identical)
const { annualIncomeLines, prepareIncomeFacts, latestAnnualFilingPeriod } = require('./incomeConcepts'); // shared cost of revenue / gross profit (/quote, /api/pnl, LTM, §16 identical)
const { resolveFilerRevenue, isOlderFiscalYear } = require('./revenueConcepts'); // shared revenue and fiscal-year floor (/quote, /api/pnl, LTM, §16 identical)
const { OPERATING_CASH_FLOW_CONCEPTS, resolveCapexAt, resolveOperatingCashFlowAt, computeFreeCashFlow } = require('./cashFlowConcepts'); // shared capex and FCF

const factsCache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours — fundamentals change quarterly

function getCached(cik) {
  const c = factsCache.get(cik);
  return c && Date.now() - c.ts < CACHE_TTL ? c.facts : null;
}
function setCached(cik, facts) { factsCache.set(cik, { ts: Date.now(), facts }); }

function inM(val) { return val != null ? Math.round(val / 1e6) : null; }

// Most recent annual entry (10-K or 20-F) from a concept's unit array.
// When multiple entries share the same end date, takes the largest (consolidated > segment).
// floorEnd: the latest annual filing period. A tag whose latest year is older returns null, never that old year.
function latestAnnualEntry(concept, unit = 'USD', floorEnd = null) {
  const entries = concept?.units?.[unit];
  if (!entries?.length) return null;
  const annuals = entries.filter(e => e.form === '10-K' || e.form === '20-F');
  if (!annuals.length) return null;
  const latestEnd = annuals.reduce((mx, e) => e.end > mx ? e.end : mx, '');
  if (isOlderFiscalYear(latestEnd, floorEnd)) return null;
  const forLatest = annuals.filter(e => e.end === latestEnd);
  const val = Math.max(...forLatest.map(e => e.val));
  const chosen = forLatest.find(e => e.val === val);
  return { val, end: latestEnd, fy: chosen.fy, fp: chosen.fp, form: chosen.form };
}

// Period-MATCHED pick (Pass A): the annual (10-K/20-F) entry for the first concept in `names` whose
// period-END equals `refEnd` (the revenue period) — mirrors server.js pickMatched's discipline (never
// returns a stale/discontinued tag from a DIFFERENT period, the KO-class trap). Duration concepts are
// constrained to a full-year span (350–380 days) so a same-END quarter can't be mistaken for the annual
// (critical for a NEGATIVE EPS, where a naive max-val would wrongly prefer the less-negative quarter).
// Instant balance-sheet concepts (Assets/Equity — no `start`) pass through. null → honest single/missing.
function pickAtEnd(ns, names, refEnd, unit = 'USD') {
  if (!refEnd) return null;
  for (const name of names) {
    const entries = ns[name]?.units?.[unit];
    if (!entries) continue;
    const matches = entries.filter(e => {
      if (e.form !== '10-K' && e.form !== '20-F') return false;
      if (e.end !== refEnd) return false;
      if (e.start) { const span = (Date.parse(e.end) - Date.parse(e.start)) / 86400000; return span >= 350 && span <= 380; }
      return true; // instant (balance-sheet) concept — no start
    });
    if (!matches.length) continue;
    const chosen = matches.reduce((a, e) => ((e.filed || '') > (a.filed || '') ? e : a), matches[0]); // latest restatement
    return { val: chosen.val, end: chosen.end, fy: chosen.fy, fp: chosen.fp, form: chosen.form };
  }
  return null;
}

function makeField(entry, valueInM = true) {
  if (!entry) return null;
  return {
    value: valueInM ? inM(entry.val) : entry.val,
    asOf:  entry.end,
    period: { fy: entry.fy, fp: entry.fp, form: entry.form, end: entry.end }, // end date = the cross-source match key
    source: 'edgar',
  };
}

async function fetchFields(cik) {
  let rawFacts = getCached(cik);
  if (!rawFacts) {
    rawFacts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    setCached(cik, rawFacts);
  }
  const facts = await prepareIncomeFacts(rawFacts, cik);

  const gaap = facts.facts?.['us-gaap']   || {};
  const dei  = facts.facts?.['dei']       || {};
  const floorEnd = await latestAnnualFilingPeriod(cik);
  const filer = resolveFilerRevenue(facts, floorEnd);
  const { useIfrs, ns } = filer;
  const revenueEntry = filer.revenue ? { ...filer.revenue.entry, val: filer.revenue.value, end: filer.revenue.end } : null;

  // Revenue's period-end is the ONE anchor for the whole §16 EDGAR page — every NON-anchor financial row
  // period-matches to it (pickAtEnd) so a discontinued tag's stale latest-end can't win (JPM debt @2013
  // $267.9B, cash @2018 $278.8B). Revenue itself comes from revenueConcepts — it DEFINES this anchor. sharesOutstanding
  // stays latestAnnualEntry (its count is often cover-dated post-FYE, so pickAtEnd would null legit counts).
  const refEnd = revenueEntry?.end;

  const opIncomeEntry = pickAtEnd(ns, useIfrs
    ? ['OperatingProfitLoss', 'ProfitLossFromOperatingActivities', 'ProfitLossBeforeTax']
    : ['OperatingIncomeLoss'], refEnd);

  const netIncomeEntry = pickAtEnd(ns, useIfrs
    ? ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss']
    : ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'], refEnd);

  const cashEntry = pickAtEnd(ns, useIfrs
    ? ['CashAndCashEquivalents']
    : ['CashAndCashEquivalentsAtCarryingValue'], refEnd);

  // GAAP list mirrors /quote's pickMatched (server.js:503): `LongTermDebtAndCapitalLeaseObligations` is a
  // FALLBACK after the primaries. Some filers (KO from FY2024) DROP `LongTermDebt`/`LongTermDebtNoncurrent`
  // and report long-term debt only under this lease-inclusive concept. pickAtEnd period-matches to Revenue's
  // end (parity fix): KO's lease concept IS tagged at the current FY end → kept ($42.12B); JPM's only tag is
  // a discontinued `LongTermDebt` @2013 → no match at 2025 → null → FMP cross-check fills current-primary
  // (was the 12-yr-stale $267.9B). Clean filers (CRM/ADBE/HD) unchanged — their debt is at Revenue's end.
  // Total debt via the SHARED resolver (server/services/debtConcepts) — identical resolution to /quote and
  // the comps peers, so §16 agrees with the deck. GAAP: sum noncurrent + current LT debt (incl current
  // maturities; commercial paper NOT included — see debtConcepts.js). IFRS: unchanged (borrowings concepts).
  const debtRes = useIfrs
    ? (() => { const e = pickAtEnd(ns, ['LongtermBorrowings', 'Borrowings', 'NoncurrentPortionOfLongtermBorrowings'], refEnd); return { value: e ? e.val : null, review: false }; })()
    : resolveTotalDebt(names => { const e = pickAtEnd(ns, names, refEnd); return e ? e.val : null; });
  const debtRepEntry = pickAtEnd(ns, useIfrs
    ? ['LongtermBorrowings', 'Borrowings', 'NoncurrentPortionOfLongtermBorrowings']
    : ['LongTermDebtNoncurrent', 'LongTermDebt', 'LongTermDebtAndCapitalLeaseObligations'], refEnd);

  // §16 expansion (Pass A) — four EDGAR-SOT vs FMP-cross rows, PERIOD-MATCHED to revenue's end so a
  // discontinued tag can't strand a stale value. EPS is per-share (USD/shares, NOT inM); GrossProfit /
  // Assets / Equity are $ → inM like Revenue. Foreign/degraded (no concept at refEnd) → null → single/FMP.
  const epsEntry    = pickAtEnd(ns, useIfrs ? ['DilutedEarningsLossPerShare', 'BasicEarningsLossPerShare'] : ['EarningsPerShareDiluted', 'EarningsPerShareBasic'], refEnd, 'USD/shares');
  const incomeLines = annualIncomeLines(ns, refEnd, revenueEntry ? revenueEntry.val : null, useIfrs);
  const grossEntry  = incomeLines.grossProfit.value != null
    ? { val: incomeLines.grossProfit.value, end: refEnd, fy: revenueEntry.fy, fp: revenueEntry.fp, form: revenueEntry.form }
    : null;
  const assetsEntry = pickAtEnd(ns, ['Assets'], refEnd);
  const equityEntry = pickAtEnd(ns, useIfrs ? ['Equity', 'EquityAttributableToOwnersOfParent'] : ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'], refEnd);

  // OCF and capex always from us-gaap (even for IFRS filers that also tag us-gaap), both at refEnd: cashFlowConcepts, the same
  // resolution and the same calculation as /quote. Either leg missing gives FCF "—" with the reason.
  const capex = resolveCapexAt(gaap, refEnd, { statement: facts.filingStatements?.cashFlow ?? null });
  const fcfResult = computeFreeCashFlow(resolveOperatingCashFlowAt(gaap, refEnd), capex);
  const ocfEntry = pickAtEnd(gaap, OPERATING_CASH_FLOW_CONCEPTS, refEnd);

  // Shares: point-in-time balance sheet count preferred over weighted average
  const sharesEntry =
    latestAnnualEntry(gaap['CommonStockSharesOutstanding'],      'shares', floorEnd) ??
    latestAnnualEntry(dei['EntityCommonStockSharesOutstanding'], 'shares', floorEnd) ??
    latestAnnualEntry(gaap['WeightedAverageNumberOfSharesOutstandingBasic'], 'shares', floorEnd);

  let freeCashFlow = null;
  if (fcfResult.value != null) {
    freeCashFlow = {
      value: inM(fcfResult.value),
      asOf:  ocfEntry.end,
      period: { fy: ocfEntry.fy, fp: ocfEntry.fp, form: ocfEntry.form, end: ocfEntry.end },
      source: 'edgar',
      basis: capex.status, sourceLabel: capex.label,
      ...(capex.flag ? { flag: capex.flag } : {}),
    };
  }

  const sharesField = sharesEntry ? {
    value: inM(sharesEntry.val),
    asOf:  sharesEntry.end,
    period: { fy: sharesEntry.fy, fp: sharesEntry.fp, form: sharesEntry.form, end: sharesEntry.end },
    source: 'edgar',
  } : null;

  return {
    revenue:           revenueEntry
      ? { ...makeField(revenueEntry), basis: filer.revenue.status, sourceLabel: filer.revenue.label, ...(filer.revenue.flag ? { flag: filer.revenue.flag } : {}) }
      : null,
    revenueUnavailableReason: filer.unavailableReason,
    latestAnnualFilingPeriod: floorEnd,
    operatingIncome:   makeField(opIncomeEntry),
    netIncome:         makeField(netIncomeEntry),
    cash:              makeField(cashEntry),
    totalDebt:         debtRes.value != null ? { value: inM(debtRes.value), asOf: refEnd, period: debtRepEntry ? { fy: debtRepEntry.fy, fp: debtRepEntry.fp, form: debtRepEntry.form, end: refEnd } : { end: refEnd }, source: 'edgar', ...(debtRes.review ? { review: true, reviewReason: debtRes.basis } : {}) } : null,
    grossProfit:             grossEntry ? { ...makeField(grossEntry), basis: incomeLines.grossProfit.basis, sourceLabel: incomeLines.grossProfit.label } : null,
    epsDiluted:              makeField(epsEntry, false),  // per-share — NOT inM
    totalAssets:             makeField(assetsEntry),
    totalStockholdersEquity: makeField(equityEntry),
    freeCashFlow,
    freeCashFlowReason: fcfResult.reason,
    sharesOutstanding: sharesField,
  };
}

module.exports = { fetchFields };
