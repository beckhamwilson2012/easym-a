'use strict';
// server/services/debtZero.js — total debt that is ZERO, as opposed to unknown. Runs only when the shared resolver
// (debtConcepts + the /quote tails) found no debt at the balance-sheet anchor.
//
// "The company has no debt" is a claim, so it needs a filing that makes it. Two sources count, nothing else:
//   A. A filed 0 for a debt concept that no later filing contradicts. OMDA tags LongTermDebt = 0 at 2025-12-31 in its
//      FY2025 10-K and tags no debt in its 2026 10-Qs; the interim anchor (2026-09-30) used to turn that into null.
//   B. The latest 10-K/10-Q's debt note says nothing is drawn. PGNY's Q3 2026 10-Q, note 6: "As of the date of this
//      filing, no amounts were drawn under the Facility."
// Either way the latest filing's own instance must carry no non-zero debt fact at its balance-sheet date (any dimension).
// No debt concept and no filed statement of zero stays null with the reason. Absence is never read as zero: HNGE tags no
// debt concept and its filings contain no debt note, so it stays "—".

const { latestPeriodicFiling, readInstanceXml, readPrimaryDocument, readSubmissions, parseContexts, numericFacts } = require('./filingInstance');

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
      const sentence = text.split(/(?<=\.)\s+(?=[A-Z])/).find((s) => NOTHING_DRAWN.some((re) => re.test(s)));
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

// The one entry point. Returns { value: 0, label, basis, source } or { value: null, reason }. Never throws.
async function resolveZeroDebt(cik, gaap, floorEnd, deps = {}) {
  const readSub = deps.readSubmissions || readSubmissions;
  const readXml = deps.readInstanceXml || readInstanceXml;
  const readDoc = deps.readPrimaryDocument || readPrimaryDocument;
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
    return { value: null, reason: `${z.reason}, and no filing states zero debt (checked through the ${where})` };
  } catch (e) {
    console.error(`[debtZero] CIK ${cik}: ${e.message}`);
    return { value: null, reason: 'the filings could not be read to confirm the debt' };
  }
}

module.exports = { DEBT_CONCEPTS, nonZeroDebtFacts, nothingDrawnStatement, noteNumber, filedZero, resolveZeroDebt };
