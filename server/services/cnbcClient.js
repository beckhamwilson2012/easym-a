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

const num = (v) => {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
};

// CNBC's own timestamp for the last price, e.g. "2026-11-03T16:00:00.000-0500". Null if missing or unreadable.
const quoteTimeIso = (v) => {
  const t = v ? new Date(v) : null;
  return t && !isNaN(t.getTime()) ? t.toISOString() : null;
};

// Fetch the full quote ONCE and cache { price, week52High, week52Low }. CNBC's FormattedQuote carries
// the regular-session last AND the trailing 52-week range (yrhiprice / yrloprice).
async function fetchQuote(ticker) {
  const key = ticker.toUpperCase();
  const c = cache.get(key);
  if (c && Date.now() - c.ts < TTL) return c.quote;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    let quote = { price: null, week52High: null, week52Low: null, asOf: null };
    try {
      // exthrs=0 → regular-session last (matches Yahoo's regularMarketPrice exactly, so the
      // cross-check is clean; exthrs=1 would return an extended-hours price that drifts from Yahoo).
      const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${key}` +
        `&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=0&output=json`;
      const data = await get(url, HEADERS);
      const q = data?.FormattedQuoteResult?.FormattedQuote?.[0];
      if (q) {
        const last = num(q.last);
        quote = {
          price:      last != null ? parseFloat(last.toFixed(2)) : null,
          week52High: num(q.yrhiprice),
          week52Low:  num(q.yrloprice),
          asOf:       quoteTimeIso(q.last_time),
        };
      }
    } catch { /* fall through → nulls */ }
    // Cache successes for the full TTL; cache a miss only briefly (30s) so it self-heals.
    const ok = quote.price != null;
    cache.set(key, { ts: ok ? Date.now() : Date.now() - (TTL - 30_000), quote });
    return quote;
  })();

  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

async function fetchPrice(ticker) {
  return (await fetchQuote(ticker)).price;
}

// When the cached price was struck. Reads the same cached quote, so no second request.
async function fetchPriceAsOf(ticker) {
  return (await fetchQuote(ticker)).asOf;
}

// Field-shaped result so CNBC can be a first-class source in the verified-data reconcile
// (server/data/reconcile.js). CNBC carries the live price AND the trailing 52-week high/low.
async function fetchFields(ticker) {
  const { price, week52High, week52Low } = await fetchQuote(ticker);
  const now = new Date().toISOString().substring(0, 10);
  const meta = (value) => value != null ? { value, asOf: now, period: null, source: 'cnbc' } : null;
  return {
    price:      meta(price),
    week52High: meta(week52High),
    week52Low:  meta(week52Low),
  };
}

module.exports = { fetchPrice, fetchQuote, fetchFields, fetchPriceAsOf };
