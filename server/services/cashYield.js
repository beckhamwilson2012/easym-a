'use strict';
// server/services/cashYield.js — a company's own realized yield on its cash (Fix 14 Task 2).
//
// When excess cash funds part of a deal, that cash stops earning interest. The yield it was earning is the company's
// own: interest income over a period ÷ the average of (cash & equivalents + short-term investments) at the period's
// start and end, both from the filings. The cash bucket is the app's convention (b): cash + the first short-term
// marketable-securities line tagged at that date (none tagged → cash only), the same lines src/lib/netDebt.js
// cashBucket sums for the deal's cash. Interest income counts only when tagged as interest (InvestmentIncomeInterest,
// or interest and dividends). A combined "interest and other income" line or a non-operating total is not interest,
// so it is not used. Any missing leg → { value: null, reason } and the deal model uses its stated 4.0% assumption.

const INTEREST_INCOME_CONCEPTS = ['InvestmentIncomeInterest', 'InvestmentIncomeInterestAndDividend'];
const CASH_CONCEPTS = ['CashAndCashEquivalentsAtCarryingValue'];
const STI_CONCEPTS = ['MarketableSecuritiesCurrent', 'ShortTermInvestments', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent'];

const DAY = 86400000;
const inM1 = (v) => Math.round(v / 1e5) / 10;   // $M to one decimal, for the label only

// The instant value of the first concept tagged exactly at `date` (the balance-sheet date), or null.
function instantAt(gaap, names, date) {
  for (const n of names) {
    const rows = (gaap[n] && gaap[n].units && gaap[n].units.USD) || [];
    const hit = rows.filter((e) => !e.start && e.end === date);
    if (hit.length) return { val: hit.reduce((a, e) => ((e.filed || '') > (a.filed || '') ? e : a), hit[0]).val, concept: n };
  }
  return null;
}

// The balance-sheet date one year before `date`: the instant cash is tagged at within 10 days of 365 days earlier.
function yearEarlierDate(gaap, date) {
  const rows = (gaap[CASH_CONCEPTS[0]] && gaap[CASH_CONCEPTS[0]].units && gaap[CASH_CONCEPTS[0]].units.USD) || [];
  const target = Date.parse(date) - 365 * DAY;
  let best = null;
  for (const e of rows) {
    if (e.start) continue;
    const d = Math.abs(Date.parse(e.end) - target) / DAY;
    if (d <= 10 && (!best || d < best.d)) best = { end: e.end, d };
  }
  return best ? best.end : null;
}

function bucketAt(gaap, date) {
  const cash = instantAt(gaap, CASH_CONCEPTS, date);
  if (!cash) return null;
  const sti = instantAt(gaap, STI_CONCEPTS, date);
  return { val: cash.val + (sti ? sti.val : 0), sti: sti ? sti.concept : null };
}

// Pure. interest: { value (raw $), concept, period: 'LTM' | 'FY2025' … } or null; endDate: the period's last day.
function realizedYield(gaap, interest, endDate) {
  if (!interest || interest.value == null) return { value: null, reason: 'no interest income tagged (InvestmentIncomeInterest) for this period' };
  const startDate = endDate ? yearEarlierDate(gaap, endDate) : null;
  const a = startDate ? bucketAt(gaap, startDate) : null;
  const b = endDate ? bucketAt(gaap, endDate) : null;
  if (!a || !b) return { value: null, reason: `cash is not tagged at both ${startDate || 'the start'} and ${endDate || 'the end'} of the period` };
  const avg = (a.val + b.val) / 2;
  if (!(avg > 0)) return { value: null, reason: 'average cash and short-term investments is not positive' };
  if (!(interest.value > 0)) return { value: null, reason: 'interest income for the period is not positive' };
  const value = interest.value / avg;
  return {
    value, interestIncomeM: inM1(interest.value), averageCashM: inM1(avg), start: startDate, end: endDate, concept: interest.concept,
    label: `${(value * 100).toFixed(1)}% realized: ${interest.period} interest income $${inM1(interest.value)}M ÷ average cash & short-term investments $${inM1(avg)}M (${startDate} and ${endDate})`,
  };
}

module.exports = { realizedYield, INTEREST_INCOME_CONCEPTS, yearEarlierDate, bucketAt };
