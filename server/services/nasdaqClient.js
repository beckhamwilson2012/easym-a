'use strict';
const { get } = require('../utils/httpGet');

// Nasdaq's public quote API is keyless and reliable (does not rate-limit like Yahoo), so it serves
// as a second independent price source for the cross-check. Requires browser-ish headers.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Origin': 'https://www.nasdaq.com',
  'Referer': 'https://www.nasdaq.com/',
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
      const data = await get(`https://api.nasdaq.com/api/quote/${key}/info?assetclass=stocks`, HEADERS);
      const raw = data?.data?.primaryData?.lastSalePrice; // e.g. "$410.13"
      const n = raw != null ? parseFloat(String(raw).replace(/[$,]/g, '')) : NaN;
      if (n && !isNaN(n)) price = parseFloat(n.toFixed(2));
    } catch { /* → null */ }
    cache.set(key, { ts: price != null ? Date.now() : Date.now() - (TTL - 30_000), price });
    return price;
  })();

  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

async function fetchFields(ticker) {
  const price = await fetchPrice(ticker);
  const now = new Date().toISOString().substring(0, 10);
  return { price: price != null ? { value: price, asOf: now, period: null, source: 'nasdaq' } : null };
}

module.exports = { fetchPrice, fetchFields };
