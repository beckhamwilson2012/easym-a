'use strict';
// server/services/ltmEps.js — LTM diluted EPS as the sum of FILED per-share figures covering the last four quarters, and the
// EPS numerator (net income attributable to common stockholders) the pro forma math must use beside it.
//
// LTM EPS is never LTM net income ÷ a share count. It is the latest interim YTD diluted EPS as filed (10-Q), plus the prior
// fiscal year's remaining quarters as filed. A filer's Q4 is almost never in XBRL; it is read from the fiscal-year earnings
// release (8-K item 2.02, EX-99), three-month column, and accepted only when the SAME row's full-year figure equals the
// 10-K's filed diluted EPS. HNGE: Q4 2025 $0.37 (release 0001628280-26-006826) + 9M 2026 $1.58 (10-Q) = $1.95.
// Any leg missing → null with the reason.

const { parseTables, splitRow, rowColumns, isFullYearText } = require('./nonGaapTables');

const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const EPS_CONCEPTS = ['EarningsPerShareDiluted'];
const TO_COMMON = ['NetIncomeLossAvailableToCommonStockholdersDiluted', 'NetIncomeLossAvailableToCommonStockholdersBasic'];
const NON_GAAP = /non-?gaap|adjusted|core|comparable|pro\s*forma/i;
const QUARTER_TEXT = /three\s+months|fourth\s+quarter|\bq4\b|quarter\s+ended|1[2-7]\s+weeks/i;
const r2 = (v) => Math.round(v * 100) / 100;

function durations(ns, concepts, unit) {
  const out = [];
  for (const c of concepts) for (const e of (ns[c]?.units?.[unit] || [])) if (e.start && /^10-[KQ]/.test(e.form || '')) out.push({ ...e, concept: c });
  return out;
}
// The latest-filed value for exactly [start, end] (±3 days), or null.
function valueFor(entries, start, end) {
  const hit = entries.filter((e) => Math.abs(days(e.start, start)) <= 3 && Math.abs(days(e.end, end)) <= 3)
    .sort((a, b) => (b.filed || '').localeCompare(a.filed || ''))[0];
  return hit || null;
}

// Pure: the filed legs from companyfacts. periods = ltmCalc's { annual, latestInterim, priorInterim }.
// Returns { ytd, priorQuarters: [...], q4: entry|null, q4Window } or { reason }.
function filedEpsLegs(ns, periods) {
  const eps = durations(ns, EPS_CONCEPTS, 'USD/shares');
  if (!eps.length) return { reason: 'no diluted EPS is tagged' };
  const { annual, latestInterim: li, priorInterim: pi } = periods;
  const ytd = valueFor(eps, li.start, li.end);
  if (!ytd) return { reason: `no filed diluted EPS for ${li.start} – ${li.end}` };
  // Prior fiscal year's quarters after the prior YTD end: 3-month entries in (pi.end, annual.end].
  const quarters = eps.filter((e) => days(e.end, e.start) >= 80 && days(e.end, e.start) <= 100
    && e.start > pi.end && e.end <= annual.end)
    .sort((a, b) => a.end.localeCompare(b.end));
  const byEnd = {};
  for (const q of quarters) if (!byEnd[q.end] || (q.filed || '') > (byEnd[q.end].filed || '')) byEnd[q.end] = q;
  const q4 = byEnd[annual.end] || null;
  const priorQuarters = Object.values(byEnd).filter((q) => q.end !== annual.end);
  // How many quarters the YTD covers (1–3) → how many prior-year quarters are needed (3–1), Q4 included.
  const ytdQuarters = Math.round(days(li.end, li.start) / 91);
  const needed = 4 - ytdQuarters;
  if (priorQuarters.length !== needed - 1) return { reason: `the prior year's quarters after ${pi.end} are not all filed (${priorQuarters.length} of ${needed - 1})` };
  return { ytd, ytdQuarters, priorQuarters, q4, annualEnd: annual.end };
}

