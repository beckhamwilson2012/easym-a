'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// fmpEngine.js — EasyM&A verified-data engine (Financial Modeling Prep)
//
// One FMP-backed engine that returns financial numbers already CLEANED and LABELED. Intended to
// become the single source of truth for financial data. Plain CommonJS — drops into the existing
// Express backend (server.js) with `require`; no TypeScript, no build step.
//
// CONTRACT — every number is an object, never a bare value:
//   { value, basis, provenance, source, note?, calendarYear?, period?, asOf? }
//     basis      : 'GAAP' | 'NON_GAAP' | 'BASIS_AGNOSTIC'
//     provenance : 'VERIFIED' | 'COMPUTED' | 'CONSENSUS_ESTIMATE'
//     source     : human-readable origin, e.g. 'FMP stable/income-statement FY2026'
//
// RULES (per spec):
//  • GAAP and non-GAAP are NEVER blended. Filing actuals = GAAP; FMP forward consensus = NON_GAAP.
//  • Market cap and EV are COMPUTED (shares × price [+ debt − cash]) — never read from an aggregator
//    field, even though FMP's profile exposes one.
//  • Fiscal years are calendarized to a common calendar basis. Jan FYE ≈ prior calendar year;
//    mid-year FYE needs a quarterly rebuild — if unavailable, the figure is returned WITH A NOTE
//    flagging it as an approximation rather than hidden.
//  • Degrade gracefully. Anything gated/empty on the free tier (HTTP 402/403, or no key) returns a
//    clear object with value:null and a note saying it needs a paid tier. Never crash, never fabricate.
//
// FREE-TIER REALITY (key created after 2025-08-31, FMP "stable" API):
//   FREE    → /stable/profile (price, 52-wk range, employees, sector, cik) and /stable/shares-float.
//   PREMIUM → /stable/{income,balance-sheet,cash-flow}-statement, analyst-estimates, key-metrics,
//             market-capitalization, quote  (all HTTP 402 for CRM/TEAM on the free key).
//   So computed market cap works; statement actuals + forward consensus degrade with a paid-tier note.
// The KEY comes from process.env.FMP_KEY (matches the FINNHUB_KEY/ALPHAVANTAGE_KEY pattern in server.js).
// ─────────────────────────────────────────────────────────────────────────────

const { get } = require('./server/utils/httpGet');

const FMP_KEY = process.env.FMP_KEY || '';
const BASE = 'https://financialmodelingprep.com/stable';

// ── small helpers ───────────────────────────────────────────────────────────
const toM = (v) => (v == null || isNaN(v) ? null : Math.round(Number(v) / 1e6));   // raw $ → $millions
const numOrNull = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

function field(value, basis, provenance, source, extra = {}) {
  return { value, basis, provenance, source, ...extra };
}
// A field whose data exists in FMP but is unreachable on the current key (gated/empty) — value:null + note.
function gated(basis, provenance, source, reason) {
  return { value: null, basis, provenance, source, note: reason };
}

// GET that never throws: resolves to { ok, status, data, error }. httpGet rejects on HTTP>=400 with
// the status embedded in the message ("HTTP 402 from ..."), so we recover the code for the note.
async function tryGet(url) {
  try {
    const data = await get(url);
    return { ok: true, status: 200, data };
  } catch (e) {
    const m = /HTTP (\d{3})/.exec(e.message || '');
    return { ok: false, status: m ? parseInt(m[1], 10) : 0, error: e.message };
  }
}
const url = (pathAndQuery) => `${BASE}/${pathAndQuery}&apikey=${FMP_KEY}`;
// Why a statement/estimate field is null, phrased for the consumer.
function gateReason(res, what) {
  if (!FMP_KEY) return `${what}: FMP_KEY env var not set — cannot fetch.`;
  if (res.status === 402 || res.status === 403) return `${what}: requires a paid FMP tier (HTTP ${res.status}); not available on the free tier.`;
  if (res.ok) return `${what}: FMP returned no data for this symbol.`;
  return `${what}: FMP fetch failed (${res.error || 'unknown error'}).`;
}

