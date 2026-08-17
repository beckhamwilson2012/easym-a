// server/harness/truthHarness.js — Phase 6 gate. Render each real 10-K, run the full chain
// (upload → locate → extract → validate), map the six required fields at the latest FY, and diff
// against the app's EDGAR/XBRL truth. Field mapping honors the definitional rulings:
//   revenue   = total revenue when both total revenue and net sales are printed (ruling 2); "Net Operating Revenues" matched (ruling 7)
//   netIncome = the "attributable to parent" line when a filer prints both (ruling 1)
//   cash      = "cash and equivalents" matched with or without the second "cash" (ruling 7)
//   ebit      = if the filer prints no operating-income subtotal → status:'missing', renders — (ruling 4)
//   D&A       = if the printed line is bundled ("… and other") → status:'review', usable but amber (ruling 5)
//   totalDebt = long-term debt incl. current maturities, excl. commercial paper / short-term borrowings (ruling 3)
const path = require('path');
const { extractPdf } = require('../services/uploadExtract');
const { locateStatements } = require('../services/locatorAgent');
const { extractPage } = require('../services/extractorAgent');
const { validate } = require('../services/validator');
const { cikFor, latestTenK, renderPdf } = require('./edgar');
const { getTruth } = require('./truth');

const OUT = '/tmp/truth-harness';
const norm = s => String(s || '').trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
const yearRe = fy => new RegExp('(^|[^0-9])' + fy + '([^0-9]|$)');

// ── field matchers ────────────────────────────────────────────────────────────
const isTotalRevenue = n => /^total (net )?revenues?$/.test(n);                       // ruling 2: prefer total revenue
const isNetOpRevenue = n => /^net operating revenues?$/.test(n);                       // ruling 7: KO
const isPlainRevenue = n => ['net sales', 'total net sales', 'revenue', 'revenues', 'net revenue', 'net revenues'].includes(n);
const isEbit         = n => ['operating income', 'income from operations', 'operating income (loss)', 'operating profit'].includes(n);
const isPlainNI      = n => ['net income', 'net income (loss)', 'net earnings', 'consolidated net income'].includes(n);
const isAttribNI     = i => /net (income|earnings).*attributable to /i.test(i.verbatimLabel) && !/noncontrolling|minority/i.test(i.verbatimLabel); // ruling 1
const isCash         = n => ['cash and cash equivalents', 'cash and equivalents', 'cash and cash equivalents at end of period', 'cash and equivalents at end of period', 'cash and cash equivalents, end of period'].includes(n); // ruling 7
const isDA           = n => /^depreciation and amortization/.test(n) || /^depreciation, amortization/.test(n) || n === 'depreciation & amortization';
const isBundledDA    = n => /and other/.test(n);                                       // ruling 5: "depreciation, amortization, and other"
// ruling 3: long-term debt incl. its current maturities; exclude CP / short-term borrowings / loans & notes payable
const isLTDebt = n => (/(long-term debt|term debt|long-term borrowings)/.test(n)
      || /current (portion|maturities|installments) of (long-term debt|finance lease|capital lease)/.test(n)
      || /long-term debt due within one year/.test(n)
      || n === 'short-term debt')
    && !/commercial paper|short-term borrowing|loans and notes payable|short-term debt obligation|available|fair value|deferred|weighted|discount|premium|issuance|net of/.test(n);

const field = it => it ? { value: it.scaledValue, label: it.verbatimLabel, page: it.page, period: it.periodLabel, status: it.status } : { value: null, label: null, status: 'not-found' };
const atFy = (items, kind, fy) => items.filter(i => i._kind === kind && yearRe(fy).test(i.periodLabel));

