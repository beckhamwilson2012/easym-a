'use strict';
const { get } = require('../utils/httpGet');
const { resolveFmpRates } = require('./fxRates'); // FX Stage 1 — convert FMP financials to USD at basis

// FMP_KEY comes from the environment (set FMP_KEY in your shell / .env) — never hardcode the secret.
const FMP_KEY = process.env.FMP_KEY || '';
const BASE    = 'https://financialmodelingprep.com';

function inM(val) { return val != null ? Math.round(val / 1e6) : null; }

function makeField(value, asOf, period = null) {
  if (value == null || (typeof value === 'number' && isNaN(value))) return null;
  return { value, asOf, period, source: 'fmp' };
}

function toDate(dateStr) {
  return dateStr ? dateStr.substring(0, 10) : null;
}

function fmpPeriod(rec) {
  // /stable statements renamed `calendarYear` → `fiscalYear`. Fall back so a label-based match still
  // resolves, AND carry the period-END date (`end`) — the unambiguous match key, since EDGAR labels a
  // Jan-ending FY as 2025 while FMP labels the same period 2026 (off-by-one). The period guard prefers
  // `end`; without it FMP would be silently excluded from every comparison and stay EDGAR-only "single".
  return rec ? { calendarYear: rec.calendarYear ?? rec.fiscalYear, period: rec.period, end: toDate(rec.date) } : null;
}

