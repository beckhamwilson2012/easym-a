'use strict';

// tolerance is fractional unless noted. Choose by how exact the field SHOULD be.
module.exports = [
  // --- live market data: CNBC (keyless, reliable) is SOT; cross-checked vs Yahoo + Nasdaq (+ Finnhub
  // if a key is set). Agree within tol → verified; disagree → flagged (CNBC value still used); one
  // only → single. Tolerance is 0.8%, not 0.5%: CNBC and Yahoo are real-time and match to the cent,
  // but Nasdaq's public feed lags slightly, so a same-instant comparison drifts ~0.4–0.6% — well
  // under any genuine error (mislabel, stale-by-days, wrong ticker), which is what we need to catch.
  // CNBC's quote has no 52-week range, so 52wk relies on Yahoo (single). ---
  { key: 'price',            sources: ['cnbc','yahoo','nasdaq','finnhub'], sot: 'cnbc', tol: 0.008, unit: '$/sh' },
  { key: 'week52High',       sources: ['yahoo','finnhub'],        sot: 'yahoo',  tol: 0.005, unit: '$/sh' },
  { key: 'week52Low',        sources: ['yahoo','finnhub'],        sot: 'yahoo',  tol: 0.005, unit: '$/sh' },
  // marketCap: no free source with cross-check; stays single FMP entry (resolves missing until key upgraded)
  { key: 'marketCap',        sources: ['fmp'],                 sot: 'fmp',     tol: 0.01,  unit: '$',    single: true },

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

  // --- consensus: single-source (FMP only). Resolves to missing on free key — source-line composer
  // routes missing analyst targets to "per transaction assumptions", not a fake citation.
  { key: 'analystTargetMean',sources: ['fmp'],                 sot: 'fmp',   tol: 0,     unit: '$/sh', single: true },
  { key: 'analystTargetHigh',sources: ['fmp'],                 sot: 'fmp',   tol: 0,     unit: '$/sh', single: true },
  { key: 'analystTargetLow', sources: ['fmp'],                 sot: 'fmp',   tol: 0,     unit: '$/sh', single: true },
];
