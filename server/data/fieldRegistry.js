'use strict';

// tolerance is fractional unless noted. Choose by how exact the field SHOULD be.
module.exports = [
  // --- live market data: CNBC (keyless, reliable) is SOT; cross-checked vs Yahoo + Nasdaq (+ Finnhub
  // if a key is set). Agree within tol → verified; disagree → flagged (CNBC value still used); one
  // only → single. Tolerance is 0.8%, not 0.5%: CNBC and Yahoo are real-time and match to the cent,
  // but Nasdaq's public feed lags slightly, so a same-instant comparison drifts ~0.4–0.6% — well
  // under any genuine error (mislabel, stale-by-days, wrong ticker), which is what we need to catch.
  // CNBC's quote carries the trailing 52-week range (yrhiprice/yrloprice), so CNBC is SOT for 52wk
  // too — cross-checked vs Yahoo/Finnhub when those are reachable; CNBC alone resolves to single. ---
  { key: 'price',            sources: ['cnbc','yahoo','nasdaq','finnhub'], sot: 'cnbc', tol: 0.008, unit: '$/sh' },
  { key: 'week52High',       sources: ['cnbc','yahoo','finnhub'], sot: 'cnbc',   tol: 0.005, unit: '$/sh' },
  { key: 'week52Low',        sources: ['cnbc','yahoo','finnhub'], sot: 'cnbc',   tol: 0.005, unit: '$/sh' },
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

  // --- analyst consensus: NO single authoritative free source. Nasdaq (SOT — richest: mean/high/low
  // + buy/hold/sell) is cross-checked against StockAnalysis for the MEAN only. Tolerance is 5%, much
  // wider than price (0.8%): aggregators poll different broker panels on different days, so a few-%
  // mean difference is LEGITIMATE — the cross-check exists to catch a PARSE error (10x misread, wrong
  // field, stale-by-months), not panel drift. `priceBand` adds a sanity guard: a target outside
  // [0.2×, 5×] the current price is rejected as a likely parse error rather than displayed.
  // mean is the cross-checked field (Nasdaq vs StockAnalysis). high/low/count/ratings come from
  // Nasdaq only → they resolve to `single` (shown, but honestly marked unconfirmed — no `single:true`).
  { key: 'analystTargetMean', sources: ['nasdaq','stockanalysis'], sot: 'nasdaq', tol: 0.05, unit: '$/sh', priceBand: true },
  { key: 'analystTargetHigh', sources: ['nasdaq'],                 sot: 'nasdaq', tol: 0,    unit: '$/sh', priceBand: true },
  { key: 'analystTargetLow',  sources: ['nasdaq'],                 sot: 'nasdaq', tol: 0,    unit: '$/sh', priceBand: true },
  { key: 'analystCount',      sources: ['nasdaq'],                 sot: 'nasdaq', tol: 0,    unit: 'n' },
  { key: 'analystRatingBuy',  sources: ['nasdaq'],                 sot: 'nasdaq', tol: 0,    unit: 'n' },
  { key: 'analystRatingHold', sources: ['nasdaq'],                 sot: 'nasdaq', tol: 0,    unit: 'n' },
  { key: 'analystRatingSell', sources: ['nasdaq'],                 sot: 'nasdaq', tol: 0,    unit: 'n' },
];
