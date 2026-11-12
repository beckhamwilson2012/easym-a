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

module.exports = { marketCapM };