function resolveRevenue(items, fy) {
  const inc = atFy(items, 'income', fy), by = m => inc.find(i => m(norm(i.verbatimLabel)));
  return field(by(isTotalRevenue) || by(isNetOpRevenue) || by(isPlainRevenue));
}
function resolveNetIncome(items, fy) {
  const inc = atFy(items, 'income', fy);
  return field(inc.find(isAttribNI) || inc.find(i => isPlainNI(norm(i.verbatimLabel))));
}
function resolveCash(items, fy) { return field(atFy(items, 'balance', fy).find(i => isCash(norm(i.verbatimLabel)))); }
function resolveEbit(items, fy) {
  const it = atFy(items, 'income', fy).find(i => isEbit(norm(i.verbatimLabel)));
  return it ? field(it) : { value: null, label: null, status: 'missing' };            // ruling 4
}
function resolveDA(items, fy) {
  const it = atFy(items, 'cashflow', fy).find(i => isDA(norm(i.verbatimLabel)));
  if (!it) return { value: null, label: null, status: 'not-found' };
  const f = field(it);
  if (isBundledDA(norm(it.verbatimLabel))) f.status = 'review';                        // ruling 5
  return f;
}
function resolveDebt(items, fy) {
  const lines = atFy(items, 'balance', fy).filter(i => isLTDebt(norm(i.verbatimLabel)));
  const ok = lines.filter(i => i.status === 'ok' && i.scaledValue != null);
  return { value: ok.length ? ok.reduce((a, i) => a + i.scaledValue, 0) : null, label: ok.map(i => i.verbatimLabel).join(' + ') || null,
    lines: lines.map(i => ({ label: i.verbatimLabel, val: i.scaledValue, status: i.status })),
    status: lines.some(i => i.status === 'missing') ? 'partial-missing' : (ok.length ? 'ok' : 'not-found') };
}

