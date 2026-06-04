'use strict';
const { get } = require('../utils/httpGet');

// Key is read from env — consistent with server.js (process.env.FINNHUB_KEY || '').
// The client returns an empty object when no key is set rather than throwing.
const FINNHUB_KEY = process.env.FINNHUB_KEY || '';
const BASE = 'https://finnhub.io/api/v1';

function fh(path) { return `${BASE}${path}&token=${FINNHUB_KEY}`; }

async function fetchFields(ticker) {
  if (!FINNHUB_KEY) return {};

  const now = new Date().toISOString().substring(0, 10);

  const [quoteRes, metricRes] = await Promise.allSettled([
    get(fh(`/quote?symbol=${ticker}`)),
    get(fh(`/stock/metric?symbol=${ticker}&metric=all`)),
  ]);

  const quote  = quoteRes.status  === 'fulfilled' ? quoteRes.value  : null;
  const metric = metricRes.status === 'fulfilled' ? metricRes.value?.metric : null;

  function makeField(value) {
    if (value == null || (typeof value === 'number' && isNaN(value)) || value === 0) return null;
    return { value, asOf: now, period: null, source: 'finnhub' };
  }

  return {
    price:      makeField(quote?.c),
    week52High: makeField(metric?.['52WeekHigh']),
    week52Low:  makeField(metric?.['52WeekLow']),
  };
}

module.exports = { fetchFields };
