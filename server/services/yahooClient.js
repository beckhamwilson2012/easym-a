'use strict';
const { get } = require('../utils/httpGet');

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

// Yahoo v8/chart requires no auth and returns live price + 52-week range.
// Treat as fragile: failure must never break the caller.
async function fetchFields(ticker) {
  const now = new Date().toISOString().substring(0, 10);

  const data = await get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
    YAHOO_HEADERS
  );

  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) return {};

  function makeField(value) {
    return value != null ? { value, asOf: now, period: null, source: 'yahoo' } : null;
  }

  return {
    price:      makeField(meta.regularMarketPrice),
    week52High: makeField(meta.fiftyTwoWeekHigh),
    week52Low:  makeField(meta.fiftyTwoWeekLow),
  };
}

module.exports = { fetchFields };
