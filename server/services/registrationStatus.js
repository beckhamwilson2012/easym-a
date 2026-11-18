'use strict';
// Is this ticker still an SEC registrant? Read only from the EDGAR submissions JSON of the resolved CIK. A deregistered
// company can keep a price and fundamentals at FMP for months, so EDGAR is the authority (Fix 21 Task 1).
//
// A company counts as deregistered when BOTH hold:
//   1. a Form 15 (15-12B, 15-12G, 15-15D) or a 25-NSE was filed after its latest periodic report (10-K, 10-Q, 20-F, 40-F);
//   2. EDGAR no longer lists the ticker for that registrant. A 25-NSE additionally needs the registrant to have no listed
//      ticker at all.
// Condition 2 is what keeps live companies out. Exchanges file a 25-NSE when one note or preferred series is removed, and
// a Form 15 can cover one class: on 2026-11-18 AAPL (25-NSE 2026-11-09, after its 10-K of 2026-11-03), GME and SHEL all
// met condition 1 while still listed and filing. 20-F and 40-F filers never file a 10-Q, so a missing 10-Q means nothing.

const PERIODIC_FORMS = new Set(['10-K', '10-KT', '10-Q', '10-QT', '20-F', '40-F']);
const FORM_15 = new Set(['15-12B', '15-12G', '15-15D']);
const DELISTING_FORM = '25-NSE';
// When one day carries several (WBD filed a 15-12G with a run of 15-15Ds), the class-wide form names the event.
const FORM_RANK = { '15-12B': 0, '15-12G': 0, '15-15D': 1 };

function recentFilings(submissions) {
  const r = submissions && submissions.filings && submissions.filings.recent;
  if (!r || !Array.isArray(r.form) || !Array.isArray(r.filingDate)) return [];
  return r.form.map((form, i) => ({ form, date: r.filingDate[i] })).filter((f) => f.form && f.date);
}

// { name, date, form } when the registrant is deregistered for this ticker, else null.
function deregistration(submissions, symbol) {
  const filings = recentFilings(submissions);
  if (!filings.length) return null;
  const listed = (submissions.tickers || []).map((t) => String(t).toUpperCase());
  if (listed.includes(String(symbol).toUpperCase())) return null;

  const latestPeriodic = filings.filter((f) => PERIODIC_FORMS.has(f.form)).reduce((max, f) => (f.date > max ? f.date : max), '');
  const after = filings.filter((f) => f.date > latestPeriodic);
  const form15s = after.filter((f) => FORM_15.has(f.form));
  const delistings = listed.length === 0 ? after.filter((f) => f.form === DELISTING_FORM) : [];
  const pool = form15s.length ? form15s : delistings;
  if (!pool.length) return null;
  const pick = [...pool].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (FORM_RANK[a.form] ?? 2) - (FORM_RANK[b.form] ?? 2)))[0];
  return { name: submissions.name || String(symbol).toUpperCase(), date: pick.date, form: pick.form };
}

const REGISTRATION_UNAVAILABLE = 'registration check unavailable';

function withDeadline(work, ms) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms}ms`)), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

// Never rejects. `block` is set only by a successful EDGAR answer that shows the company deregistered. Any failure (HTTP
// 429 or 5xx, timeout, no network, an answer with no filing history) gives { checked: false, block: null } and one log line.
async function checkRegistration(symbol, { resolveCik, fetchSubmissions, deadlineMs, warn = console.warn }) {
  const ask = async () => {
    const cik = await resolveCik(symbol);
    if (!cik) return null;
    const submissions = await fetchSubmissions(cik);
    if (!recentFilings(submissions).length) throw new Error('EDGAR answer has no filing history');
    return deregistration(submissions, symbol);
  };
  try {
    return { checked: true, block: await withDeadline(ask(), deadlineMs) };
  } catch (e) {
    warn(`[${symbol}] ${REGISTRATION_UNAVAILABLE}: ${e.message}`);
    return { checked: false, block: null };
  }
}

const deregisteredMessage = (d) => `${d.name} deregistered with the SEC on ${d.date} (Form ${d.form}); no current filings`;

module.exports = { deregistration, deregisteredMessage, checkRegistration, withDeadline, REGISTRATION_UNAVAILABLE, PERIODIC_FORMS, FORM_15, DELISTING_FORM };
