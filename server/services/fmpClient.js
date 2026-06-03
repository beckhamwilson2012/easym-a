'use strict';
const { get } = require('../utils/httpGet');

// FMP_KEY is intentionally hardcoded here consistent with server.js.
// Move to process.env.FMP_KEY before making this repo public.
const FMP_KEY = '6I3ipjC9tcfV6dpfR6CcXqsDcZCtMwyA';
const BASE    = 'https://financialmodelingprep.com';

function inM(val) { return val != null ? Math.round(val / 1e6) : null; }
function fmp(path) { return `${BASE}${path}&apikey=${FMP_KEY}`; }

function makeField(value, asOf, period = null) {
  if (value == null || (typeof value === 'number' && isNaN(value))) return null;
  return { value, asOf, period, source: 'fmp' };
}

function toDate(dateStr) {
  return dateStr ? dateStr.substring(0, 10) : null;
}

function fmpPeriod(rec) {
  return rec ? { calendarYear: rec.calendarYear, period: rec.period } : null;
}

async function fetchFields(ticker) {
  const now = new Date().toISOString().substring(0, 10);

  const [quoteRes, incomeRes, balanceRes, cashRes, targetRes] = await Promise.allSettled([
    get(`${BASE}/api/v3/quote/${ticker}?apikey=${FMP_KEY}`),
    get(fmp(`/api/v4/income-statement/${ticker}?period=annual&limit=3`)),
    get(fmp(`/api/v3/balance-sheet-statement/${ticker}?period=annual&limit=3`)),
    get(fmp(`/api/v3/cash-flow-statement/${ticker}?period=annual&limit=3`)),
    get(`${BASE}/api/v4/price-target-consensus?symbol=${ticker}&apikey=${FMP_KEY}`),
  ]);

  const quote    = quoteRes.status    === 'fulfilled' && Array.isArray(quoteRes.value)    ? quoteRes.value[0]    : null;
  const income   = incomeRes.status   === 'fulfilled' && Array.isArray(incomeRes.value)   ? incomeRes.value[0]   : null;
  const balance  = balanceRes.status  === 'fulfilled' && Array.isArray(balanceRes.value)  ? balanceRes.value[0]  : null;
  const cashFlow = cashRes.status     === 'fulfilled' && Array.isArray(cashRes.value)     ? cashRes.value[0]     : null;
  const target   = targetRes.status   === 'fulfilled' && Array.isArray(targetRes.value)   ? targetRes.value[0]   : null;

  return {
    // Live market data
    price:      quote ? makeField(parseFloat((quote.price || 0).toFixed(4)), now) : null,
    marketCap:  quote ? makeField(inM(quote.marketCap), now) : null,
    week52High: quote ? makeField(quote.yearHigh, now) : null,
    week52Low:  quote ? makeField(quote.yearLow,  now) : null,

    // Income statement fundamentals
    revenue:         income ? makeField(inM(income.revenue),         toDate(income.date), fmpPeriod(income)) : null,
    operatingIncome: income ? makeField(inM(income.operatingIncome), toDate(income.date), fmpPeriod(income)) : null,
    netIncome:       income ? makeField(inM(income.netIncome),       toDate(income.date), fmpPeriod(income)) : null,
    sharesOutstanding: income ? makeField(inM(income.weightedAverageShsOut), toDate(income.date), fmpPeriod(income)) : null,

    // Balance sheet fundamentals
    totalDebt: balance ? makeField(inM(balance.totalDebt), toDate(balance.date), fmpPeriod(balance)) : null,
    cash:      balance ? makeField(
      inM(balance.cashAndCashEquivalents ?? balance.cashAndShortTermInvestments),
      toDate(balance.date), fmpPeriod(balance)
    ) : null,

    // Cash flow
    freeCashFlow: cashFlow ? makeField(inM(cashFlow.freeCashFlow), toDate(cashFlow.date), fmpPeriod(cashFlow)) : null,

    // Analyst consensus (single-source; always most recent)
    analystTargetMean: target ? makeField(target.targetConsensus, now) : null,
    analystTargetHigh: target ? makeField(target.targetHigh,      now) : null,
    analystTargetLow:  target ? makeField(target.targetLow,       now) : null,
  };
}

module.exports = { fetchFields };
