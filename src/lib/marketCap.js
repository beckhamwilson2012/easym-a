'use strict';

// SINGLE SOURCE OF TRUTH for market capitalization = live share price × shares outstanding, in $M (shares in millions).
// The server (peer picker's target size band, server.js targetMarketCap) and the client (the Comparables equity-value
// cell, buildCompany; the deal's currentMarketCap, App.js) all call this, so the server's figure and the slide's figure
// are one product of the same two inputs. CommonJS on purpose: the server `require`s it, the client `import`s it (same
// pattern as financialSic.js).
//
// Null — never 0 — unless BOTH inputs are finite and positive: a missing price or share count is unknown, not zero.
function marketCapM(price, sharesM) {
  const p = Number(price), s = Number(sharesM);
  if (price == null || sharesM == null || !Number.isFinite(p) || !Number.isFinite(s) || !(p > 0) || !(s > 0)) return null;
  return p * s;
}

// The share-count check on that product. A wrong count or unit (WDAY once resolved 36M shares against about 265M; a count
// filed in thousands is off by 1,000×) makes price × shares disagree with the market's own figure, so the check compares the
// two directly: the app's market cap against an independent one (FMP's profile marketCap). More than 25% apart → flagged.
// It only ever flags. The app's figure stays on the slide, with both numbers in the legend. No independent figure → not checked.
const MARKET_CAP_TOLERANCE = 0.25;
function marketCapCheck(appCapM, independentCapM) {
  const pos = (v) => { const n = Number(v); return v != null && Number.isFinite(n) && n > 0 ? n : null; };
  const app = pos(appCapM), other = pos(independentCapM);
  if (app == null || other == null) return { checked: false, flagged: false, appCapM: app, independentCapM: other, diffPct: null };
  const diffPct = (app - other) / other;
  return { checked: true, flagged: Math.abs(diffPct) > MARKET_CAP_TOLERANCE, appCapM: app, independentCapM: other, diffPct };
}

module.exports = { marketCapM, marketCapCheck, MARKET_CAP_TOLERANCE };
