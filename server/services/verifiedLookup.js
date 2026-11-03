'use strict';
const edgarClient   = require('./edgarClient');
const fmpClient     = require('./fmpClient');
const yahooClient   = require('./yahooClient');
const finnhubClient = require('./finnhubClient');
const cnbcClient    = require('./cnbcClient');
const nasdaqClient  = require('./nasdaqClient');
const stockAnalysisClient = require('./stockAnalysisClient');
const { reconcile } = require('../data/reconcile');
const FIELDS = require('../data/fieldRegistry');

// In-memory cache keyed by ticker. TTL is short (60s) because live price data
// is included. Fundamentals are stable but we re-fetch the whole bundle together.
const cache = new Map();
const CACHE_TTL = 60_000;

function getCached(ticker) {
  const c = cache.get(ticker);
  return c && Date.now() - c.ts < CACHE_TTL ? c.result : null;
}
function setCached(ticker, result) {
  cache.set(ticker, { ts: Date.now(), result });
}

// Period-match guard for fundamentals.
// EDGAR period: { fy: 2025, fp: 'FY', form: '10-K' }
// FMP period:   { calendarYear: '2025', period: 'FY' }
function periodsMatch(edgarPeriod, fmpPeriod) {
  if (!edgarPeriod || !fmpPeriod) return false;
  // Prefer the unambiguous period-END date. EDGAR labels a Jan-ending fiscal year as fy 2025 while FMP
  // /stable labels the SAME period 2026 (off-by-one); matching fy-labels would falsely exclude FMP and
  // strand the financials at EDGAR-only "single". Both sources now carry the end date as `period.end`.
  if (edgarPeriod.end && fmpPeriod.end) return edgarPeriod.end === fmpPeriod.end;
  return edgarPeriod.fy === parseInt(fmpPeriod.calendarYear, 10); // label fallback (one side lacks a date)
}

// Should a non-EDGAR source's value be EXCLUDED before comparison because its fiscal period differs
// from EDGAR's? This is the guard that prevents the FY25-vs-FY26 (or Q-vs-FY) class of error —
// comparing a value from a different period would be a false agreement or a false disagreement.
// Only applies to period-sensitive fields, non-EDGAR sources, when both periods are known.
function periodGuardExcludes(fieldSpec, srcName, edgarPeriod, srcPeriod) {
  if (!fieldSpec.period || srcName === 'edgar' || !edgarPeriod || !srcPeriod) return false;
  return !periodsMatch(edgarPeriod, srcPeriod);
}

// Sanity band for analyst price targets: a target must be positive and within [0.2×, 5×] the current
// price. Anything outside that is almost certainly a parse error (a 10× misread, grabbing the wrong
// field, a stale-by-months figure) — reject it rather than display a fabricated-looking number.
// When no current price is available we can't band-check, so accept any positive value.
function sanePriceTarget(value, price) {
  const v = parseFloat(value);
  if (!(v > 0)) return false;
  const p = parseFloat(price);
  if (!(p > 0)) return true;
  return v >= p * 0.2 && v <= p * 5;
}

