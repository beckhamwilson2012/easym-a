'use strict';
const { get } = require('../utils/httpGet');

// StockAnalysis.com's public overview API is keyless and returns the consensus 12-month price
// target — used as an INDEPENDENT second source to cross-check Nasdaq's analyst mean (different
// aggregators poll different broker panels, so this catches a parse error, not minor panel drift).
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

const cache = new Map();
const inflight = new Map();
const TTL = 300_000; // 5 min

async function fetchAnalyst(ticker) {
  const key = ticker.toUpperCase();
  const c = cache.get(key);
  if (c && Date.now() - c.ts < TTL) return c.fields;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    let fields = {};
    try {
      const data = await get(`https://stockanalysis.com/api/symbol/s/${key}/overview`, HEADERS);
      const d = data?.data;
      if (d) {
        const now = new Date().toISOString().substring(0, 10);
        // analystTarget.target is like "$560.95"; analystIntro states "According to N analysts".
        const meanRaw = d.analystTarget ? parseFloat(String(d.analystTarget.target).replace(/[$,]/g, '')) : NaN;
        const mk = (v) => (v != null && !isNaN(parseFloat(v)) ? { value: parseFloat(v), asOf: now, period: null, source: 'stockanalysis' } : null);
        fields = { analystTargetMean: mk(meanRaw) };
      }
    } catch { /* → {} */ }
    cache.set(key, { ts: Object.keys(fields).length ? Date.now() : Date.now() - (TTL - 30_000), fields });
    return fields;
  })();

  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

module.exports = { fetchAnalyst };
