'use strict';
const edgarClient   = require('./edgarClient');
const fmpClient     = require('./fmpClient');
const yahooClient   = require('./yahooClient');
const finnhubClient = require('./finnhubClient');
const cnbcClient    = require('./cnbcClient');
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
  return edgarPeriod.fy === parseInt(fmpPeriod.calendarYear, 10);
}

async function lookup(ticker, cik) {
  const cached = getCached(ticker);
  if (cached) return cached;

  const [edgarRes, fmpRes, yahooRes, finnhubRes] = await Promise.allSettled([
    cik ? edgarClient.fetchFields(cik) : Promise.resolve({}),
    fmpClient.fetchFields(ticker),
    yahooClient.fetchFields(ticker),
    finnhubClient.fetchFields(ticker),
  ]);

  const edgar   = edgarRes.status   === 'fulfilled' ? edgarRes.value   : {};
  const fmp     = fmpRes.status     === 'fulfilled' ? fmpRes.value     : {};
  const yahoo   = yahooRes.status   === 'fulfilled' ? yahooRes.value   : {};
  const finnhub = finnhubRes.status === 'fulfilled' ? finnhubRes.value : {};

  const asOf = new Date().toISOString();
  const fields = {};

  for (const fieldSpec of FIELDS) {
    const values = {};

    for (const rawSrc of fieldSpec.sources) {
      const srcName = rawSrc.replace('?', ''); // strip optional marker
      const srcMap  = srcName === 'edgar' ? edgar : srcName === 'fmp' ? fmp : srcName === 'finnhub' ? finnhub : yahoo;
      const fd      = srcMap[fieldSpec.key];

      if (!fd) { values[srcName] = null; continue; }

      // Period-match guard: only compare financials from the same fiscal year
      if (fieldSpec.period && srcName !== 'edgar' && edgar[fieldSpec.key]?.period && fd.period) {
        if (!periodsMatch(edgar[fieldSpec.key].period, fd.period)) {
          values[srcName] = null; // period mismatch → exclude from comparison
          continue;
        }
      }

      values[srcName] = fd.value;
    }

    const rec = reconcile(fieldSpec, values);

    // Build per-source metadata for the UI tooltip
    const sourceMeta = {};
    for (const rawSrc of fieldSpec.sources) {
      const srcName = rawSrc.replace('?', '');
      const srcMap  = srcName === 'edgar' ? edgar : srcName === 'fmp' ? fmp : srcName === 'finnhub' ? finnhub : yahoo;
      const fd      = srcMap[fieldSpec.key];
      if (fd) sourceMeta[srcName] = { value: fd.value, asOf: fd.asOf, period: fd.period };
    }

    fields[fieldSpec.key] = { ...rec, unit: fieldSpec.unit, sot: fieldSpec.sot, sourceMeta };
  }

  // Price backfill: Finnhub needs a key and Yahoo rate-limits (429), so the price field is often
  // missing. Fall back to keyless CNBC so the Source Verification panel still shows a live price.
  if (fields.price && fields.price.status === 'missing') {
    const cnbcPrice = await cnbcClient.fetchPrice(ticker);
    if (cnbcPrice != null) {
      fields.price = {
        ...fields.price, status: 'single', value: cnbcPrice, chosenSource: 'cnbc',
        sources: { ...(fields.price.sources || {}), cnbc: cnbcPrice },
        sourceMeta: { ...(fields.price.sourceMeta || {}), cnbc: { value: cnbcPrice, asOf, period: null } },
      };
    }
  }

  const result = { ticker, asOf, fields };
  setCached(ticker, result);
  return result;
}

module.exports = { lookup };