async function lookup(ticker, cik) {
  const cached = getCached(ticker);
  if (cached) return cached;

  const [edgarRes, fmpRes, yahooRes, finnhubRes, cnbcRes, nasdaqRes, nasdaqAnalystRes, stockAnalystRes, fmpAnalystRes] =
    await Promise.allSettled([
      cik ? edgarClient.fetchFields(cik) : Promise.resolve({}),
      fmpClient.fetchFields(ticker),
      yahooClient.fetchFields(ticker),
      finnhubClient.fetchFields(ticker),
      cnbcClient.fetchFields(ticker),
      nasdaqClient.fetchFields(ticker),
      nasdaqClient.fetchAnalyst(ticker),
      stockAnalysisClient.fetchAnalyst(ticker),
      fmpClient.fetchAnalyst(ticker), // FMP /stable price targets — THIRD analyst cross-check source
    ]);

  const edgar   = edgarRes.status   === 'fulfilled' ? edgarRes.value   : {};
  // FMP contributes BOTH financials (fetchFields, EDGAR-miss fallback) and analyst price targets
  // (fetchAnalyst, /stable). Merge so the `fmp` source carries its /stable analyst fields too; the
  // analyst values override any (now-deprecated) v4 ones from fetchFields. Financials are untouched.
  const fmpFields  = fmpRes.status       === 'fulfilled' ? fmpRes.value : {};
  const fmpAnalyst = fmpAnalystRes.status === 'fulfilled' && fmpAnalystRes.value ? (fmpAnalystRes.value.fields || {}) : {};
  const fmp     = { ...fmpFields, ...fmpAnalyst };
  const yahoo   = yahooRes.status   === 'fulfilled' ? yahooRes.value   : {};
  const finnhub = finnhubRes.status === 'fulfilled' ? finnhubRes.value : {};
  const cnbc    = cnbcRes.status    === 'fulfilled' ? cnbcRes.value    : {};
  // Nasdaq provides BOTH the price (fetchFields) and the analyst consensus (fetchAnalyst) — merge.
  const nasdaqPrice   = nasdaqRes.status        === 'fulfilled' ? nasdaqRes.value        : {};
  const nasdaqAnalyst = nasdaqAnalystRes.status === 'fulfilled' ? nasdaqAnalystRes.value : {};
  const nasdaq        = { ...nasdaqPrice, ...nasdaqAnalyst };
  const stockanalysis = stockAnalystRes.status  === 'fulfilled' ? stockAnalystRes.value  : {};
  // Source name → its field map. price: CNBC(SOT)+Yahoo+Nasdaq; analyst mean: Nasdaq(SOT)+StockAnalysis.
  const srcMaps = { edgar, fmp, yahoo, finnhub, cnbc, nasdaq, stockanalysis };

  const asOf = new Date().toISOString();
  const fields = {};

  for (const fieldSpec of FIELDS) {
    const values = {};

    for (const rawSrc of fieldSpec.sources) {
      const srcName = rawSrc.replace('?', ''); // strip optional marker
      const srcMap  = srcMaps[srcName] || {};
      const fd      = srcMap[fieldSpec.key];

      if (!fd) { values[srcName] = null; continue; }

      // Period-match guard: never compare financials from a different fiscal period.
      if (periodGuardExcludes(fieldSpec, srcName, edgar[fieldSpec.key]?.period, fd.period)) {
        values[srcName] = null; // period mismatch → exclude from comparison
        continue;
      }

      // Sanity-band guard for analyst price targets: reject an implausible value (likely a parse
      // error) so it is treated as not-found rather than displayed. `fields.price` is already
      // resolved here because the price field precedes the analyst fields in the registry.
      if (fieldSpec.priceBand && !sanePriceTarget(fd.value, fields.price?.value)) {
        values[srcName] = null;
        continue;
      }

      values[srcName] = fd.value;
    }

    const rec = reconcile(fieldSpec, values);

    // Build per-source metadata for the UI tooltip
    const sourceMeta = {};
    for (const rawSrc of fieldSpec.sources) {
      const srcName = rawSrc.replace('?', '');
      const srcMap  = srcMaps[srcName] || {};
      const fd      = srcMap[fieldSpec.key];
      if (fd) sourceMeta[srcName] = { value: fd.value, asOf: fd.asOf, period: fd.period,
        ...(fd.basis ? { basis: fd.basis, sourceLabel: fd.sourceLabel } : {}) };
    }

    fields[fieldSpec.key] = { ...rec, unit: fieldSpec.unit, sot: fieldSpec.sot, sourceMeta };
  }

  // FX Stage 1 — surface the FMP filer's currency provenance top-level (kept OUT of `fields` so it
  // doesn't collide with the field registry). Values above are already USD-converted at the fetch layer;
  // this only records HOW (reportedCurrency, spot/avg rates, FY window, converted flag) for later labeling.
  const result = { ticker, asOf, fields, fx: fmpFields._fx || null };
  setCached(ticker, result);
  return result;
}

module.exports = { lookup, periodsMatch, periodGuardExcludes, sanePriceTarget };