// ── calendarization ───────────────────────────────────────────────────────────
// Restate a fiscal-year statement record to a common CALENDAR-YEAR basis.
//  • Jan/Feb FYE (e.g. Salesforce, ends Jan 31): the FY ≈ the PRIOR calendar year (one-month stub
//    immaterial) → CY = endYear − 1.
//  • ~Dec FYE: CY = endYear (already calendar).
//  • Mid-year FYE (e.g. Atlassian, ends Jun 30): the fiscal year straddles two calendar years; a
//    TRUE calendar figure needs summing Jan–Dec quarters. If quarterly data isn't available, we map
//    to the calendar year the FY mostly falls in and FLAG it as an approximation (never hide it).
// Returns { calendarYear: 'CY2025', approximate: bool, note }.
function calendarizeAnnual(endDateStr, haveQuarterlyRebuild = false) {
  if (!endDateStr) return { calendarYear: null, approximate: false, note: null };
  const d = new Date(endDateStr + (endDateStr.length === 10 ? 'T00:00:00Z' : ''));
  const endYear = d.getUTCFullYear();
  const endMonth = d.getUTCMonth() + 1; // 1-12
  if (endMonth <= 2) {
    return { calendarYear: `CY${endYear - 1}`, approximate: false,
      note: `Fiscal year ends ${endDateStr} (Jan/Feb FYE) ≈ prior calendar year CY${endYear - 1}.` };
  }
  if (endMonth >= 11) {
    return { calendarYear: `CY${endYear}`, approximate: false, note: null };
  }
  // Mid-year FYE.
  if (haveQuarterlyRebuild) {
    return { calendarYear: `CY${endYear}`, approximate: false,
      note: `Calendar year rebuilt from Jan–Dec quarters (mid-year FYE ending ${endDateStr}).` };
  }
  return { calendarYear: `CY${endYear}`, approximate: true,
    note: `APPROXIMATION — fiscal year ends ${endDateStr} (mid-year FYE) and straddles two calendar years; a true Jan–Dec rebuild needs quarterly data (not on the free tier). Mapped to CY${endYear}.` };
}

// FMP returns analyst estimates sorted DESCENDING by date (furthest year first), so estimate[0] is
// the furthest projection. Pick the NEAREST FUTURE period instead — the smallest fiscal-period-end
// date strictly after `today` — which is the next forward year a deck actually wants. Returns null
// when no future period is present (→ field degrades with a note, never fabricated).
function nearestFutureEstimate(list, today) {
  if (!Array.isArray(list)) return null;
  const future = list.filter((r) => r && typeof r.date === 'string' && r.date > today);
  if (!future.length) return null;
  return future.reduce((a, b) => (a.date <= b.date ? a : b));
}