async function fetchFields(ticker) {
  const now = new Date().toISOString().substring(0, 10);

  // Migrated v3/v4 → /stable (the v3/v4 endpoints 403 "Legacy Endpoint"). /stable uses ?symbol= and
  // renamed calendarYear→fiscalYear (handled in fmpPeriod); all value field names are unchanged. The
  // price-target-consensus call was REMOVED here — fetchAnalyst() already supplies the analyst targets
  // to verifiedLookup (merged over fetchFields), so keeping it here would be a redundant dead call.
  const [quoteRes, incomeRes, balanceRes, cashRes] = await Promise.allSettled([
    get(`${STABLE}/quote?symbol=${ticker}&apikey=${FMP_KEY}`),
    get(`${STABLE}/income-statement?symbol=${ticker}&period=annual&limit=1&apikey=${FMP_KEY}`),
    get(`${STABLE}/balance-sheet-statement?symbol=${ticker}&period=annual&limit=1&apikey=${FMP_KEY}`),
    get(`${STABLE}/cash-flow-statement?symbol=${ticker}&period=annual&limit=1&apikey=${FMP_KEY}`),
  ]);

  const quote    = quoteRes.status    === 'fulfilled' && Array.isArray(quoteRes.value)    ? quoteRes.value[0]    : null;
  const income   = incomeRes.status   === 'fulfilled' && Array.isArray(incomeRes.value)   ? incomeRes.value[0]   : null;
  const balance  = balanceRes.status  === 'fulfilled' && Array.isArray(balanceRes.value)  ? balanceRes.value[0]  : null;
  const cashFlow = cashRes.status     === 'fulfilled' && Array.isArray(cashRes.value)     ? cashRes.value[0]     : null;

  // FX Stage 1 — convert as-reported figures to USD at their basis. The /stable/quote price here is the
  // US-listed quote → already USD (priceCcy='USD', priceRate=1); only the FILER's fundamentals may be
  // non-USD (income.reportedCurrency / balance.reportedCurrency). USD filer → rates 1, strict no-op.
  const fx  = await resolveFmpRates(income, balance, 'USD');
  const cvA = (m) => (m == null ? null : Math.round(m * fx.avgRate));   // P&L flows → FY period-average
  const cvS = (m) => (m == null ? null : Math.round(m * fx.spotRate));  // balance sheet → spot
  const epsRaw = income ? (income.epsdiluted ?? income.epsDiluted ?? income.eps) : null;
  // per-share → avg. Gate on converted so a USD filer keeps the RAW eps byte-for-byte (no toFixed rounding).
  const epsUsd = epsRaw == null ? null : (fx.converted ? parseFloat((epsRaw * fx.avgRate).toFixed(4)) : epsRaw);
  if (fx.converted) console.log(`[verified ${ticker}] FX — reported ${fx.reportedCurrency}, converted=${fx.converted}, avgRate=${fx.avgRate}, spotRate=${fx.spotRate}, window=${JSON.stringify(fx.avgWindow)}`);

  return {
    // Live market data — US quote is USD, NOT converted
    price:      quote ? makeField(parseFloat((quote.price || 0).toFixed(4)), now) : null,
    marketCap:  quote ? makeField(inM(quote.marketCap), now) : null,
    week52High: quote ? makeField(quote.yearHigh, now) : null,
    week52Low:  quote ? makeField(quote.yearLow,  now) : null,

    // Income statement fundamentals — period-average (cvA)
    revenue:         income ? makeField(cvA(inM(income.revenue)),         toDate(income.date), fmpPeriod(income)) : null,
    grossProfit:     income ? makeField(cvA(inM(income.grossProfit)),     toDate(income.date), fmpPeriod(income)) : null,
    operatingIncome: income ? makeField(cvA(inM(income.operatingIncome)), toDate(income.date), fmpPeriod(income)) : null,
    netIncome:       income ? makeField(cvA(inM(income.netIncome)),       toDate(income.date), fmpPeriod(income)) : null,
    // Share COUNT — NOT converted (converting a unit count by an FX rate would be nonsense)
    sharesOutstanding: income ? makeField(inM(income.weightedAverageShsOut), toDate(income.date), fmpPeriod(income)) : null,
    // Diluted EPS: /stable income = as-reported GAAP (NOT adjusted). `epsdiluted` is sparse on /stable, so
    // fall back to `eps` (which is the diluted GAAP figure for TEAM et al.). Per-share → NOT inM; ×avgRate.
    epsDiluted:      income ? makeField(epsUsd, toDate(income.date), fmpPeriod(income)) : null,

    // Balance sheet fundamentals — spot (cvS)
    totalDebt: balance ? makeField(cvS(inM(balance.totalDebt)), toDate(balance.date), fmpPeriod(balance)) : null,
    cash:      balance ? makeField(
      cvS(inM(balance.cashAndCashEquivalents ?? balance.cashAndShortTermInvestments)),
      toDate(balance.date), fmpPeriod(balance)
    ) : null,
    totalAssets:             balance ? makeField(cvS(inM(balance.totalAssets)),             toDate(balance.date), fmpPeriod(balance)) : null,
    totalStockholdersEquity: balance ? makeField(cvS(inM(balance.totalStockholdersEquity)), toDate(balance.date), fmpPeriod(balance)) : null,

    // Cash flow — period-average (cvA)
    freeCashFlow: cashFlow ? makeField(cvA(inM(cashFlow.freeCashFlow)), toDate(cashFlow.date), fmpPeriod(cashFlow)) : null,

    // FX provenance (Stage 1) — for downstream labeling/suppression; ignored by the field-registry merge.
    _fx: { reportedCurrency: fx.reportedCurrency, spotRate: fx.spotRate, avgRate: fx.avgRate, avgWindow: fx.avgWindow, converted: fx.converted },

    // (Analyst price targets are supplied by fetchAnalyst() — see verifiedLookup merge — not here.)
  };
}

// ── FMP /stable analyst endpoints (Premium) ────────────────────────────────────────────────────────
const STABLE = `${BASE}/stable`;
function stable(path) { return `${STABLE}/${path}${path.includes('?') ? '&' : '?'}apikey=${FMP_KEY}`; }

