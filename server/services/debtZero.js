'use strict';
// server/services/debtZero.js — total debt that is ZERO, as opposed to unknown. Runs only when the shared resolver
// (debtConcepts + the /quote tails) found no debt at the balance-sheet anchor.
//
// "The company has no debt" is a claim, so it needs a filing that makes it. Two sources count, nothing else:
//   A. A filed 0 for a debt concept that no later filing contradicts. OMDA tags LongTermDebt = 0 at 2025-12-31 in its
//      FY2025 10-K and tags no debt in its 2026 10-Qs; the interim anchor (2026-09-30) used to turn that into null.
//   B. The latest 10-K/10-Q's debt note says nothing is drawn. PGNY's Q3 2026 10-Q, note 6: "As of the date of this
//      filing, no amounts were drawn under the Facility."
//   C. Only when A and B both fail: the latest balance sheet proves it. Every liability line on the face of the balance
//      sheet is read from the filing (its presentation linkbase and its own instance), the lines sum exactly to Total
//      liabilities as filed, and every line is a concept known not to be a borrowing (payables, accrued, deferred revenue,
//      operating leases, taxes). HNGE's Q3 2026 10-Q: five lines, 80,816,000 + 4,721,000 + 459,174,000 + 29,157,000 +
//      795,000 = 574,663,000 = Total liabilities, none a borrowing → $0. Any line that is a borrowing (finance leases
//      included), any concept not on the known list ("other" liabilities, company extensions), a line with no value, or
//      a sum that misses the total by a single unit → null with that reason. An unknown concept is never "not debt".
// Either way the latest filing's own instance must carry no non-zero debt fact at its balance-sheet date (any dimension).
// No debt concept and no filed statement of zero stays null with the reason. Absence is never read as zero: a missing
// line, total or linkbase keeps debt "—".

const { latestPeriodicFiling, readInstanceXml, readPrimaryDocument, readPresentationXml, readSubmissions, parseContexts, numericFacts, usdUnits } = require('./filingInstance');

// Every borrowing concept the resolver and its tails read, plus the line-of-credit and notes-payable balances a facility
// note is tagged with. Fair values, capacities and maturities schedules are not balances and stay out.
const DEBT_CONCEPTS = [
  'LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtCurrent',
  'LongTermDebtAndCapitalLeaseObligations', 'LongTermDebtAndCapitalLeaseObligationsCurrent',
  'ConvertibleDebtNoncurrent', 'ConvertibleDebtCurrent', 'ConvertibleLongTermNotesPayable', 'ConvertibleNotesPayableCurrent',
  'DebtLongtermAndShorttermCombinedAmount', 'LongTermLineOfCredit', 'LongTermNotesPayable', 'LineOfCredit',
  'NotesPayable', 'NotesPayableCurrent', 'ShortTermBorrowings', 'DebtCurrent', 'SecuredDebt', 'SeniorNotes',
];
const DEBT_NOTE_BLOCKS = ['DebtDisclosureTextBlock', 'LongTermDebtTextBlock', 'LineOfCreditFacilityDisclosureTextBlock'];
const PERIODIC = /^10-[KQ]/;

