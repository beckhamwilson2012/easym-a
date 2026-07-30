'use strict';

// SINGLE SOURCE OF TRUTH for the "financial company" SIC set — banks + broker-dealers. Consumed by BOTH
// the server (`/quote`'s companyType classifier, server.js) AND the client (`isFinancial`, deckTokens.js)
// so the two detectors can never drift apart again. CommonJS on purpose: the server `require`s it and the
// client `import`s it (webpack CJS↔ESM interop). Codes: 6020/6021/6022 commercial banks · 6199 finance
// services · 6211 security brokers/dealers. (Insurers 63/64xx, REITs 6798, asset managers 6282 are
// deliberately OUT — a separate bucket, not this classifier.)
const FINANCIAL_SIC = ['6020', '6021', '6022', '6199', '6211'];

module.exports = { FINANCIAL_SIC };
