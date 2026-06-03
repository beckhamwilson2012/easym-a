'use strict';

// tolerance is fractional unless noted. Choose by how exact the field SHOULD be.
module.exports = [
  // --- live market data: small drift OK (quotes pulled seconds apart) ---
  { key: 'price',            sources: ['fmp','yahoo'],         sot: 'fmp',   tol: 0.005, unit: '$/sh' },
  { key: 'marketCap',        sources: ['fmp'],                 sot: 'fmp',   tol: 0.01,  unit: '$',    single: true },
  { key: 'week52High',       sources: ['fmp','yahoo'],         sot: 'fmp',   tol: 0.005, unit: '$/sh' },
  { key: 'week52Low',        sources: ['fmp','yahoo'],         sot: 'fmp',   tol: 0.005, unit: '$/sh' },

  // --- share count: should match a filing closely ---
  { key: 'sharesOutstanding',sources: ['edgar','fmp'],         sot: 'edgar', tol: 0.01,  unit: 'sh',   period: true },

  // --- audited financials: same fiscal period must be (near) identical ---
  // A mismatch here is usually a FISCAL-YEAR or GAAP-vs-nonGAAP labeling bug.
  { key: 'revenue',          sources: ['edgar','fmp'],         sot: 'edgar', tol: 0.002, unit: '$',    period: true },
  { key: 'operatingIncome',  sources: ['edgar','fmp'],         sot: 'edgar', tol: 0.01,  unit: '$',    period: true },
  { key: 'netIncome',        sources: ['edgar','fmp'],         sot: 'edgar', tol: 0.01,  unit: '$',    period: true },
  { key: 'totalDebt',        sources: ['edgar','fmp'],         sot: 'edgar', tol: 0.02,  unit: '$',    period: true },
  { key: 'cash',             sources: ['edgar','fmp'],         sot: 'edgar', tol: 0.02,  unit: '$',    period: true },
  { key: 'freeCashFlow',     sources: ['edgar','fmp'],         sot: 'edgar', tol: 0.02,  unit: '$',    period: true },

  // --- consensus: single-source acceptable (only FMP has it cleanly) ---
  { key: 'analystTargetMean',sources: ['fmp'],                 sot: 'fmp',   tol: 0,     unit: '$/sh', single: true },
  { key: 'analystTargetHigh',sources: ['fmp'],                 sot: 'fmp',   tol: 0,     unit: '$/sh', single: true },
  { key: 'analystTargetLow', sources: ['fmp'],                 sot: 'fmp',   tol: 0,     unit: '$/sh', single: true },
];