const NOTHING_DRAWN = [
  /\bno\s+(?:amounts?|borrowings?|balances?|loans?|advances?)\b[^.;]{0,60}?\b(?:were|was|have been|had been|are|is|remained?)\s+(?:drawn|outstanding|borrowed)\b/i,
  /\b(?:there were|there was|there are|there is|we had|we have|the company had|the company has)\s+no\s+(?:amounts?|borrowings?)\s+outstanding\b/i,
  /\bno\s+(?:outstanding\s+)?borrowings\s+under\b/i,
];
const FACILITY = /credit (?:facility|agreement)|line of credit|revolv/i;

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x201[cd];/gi, '"')
  .replace(/&#x2019;|&#8217;/gi, "'").replace(/&#160;|&nbsp;/g, ' ').replace(/&#x2014;/gi, '—').replace(/&amp;/g, '&');
const textOf = (html) => decode(decode(html)).replace(/<[^>]+>/g, ' ').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim();
const mdy = (iso) => { const [y, m, d] = String(iso).split('-'); return `${Number(m)}/${Number(d)}/${y}`; };

// Pure: non-zero debt facts in a filing's instance at its balance-sheet date. Any dimension counts: a facility-level
// LineOfCredit of $40M is debt even though companyfacts never sees it.
function nonZeroDebtFacts(xml, date) {
  const contexts = parseContexts(xml);
  const out = [];
  for (const c of DEBT_CONCEPTS) {
    for (const f of numericFacts(xml, 'us-gaap', c)) {
      const ctx = contexts[f.ctx];
      if (ctx && ctx.instant === date && f.val !== 0) out.push({ concept: c, val: f.val, ctx: f.ctx });
    }
  }
  return out;
}

// Pure: the debt note's "nothing drawn" sentence from an instance, or null. { block, heading, sentence, revolver }
function nothingDrawnStatement(xml) {
  for (const block of DEBT_NOTE_BLOCKS) {
    for (const m of xml.matchAll(new RegExp(`<us-gaap:${block}\\b[^>]*>([\\s\\S]*?)</us-gaap:${block}>`, 'g'))) {
      const text = textOf(m[1]);
      if (!FACILITY.test(text)) continue;
      // The sentence must state the position AS OF a date (a period end, or "the date of this filing") and must not be about a
      // facility that has ended: FFIV's "At the time of expiration, there were no outstanding borrowings under the Revolving
      // Credit Facility" describes a past facility, not the debt at the balance-sheet date, so it is not a statement of zero.
      const sentence = text.split(/(?<=\.)\s+(?=[A-Z])/).find((s) => NOTHING_DRAWN.some((re) => re.test(s))
        && /\bas of\b/i.test(s) && !/expir|terminat|matured|prior to/i.test(s));
      if (!sentence) continue;
      const heading = (text.match(/^([A-Z][A-Za-z ,&-]{1,40}?)(?=\s+(?:On|As|In|The|We|During|At)\b)/) || [])[1] || null;
      return { block, heading, sentence: sentence.trim(), revolver: /revolv/i.test(text) };
    }
  }
  return null;
}

// Pure: the note number printed before the heading in the primary document, nearest before the sentence. "6" or null.
function noteNumber(documentHtml, heading, sentence) {
  if (!documentHtml || !heading) return null;
  const text = textOf(documentHtml);
  const at = text.indexOf(sentence.slice(0, 60));
  const before = at >= 0 ? text.slice(0, at) : text;
  const re = new RegExp(`(?:^|\\s)(\\d{1,2})\\.\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  let n = null;
  for (const m of before.matchAll(re)) n = m[1];
  return n;
}

// Pure: rule A on companyfacts. The latest-dated instant across the debt concepts, from a 10-K/10-Q, all zero, no older than
// the latest 10-K's period. { end, form, concept, filed } or { reason }.
function filedZero(gaap, floorEnd) {
  const rows = [];
  for (const c of DEBT_CONCEPTS) {
    for (const e of (gaap[c]?.units?.USD || [])) if (!e.start && PERIODIC.test(e.form || '')) rows.push({ ...e, concept: c });
  }
  if (!rows.length) return { reason: 'no debt concept is tagged in any 10-K or 10-Q' };
  const latestEnd = rows.reduce((d, e) => (e.end > d ? e.end : d), '');
  const at = rows.filter((e) => e.end === latestEnd);
  if (at.some((e) => e.val !== 0)) return { reason: `the latest debt tag is non-zero (${at.find((e) => e.val !== 0).concept} at ${latestEnd}) but not at the balance-sheet date` };
  if (floorEnd && latestEnd < floorEnd) return { reason: `the latest filed debt tag (0 at ${latestEnd}) is older than the latest 10-K (${floorEnd})` };
  const pick = at.filter((e) => /^10-K/.test(e.form)).sort((a, b) => (b.filed || '').localeCompare(a.filed || ''))[0]
    || at.sort((a, b) => (b.filed || '').localeCompare(a.filed || ''))[0];
  return { end: latestEnd, form: pick.form.replace(/\/A$/, ''), concept: pick.concept, filed: pick.filed, accn: pick.accn };
}

// ── C. Balance-sheet proof ────────────────────────────────────────────────────────────────────────────────────────────
// Liability lines known NOT to be borrowings, by exact us-gaap concept, with the category the label reports. Nothing with
// "Other" in its name is here: an "other liabilities" line can hold anything, so it is unknown and the rule doesn't fire.
// Company extension concepts are never here for the same reason.
const NOT_BORROWING = {
  'us-gaap:AccountsPayableCurrent': 'payables', 'us-gaap:AccountsPayableNoncurrent': 'payables',
  'us-gaap:AccountsPayableTradeCurrent': 'payables', 'us-gaap:AccountsPayableRelatedPartiesCurrent': 'payables',
  'us-gaap:AccountsPayableCurrentAndNoncurrent': 'payables',
  'us-gaap:AccountsPayableAndAccruedLiabilitiesCurrent': 'payables and accrued',
  'us-gaap:AccountsPayableAndAccruedLiabilitiesNoncurrent': 'payables and accrued',
  'us-gaap:AccountsPayableAndAccruedLiabilitiesCurrentAndNoncurrent': 'payables and accrued',
  'us-gaap:AccruedLiabilitiesCurrent': 'accrued', 'us-gaap:AccruedLiabilitiesNoncurrent': 'accrued',
  'us-gaap:AccruedLiabilitiesCurrentAndNoncurrent': 'accrued',
  'us-gaap:EmployeeRelatedLiabilitiesCurrent': 'accrued', 'us-gaap:AccruedSalariesCurrent': 'accrued',
  'us-gaap:ContractWithCustomerLiabilityCurrent': 'deferred revenue', 'us-gaap:ContractWithCustomerLiabilityNoncurrent': 'deferred revenue',
  'us-gaap:ContractWithCustomerLiability': 'deferred revenue', 'us-gaap:DeferredRevenueCurrent': 'deferred revenue',
  'us-gaap:DeferredRevenueNoncurrent': 'deferred revenue', 'us-gaap:DeferredRevenue': 'deferred revenue',
  'us-gaap:CustomerRefundLiabilityCurrent': 'deferred revenue',
  'us-gaap:OperatingLeaseLiabilityCurrent': 'operating lease', 'us-gaap:OperatingLeaseLiabilityNoncurrent': 'operating lease',
  'us-gaap:OperatingLeaseLiability': 'operating lease',
  'us-gaap:DeferredIncomeTaxLiabilitiesNet': 'tax', 'us-gaap:DeferredIncomeTaxLiabilities': 'tax',
  'us-gaap:AccruedIncomeTaxesCurrent': 'tax', 'us-gaap:AccruedIncomeTaxesNoncurrent': 'tax', 'us-gaap:TaxesPayableCurrent': 'tax',
  'us-gaap:LiabilityForUncertainTaxPositionsCurrent': 'tax', 'us-gaap:LiabilityForUncertainTaxPositionsNoncurrent': 'tax',
};
// A borrowing: every concept the resolver reads, plus anything named as debt, a loan, notes, a credit line, commercial paper
// or a finance (capital) lease, in us-gaap or an extension. Checked before NOT_BORROWING, so a borrowing can never pass.
const BORROWING_NAME = /Debt|Loan|Borrowing|NotesPayable|Lines? ?OfCredit|CommercialPaper|FinanceLease|CapitalLease|SeniorNotes|Debenture|BondsPayable/i;
const SUBTOTALS = ['us-gaap:LiabilitiesCurrent', 'us-gaap:LiabilitiesNoncurrent'];
const TOTAL = 'us-gaap:Liabilities';

// Pure: 'borrowing' | 'not borrowing' (with category) | 'unknown'.
function classifyLiability(qname) {
  const name = qname.split(':')[1] || qname;
  if ((qname.startsWith('us-gaap:') && DEBT_CONCEPTS.includes(name)) || BORROWING_NAME.test(name)) return { kind: 'borrowing' };
  if (NOT_BORROWING[qname]) return { kind: 'not borrowing', category: NOT_BORROWING[qname] };
  return { kind: 'unknown' };
}

const attr = (s, k) => (s.match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1];

// Pure: the balance-sheet role's tree from a presentation linkbase → { role, loc: label → qname, kids: label → [{ to, pref }] }
// or null. The balance sheet is the first role, not parenthetical or a note detail, that presents LiabilitiesAndStockholdersEquity.
function balanceSheetTree(preXml) {
  for (const m of preXml.matchAll(/<(?:link:)?presentationLink\b([^>]*)>([\s\S]*?)<\/(?:link:)?presentationLink>/g)) {
    const role = attr(m[1], 'xlink:role') || '';
    if (/parenthetical|details|tables|polic/i.test(role)) continue;
    const loc = {};
    for (const l of m[2].matchAll(/<(?:link:)?loc\b([^>]*)\/?>/g)) {
      const href = attr(l[1], 'xlink:href') || '';
      const id = href.slice(href.indexOf('#') + 1);
      const at = id.indexOf('_');
      if (at > 0) loc[attr(l[1], 'xlink:label')] = `${id.slice(0, at)}:${id.slice(at + 1)}`;
    }
    if (!Object.values(loc).includes('us-gaap:LiabilitiesAndStockholdersEquity')) continue;
    const kids = {};
    for (const a of m[2].matchAll(/<(?:link:)?presentationArc\b([^>]*)\/?>/g)) {
      if (attr(a[1], 'use') === 'prohibited') continue;
      (kids[attr(a[1], 'xlink:from')] ||= []).push({ to: attr(a[1], 'xlink:to'), order: Number(attr(a[1], 'order') || 0), pref: attr(a[1], 'preferredLabel') || '' });
    }
    Object.values(kids).forEach((k) => k.sort((x, y) => x.order - y.order));
    return { role, loc, kids };
  }
  return null;
}

// Pure: does the balance sheet prove zero debt at `date`? Never throws.
// → { zero: true, lines, subtotals, total, decimals, role } or { zero: false, why, lines?, total? }.
function balanceSheetProof(xml, preXml, date) {
  const tree = preXml ? balanceSheetTree(preXml) : null;
  if (!tree) return { zero: false, why: 'its balance sheet could not be read from the filing' };
  const { loc, kids } = tree;
  // Total liabilities, and the lines that come before it under the same heading (each sibling's subtree, in order).
  let parent = null, at = -1;
  for (const [from, list] of Object.entries(kids)) {
    const i = list.findIndex((k) => loc[k.to] === TOTAL);
    if (i >= 0) { parent = from; at = i; break; }
  }
  if (parent == null) return { zero: false, why: 'it shows no Total liabilities line' };
  const nodes = [];
  const walk = (label, under, pref) => { nodes.push({ qn: loc[label], under, pref }); for (const k of kids[label] || []) walk(k.to, label, k.pref); };
  kids[parent].slice(0, at).forEach((k) => walk(k.to, parent, k.pref));
  const lastAssets = nodes.map((n) => n.qn).lastIndexOf('us-gaap:Assets');
  const items = nodes.slice(lastAssets + 1).filter((n) => n.qn && !/Abstract$/.test(n.qn));

  const contexts = parseContexts(xml);
  const usd = usdUnits(xml);
  const valueOf = (qn) => {
    const [p, n] = qn.split(':');
    const vals = [...new Set(numericFacts(xml, p, n)
      .filter((f) => contexts[f.ctx] && contexts[f.ctx].instant === date && !contexts[f.ctx].dimensioned && usd.has(f.unit))
      .map((f) => f.val))];
    const dec = numericFacts(xml, p, n).find((f) => contexts[f.ctx] && contexts[f.ctx].instant === date && !contexts[f.ctx].dimensioned)?.decimals ?? null;
    return vals.length === 1 ? { val: vals[0], dec } : { val: null, conflict: vals.length > 1 };
  };
  const cents = (v) => Math.round(v * 100);
  const fmt = (v) => `$${v.toLocaleString('en-US')}`;

  const total = valueOf(TOTAL);
  if (total.val == null) return { zero: false, why: total.conflict ? 'Total liabilities has conflicting values' : `Total liabilities has no USD value at ${date}` };
  const lines = [], subtotals = [];
  for (const [i, n] of items.entries()) {
    const v = valueOf(n.qn);
    const line = { concept: n.qn, value: v.val, ...classifyLiability(n.qn), under: n.under, i };
    if (SUBTOTALS.includes(n.qn)) subtotals.push(line); else lines.push(line);
    if (v.val == null) return { zero: false, why: `line ${n.qn} ${v.conflict ? 'has conflicting values' : `has no USD value at ${date}`}`, lines, total: total.val };
    if (/negated/i.test(n.pref)) return { zero: false, why: `line ${n.qn} is shown negated`, lines, total: total.val };
  }
  if (!lines.length) return { zero: false, why: 'no liability lines are presented before Total liabilities', total: total.val };
  const borrowing = lines.filter((l) => l.kind === 'borrowing');
  if (borrowing.length) return { zero: false, why: `it carries a borrowing line (${borrowing.map((l) => `${l.concept} ${fmt(l.value)}`).join('; ')})`, lines, total: total.val };
  const unknown = lines.filter((l) => l.kind === 'unknown');
  if (unknown.length) return { zero: false, why: `it carries a line the rule cannot classify as debt or not (${unknown.map((l) => l.concept).join('; ')})`, lines, total: total.val };
  // Each subtotal ties to the lines above it under its own heading (after any earlier subtotal there); then every line ties
  // to Total liabilities, to the unit filed.
  for (const s of subtotals) {
    const prev = subtotals.filter((p) => p.under === s.under && p.i < s.i).reduce((m, p) => Math.max(m, p.i), -1);
    const own = lines.filter((l) => l.under === s.under && l.i < s.i && l.i > prev);
    const sum = own.reduce((a, l) => a + cents(l.value), 0);
    if (sum !== cents(s.value)) return { zero: false, why: `its ${s.concept} lines sum to ${fmt(sum / 100)}, not ${fmt(s.value)}`, lines, total: total.val };
  }
  const sum = lines.reduce((a, l) => a + cents(l.value), 0);
  if (sum !== cents(total.val)) return { zero: false, why: `its liability lines sum to ${fmt(sum / 100)}, not Total liabilities ${fmt(total.val)}`, lines, total: total.val };
  const strip = (l) => ({ concept: l.concept, value: l.value, category: l.category || null });
  return { zero: true, lines: lines.map(strip), subtotals: subtotals.map(strip), total: total.val, decimals: total.dec, role: tree.role };
}

// The one entry point. Returns { value: 0, label, basis, source } or { value: null, reason }. Never throws.
// `opts.balanceSheetAsOf`: the date the caller's cash comes from; rule C refuses a balance sheet at any other date.
async function resolveZeroDebt(cik, gaap, floorEnd, deps = {}, opts = {}) {
  const readSub = deps.readSubmissions || readSubmissions;
  const readXml = deps.readInstanceXml || readInstanceXml;
  const readDoc = deps.readPrimaryDocument || readPrimaryDocument;
  const readPre = deps.readPresentationXml || readPresentationXml;
  try {
    const filing = latestPeriodicFiling(await readSub(cik));
    if (!filing) return { value: null, reason: 'no 10-K or 10-Q on file to state the debt' };
    const where = `${filing.form} ${mdy(filing.reportDate)}`;
    const xml = await readXml(cik, filing);
    if (!xml) return { value: null, reason: `the latest filing (${where}) could not be read to confirm the debt` };
    const contradicting = nonZeroDebtFacts(xml, filing.reportDate);
    if (contradicting.length) {
      const c = contradicting[0];
      return { value: null, reason: `the ${where} tags ${c.concept} ${c.val.toLocaleString('en-US')} at the balance-sheet date, which the debt resolver does not total` };
    }

    // B. The debt note of the latest filing states nothing is drawn.
    const note = nothingDrawnStatement(xml);
    if (note) {
      const n = noteNumber(await readDoc(cik, filing), note.heading, note.sentence);
      const noteRef = n ? `note ${n}` : `note "${note.heading || 'Debt'}"`;
      return {
        value: 0,
        label: `$0, nothing drawn on ${note.revolver ? 'revolver' : 'credit facility'}, ${where} ${noteRef}`,
        basis: 'facility note',
        source: { form: filing.form, accn: filing.accn, filed: filing.filed, asOf: filing.reportDate, note: noteRef, sentence: note.sentence },
      };
    }

    // A. A filed zero that no later filing contradicts.
    const z = filedZero(gaap || {}, floorEnd);
    if (z.end) {
      const period = /^10-K/.test(z.form) ? `FY${z.end.slice(0, 4)}` : mdy(z.end);
      const later = z.end < filing.reportDate;
      return {
        value: 0,
        label: `$0, ${z.form} ${period}${later ? ', no later debt tag' : ''}`,
        basis: 'filed zero',
        source: { form: z.form, accn: z.accn, filed: z.filed, asOf: z.end, concept: z.concept, checkedThrough: { form: filing.form, accn: filing.accn, asOf: filing.reportDate } },
      };
    }
    const noStatement = `${z.reason}, and no filing states zero debt (checked through the ${where})`;

    // C. The latest balance sheet proves it: every liability line read, tied to Total liabilities, none a borrowing.
    if (opts.balanceSheetAsOf && opts.balanceSheetAsOf !== filing.reportDate) {
      return { value: null, reason: `${noStatement}; the ${where} balance sheet is not at the deck's balance-sheet date (${mdy(opts.balanceSheetAsOf)})` };
    }
    const bs = balanceSheetProof(xml, await readPre(cik, filing), filing.reportDate);
    if (bs.zero) {
      return {
        value: 0,
        label: `$0, no borrowings on the balance sheet; liabilities tie to total, ${where}`,
        basis: 'balance sheet',
        source: { form: filing.form, accn: filing.accn, filed: filing.filed, asOf: filing.reportDate, role: bs.role, lines: bs.lines, subtotals: bs.subtotals, totalLiabilities: bs.total, decimals: bs.decimals },
      };
    }
    return { value: null, reason: `${noStatement}; the balance sheet does not prove zero: ${bs.why}` };
  } catch (e) {
    console.error(`[debtZero] CIK ${cik}: ${e.message}`);
    return { value: null, reason: 'the filings could not be read to confirm the debt' };
  }
}

// /quote's debt for a GAAP filer, in one place. A resolved debt figure always wins and the zero check never runs; only a
// null runs it. → { debt, label, reason, source }: debt is the resolved figure, 0 by a filing's proof, or null.
async function finalDebt(debtResolved, cik, gaap, floorEnd, opts = {}, deps = {}) {
  if (debtResolved != null) return { debt: debtResolved, label: null, reason: null, source: null };
  const z = await resolveZeroDebt(cik, gaap, floorEnd, deps, opts);
  return z.value === 0
    ? { debt: 0, label: z.label, reason: null, source: z.source }
    : { debt: null, label: null, reason: z.reason, source: null };
}

module.exports = { DEBT_CONCEPTS, nonZeroDebtFacts, nothingDrawnStatement, noteNumber, filedZero, classifyLiability, balanceSheetTree, balanceSheetProof, resolveZeroDebt, finalDebt };