// ── main engine ─────────────────────────────────────────────────────────────
async function getVerified(ticker) {
  const t = String(ticker || '').toUpperCase();
  const asOf = new Date().toISOString();

  // Fire every source in parallel; none can crash the engine.
  const [profileRes, floatRes, incomeRes, balanceRes, cashRes, estRes] = await Promise.all([
    tryGet(url(`profile?symbol=${t}`)),
    tryGet(url(`shares-float?symbol=${t}`)),
    tryGet(url(`income-statement?symbol=${t}&period=annual&limit=4`)),
    tryGet(url(`balance-sheet-statement?symbol=${t}&period=annual&limit=1`)),
    tryGet(url(`cash-flow-statement?symbol=${t}&period=annual&limit=1`)),
    tryGet(url(`analyst-estimates?symbol=${t}&period=annual&limit=8`)),
  ]);

  const profile = profileRes.ok && Array.isArray(profileRes.data) ? profileRes.data[0] : null;
  const floatRec = floatRes.ok && Array.isArray(floatRes.data) ? floatRes.data[0] : null;
  const income = incomeRes.ok && Array.isArray(incomeRes.data) ? incomeRes.data[0] : null;
  const balance = balanceRes.ok && Array.isArray(balanceRes.data) ? balanceRes.data[0] : null;
  const cash = cashRes.ok && Array.isArray(cashRes.data) ? cashRes.data[0] : null;
  const estimate = estRes.ok && Array.isArray(estRes.data) ? nearestFutureEstimate(estRes.data, asOf.slice(0, 10)) : null;

  const fields = {};

  // ── Live market data (BASIS_AGNOSTIC, VERIFIED) ────────────────────────────
  const price = profile ? numOrNull(profile.price) : null;
  fields.price = price != null
    ? field(price, 'BASIS_AGNOSTIC', 'VERIFIED', 'FMP stable/profile (live)')
    : gated('BASIS_AGNOSTIC', 'VERIFIED', 'FMP stable/profile', gateReason(profileRes, 'Live price'));

  // Shares outstanding — from the dedicated shares-float endpoint (sourced from the latest filing).
  const sharesRaw = floatRec ? numOrNull(floatRec.outstandingShares) : null;
  fields.sharesOutstanding = sharesRaw != null
    ? field(toM(sharesRaw), 'BASIS_AGNOSTIC', 'VERIFIED', `FMP stable/shares-float (per ${floatRec.source || 'SEC filing'})`,
        { unit: 'millions', asOf: floatRec.date || null })
    : gated('BASIS_AGNOSTIC', 'VERIFIED', 'FMP stable/shares-float', gateReason(floatRes, 'Shares outstanding'));

  // 52-week range — parsed from profile.range "low-high".
  let lo = null, hi = null;
  if (profile && typeof profile.range === 'string' && profile.range.includes('-')) {
    const [a, b] = profile.range.split('-').map((x) => numOrNull(x));
    if (a != null && b != null) { lo = Math.min(a, b); hi = Math.max(a, b); }
  }
  fields.week52High = hi != null
    ? field(hi, 'BASIS_AGNOSTIC', 'VERIFIED', 'FMP stable/profile (range)')
    : gated('BASIS_AGNOSTIC', 'VERIFIED', 'FMP stable/profile', gateReason(profileRes, '52-week high'));
  fields.week52Low = lo != null
    ? field(lo, 'BASIS_AGNOSTIC', 'VERIFIED', 'FMP stable/profile (range)')
    : gated('BASIS_AGNOSTIC', 'VERIFIED', 'FMP stable/profile', gateReason(profileRes, '52-week low'));

  // ── Market cap — COMPUTED as shares × price. NEVER profile.marketCap (aggregator). ──────────
  fields.marketCap = (sharesRaw != null && price != null)
    ? field(toM(sharesRaw * price), 'BASIS_AGNOSTIC', 'COMPUTED', 'shares-float outstanding shares × FMP profile price',
        { unit: 'millions', formula: `${toM(sharesRaw)}M shares × $${price}` })
    : gated('BASIS_AGNOSTIC', 'COMPUTED', 'shares × price',
        `Market cap: need both shares outstanding and live price${!sharesRaw ? ' (shares missing)' : ''}${price == null ? ' (price missing)' : ''}.`);

  // ── Audited GAAP financials (calendarized). Free key gates the statements → value:null + note. ──
  const incomeCal = income ? calendarizeAnnual(income.date) : null;
  const statementField = (rec, raw, label, cal) => rec
    ? field(toM(raw), 'GAAP', 'VERIFIED', `FMP stable/${label}${cal?.calendarYear ? ` ${cal.calendarYear}` : ''}`,
        { unit: 'millions', fiscalDate: rec.date, calendarYear: cal?.calendarYear || null,
          ...(cal?.approximate ? { approximate: true } : {}), ...(cal?.note ? { note: cal.note } : {}) })
    : null;

  fields.revenue = statementField(income, income?.revenue, 'income-statement', incomeCal)
    || gated('GAAP', 'VERIFIED', 'FMP stable/income-statement', gateReason(incomeRes, 'Revenue (GAAP actual)'));
  fields.operatingIncome = statementField(income, income?.operatingIncome, 'income-statement', incomeCal)
    || gated('GAAP', 'VERIFIED', 'FMP stable/income-statement', gateReason(incomeRes, 'Operating income (GAAP actual)'));
  fields.netIncome = statementField(income, income?.netIncome, 'income-statement', incomeCal)
    || gated('GAAP', 'VERIFIED', 'FMP stable/income-statement', gateReason(incomeRes, 'Net income (GAAP actual)'));

  // Reported DILUTED EPS — the filed per-share figure (GAAP, VERIFIED). Falls back to net income ÷
  // weighted-average DILUTED shares (tagged COMPUTED, never VERIFIED) only when the filing's diluted
  // EPS is genuinely absent — never net income ÷ point-in-time share count.
  const epsDil = income ? numOrNull(income.epsDiluted) : null;
  const wadDil = income ? numOrNull(income.weightedAverageShsOutDil) : null;
  if (epsDil != null) {
    fields.eps = field(epsDil, 'GAAP', 'VERIFIED',
      `FMP stable/income-statement${incomeCal?.calendarYear ? ` ${incomeCal.calendarYear}` : ''} (reported diluted EPS)`,
      { unit: '$/share', fiscalDate: income.date, calendarYear: incomeCal?.calendarYear || null,
        ...(incomeCal?.approximate ? { approximate: true } : {}) });
  } else if (income && numOrNull(income.netIncome) != null && wadDil) {
    fields.eps = field(Math.round((numOrNull(income.netIncome) / wadDil) * 100) / 100, 'GAAP', 'COMPUTED',
      'net income ÷ weighted-avg diluted shares (FMP income-statement)',
      { unit: '$/share', fiscalDate: income.date, calendarYear: incomeCal?.calendarYear || null,
        note: 'Reported diluted EPS unavailable in the filing — derived from net income ÷ weighted-average diluted shares.',
        ...(incomeCal?.approximate ? { approximate: true } : {}) });
  } else {
    fields.eps = gated('GAAP', 'VERIFIED', 'FMP stable/income-statement', gateReason(incomeRes, 'Diluted EPS (reported)'));
  }

  const balCal = balance ? calendarizeAnnual(balance.date) : null;
  fields.totalDebt = statementField(balance, balance?.totalDebt, 'balance-sheet-statement', balCal)
    || gated('GAAP', 'VERIFIED', 'FMP stable/balance-sheet-statement', gateReason(balanceRes, 'Total debt (GAAP actual)'));
  const cashRaw = balance ? (balance.cashAndCashEquivalents ?? balance.cashAndShortTermInvestments) : null;
  fields.cash = balance
    ? statementField(balance, cashRaw, 'balance-sheet-statement', balCal)
    : gated('GAAP', 'VERIFIED', 'FMP stable/balance-sheet-statement', gateReason(balanceRes, 'Cash & equivalents (GAAP actual)'));

  const cashCal = cash ? calendarizeAnnual(cash.date) : null;
  fields.freeCashFlow = statementField(cash, cash?.freeCashFlow, 'cash-flow-statement', cashCal)
    || gated('GAAP', 'VERIFIED', 'FMP stable/cash-flow-statement', gateReason(cashRes, 'Free cash flow (GAAP actual)'));

  // ── Enterprise value — COMPUTED = market cap + total debt − cash. Needs the (gated) balance sheet. ──
  const mc = fields.marketCap.value, debt = fields.totalDebt.value, csh = fields.cash.value;
  fields.enterpriseValue = (mc != null && debt != null && csh != null)
    ? field(mc + debt - csh, 'BASIS_AGNOSTIC', 'COMPUTED', 'market cap + total debt − cash', { unit: 'millions' })
    : gated('BASIS_AGNOSTIC', 'COMPUTED', 'market cap + total debt − cash',
        `Enterprise value: needs computed market cap + balance-sheet debt & cash; ${debt == null || csh == null ? 'debt/cash are gated (paid tier).' : 'market cap unavailable.'}`);

  // ── Forward consensus — NON-GAAP by nature; tagged so it can never blend with GAAP actuals. ──
  const estCal = estimate ? calendarizeAnnual(estimate.date) : null;
  fields.forwardRevenue = (estimate && numOrNull(estimate.revenueAvg ?? estimate.estimatedRevenueAvg) != null)
    ? field(toM(estimate.revenueAvg ?? estimate.estimatedRevenueAvg), 'NON_GAAP', 'CONSENSUS_ESTIMATE',
        `FMP stable/analyst-estimates${estCal?.calendarYear ? ` ${estCal.calendarYear}` : ''}`,
        { unit: 'millions', fiscalDate: estimate.date, calendarYear: estCal?.calendarYear || null,
          ...(estCal?.approximate ? { approximate: true } : {}) })
    : gated('NON_GAAP', 'CONSENSUS_ESTIMATE', 'FMP stable/analyst-estimates', gateReason(estRes, 'Forward revenue (consensus)'));
  fields.forwardEps = (estimate && numOrNull(estimate.epsAvg ?? estimate.estimatedEpsAvg) != null)
    ? field(numOrNull(estimate.epsAvg ?? estimate.estimatedEpsAvg), 'NON_GAAP', 'CONSENSUS_ESTIMATE',
        `FMP stable/analyst-estimates${estCal?.calendarYear ? ` ${estCal.calendarYear}` : ''}`,
        { unit: '$/share', fiscalDate: estimate.date, calendarYear: estCal?.calendarYear || null,
          ...(estCal?.approximate ? { approximate: true } : {}) })
    : gated('NON_GAAP', 'CONSENSUS_ESTIMATE', 'FMP stable/analyst-estimates', gateReason(estRes, 'Forward EPS (consensus)'));

  // Employees — verified company datum (basis-agnostic).
  const emp = profile ? numOrNull(profile.fullTimeEmployees) : null;
  fields.employees = emp != null
    ? field(emp, 'BASIS_AGNOSTIC', 'VERIFIED', 'FMP stable/profile (fullTimeEmployees)')
    : gated('BASIS_AGNOSTIC', 'VERIFIED', 'FMP stable/profile', gateReason(profileRes, 'Employees'));

  return {
    ticker: t,
    asOf,
    currency: (profile && profile.currency) || 'USD',
    company: profile
      ? { name: profile.companyName || null, cik: profile.cik || null, exchange: profile.exchange || null,
          sector: profile.sector || null, industry: profile.industry || null }
      : null,
    keyConfigured: !!FMP_KEY,
    fields,
  };
}

module.exports = { getVerified, calendarizeAnnual };
