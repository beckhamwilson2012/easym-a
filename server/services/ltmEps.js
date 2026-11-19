'use strict';
// server/services/ltmEps.js — LTM diluted EPS as the sum of FILED per-share figures covering the last four quarters, and the
// EPS numerator (net income attributable to common stockholders) the pro forma math must use beside it.
//
// LTM EPS is never LTM net income ÷ a share count. It is the latest interim YTD diluted EPS as filed (10-Q), plus the prior
// fiscal year's remaining quarters as filed. A filer's Q4 is almost never in XBRL; it is read from the fiscal-year earnings
// release (8-K item 2.02, EX-99), three-month column, and accepted only when the SAME row's full-year figure equals the
// 10-K's filed diluted EPS. HNGE: Q4 2025 $0.37 (release 0001628280-26-006826) + 9M 2026 $1.58 (10-Q) = $1.95.
// Any leg missing → null with the reason.
//
// Fix 22/23 order, one reader:
//   (a) the sum of four filed quarters, above (unchanged for every company it resolves);
//   (b) otherwise the standard LTM, every figure filed diluted EPS: the fiscal year (10-K) + the current year-to-date (latest
//       10-Q) − the prior-year year-to-date, taken from the comparative column of that SAME 10-Q (it may be restated);
//       periods matched by start and end dates, never by labels;
//   (c) otherwise null with both reasons. A stock split or a restated share count inside the window also gives null.
//   EPS is never computed from net income ÷ shares.

const { parseTables, splitRow, rowColumns, isFullYearText } = require('./nonGaapTables');