// Pure: Q4 diluted EPS from the fiscal-year release, tied to the filed full-year EPS. { value, row, table } or { reason }.
function releaseQuarterEps(html, { fyEndYear, fyEps }) {
  // Layouts, each pinned by a filer: quarter and year columns in one table (HNGE); quarter and year in two tables with the
  // same row label (KO tables 19/20); "Diluted" as a value-less header row above the per-share row (PEP). The year figure
  // of the SAME row label must equal the 10-K's filed diluted EPS, or nothing is taken.
  const PER_SHARE = /per\s+(common\s+)?share|\beps\b/i;
  const quarters = [], years = [];
  for (const t of parseTables(html)) {
    t.rows.forEach((cells, ri) => {
      const { label, values } = splitRow(cells);
      if (!values.length || values.every((v) => v.value == null)) return;
      const above = t.rows.slice(Math.max(0, ri - 3), ri).map((r) => splitRow(r)).reverse();
      const headers = above.filter((x) => x.label && x.values.every((v) => v.value == null));
      const header = headers[0] || null;
      const diluted = /diluted/i.test(label) || (header && /diluted/i.test(header.label) && !/basic/i.test(header.label));
      // Per share from the row's own label, else its NEAREST header; a share-count block ("Weighted average shares used in
      // computing … per share", HNGE's second "Diluted" row, 84,533) is never an EPS row.
      const SHARE_COUNT = /weighted|shares\s+used|number\s+of\s+shares/i;
      const perShare = PER_SHARE.test(label) ? !SHARE_COUNT.test(label)
        : !!(header && PER_SHARE.test(header.label) && !SHARE_COUNT.test(header.label));
      if (!diluted || !perShare) return;
      if (NON_GAAP.test(label.replace(/^GAAP\b/i, '')) || headers.some((x) => NON_GAAP.test(x.label.replace(/^GAAP\b/i, '')))) return;
      const cols = rowColumns(t.rows, ri);
      if (!cols || cols.length < values.length) return;
      const key = normLabel(label);
      values.forEach((v, i) => {
        const c = cols[i];
        if (v.value == null || !c || c.year !== fyEndYear || !c.period) return;
        if (isFullYearText(c.period)) years.push({ key, value: v.value, table: t.index });
        else if (QUARTER_TEXT.test(c.period)) quarters.push({ key, value: v.value, table: t.index, row: label });
      });
    });
  }
  const tied = new Set(years.filter((y) => Math.abs(y.value - fyEps) <= 0.005).map((y) => y.key));
  const cands = quarters.filter((q) => tied.has(q.key));
  if (cands.length) {
    if (cands.some((c) => c.value !== cands[0].value)) return { reason: 'the release prints two different Q4 diluted EPS figures' };
    return cands[0];
  }
  // No table carries a per-share row at all (IRDM): the release's own sentence, exact wording only.
  if (!quarters.length && !years.length) {
    const hits = proseQuarterEps(html, fyEndYear);
    if (hits.length && hits.every((h) => h === hits[0])) {
      return { value: hits[0], row: `release text: "$${hits[0].toFixed(2)} per diluted share, for the fourth quarter of ${fyEndYear}"`, table: null };
    }
  }
  return { reason: `no GAAP diluted EPS row in the release with a ${fyEndYear} quarter figure whose full-year figure ties to the filed FY EPS ${fyEps}` };
}

const normLabel = (l) => String(l).toLowerCase().replace(/\(\d+\)|\d+$/g, '').replace(/[^a-z]+/g, ' ').trim();
function proseQuarterEps(html, year) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&#160;|&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const re = new RegExp(`\\$\\s?(\\(?-?\\d+\\.\\d{2}\\)?) per diluted share,? for the fourth quarter of ${year}\\b`, 'gi');
  return [...text.matchAll(re)].map((m) => Number(m[1].replace(/[()-]/g, '')) * (/[(-]/.test(m[1]) ? -1 : 1));
}

