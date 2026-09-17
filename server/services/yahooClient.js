'use strict';
const { get } = require('../utils/httpGet');

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Shared 5-minute cache so the deal model (/api/price) and the Source Verification panel
// (/api/verified) reuse ONE Yahoo call per ticker instead of each hitting Yahoo separately —
// halving the request rate, which is what triggers Yahoo's HTTP 429 rate-limiting.
const cache = new Map();
const inflight = new Map(); // share a single in-flight request across concurrent callers
const TTL = 300_000;

// Fetch the chart meta. A 429 means Yahoo is rate-limiting this IP: SKIP it — log one line and return null
// WITHOUT retrying and without trying the sibling host. A second hit while rate-limited never returns data
// and only deepens the limit (every Yahoo host answered 429 on 2026-09-17). A 5xx still falls through to
// query2 once. Returns null on failure, never throws to the caller.
async function fetchYahooMeta(ticker) {
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  for (let i = 0; i < hosts.length; i++) {
    try {
      const data = await get(`https://${hosts[i]}/v8/finance/chart/${ticker}?interval=1d&range=1d`, YAHOO_HEADERS);
      const meta = data?.chart?.result?.[0]?.meta;
      if (meta) return meta;
      return null; // valid response, no meta → don't hammer the other host
    } catch (e) {
      if (/HTTP 429/.test(e.message)) {
        console.warn(`[${ticker}] yahoo price skipped: HTTP 429 (rate limited, not retried)`);
        return null;
      }
      if (i < hosts.length - 1 && /HTTP 5\d\d/.test(e.message)) { await sleep(250); continue; }
      return null;
    }
  }
  return null;
}

async function fetchFields(ticker) {
  const key = ticker.toUpperCase();
  const c = cache.get(key);
  if (c && Date.now() - c.ts < TTL) return c.fields;
  if (inflight.has(key)) return inflight.get(key); // concurrent caller → reuse the in-flight request

  const p = (async () => {
    const now = new Date().toISOString().substring(0, 10);
    const meta = await fetchYahooMeta(key);
    if (!meta) {
      // Cache an empty result only briefly (30s) so a transient 429 doesn't pin "missing" for 5 min.
      cache.set(key, { ts: Date.now() - (TTL - 30_000), fields: {} });
      return {};
    }
    const makeField = (value) => (value != null ? { value, asOf: now, period: null, source: 'yahoo' } : null);
    const fields = {
      price:      makeField(meta.regularMarketPrice),
      week52High: makeField(meta.fiftyTwoWeekHigh),
      week52Low:  makeField(meta.fiftyTwoWeekLow),
    };
    cache.set(key, { ts: Date.now(), fields });
    return fields;
  })();

  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

// Convenience for the price waterfall — returns just the live price (or null), via the shared cache.
async function fetchPrice(ticker) {
  const f = await fetchFields(ticker);
  return f.price?.value != null ? parseFloat(f.price.value.toFixed(2)) : null;
}

module.exports = { fetchFields, fetchPrice };