// Analyst consensus from FMP /stable — price-target-consensus + grades-consensus. Returns a field-shaped
// map (so verifiedLookup can reconcile it as a THIRD price-target source alongside Nasdaq + StockAnalysis)
// PLUS the raw blocks for /api/estimates. Single source; each sub-fetch degrades to null on any failure,
// so a thin/absent ticker simply doesn't contribute — never throws, never fabricates.
async function fetchAnalyst(ticker) {
  const now = new Date().toISOString().substring(0, 10);
  const [ptRes, grRes] = await Promise.allSettled([
    get(stable(`price-target-consensus?symbol=${ticker}`)),
    get(stable(`grades-consensus?symbol=${ticker}`)),
  ]);
  const pt = ptRes.status === 'fulfilled' && Array.isArray(ptRes.value) ? ptRes.value[0] : null;
  const gr = grRes.status === 'fulfilled' && Array.isArray(grRes.value) ? grRes.value[0] : null;

  // Collapse FMP's 5-tier grades to the slide's 3-tier Buy/Hold/Sell (strongBuy+buy / hold / sell+strongSell).
  const buy  = gr ? (parseInt(gr.strongBuy, 10) || 0) + (parseInt(gr.buy, 10) || 0) : null;
  const hold = gr ? (parseInt(gr.hold, 10) || 0) : null;
  const sell = gr ? (parseInt(gr.sell, 10) || 0) + (parseInt(gr.strongSell, 10) || 0) : null;
  const total = gr ? (buy || 0) + (hold || 0) + (sell || 0) : null;

  return {
    fields: {
      analystTargetMean: pt ? makeField(pt.targetConsensus, now) : null,
      analystTargetHigh: pt ? makeField(pt.targetHigh, now) : null,
      analystTargetLow:  pt ? makeField(pt.targetLow, now)  : null,
      analystRatingBuy:  buy  != null ? makeField(buy, now)  : null,
      analystRatingHold: hold != null ? makeField(hold, now) : null,
      analystRatingSell: sell != null ? makeField(sell, now) : null,
      analystCount:      total ? makeField(total, now) : null,
    },
    priceTarget: pt ? { consensus: pt.targetConsensus, high: pt.targetHigh, low: pt.targetLow, median: pt.targetMedian } : null,
    grades: gr ? { strongBuy: parseInt(gr.strongBuy, 10) || 0, buy: parseInt(gr.buy, 10) || 0, hold: parseInt(gr.hold, 10) || 0, sell: parseInt(gr.sell, 10) || 0, strongSell: parseInt(gr.strongSell, 10) || 0, consensus: gr.consensus || null } : null,
  };
}

// Forward ANNUAL estimates — period=annual is REQUIRED (the endpoint 400s without it). Returns the next
// 1–2 fiscal years (period-end in the future), nearest first: { fy, revenueAvg ($M), epsAvg, numAnalysts }.
// EDGAR can't provide this (consensus isn't a filing) — it's purely additive, FMP-sourced. Never throws.
async function fetchForwardEstimates(ticker) {
  let arr = [];
  try {
    const res = await get(stable(`analyst-estimates?symbol=${ticker}&period=annual&limit=10`)); // plan caps limit at 10
    if (Array.isArray(res)) arr = res;
  } catch { /* graceful: no forward estimates for this ticker */ }
  const today = new Date().toISOString().substring(0, 10);
  return arr
    .filter(r => r && typeof r.date === 'string' && r.date.substring(0, 10) > today) // future fiscal years only
    .sort((a, b) => a.date.localeCompare(b.date))                                    // nearest first
    .slice(0, 2)
    .map(r => ({
      fy: parseInt(r.date.substring(0, 4), 10),
      revenueAvg: r.revenueAvg != null ? Math.round(r.revenueAvg / 1e6) : null, // → $M (deck convention)
      epsAvg: r.epsAvg != null ? Number(r.epsAvg) : null,
      numAnalysts: parseInt(r.numAnalystsEps, 10) || parseInt(r.numAnalystsRevenue, 10) || null,
    }));
}

// Reported quarterly EARNINGS DATES (actual report dates, FMP). §G uses these to annotate a price move
// that coincides with a real earnings report — a factual coincidence in timing, NEVER an asserted cause.
// Past reports only (epsActual present, date ≤ today). EDGAR has no clean earnings-date calendar, so this
// is purely additive. Never throws — a thin/blocked ticker yields [] and §G falls back to magnitude-only.
async function fetchEarnings(ticker) {
  let arr = [];
  try {
    const res = await get(stable(`earnings?symbol=${ticker}&limit=24`));
    if (Array.isArray(res)) arr = res;
  } catch { /* graceful: no earnings calendar for this ticker */ }
  const today = new Date().toISOString().substring(0, 10);
  return arr
    .filter(r => r && typeof r.date === 'string' && r.date.substring(0, 10) <= today && r.epsActual != null)
    .map(r => ({
      date: r.date.substring(0, 10),
      epsActual:    r.epsActual    != null ? Number(r.epsActual)    : null,
      epsEstimated: r.epsEstimated != null ? Number(r.epsEstimated) : null,
    }))
    .sort((a, b) => b.date.localeCompare(a.date)); // newest first
}

module.exports = { fetchFields, fetchAnalyst, fetchForwardEstimates, fetchEarnings };