const qLabel = (end) => { const m = Number(end.slice(5, 7)); return `${end.slice(0, 4)}-${String(m).padStart(2, '0')}`; };

// LTM EPS from filed legs. readRelease() → { html, accession } | null, called only when Q4 is not in companyfacts.
// Returns { value, label, legs } or { value: null, reason }.
async function resolveLtmEps(ns, periods, { fyEps, readRelease }) {
  const legs = filedEpsLegs(ns, periods);
  if (legs.reason) return { value: null, reason: legs.reason };
  let q4 = legs.q4 ? { value: legs.q4.val, source: `${legs.q4.form} ${legs.q4.accn}` } : null;
  if (!q4) {
    if (fyEps == null) return { value: null, reason: 'no filed FY diluted EPS to tie the release Q4 to' };
    const rel = readRelease ? await readRelease() : null;
    if (!rel || !rel.html) return { value: null, reason: `Q4 ending ${legs.annualEnd} is not in XBRL and the fiscal-year earnings release could not be read${rel && rel.reason ? ` (${rel.reason})` : ''}` };
    const r = releaseQuarterEps(rel.html, { fyEndYear: Number(legs.annualEnd.slice(0, 4)), fyEps });
    if (r.reason) return { value: null, reason: `Q4: ${r.reason} (release ${rel.accession})` };
    q4 = { value: r.value, source: `FY release 8-K ${rel.accession}, "${r.row}"` };
  }
  const parts = [...legs.priorQuarters.map((q) => ({ period: `quarter to ${q.end}`, value: q.val, source: `${q.form} ${q.accn}` })),
    { period: `quarter to ${legs.annualEnd}`, value: q4.value, source: q4.source },
    { period: `${legs.ytdQuarters * 3} months to ${legs.ytd.end}`, value: legs.ytd.val, source: `${legs.ytd.form} ${legs.ytd.accn}` }];
  const value = r2(parts.reduce((s, p) => s + p.value, 0));
  const usd = (v) => `${v < 0 ? '(' : ''}$${Math.abs(v).toFixed(2)}${v < 0 ? ')' : ''}`;
  const label = `sum of 4 filed quarters: ${parts.map((p) => `${p.period} ${usd(p.value)}`).join(' + ')}`;
  return { value, label, legs: parts };
}

// Pure: the EPS numerator. FY: net income attributable to common stockholders (diluted, else basic) at exactly the fiscal year
// [start, end], or null (→ the caller keeps net income). A tag from another year never counts (IRDM 2019, TDOC 2016).
function epsNumeratorAt(ns, end) {
  if (!end) return null;
  const e = durations(ns, TO_COMMON, 'USD').filter((x) => /^10-K/.test(x.form) && Math.abs(days(x.end, end)) <= 3 && days(x.end, x.start) >= 350 && days(x.end, x.start) <= 380)
    .sort((a, b) => TO_COMMON.indexOf(a.concept) - TO_COMMON.indexOf(b.concept) || (b.filed || '').localeCompare(a.filed || ''))[0];
  return e ? { value: e.val, concept: e.concept, form: e.form, accn: e.accn } : null;
}
// LTM numerator: the same three legs as LTM net income, on the to-common concept. All three or null.
function ltmEpsNumerator(ns, periods) {
  const { annual, latestInterim: li, priorInterim: pi } = periods;
  for (const c of TO_COMMON) {
    const ent = durations(ns, [c], 'USD');
    const a = valueFor(ent, annual.start, annual.end), y = valueFor(ent, li.start, li.end), p = valueFor(ent, pi.start, pi.end);
    if (a && y && p) return { value: a.val + y.val - p.val, concept: c };
  }
  return null;
}

module.exports = { filedEpsLegs, releaseQuarterEps, resolveLtmEps, epsNumeratorAt, ltmEpsNumerator };