const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const EPS_CONCEPTS = ['EarningsPerShareDiluted'];
const TO_COMMON = ['NetIncomeLossAvailableToCommonStockholdersDiluted', 'NetIncomeLossAvailableToCommonStockholdersBasic'];
const NON_GAAP = /non-?gaap|adjusted|core|comparable|pro\s*forma/i;
const QUARTER_TEXT = /three\s+months|fourth\s+quarter|\bq4\b|quarter\s+ended|1[2-7]\s+weeks/i;
// A per-share row that names net income but not "diluted". PRU prints "Net income (loss) attributable to Prudential Financial,
// Inc." under "Earnings per share of Common Stock:"; MET prints "Net income (loss) per share" and defines it as per diluted share.
const NET_INCOME_ROW = /\bnet\s+(income|earnings|\(?loss\)?)/i;
const r2 = (v) => Math.round(v * 100) / 100;
const usd = (v) => `${v < 0 ? '(' : ''}$${Math.abs(v).toFixed(2)}${v < 0 ? ')' : ''}`;
// Comparability checks for (b). FY − prior YTD is only a quarter's EPS when both are per-share on about the same share count.
//   • any non-zero split fact dated inside the window;
//   • a diluted share count for one of the three periods that two filings report more than 20% apart (a retroactive split);
//   • the three periods' diluted share counts more than 20% apart from each other (an IPO, a split, a large issuance):
//     VIA, IPO September 2025, averaged 16.8M diluted shares over 9M 2025, 32.9M over FY2025 and 81.4M over 9M 2026, and
//     FY + YTD − prior YTD gives +$0.79 for a loss-making company;
//   • no filed diluted share count for one of the periods, so comparability cannot be confirmed.
// Each gives null with the reason. The counts are only checked, never used in the figure.
const SPLIT_CONCEPTS = ['StockholdersEquityNoteStockSplitConversionRatio1', 'StockholdersEquityNoteStockSplitConversionRatio', 'StockIssuedDuringPeriodSharesStockSplits'];
const DILUTED_SHARES = ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted'];
const SHARE_SPREAD = 1.2;

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
  const unnamed = [];   // net income per-share rows that do not say "diluted": { value (Q4), year (full year) }, one per row
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
      if (!perShare) return;
      if (!diluted && (!NET_INCOME_ROW.test(label) || /basic/i.test(label))) return;
      if (NON_GAAP.test(label.replace(/^GAAP\b/i, '')) || headers.some((x) => NON_GAAP.test(x.label.replace(/^GAAP\b/i, '')))) return;
      const cols = rowColumns(t.rows, ri);
      if (!cols || cols.length < values.length) return;
      if (!diluted) {
        const at = (test) => values.find((v, i) => v.value != null && cols[i] && cols[i].year === fyEndYear && cols[i].period && test(cols[i].period));
        const q = at((p) => !isFullYearText(p) && QUARTER_TEXT.test(p)), y = at(isFullYearText);
        if (q && y) unnamed.push({ value: q.value, year: y.value, row: label });
        return;
      }
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
  // No row says "diluted" and ties: a net income per-share row counts only when its OWN full-year figure is the 10-K's filed
  // diluted EPS. That tie is what makes it the diluted figure (PRU: 9.99 diluted against 10.05 basic). Same row, as filed.
  const tiedRows = unnamed.filter((r) => Math.abs(r.year - fyEps) <= 0.005);
  if (tiedRows.length) {
    if (tiedRows.some((r) => r.value !== tiedRows[0].value)) return { reason: 'the release prints two different Q4 diluted EPS figures' };
    return { value: tiedRows[0].value, row: tiedRows[0].row, table: null };
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
// (b) Pure: FY + current YTD − prior YTD, all filed diluted EPS. { value, label, legs } or { value: null, reason }.
function standardLtmEps(ns, periods) {
  const { annual, latestInterim: li, priorInterim: pi } = periods;
  if (!annual?.start || !li?.start || !pi?.start) return { value: null, reason: 'the LTM periods are not dated' };
  const eps = durations(ns, EPS_CONCEPTS, 'USD/shares');
  if (!eps.length) return { value: null, reason: 'no diluted EPS is tagged' };
  const fy = valueFor(eps.filter((e) => /^10-K/.test(e.form)), annual.start, annual.end);
  if (!fy) return { value: null, reason: `no filed FY diluted EPS for ${annual.start} – ${annual.end}` };
  const ytd = valueFor(eps.filter((e) => /^10-Q/.test(e.form)), li.start, li.end);
  if (!ytd) return { value: null, reason: `no filed year-to-date diluted EPS for ${li.start} – ${li.end}` };
  const prior = valueFor(eps.filter((e) => e.accn === ytd.accn), pi.start, pi.end);
  if (!prior) return { value: null, reason: `the latest 10-Q (${ytd.accn}) files no prior-year diluted EPS for ${pi.start} – ${pi.end}` };
  const from = annual.start, to = li.end;
  for (const c of SPLIT_CONCEPTS) {
    for (const e of Object.values(ns[c]?.units || {}).flat()) {
      if (e.val && e.end >= from && e.end <= to) return { value: null, reason: `a stock split is filed inside the LTM window (${c} ${e.val}, ${e.end})` };
    }
  }
  // The first share concept that is filed for all three periods (latest filing of each), as with the EPS legs.
  const count = (c, p) => valueFor(durations(ns, [c], 'shares'), p.start, p.end);
  const concept = DILUTED_SHARES.find((c) => [annual, li, pi].every((p) => count(c, p)));
  if (!concept) return { value: null, reason: 'no diluted share count is filed for all three periods, so FY and YTD EPS cannot be confirmed comparable' };
  for (const p of [annual, li, pi]) {
    // A count tagged in thousands in one filing (ECHO: 287,362 and 287,362,000 for the same nine months) is a unit difference,
    // not a restatement: each value is put on the latest filing's scale by a power of 1,000 before comparing.
    const filed = durations(ns, [concept], 'shares').filter((e) => Math.abs(days(e.start, p.start)) <= 3 && Math.abs(days(e.end, p.end)) <= 3);
    const ref = count(concept, p).val;
    const v = filed.map((e) => { let x = e.val; while (x > 0 && x * 1000 <= ref * 1.5) x *= 1000; while (x / 1000 >= ref / 1.5) x /= 1000; return x; });
    if (Math.max(...v) > SHARE_SPREAD * Math.min(...v)) {
      return { value: null, reason: `the diluted share count for ${p.start} – ${p.end} is filed both as ${Math.min(...v).toLocaleString('en-US')} and ${Math.max(...v).toLocaleString('en-US')} (a split or share-class change)` };
    }
  }
  const [sFy, sYtd, sPrior] = [annual, li, pi].map((p) => count(concept, p).val);
  if (Math.max(sFy, sYtd, sPrior) > SHARE_SPREAD * Math.min(sFy, sYtd, sPrior)) {
    const m = (v) => `${(v / 1e6).toFixed(1)}M`;
    return { value: null, reason: `diluted shares moved inside the window (FY ${m(sFy)}, YTD ${m(sYtd)}, prior YTD ${m(sPrior)}), so FY and YTD EPS are not comparable` };
  }
  const value = r2(fy.val + ytd.val - prior.val);
  const months = Math.round(days(li.end, li.start) / 30.44);
  const label = `LTM EPS = FY${annual.end.slice(2, 4)} + ${months}M YTD − prior YTD (filed): ${usd(fy.val)} + ${usd(ytd.val)} − ${usd(prior.val)}`;
  return { value, label, legs: [
    { period: `fiscal year to ${annual.end}`, value: fy.val, source: `${fy.form} ${fy.accn}` },
    { period: `${months} months to ${li.end}`, value: ytd.val, source: `${ytd.form} ${ytd.accn}` },
    { period: `less ${months} months to ${pi.end} (comparative)`, value: -prior.val, source: `${prior.form} ${prior.accn}` },
  ] };
}

// (a), then (b): the one LTM EPS. Both reasons are kept when neither resolves.
async function resolveLtmEps(ns, periods, opts) {
  const a = await quarterSumLtmEps(ns, periods, opts);
  if (a.value != null) return a;
  const b = standardLtmEps(ns, periods);
  if (b.value != null) return b;
  return { value: null, reason: `four filed quarters: ${a.reason}; FY + YTD − prior YTD: ${b.reason}` };
}

async function quarterSumLtmEps(ns, periods, { fyEps, readRelease }) {
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

module.exports = { filedEpsLegs, releaseQuarterEps, resolveLtmEps, standardLtmEps, epsNumeratorAt, ltmEpsNumerator };
