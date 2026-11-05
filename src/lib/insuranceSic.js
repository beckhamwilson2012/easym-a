'use strict';

// SINGLE SOURCE OF TRUTH for the insurance SIC set. Consumed by BOTH the server (/quote, /api/pnl, /api/verified) AND the client
// (deckTokens.js), the same pattern as utilitySic. CommonJS on purpose: the server `require`s it and the client `import`s it.
// Codes: 6311 life · 6321 accident and health · 6324 hospital and medical service plans · 6331 fire, marine and casualty ·
// 6351 surety · 6361 title · 6399 insurance carriers, not elsewhere classified · 6411 agents, brokers and service.
// Gross profit is not meaningful for these filers: an insurer's main cost is claims, which sit outside any cost-of-revenue tag
// (UNH FY25: products cost 50,655 of 447,567 revenue reads as an 88.7% margin, with 313,995 of claims left out).
// They render "n/m", never a number and never 0.
const { UTILITY_SIC, UTILITY_GROSS_REASON } = require('./utilitySic');

const INSURANCE_SIC = ['6311', '6321', '6324', '6331', '6351', '6361', '6399', '6411'];
const INSURANCE_GROSS_REASON = 'not meaningful for insurers';

// Why gross profit is not meaningful for this SIC, or null when it is meaningful.
function grossNotMeaningfulReason(sic) {
  if (UTILITY_SIC.includes(sic)) return UTILITY_GROSS_REASON;
  if (INSURANCE_SIC.includes(sic)) return INSURANCE_GROSS_REASON;
  return null;
}

module.exports = { INSURANCE_SIC, INSURANCE_GROSS_REASON, grossNotMeaningfulReason };
