'use strict';
// Company-reported non-GAAP figures, read from the HTML tables of a fiscal-year-end earnings exhibit
// (8-K item 2.02, EX-99.1). Tables only: prose paragraphs are never read. No model is called.
//
// What it returns, per figure: the value, the period, the company's own row label, the 8-K accession,
// and the tie-out (GAAP line, each adjustment, the non-GAAP total) from the filed numbers. A figure is
// returned only when reconcileCheck() — the one reconcile check in the app — says the filed rows add
// up. Otherwise the figure is null and the reason says why ("reconciliation doesn't tie: <residual>").
//
// Two table layouts are read:
//   row-oriented — periods are columns, the GAAP line / adjustments / non-GAAP total are rows (NET, DDOG,
//                  RKLB, IRDM);
//   transposed   — one table section per period, measures are columns, and "Reported (GAAP)" /
//                  adjustment rows / "Comparable (Non-GAAP)" are rows (KO, PEP).
// Only the full-year column whose period ends in the deck's fiscal year is used.

// ── The reconcile check (moved here unchanged from server.js so the table reader and the older
// extractor share ONE copy): gaap + sum(adjustments) ≈ nonGaap within a unit-aware tolerance.
function reconcileCheck(line) {
  const gaap = parseFloat(line.gaap);
  const nonGaap = parseFloat(line.nonGaap);
  const adj = Array.isArray(line.adjustments) ? line.adjustments : [];
  const sumAdj = adj.reduce((s, a) => s + (parseFloat(a && a.value) || 0), 0);
  const computed = gaap + sumAdj;
  const residual = Math.round((nonGaap - computed) * 1000) / 1000;
  const unit = (line.unit || '').toLowerCase();
  const tolerance = /per.?share|eps/.test(unit) ? 0.02 : /percent|%/.test(unit) ? 0.15 : 2.0; // cent for EPS, ~0.1pp, ~$2M
  const reconciles = Number.isFinite(gaap) && Number.isFinite(nonGaap) && Math.abs(residual) <= tolerance;
  return { reconciles, residual, computed: Math.round(computed * 100) / 100, tolerance };
}

