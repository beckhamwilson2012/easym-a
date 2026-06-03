'use strict';
const { get } = require('../utils/httpGet');

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
function latestAnnualEntry(concept, unit = 'USD') {
  const entries = concept?.units?.[unit];
  if (!entries?.length) return null;
  const annuals = entries.filter(e => e.form === '10-K' || e.form === '20-F');
  if (!annuals.length) return null;
  const latestEnd = annuals.reduce((mx, e) => e.end > mx ? e.end : mx, '');
  const forLatest = annuals.filter(e => e.end === latestEnd);
  const val = Math.max(...forLatest.map(e => e.val));
  const chosen = forLatest.find(e => e.val === val);
  return { val, end: latestEnd, fy: chosen.fy, fp: chosen.fp, form: chosen.form };
}

// Try a list of concept names in order; return the one with the most recent end date.
function pick(ns, names, unit = 'USD') {
  let best = null;
  for (const name of names) {
    const entry = latestAnnualEntry(ns[name], unit);
    if (!entry) continue;
    if (!best || entry.end > best.end) best = entry;
  }
  return best;
}

function makeField(entry, valueInM = true) {
  if (!entry) return null;
  return {
    value: valueInM ? inM(entry.val) : entry.val,
    asOf:  entry.end,
    period: { fy: entry.fy, fp: entry.fp, form: entry.form },
    source: 'edgar',
  };
}

async function fetchFields(cik) {
  let facts = getCached(cik);
  if (!facts) {
    facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    setCached(cik, facts);
  }

  const gaap = facts.facts?.['us-gaap']   || {};
  const ifrs = facts.facts?.['ifrs-full'] || {};
  const dei  = facts.facts?.['dei']       || {};
  const useIfrs = Object.keys(ifrs).length > 0 && Object.keys(gaap).length === 0;
  const ns = useIfrs ? ifrs : gaap;

  const revenueEntry = pick(ns, useIfrs
    ? ['Revenue', 'RevenueFromContractsWithCustomers', 'RevenueAndOtherIncome']
    : ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet',
       'RevenueFromContractWithCustomerIncludingAssessedTax', 'RevenuesNetOfInterestExpense']);

  const opIncomeEntry = pick(ns, useIfrs
    ? ['OperatingProfitLoss', 'ProfitLossFromOperatingActivities', 'ProfitLossBeforeTax']
    : ['OperatingIncomeLoss']);

  const netIncomeEntry = pick(ns, useIfrs
    ? ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss']
    : ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic']);

  const cashEntry = pick(ns, useIfrs
    ? ['CashAndCashEquivalents']
    : ['CashAndCashEquivalentsAtCarryingValue']);

  const debtEntry = pick(ns, useIfrs
    ? ['LongtermBorrowings', 'Borrowings', 'NoncurrentPortionOfLongtermBorrowings']
    : ['LongTermDebt', 'LongTermDebtNoncurrent']);

  // OCF and CapEx always from us-gaap (even for IFRS filers that also tag us-gaap)
  const ocfEntry   = pick(gaap, ['NetCashProvidedByUsedInOperatingActivities']);
  const capexEntry = pick(gaap, ['PaymentsToAcquirePropertyPlantAndEquipment']);

  // Shares: point-in-time balance sheet count preferred over weighted average
  const sharesEntry =
    latestAnnualEntry(gaap['CommonStockSharesOutstanding'],      'shares') ??
    latestAnnualEntry(dei['EntityCommonStockSharesOutstanding'], 'shares') ??
    latestAnnualEntry(gaap['WeightedAverageNumberOfSharesOutstandingBasic'], 'shares');

  // FCF = OCF + CapEx (CapEx is stored as a negative outflow in EDGAR)
  let freeCashFlow = null;
  if (ocfEntry && capexEntry) {
    freeCashFlow = {
      value: inM(ocfEntry.val) + inM(capexEntry.val),
      asOf:  ocfEntry.end,
      period: { fy: ocfEntry.fy, fp: ocfEntry.fp, form: ocfEntry.form },
      source: 'edgar',
    };
  }

  const sharesField = sharesEntry ? {
    value: inM(sharesEntry.val),
    asOf:  sharesEntry.end,
    period: { fy: sharesEntry.fy, fp: sharesEntry.fp, form: sharesEntry.form },
    source: 'edgar',
  } : null;

  return {
    revenue:           makeField(revenueEntry),
    operatingIncome:   makeField(opIncomeEntry),
    netIncome:         makeField(netIncomeEntry),
    cash:              makeField(cashEntry),
    totalDebt:         makeField(debtEntry),
    freeCashFlow,
    sharesOutstanding: sharesField,
  };
}

module.exports = { fetchFields };
