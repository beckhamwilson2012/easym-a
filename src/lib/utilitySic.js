'use strict';

// SINGLE SOURCE OF TRUTH for the utility SIC set. Consumed by BOTH the server (/quote, /api/pnl, /api/verified)
// AND the client (`isUtility`, deckTokens.js), the same pattern as financialSic. CommonJS on purpose: the server
// `require`s it and the client `import`s it. Codes: 4911 electric · 4922/4923/4924 natural gas transmission and
// distribution · 4931/4932/4939 combination electric, gas and other · 4941 water. Gross profit is not meaningful
// for these filers: what they tag as cost is fuel and purchased power only (DUK FY25: 9,041 of 31,741 revenue),
// so revenue minus cost reads as a 71.5% margin. They render "n/m", never a number and never 0.
const UTILITY_SIC = ['4911', '4922', '4923', '4924', '4931', '4932', '4939', '4941'];
const UTILITY_GROSS_REASON = 'not meaningful for utilities';

module.exports = { UTILITY_SIC, UTILITY_GROSS_REASON };
