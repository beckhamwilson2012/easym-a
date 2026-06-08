'use strict';
const { get } = require('../utils/httpGet');

// CNBC's public quote service is keyless, returns clean JSON, and does NOT rate-limit like Yahoo —
// so it's the reliable primary live-price source. Needs a browser User-Agent.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

const cache = new Map();
const inflight = new Map();
const TTL = 300_000; // 5 min

async function fetchPrice(ticker) {
  const key = ticker.toUpperCase();
  const c = cache.get(key);
  if (c && Date.now() - c.ts < TTL) return c.price;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    let price = null;
    try {
      // exthrs=0 → regular-session last (matches Yahoo's regularMarketPrice exactly, so the
      // cross-check is clean; exthrs=1 would return an extended-hours price that drifts from Yahoo).
      const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${key}` +
        `&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=0&output=json`;
      const data = await get(url, HEADERS);
      const q = data?.FormattedQuoteResult?.FormattedQuote?.[0];
      const last = q ? parseFloat(String(q.last).replace(/,/g, '')) : NaN;
      if (last && !isNaN(last)) price = parseFloat(last.toFixed(2));
    } catch { /* fall through → null */ }
    // Cache successes for the full TTL; cache a miss only briefly (30s) so it self-heals.
    cache.set(key, { ts: price != null ? Date.now() : Date.now() - (TTL - 30_000), price });
    return price;
  })();

  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

// Field-shaped result so CNBC can be a first-class source in the verified-data reconcile
// (server/data/reconcile.js). CNBC's quote response carries the live price but no 52-week range.
async function fetchFields(ticker) {
  const price = await fetchPrice(ticker);
  const now = new Date().toISOString().substring(0, 10);
  return { price: price != null ? { value: price, asOf: now, period: null, source: 'cnbc' } : null };
}

module.exports = { fetchPrice, fetchFields };