async function runCompany(ticker) {
  const meta = latestTenK(cikFor(ticker));
  const pdf = path.join(OUT, `${ticker}.pdf`);
  renderPdf(meta.url, pdf);
  const { pages, pageCount } = await extractPdf(pdf);
  const loc = await locateStatements(pages);
  if (!loc.ok) return { ticker, company: meta.company, error: `locator refused: ${loc.failure}`, pageCount };
  const facts = { scale: loc.facts.scale, exceptPerShare: loc.facts.exceptPerShare };
  const fy = new Date(meta.reportDate).getUTCFullYear();

  const pick = async (pageNums, kind) => {
    const out = [];
    for (const pn of (pageNums || [])) {
      const pg = pages.find(p => p.page === pn); if (!pg) continue;
      const ex = await extractPage(pg.text, pn, facts);
      ex.items.forEach(it => (it._kind = kind));
      out.push(...ex.items);
    }
    return out;
  };
  const items = [
    ...await pick(loc.incomeStatementPages, 'income'),
    ...await pick(loc.balanceSheetPages, 'balance'),
    ...await pick(loc.cashFlowPages, 'cashflow'),
  ];

  await validate({ page: 'multi', items, scale: facts.scale, exceptPerShare: facts.exceptPerShare });  // marks failing fields 'missing'
  const truth = await getTruth(meta.cik, meta.reportDate);

  const extracted = {
    revenue: resolveRevenue(items, fy),
    ebit: resolveEbit(items, fy),
    da: resolveDA(items, fy),
    netIncome: resolveNetIncome(items, fy),
    cash: resolveCash(items, fy),
    totalDebt: resolveDebt(items, fy),
  };

  const FIELDS = ['revenue', 'ebit', 'da', 'netIncome', 'cash', 'totalDebt'];
  const diffs = FIELDS.map(f => {
    const ex = extracted[f], want = truth[f], got = ex.value;
    const pct = (got != null && want != null && want !== 0) ? Math.abs(got - want) / Math.abs(want) * 100 : null;
    const pass = pct != null && pct <= 0.5;
    let state;
    if (pass) state = 'pass';
    else if (ex.status === 'missing' && want == null) state = 'legit-missing';   // ruling 4 (NKE ebit)
    else if (ex.status === 'review') state = 'review';                           // ruling 5 (MSFT da)
    else state = 'red';
    const blindSpot = state === 'red' && got != null && ex.status === 'ok';
    return { field: f, extracted: got, truth: want, pct, state, pass, matchedLabel: ex.label, page: ex.page, validatorStatus: ex.status, blindSpot };
  });

  return { ticker, company: meta.company, fy, reportDate: meta.reportDate, pageCount,
    located: { income: loc.incomeStatementPages, balance: loc.balanceSheetPages, cashflow: loc.cashFlowPages },
    extracted, truth, diffs };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const DEFAULT_10 = ['AAPL', 'MSFT', 'NVDA', 'KO', 'PEP', 'WMT', 'HD', 'COST', 'MCD', 'NKE'];
const M = x => x == null ? '—' : '$' + Math.round(x / 1e6).toLocaleString() + 'M';
const PC = p => p == null ? '  n/a' : p.toFixed(3) + '%';
const SYM = { pass: 'PASS', red: 'RED ', review: 'REVIEW', 'legit-missing': 'MISSING(ok)' };

async function main() {
  const tickers = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_10;
  const results = [];
  for (const t of tickers) {
    process.stderr.write(`\n=== ${t} ===\n`);
    try { const r = await runCompany(t); results.push(r); printCompany(r); }
    catch (e) { console.log(`${t}: ERROR ${e.message}`); results.push({ ticker: t, error: e.message }); }
  }
  printSummary(results);
}
function printCompany(r) {
  if (r.error) { console.log(`\n${r.ticker}: ERROR — ${r.error}`); return; }
  console.log(`\n${r.ticker} · ${r.company} · FY${r.fy} · ${r.pageCount}pp · located I:${JSON.stringify(r.located.income)} B:${JSON.stringify(r.located.balance)} C:${JSON.stringify(r.located.cashflow)}`);
  console.log('  field      extracted        XBRL truth       %diff       state        matched label');
  for (const d of r.diffs)
    console.log(`  ${d.field.padEnd(10)} ${M(d.extracted).padStart(13)}   ${M(d.truth).padStart(13)}   ${PC(d.pct).padStart(9)}   ${(SYM[d.state] || d.state).padEnd(11)}  ${d.matchedLabel || '(none)'}`);
}
function printSummary(results) {
  console.log('\n\n================= PHASE 6 GATE SUMMARY (post-fix) =================');
  let cleanCos = 0, reds = 0, reviews = 0, legitMissing = 0, blindSpots = 0, misreads = 0;
  const exceptions = [];
  for (const r of results) {
    if (r.error) { console.log(`  ${r.ticker.padEnd(6)} ERROR ${r.error}`); continue; }
    const bad = r.diffs.filter(d => d.state === 'red');
    reds += bad.length; blindSpots += bad.filter(d => d.blindSpot).length;
    reviews += r.diffs.filter(d => d.state === 'review').length;
    legitMissing += r.diffs.filter(d => d.state === 'legit-missing').length;
    if (bad.length === 0) cleanCos++;
    for (const d of r.diffs.filter(d => d.state !== 'pass'))
      exceptions.push(`${r.ticker} ${d.field} [${d.state}] extracted ${M(d.extracted)} vs truth ${M(d.truth)}${d.pct != null ? ` (${d.pct.toFixed(2)}%)` : ''}`);
    console.log(`  ${r.ticker.padEnd(6)} ${bad.length === 0 ? 'CLEAN (all six green or named-exception)' : `reds: ${bad.map(d => d.field).join(',')}`}`);
  }
  console.log('\n  Named exceptions (definitional / review / legitimately-missing — NOT folded into pass):');
  exceptions.forEach(e => console.log('    · ' + e));
  console.log(`\n  Companies with zero reds: ${cleanCos}/${results.filter(r => !r.error).length}`);
  console.log(`  Reds: ${reds} | reviews (amber): ${reviews} | legit-missing: ${legitMissing} | validator blind-spots among reds: ${blindSpots}`);
  console.log(`  >>> EXTRACTOR MISREADS across all 60 cells: computed in the report after per-red verification.`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { runCompany };
