'use strict';
// server/services/filingStatements.js — reads a filing's own income statement and cash flow statement, as the SEC renders
// them (FilingSummary.xml → R pages). companyfacts says what a filer tagged somewhere in a filing, including in the notes;
// only the statement says what the line actually is. Sarepta's CostOfRevenue 25.5 is a real fact from a note, and its cost
// line is 839.6 under a company-specific tag. Each row keeps its tag, so a value can be confirmed tag by tag, period by period.
//
// Nothing here estimates: a row is what the filing printed, scaled by the page's own header. An unreadable statement is
// null, and the callers keep their value with a flag.

const UA = { 'User-Agent': 'EasyMandA contact@easymanda.com' };
const TIMEOUT_MS = 20000;
const FAILURE_RETRY_MS = 60 * 60 * 1000;

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const textOf = (html) => html.replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#160;|&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&#x2019;/g, "'").replace(/\s+/g, ' ').trim();

function parseHeaderDate(text) {
  const m = text.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})/);
  if (!m || !MONTHS[m[1].toLowerCase()]) return null;
  return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`;
}

// "$ 4,049" → 4049, "(13,699)" → -13699, blank or text → null. Before scaling.
function parseCell(text) {
  const t = text.replace(/[$,\s]/g, '').replace(/\[\d+\]/g, '');
  if (!t || !/^\(?-?\d*\.?\d+\)?$/.test(t)) return null;
  const n = Number(t.replace(/[()]/g, ''));
  return t.startsWith('(') ? -n : n;
}

// Pure: one R page → { title, scale, periods, rows }. `periods[i]` is the end date of column i, or null for a column that is
// not a full year (a "3 Months Ended" column on the same page). `scale` comes only from "$ in Thousands / Millions": Globalstar's
// header says "shares in Thousands" and prints dollars in full.
function parseStatementPage(html) {
  const headRows = [...html.matchAll(/<tr>\s*(<th[\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const titleCell = (html.match(/<th[^>]*class="tl"[^>]*>([\s\S]*?)<\/th>/) || [])[1] || '';
  const title = textOf(titleCell);
  const scaleWord = (title.match(/\$ in (Thousands|Millions|Billions)/i) || [])[1];
  const scale = !scaleWord ? 1 : ({ thousands: 1e3, millions: 1e6, billions: 1e9 })[scaleWord.toLowerCase()];

  // Which months each column covers: the first header row's groups, expanded by colspan.
  const groups = [];
  for (const m of (headRows[0] || '').matchAll(/<th([^>]*)class="th"([^>]*)>([\s\S]*?)<\/th>/g)) {
    const colspan = Number(((m[1] + m[2]).match(/colspan="(\d+)"/) || [])[1] || 1);
    for (let i = 0; i < colspan; i++) groups.push(textOf(m[3]));
  }
  const dateCells = (headRows[1] || '').match(/<th[^>]*class="th"[^>]*>[\s\S]*?<\/th>/g) || [];
  const periods = dateCells.map((cell, i) => (/1[12] Months Ended/i.test(groups[i] || '12 Months Ended') ? parseHeaderDate(textOf(cell)) : null));

  const rows = [];
  for (const m of html.matchAll(/<tr class="r[eo]\w*">([\s\S]*?)<\/tr>/g)) {
    const ref = m[1].match(/defref_([A-Za-z0-9-]+)_([A-Za-z0-9_]+)/);
    const labelCell = m[1].match(/<td class="pl[^"]*"[^>]*>([\s\S]*?)<\/td>/);
    if (!ref || !labelCell) continue;
    const cells = [...m[1].matchAll(/<td class="(?:nump|num|text)"[^>]*>([\s\S]*?)<\/td>/g)].map((c) => parseCell(textOf(c[1])));
    rows.push({ ns: ref[1], tag: ref[2], label: textOf(labelCell[1]), values: cells.map((v) => (v == null ? null : v * scale)) });
  }
  return { title, scale, periods, rows };
}

// Pure: FilingSummary.xml → the R files of the primary statements. Notes and schedules also mention "income" and "cash flow".
function selectStatementReports(filingSummaryXml) {
  const reports = [...filingSummaryXml.matchAll(/<Report instance="[^"]*">([\s\S]*?)<\/Report>/g)].map((m) => ({
    file: (m[1].match(/<HtmlFileName>([^<]+)/) || [])[1],
    name: (m[1].match(/<ShortName>([^<]+)/) || [])[1] || '',
    category: (m[1].match(/<MenuCategory>([^<]+)/) || [])[1] || '',
  })).filter((r) => r.file);
  const primary = reports.filter((r) => !/parenthetical|details|tables|policies|disclosure|note|schedule|summary/i.test(r.name) && (r.category === 'Statements' || !r.category));
  const cashFlow = primary.find((r) => /cash ?flow/i.test(r.name)) || null;
  const income = primary.find((r) => /income|operations|earnings|profit/i.test(r.name) && !/statements? of comprehensive|comprehensive income$|changes|equity|balance|cash/i.test(r.name))
    || primary.find((r) => /income|operations|earnings/i.test(r.name) && !/changes|equity|balance|cash/i.test(r.name)) || null;
  return { cashFlow, income };
}

const columnOf = (statement, end) => (statement && end ? statement.periods.indexOf(end) : -1);

// The row for a tag at a period: { row, value }, or null when the tag is not on the statement for that period.
function statementRow(statement, tag, end) {
  const col = columnOf(statement, end);
  if (col < 0) return null;
  const row = statement.rows.find((r) => r.tag === tag && r.values[col] != null);
  return row ? { row, value: row.values[col] } : null;
}

// Filed figures round independently. Half a printed unit covers rounding and nothing else.
function sameFiled(statement, a, b) {
  return Math.abs(Math.abs(a) - Math.abs(b)) <= Math.max(statement.scale * 0.51, Math.abs(b) * 0.0005);
}

async function readText(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

const cache = new Map();   // accession → { promise, failed, ts }. A filing never changes, so success has no TTL.

// { income, cashFlow, form, accn, reportDate }, each statement parsed or null. Never throws.
async function fetchFilingStatements(cik, filing) {
  const cached = cache.get(filing.accn);
  if (cached && (!cached.failed || Date.now() - cached.ts < FAILURE_RETRY_MS)) return cached.promise;
  const promise = (async () => {
    const folder = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${filing.accn.replace(/-/g, '')}`;
    const picked = selectStatementReports(await readText(`${folder}/FilingSummary.xml`));
    const read = async (report) => (report ? { ...parseStatementPage(await readText(`${folder}/${report.file}`)), form: filing.form, accn: filing.accn } : null);
    const [income, cashFlow] = await Promise.all([read(picked.income), read(picked.cashFlow)]);
    return { income, cashFlow, form: filing.form, accn: filing.accn, reportDate: filing.reportDate };
  })().catch((e) => {
    console.error(`[filingStatements] read failed for ${filing.accn}: ${e.message}`);
    cache.set(filing.accn, { promise: Promise.resolve(null), failed: true, ts: Date.now() });
    return null;
  });
  cache.set(filing.accn, { promise, failed: false, ts: Date.now() });
  return promise;
}

module.exports = { parseStatementPage, selectStatementReports, columnOf, statementRow, sameFiled, fetchFilingStatements };
