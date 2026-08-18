'use strict';
// server/services/fieldMapper.js — Phase 5 foundation: map a validated multi-statement extraction to the
// six required deck fields, each carrying its PAGE CITE (page + verbatim label) and a status:
//   'ok'      — a clean value the validator accepted
//   'review'  — usable but qualified (bundled/qualified D&A, or a debt line flagged review) → amber in UI
//   'missing' — not found, or the validator nulled it → renders an em-dash, NEVER 0
// Definitions match the harness rulings: revenue = total revenue; net income = attributable to parent;
// D&A "…and other"/"…excluding…" → review; total debt = long-term debt incl current maturities, excl
// commercial paper / short-term borrowings (same shape as the XBRL debt resolver).

const norm = s => String(s || '').trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');

const isTotalRevenue = n => /^total (net )?revenues?$/.test(n);
const isNetOpRevenue = n => /^net operating revenues?$/.test(n);
const isPlainRevenue = n => ['net sales', 'total net sales', 'revenue', 'revenues', 'net revenue', 'net revenues'].includes(n);
const isEbit         = n => ['operating income', 'income from operations', 'operating income (loss)', 'operating profit'].includes(n);
const isPlainNI      = n => ['net income', 'net income (loss)', 'net earnings', 'consolidated net income'].includes(n);
const isAttribNI     = i => /net (income|earnings).*attributable to /i.test(i.verbatimLabel) && !/noncontrolling|minority/i.test(i.verbatimLabel);
const isCash         = n => ['cash and cash equivalents', 'cash and equivalents', 'cash and cash equivalents at end of period', 'cash and equivalents at end of period', 'cash and cash equivalents, end of period'].includes(n);
const isDA           = n => /^depreciation and amortization/.test(n) || /^depreciation, amortization/.test(n) || n === 'depreciation & amortization';
const isBundledDA    = n => /and other|excluding|excl\.|net of/.test(n);
const isLTDebt = n => (/(long-term debt|term debt|long-term borrowings)/.test(n)
      || /current (portion|maturities|installments) of (long-term debt|finance lease|capital lease)/.test(n)
      || /long-term debt due within one year/.test(n) || n === 'short-term debt')
    && !/commercial paper|short-term borrowing|loans and notes payable|short-term debt obligation|available|fair value|deferred|weighted|discount|premium|issuance|net of/.test(n);

// latest fiscal year per statement (flows can be labeled fy-1 by retailers; instants carry the calendar year)
const yearRe = fy => new RegExp('(^|[^0-9])' + fy + '([^0-9]|$)');
function yearForKind(items, kind, fy) {
  const labels = items.filter(i => i._kind === kind).map(i => i.periodLabel).join(' | ');
  return yearRe(fy).test(labels) ? fy : (yearRe(fy - 1).test(labels) ? fy - 1 : fy);
}
const atFy = (items, kind, fy) => { const y = yearForKind(items, kind, fy); return items.filter(i => i._kind === kind && yearRe(y).test(i.periodLabel)); };

const cite = it => it ? { value: it.scaledValue, page: it.page, label: it.verbatimLabel, periodLabel: it.periodLabel, status: it.status === 'missing' ? 'missing' : 'ok' } : { value: null, page: null, label: null, status: 'missing' };

// items: extracted line items, each stamped ._kind ('income'|'balance'|'cashflow') + validator status.
// facts: { scale, exceptPerShare, currency, fiscalYearEnd } from the locator. fy: latest fiscal year (int).
function mapFields(items, fy) {
  const inc = m => atFy(items, 'income', fy).find(i => m(norm(i.verbatimLabel)));

  const revenue = cite(atFy(items, 'income', fy).find(i => isTotalRevenue(norm(i.verbatimLabel)))
                    || atFy(items, 'income', fy).find(i => isNetOpRevenue(norm(i.verbatimLabel)))
                    || atFy(items, 'income', fy).find(i => isPlainRevenue(norm(i.verbatimLabel))));

  const ebitIt = inc(isEbit);
  const ebit = ebitIt ? cite(ebitIt) : { value: null, page: null, label: null, status: 'missing' }; // no operating-income subtotal → missing (renders —)

  const netIncome = cite(atFy(items, 'income', fy).find(isAttribNI) || atFy(items, 'income', fy).find(i => isPlainNI(norm(i.verbatimLabel))));

  const cash = cite(atFy(items, 'balance', fy).find(i => isCash(norm(i.verbatimLabel))));

  const daIt = atFy(items, 'cashflow', fy).find(i => isDA(norm(i.verbatimLabel)));
  const da = daIt ? { ...cite(daIt), status: isBundledDA(norm(daIt.verbatimLabel)) ? 'review' : (daIt.status === 'missing' ? 'missing' : 'ok') }
                  : { value: null, page: null, label: null, status: 'missing' };

  const debtLines = atFy(items, 'balance', fy).filter(i => isLTDebt(norm(i.verbatimLabel)));
  const debtOk = debtLines.filter(i => i.status === 'ok' && i.scaledValue != null);
  const totalDebt = debtOk.length
    ? { value: debtOk.reduce((a, i) => a + i.scaledValue, 0),
        page: debtOk[0].page,
        label: debtOk.map(i => i.verbatimLabel).join(' + '),
        lines: debtLines.map(i => ({ label: i.verbatimLabel, value: i.scaledValue, page: i.page, status: i.status })),
        status: debtLines.some(i => i.status !== 'ok') ? 'review' : 'ok' }
    : { value: null, page: null, label: null, lines: debtLines.map(i => ({ label: i.verbatimLabel, page: i.page })), status: 'missing' };

  return { revenue, ebit, da, netIncome, cash, totalDebt };
}

module.exports = { mapFields };