// ── HTML → tables ─────────────────────────────────────────────────────────────────────────────────
function decode(s) {
  return s
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/&amp;|&#38;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;|&rsquo;|&lsquo;|&#8217;|&#8216;/g, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"').replace(/&mdash;|&#8212;/g, '—').replace(/&ndash;|&#8211;/g, '–')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, ' ');
}
const cellText = (h) => decode(h.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const stripText = (h) => decode(h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

const UNIT_RE = /\(?\s*(?:\$|dollars|amounts)?\s*in\s+(thousands|millions|billions)\b/gi;
function lastUnit(text) {
  let m, last = null;
  UNIT_RE.lastIndex = 0;
  while ((m = UNIT_RE.exec(text))) last = m[1].toLowerCase();
  return last;
}

// Every <table> as rows of non-empty cells {col, text}; `col` is the grid column after colspans.
function parseTables(html) {
  const out = [];
  const re = /<table[\s\S]*?<\/table>/gi;
  let m, prevEnd = 0;
  while ((m = re.exec(html))) {
    const rows = [];
    for (const r of m[0].match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      let col = 0; const cells = [];
      for (const c of r.matchAll(/<t([dh])([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
        const span = parseInt((c[2].match(/colspan\s*=\s*"?(\d+)/i) || [])[1] || '1', 10);
        const text = cellText(c[3]);
        if (text) cells.push({ col, text });
        col += span;
      }
      if (cells.length) rows.push(cells);
    }
    // Unit: stated inside the table, else the last statement in the text since the previous table.
    const inside = lastUnit(rows.map(r => r.map(c => c.text).join(' ')).join(' '));
    const before = lastUnit(stripText(html.slice(Math.max(prevEnd, m.index - 6000), m.index)));
    out.push({ index: out.length, rows, unit: inside || before || null });
    prevEnd = m.index + m[0].length;
  }
  return out;
}

// ── Row → label + value groups ────────────────────────────────────────────────────────────────────
const NUM_RE = /^\$?\s*\(?\s*\$?\s*-?\s*[\d,]*\.?\d+\s*\)?\s*%?\s*\)?$/;
const DASH_RE = /^[—–-]+\s*%?$/;
const isNumCell = (t) => NUM_RE.test(t) && /\d/.test(t);
const isFragment = (t) => /^[$)%]+$/.test(t) || /^\)\s*%$/.test(t);

function parseNumber(t) {
  if (DASH_RE.test(t.trim())) return 0; // a filed dash is a filed zero
  const neg = /\(/.test(t) || /^\s*-/.test(t.replace(/^\$\s*/, ''));
  const n = parseFloat(t.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

// Label = leading text cells; values = the cells after it, with "$" / ")" / "%" fragments merged
// into the number they belong to. Each value keeps the grid column where its group starts.
function splitRow(cells) {
  let i = 0; const labelParts = [];
  while (i < cells.length && !isNumCell(cells[i].text) && !DASH_RE.test(cells[i].text) && !isFragment(cells[i].text)) {
    labelParts.push(cells[i].text); i++;
  }
  const values = []; let pendingStart = null;
  for (; i < cells.length; i++) {
    const t = cells[i].text;
    if (t === '$') { pendingStart = cells[i].col; continue; }
    if (isFragment(t)) {
      if (values.length) { values[values.length - 1].raw += t; if (/\)/.test(t)) values[values.length - 1].value = -Math.abs(values[values.length - 1].value); }
      continue;
    }
    if (isNumCell(t) || DASH_RE.test(t)) {
      values.push({ col: pendingStart != null ? pendingStart : cells[i].col, raw: t, value: parseNumber(t) });
      pendingStart = null; continue;
    }
    // A text cell after the numbers starts (n/m, a footnote word) — keep its slot so counts stay honest.
    values.push({ col: pendingStart != null ? pendingStart : cells[i].col, raw: t, value: null });
    pendingStart = null;
  }
  return { label: labelParts.join(' ').trim(), values };
}

// ── Periods ───────────────────────────────────────────────────────────────────────────────────────
const FULL_YEAR_RE = /\b(fiscal\s+years?|years?|twelve\s+months|12\s+months|full[\s-]year|5[23]\s+weeks)\b(\s+ended)?/i;
const PART_YEAR_RE = /\b(three|six|nine|quarter|fourth\s+quarter|1[2-7]\s+weeks|q[1-4])\b/i;
const PERIOD_RE = /\b(three|six|nine|twelve|12)\s+months|quarters?\s+ended|years?\s+ended|fiscal\s+year|full[\s-]year|fourth\s+quarter|weeks\s+ended/i;
const yearIn = (t) => { const m = String(t).match(/\b(19|20)\d{2}\b/g); return m ? Number(m[m.length - 1]) : null; };
const isFullYearText = (t) => FULL_YEAR_RE.test(t) && !PART_YEAR_RE.test(t);

// Row-oriented column model for a table: the year row (≥2 cells carrying a year) gives the columns in
// order; the period row above it (if any) groups them. Returns [{year, period}] or null.
function rowColumns(rows, beforeRow) {
  let yr = -1;
  for (let r = beforeRow - 1; r >= 0; r--) {
    const cells = rows[r];
    const withYear = cells.filter(c => yearIn(c.text) != null);
    const numericNonYear = cells.filter(c => isNumCell(c.text) && !/^(19|20)\d{2}$/.test(c.text.trim()));
    if (withYear.length >= 2 && numericNonYear.length === 0) { yr = r; break; }
  }
  if (yr < 0) return null;
  let cols = rows[yr].filter((c, i) => !(i === 0 && c.col === 0 && yearIn(c.text) == null && !PERIOD_RE.test(c.text)));
  cols = cols.map(c => ({ col: c.col, year: yearIn(c.text), text: c.text }));
  let groups = null;
  for (let r = yr - 1; r >= Math.max(0, yr - 3); r--) {
    const g = rows[r].filter(c => PERIOD_RE.test(c.text));
    if (g.length) { groups = g; break; }
  }
  return cols.map((c, i) => {
    let period = PERIOD_RE.test(c.text) ? c.text : null;
    if (!period && groups) {
      if (groups.length === cols.length) period = groups[i].text;
      else if (cols.length % groups.length === 0) period = groups[Math.floor(i / (cols.length / groups.length))].text;
      else period = (groups.filter(g => g.col <= c.col).pop() || groups[0]).text;
    }
    return { year: c.year, period, text: c.text };
  });
}

// ── Block readers ─────────────────────────────────────────────────────────────────────────────────
const TAX_ROW_RE = /income\s+tax|tax\s+effect/i;

// Sum check with the one reconcile check. A tax-effect row printed with no sign is read as printed
// first; only if that fails is its negative tried (DDOG prints its tax provision unsigned and subtracts
// it). Exactly one such row may be re-signed, and only an exact tie is accepted. Recorded in the tie-out.
function tieOut({ gaap, adjustments, total, unit }) {
  const line = { gaap: gaap.value, adjustments: adjustments.map(a => ({ label: a.label, value: a.value })), nonGaap: total.value, unit };
  let chk = reconcileCheck(line);
  let resigned = null;
  if (!chk.reconciles) {
    const unsignedTax = adjustments.map((a, i) => ({ a, i })).filter(({ a }) => TAX_ROW_RE.test(a.label) && a.value > 0 && !/\(|-/.test(a.raw || ''));
    if (unsignedTax.length === 1) {
      const { i } = unsignedTax[0];
      const flipped = { ...line, adjustments: line.adjustments.map((x, j) => j === i ? { ...x, value: -x.value } : x) };
      const c2 = reconcileCheck(flipped);
      if (c2.reconciles && c2.residual === 0) { chk = c2; resigned = adjustments[i].label; line.adjustments = flipped.adjustments; }
    }
  }
  return {
    reconciles: chk.reconciles, residual: chk.residual, tolerance: chk.tolerance, computed: chk.computed,
    gaap: { label: gaap.label, value: gaap.value },
    adjustments: line.adjustments,
    nonGaap: { label: total.label, value: total.value },
    resignedTaxRow: resigned, // label of the tax row read as a deduction because it was printed unsigned, else null
  };
}

const hasValues = (sr) => sr.values.some(v => v.value != null);

// Row-oriented: find `total` rows matching isTotal, walk up to the nearest anchor row (isAnchor), and
// take every valued row in between as an adjustment (subtotals matching isSubtotal are skipped).
function rowBlocks(table, fy, { isTotal, isAnchor, isSubtotal = () => false, unit }) {
  const out = [];
  const rows = table.rows.map(splitRow);
  rows.forEach((sr, t) => {
    if (!sr.label || !isTotal(sr.label) || !hasValues(sr)) return;
    let a = -1;
    for (let r = t - 1; r >= 0; r--) { if (isAnchor(rows[r].label) && hasValues(rows[r])) { a = r; break; } }
    if (a < 0) return;
    const cols = rowColumns(table.rows, a);
    const base = { table: table.index, layout: 'row', totalLabel: sr.label, anchorLabel: rows[a].label };
    if (!cols) { out.push({ ...base, error: `table ${table.index}: no period header row` }); return; }
    const ci = cols.findIndex(c => c.year === fy && c.period && isFullYearText(c.period));
    if (ci < 0) { out.push({ ...base, error: `no full-year column for FY${fy} (table ${table.index} columns: ${cols.map(c => `${c.period || '?'} ${c.year || ''}`.trim()).join(' / ')})` }); return; }
    const pick = (row) => (row.values.length === cols.length ? row.values[ci] : null);
    const g = pick(rows[a]); const tot = pick(sr);
    if (!g || g.value == null || !tot || tot.value == null) { out.push({ ...base, error: `table ${table.index}: GAAP or non-GAAP row does not align with its ${cols.length} period columns` }); return; }
    const adjustments = []; let misaligned = null;
    for (let r = a + 1; r < t; r++) {
      const row = rows[r];
      if (!hasValues(row) || isSubtotal(row.label)) continue;
      const v = pick(row);
      if (!v || v.value == null) { misaligned = row.label || `row ${r}`; break; }
      adjustments.push({ label: row.label, value: v.value, raw: v.raw });
    }
    if (misaligned) { out.push({ ...base, error: `table ${table.index}: adjustment row "${misaligned}" does not align with the period columns` }); return; }
    out.push({
      ...base, period: `${cols[ci].period} ${cols[ci].text}`.replace(/\s+/g, ' ').trim(), columnIndex: ci,
      tie: tieOut({ gaap: { label: rows[a].label, value: g.value }, adjustments, total: { label: sr.label, value: tot.value }, unit }),
    });
  });
  return out;
}

// Transposed: a period heading row, a row of measure names, then Reported (GAAP) / adjustments /
// non-GAAP rows. The measure column is located in the GAAP row by position.
const T_ANCHOR = (l) => /^reported\b/i.test(l) && /gaap/i.test(l) && !/%|change/i.test(l);
const T_TOTAL = (l) => /non-?gaap/i.test(l) && /^(comparable|core|adjusted|non-?gaap)\b/i.test(l) && !/%|change|constant currency/i.test(l);
function transposedBlocks(table, fy, { isMeasure, unit }) {
  const out = [];
  const rows = table.rows.map(splitRow);
  rows.forEach((sr, a) => {
    if (!T_ANCHOR(sr.label) || !hasValues(sr)) return;
    let t = -1;
    for (let r = a + 1; r < rows.length; r++) { if (T_ANCHOR(rows[r].label)) break; if (T_TOTAL(rows[r].label)) { t = r; break; } }
    if (t < 0) return;
    let headRow = -1, periodText = null;
    for (let r = a - 1; r >= 0; r--) {
      const texts = table.rows[r].map(c => c.text);
      if (headRow < 0 && texts.length >= 2 && !rows[r].values.some(v => v.value != null)) headRow = r;
      const p = texts.find(x => PERIOD_RE.test(x) && yearIn(x) != null);
      if (p) { periodText = p; break; }
    }
    const base = { table: table.index, layout: 'transposed', anchorLabel: sr.label, totalLabel: rows[t].label };
    if (headRow < 0 || !periodText) { out.push({ ...base, error: `table ${table.index}: no period heading or measure row above "${sr.label}"` }); return; }
    if (!(yearIn(periodText) === fy && isFullYearText(periodText))) { out.push({ ...base, period: periodText, error: `not the FY${fy} full-year section (${periodText})` }); return; }
    const measures = table.rows[headRow].map(c => c.text).filter(x => !PERIOD_RE.test(x));
    if (measures.length !== sr.values.length) { out.push({ ...base, error: `table ${table.index}: ${measures.length} measure columns vs ${sr.values.length} GAAP values` }); return; }
    const mi = measures.findIndex(isMeasure);
    if (mi < 0) return;
    const col = sr.values[mi].col;
    const at = (row) => row.values.find(v => v.col === col) || null;
    const tot = at(rows[t]);
    if (!tot || tot.value == null) { out.push({ ...base, error: `table ${table.index}: non-GAAP row has no value under "${measures[mi]}"` }); return; }
    const adjustments = []; let misaligned = null;
    for (let r = a + 1; r < t; r++) {
      if (!hasValues(rows[r])) continue;
      const v = at(rows[r]);
      if (!v || v.value == null) { misaligned = rows[r].label; break; }
      adjustments.push({ label: rows[r].label, value: v.value, raw: v.raw });
    }
    if (misaligned) { out.push({ ...base, error: `table ${table.index}: adjustment row "${misaligned}" has no value under "${measures[mi]}"` }); return; }
    out.push({
      ...base, period: periodText, measure: measures[mi],
      totalLabel: `${rows[t].label} — ${measures[mi]}`,
      tie: tieOut({ gaap: { label: `${sr.label} — ${measures[mi]}`, value: sr.values[mi].value }, adjustments, total: { label: `${rows[t].label} — ${measures[mi]}`, value: tot.value }, unit }),
    });
  });
  return out;
}

// ── Choosing among candidates ─────────────────────────────────────────────────────────────────────
// Tied candidates must agree on the value; otherwise the figure is ambiguous and null.
function choose(cands, what) {
  const tied = cands.filter(c => c.tie && c.tie.reconciles);
  if (tied.length) {
    const vals = [...new Set(tied.map(c => c.tie.nonGaap.value))];
    if (vals.length > 1) return { pick: null, reason: `${what}: ${vals.length} tables tie to different values (${vals.join(', ')}) — not choosing` };
    return { pick: tied[0], reason: null };
  }
  const failed = cands.find(c => c.tie && !c.tie.reconciles);
  if (failed) return { pick: null, reason: `reconciliation doesn't tie: ${failed.tie.residual} (${what}, table ${failed.table}, ${failed.totalLabel})` };
  const err = cands.find(c => c.error);
  if (err) return { pick: null, reason: `${what}: ${err.error}` };
  return { pick: null, reason: null };
}

const SCALE = { thousands: 0.001, millions: 1, billions: 1000 };
const toMillions = (v, unit) => (v == null || !SCALE[unit] ? null : Math.round(v * SCALE[unit] * 1000) / 1000);
const titleIfCaps = (s) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s)
  ? s.toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase()).replace(/\bEbitda\b/g, 'EBITDA').replace(/\bGaap\b/g, 'GAAP')
  : s);
// Footnote markers only: "(1)", "(d)", and a digit glued to a word ("Net income3", "Per Share1").
const cleanLabel = (s) => String(s || '').replace(/\s*\((\d|[a-z])\)/g, '').replace(/([a-z])\d\b/gi, '$1').replace(/\s+/g, ' ').trim();

// ── Matchers for the four figures ─────────────────────────────────────────────────────────────────
const NG_WORD = /non-?gaap|adjusted|core|comparable/i;
const M = {
  epsTotal: (l) => NG_WORD.test(l) && /per\s+(common\s+)?share|\beps\b/i.test(l) && !/basic|before/i.test(l) && !/%|change/i.test(l),
  epsAnchor: (l) => /^gaap\b/i.test(l) && /per\s+(common\s+)?share/i.test(l) && !/basic(?!.*diluted)/i.test(l) && /diluted/i.test(l),
  niTotal: (l) => NG_WORD.test(l) && /net\s+income|net\s+earnings/i.test(l) && !/per\s+share|before|margin|%/i.test(l),
  niSubtotal: (l) => NG_WORD.test(l) && /net\s+income/i.test(l) && /before/i.test(l) && !/per\s+share/i.test(l),
  niAnchor: (l) => /^gaap\b/i.test(l) && /net\s+(income|loss|earnings)/i.test(l) && !/per\s+share|margin|%/i.test(l),
  ebitdaTotal: (l) => /ebitda/i.test(l) && !/margin|%|per\s+share|change/i.test(l),
  ebitdaAnchor: (l) => /\bnet\s+(income|loss|earnings)\b/i.test(l) && !/per\s+share|margin|%|noncontrolling|attributable to non/i.test(l),
  tEps: (m) => /per\s+(common\s+)?share|\beps\b/i.test(m) && !/basic/i.test(m),
  tNi: (m) => /net\s+income/i.test(m) && !/per\s+(common\s+)?share|noncontrolling/i.test(m),
  shares: (l) => /shares/i.test(l) && /dilut/i.test(l) && !/basic/i.test(l),
};

// Diluted share rows anywhere in the exhibit, FY column, with the section heading folded into the
// label (DDOG: "Shares used in non-GAAP net income per share calculations:" → "Diluted").
function shareCandidates(tables, fy) {
  const out = [];
  for (const table of tables) {
    const rows = table.rows.map(splitRow);
    rows.forEach((sr, r) => {
      if (!hasValues(sr)) return;
      // Fold in the nearest section heading (a text-only row) within 3 rows: PEP files "Diluted" as a
      // heading over "Weighted-average common shares outstanding".
      let ctx = sr.label;
      for (let k = r - 1; k >= Math.max(0, r - 3); k--) { if (!hasValues(rows[k]) && rows[k].label) { ctx = `${rows[k].label} ${sr.label}`; break; } }
      if (!M.shares(ctx)) return;
      const cols = rowColumns(table.rows, r);
      if (!cols || sr.values.length !== cols.length) return;
      const ci = cols.findIndex(c => c.year === fy && c.period && isFullYearText(c.period));
      if (ci < 0 || sr.values[ci].value == null || !(sr.values[ci].value > 0)) return;
      out.push({ table: table.index, label: ctx, native: sr.values[ci].value, unit: table.unit, millions: toMillions(sr.values[ci].value, table.unit), nonGaapLabeled: /non-?gaap/i.test(ctx) });
    });
  }
  return out.sort((a, b) => (b.nonGaapLabeled - a.nonGaapLabeled));
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Read the non-GAAP figures from one exhibit.
 * @param {string} html   the EX-99.1 document
 * @param {object} ctx    { fiscalYear (label), fyEndYear (calendar year the FY column ends in), accession, sourceUrl }
 * @returns {{ eps, netIncome, dilutedShares, ebitda, reasons }}  each figure null or
 *   { value, unit, period, fiscalYear, rowLabel, name, accession, label, tieOut, table }
 */
function readNonGaapTables(html, ctx) {
  const fy = ctx.fyEndYear;
  const tables = parseTables(html);
  const label = `non-GAAP, company reported, FY${ctx.fiscalYear}, ${ctx.accession}`;
  const reasons = { eps: null, netIncome: null, dilutedShares: null, ebitda: null };
  const res = { eps: null, netIncome: null, dilutedShares: null, ebitda: null, reasons, tablesRead: tables.length };

  const gather = (rowSpec, tSpec) => tables.flatMap(t => [
    ...rowBlocks(t, fy, { ...rowSpec, unit: rowSpec.unit, }),
    ...(tSpec ? transposedBlocks(t, fy, tSpec) : []),
  ].map(c => ({ ...c, tableUnit: t.unit })));

  const figure = (c, value, unit, extra = {}) => ({
    value, unit, period: c.period, fiscalYear: ctx.fiscalYear, rowLabel: cleanLabel(c.totalLabel),
    name: titleIfCaps(cleanLabel(c.layout === 'transposed' ? c.totalLabel.split(' — ')[0] : c.totalLabel)),
    accession: ctx.accession, sourceUrl: ctx.sourceUrl || null, label, table: c.table, layout: c.layout,
    tieOut: c.tie, nativeUnit: c.tableUnit, ...extra,
  });

  // Net income (the EPS numerator) — needed by the EPS identity and by the deal's EPS math.
  const niC = gather({ isTotal: M.niTotal, isAnchor: M.niAnchor, isSubtotal: M.niSubtotal, unit: 'millions' }, { isMeasure: M.tNi, unit: 'millions' });
  const ni = choose(niC, 'net income');
  if (ni.pick) {
    const v = toMillions(ni.pick.tie.nonGaap.value, ni.pick.tableUnit);
    if (v == null) reasons.netIncome = `net income: unit not stated for table ${ni.pick.table}`;
    else res.netIncome = figure(ni.pick, v, '$M', { native: ni.pick.tie.nonGaap.value, gaapNative: ni.pick.tie.gaap.value });
  } else reasons.netIncome = ni.reason || 'no non-GAAP net income row in the reconciliation tables';

  // Diluted shares: a filed row whose count reproduces the filed EPS from the filed net income (to the cent).
  const shareC = shareCandidates(tables, fy);

  // EPS: (a) an additive per-share reconciliation that ties; else (b) a filed non-GAAP diluted EPS that
  // equals filed non-GAAP net income ÷ filed diluted shares to the cent, when that net income ties.
  const epsC = gather({ isTotal: M.epsTotal, isAnchor: M.epsAnchor, unit: 'per share' }, { isMeasure: M.tEps, unit: 'per share' });
  const eps = choose(epsC, 'diluted EPS');
  const identity = (epsValue) => {
    if (!res.netIncome) return null;
    for (const s of shareC) {
      if (s.millions == null) continue;
      const q = res.netIncome.value / s.millions;
      if (round2(q) === round2(epsValue)) return { shares: s, quotient: Math.round(q * 10000) / 10000 };
    }
    return null;
  };
  if (eps.pick) {
    res.eps = figure(eps.pick, eps.pick.tie.nonGaap.value, 'per share', { method: 'additive per-share reconciliation' });
  } else if (res.netIncome && res.netIncome.layout === 'row') {
    // (b) per-share rows in the same table as the tied net income, with no GAAP per-share line to add from.
    const t = tables[res.netIncome.table];
    const rows = t.rows.map(splitRow);
    const cols = rowColumns(t.rows, rows.findIndex(r => r.label === res.netIncome.tieOut.gaap.label));
    const ci = cols ? cols.findIndex(c => c.year === fy && c.period && isFullYearText(c.period)) : -1;
    const perShare = rows.filter(r => M.epsTotal(r.label) || (/per\s+share/i.test(r.label) && /diluted/i.test(r.label) && /non-?gaap|after/i.test(r.label) && !/before/i.test(r.label)));
    const hits = [];
    for (const r of perShare) {
      if (ci < 0 || r.values.length !== cols.length || r.values[ci].value == null) continue;
      const id = identity(r.values[ci].value);
      if (id) hits.push({ r, id });
    }
    if (hits.length === 1 && !epsC.some(c => c.tie && !c.tie.reconciles)) {
      const { r, id } = hits[0];
      res.eps = {
        value: r.values[ci].value, unit: 'per share', period: res.netIncome.period, fiscalYear: ctx.fiscalYear,
        rowLabel: cleanLabel(r.label), name: cleanLabel(r.label), accession: ctx.accession, sourceUrl: ctx.sourceUrl || null, label,
        table: t.index, layout: 'row', method: 'net-income identity',
        tieOut: {
          reconciles: true, method: 'net-income identity',
          note: `The filing shows no per-share adjustments. Non-GAAP net income ties (residual ${res.netIncome.tieOut.residual}); ${res.netIncome.value} ÷ ${id.shares.millions} diluted shares = ${id.quotient} → ${round2(id.quotient).toFixed(2)}, equal to the filed ${r.values[ci].value.toFixed(2)}.`,
          netIncome: res.netIncome.tieOut, sharesLabel: id.shares.label,
        },
      };
    } else reasons.eps = eps.reason || (hits.length > 1 ? 'diluted EPS: more than one per-share row matches the net-income identity — not choosing' : 'no adjusted (non-GAAP) diluted EPS row in the reconciliation tables');
  } else reasons.eps = eps.reason || 'no adjusted (non-GAAP) diluted EPS row in the reconciliation tables';

  if (res.eps) {
    const id = identity(res.eps.value);
    if (id) {
      res.dilutedShares = { value: id.shares.millions, unit: 'M shares', rowLabel: cleanLabel(id.shares.label), table: id.shares.table, period: res.eps.period, fiscalYear: ctx.fiscalYear, accession: ctx.accession, label,
        check: `${res.netIncome.value} ÷ ${id.shares.millions} = ${id.quotient} → ${round2(id.quotient).toFixed(2)} = filed EPS ${res.eps.value.toFixed(2)}` };
    } else reasons.dilutedShares = res.netIncome ? `no filed diluted share count reproduces EPS ${res.eps.value} from net income ${res.netIncome.value}` : 'net income unavailable, so the share count cannot be checked';
  } else reasons.dilutedShares = 'no adjusted EPS';

  // Adjusted EBITDA under the company's own name (IRDM: "Operational EBITDA").
  const ebC = gather({ isTotal: M.ebitdaTotal, isAnchor: M.ebitdaAnchor, unit: 'millions' }, null);
  const eb = choose(ebC, 'EBITDA');
  if (eb.pick) {
    const v = toMillions(eb.pick.tie.nonGaap.value, eb.pick.tableUnit);
    if (v == null) reasons.ebitda = `EBITDA: unit not stated for table ${eb.pick.table}`;
    else res.ebitda = figure(eb.pick, v, '$M', { native: eb.pick.tie.nonGaap.value, gaapNative: eb.pick.tie.gaap.value });
  } else reasons.ebitda = eb.reason || 'no adjusted EBITDA row in the reconciliation tables';

  return res;
}

module.exports = { readNonGaapTables, reconcileCheck, parseTables, splitRow, rowColumns, isFullYearText };
