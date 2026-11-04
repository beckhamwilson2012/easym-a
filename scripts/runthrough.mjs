#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// scripts/runthrough.mjs — PRE-DEMO SMOKE TEST.
//
// Answers one question in under two minutes: will the app embarrass me in front of a person?
// Diagnostic-first — a red line names the STAGE and the FIGURE, so you know where in the pipeline to
// look, not merely that something broke.
//
//   node scripts/runthrough.mjs                  # --summary (default): one pair, one line per stage
//   node scripts/runthrough.mjs --full           # every configured pair, per-stage timing + values
//   node scripts/runthrough.mjs --pair CRM/TEAM  # override the pair (either mode)
//
// Exit code is 0 only when every stage AND every defect check passed. Non-zero = do not walk in.
//
// WHAT IT EXERCISES — traced to the real code path, not assumed:
//   §1 EDGAR companyfacts   GET /quote?symbol=      → server/services/edgarClient.fetchFields() →
//                           data.sec.gov/api/xbrl/companyfacts/CIK*.json.   (App.js:37 fetchCompanyData)
//   §2 FMP forward estimates GET /api/estimates/:t  → fmpClient.fetchForwardEstimates  (server.js:1518)
//   §3 Live price           GET /api/price/:t       → finnhub→cnbc→yahoo→alphavantage→fmp waterfall
//                           (server.js:1133), cross-checked against GET /api/verified/:t
//   §4 Deck assembly        the REAL src/utils/dealCalc.calculate() + src/lib/deckModel.buildDeckModel()
//   §5 Output written       run artifact to disk, re-read and re-parsed
//   §6 Defect audit         the reason this script exists (below)
//
// WHY §6 IS THE POINT. A crash is easy to see on stage. A deck that renders a plausible WRONG number is
// the failure that costs the meeting. Per CLAUDE.md the cardinal sin is a null coerced into a sum
// (pattern B) — "a fabrication that survives inspection is worse than a visible zero". §6 checks:
//   B1 blank      — a figure the deck needs came back null/undefined
//   B2 zero-coerce— a figure is exactly 0 while an input it derives from is null  (pattern B)
//   B3 fabricated — a figure is non-null while a REQUIRED input is null           (pattern B, worst case)
//   B4 formula    — the figure disagrees with an independent recompute from the fetched inputs
//   B5 untraced   — a figure equals no fetched value, no recompute, and no declared assumption
//   B6 stale      — the live quote's own date is older than CONFIG.staleness
//   B7 period     — acquirer and target report from different fiscal periods (false comparability)
//
// B3/B5 are the ones that matter most: a silently fabricated number is the failure mode being hunted.
//
// This script never writes to app code and never mutates app state — it is read-only against a running
// server plus two pure functions imported from src/.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// ── CONFIG ───────────────────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  // Where server.js is listening. `npm run start:server` → 3001. Env override for a staging host.
  baseUrl: process.env.RUNTHROUGH_BASE_URL || 'http://localhost:3001',

  // Demo pairs. summary mode runs pairs[0]; --full runs them all. premiumPct/cashPercent are DOCUMENTED
  // ASSUMPTIONS (they are inputs you type on stage, not fetched data) and are labelled as such in §6.
  pairs: [
    { acquirer: 'CRM', target: 'TEAM', premiumPct: 25, cashPercent: 60 },
    { acquirer: 'NET', target: 'DDOG', premiumPct: 30, cashPercent: 50 },
    { acquirer: 'ORCL', target: 'WDAY', premiumPct: 20, cashPercent: 60 },
  ],

  // B6. The live quote carries a DAY-granular date (sourceMeta.<src>.asOf), so this is in days.
  // 1 = "must be today or yesterday" — over a weekend a Friday close is legitimately 1–3 days old, so
  // weekendGraceDays widens it Sat/Sun/Mon rather than crying stale at a market that is simply closed.
  staleness: { maxQuoteAgeDays: 1, weekendGraceDays: 3 },

  // B7/B8. Different fiscal year-ends are NORMAL in M&A and are not a defect on their own — CRM ends in
  // January, TEAM in June. What misleads an audience is a gap wide enough that the two FY columns cover
  // materially different economies. Half a year is the line.
  comparability: { maxPeriodGapDays: 183 },

  // Per-request ceilings. /quote is the slow one — it can fan out to companyfacts + LTM assembly.
  // Per-REQUEST ceilings, plus a per-STAGE ceiling. The request aborts were verified to cap correctly in
  // isolation (a 1500ms budget aborts a hanging socket at 1501ms), yet one cold run still spent 116s in §1
  // — unreproducible, and not explainable from the abort path. A tool whose whole promise is "under two
  // minutes" cannot depend on knowing every way a stage might stall, so the stage cap bounds it regardless
  // of cause and reports WHICH stage hung rather than leaving you watching a blank terminal.
  timeouts: {
    quote: 45000, price: 15000, estimates: 20000, verified: 45000,
    // Env-overridable so the ceiling can be raised on a slow connection, and lowered to prove the
    // watchdog fires (it is the kind of guard that is easy to add and never exercise).
    stage: Number(process.env.RUNTHROUGH_STAGE_MS) || 60000,
  },

  // summary mode target. Exceeding it is a WARN, not a failure: a slow run still tells you the truth,
  // but you should know before you plan to do this live in the ten minutes before a meeting.
  summaryBudgetMs: 120000,

  outDir: 'scripts/.runthrough',
};

// ── tiny helpers ─────────────────────────────────────────────────────────────────────────────────────
const REPO   = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NOCOLOR = process.env.NO_COLOR != null || !process.stdout.isTTY;
const C = (c, s) => (NOCOLOR ? s : `\x1b[${c}m${s}\x1b[0m`);
const green = (s) => C('32', s), red = (s) => C('31', s), yellow = (s) => C('33', s), dim = (s) => C('2', s), bold = (s) => C('1', s);
const TICK = () => process.hrtime.bigint();
const msSince = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
// Below a second, `${(ms/1000).toFixed(1)}s` renders every warm-cache run as a flat "0.0s", which reads
// as a broken timer rather than a fast one. Milliseconds under 1s, seconds above.
const secs = (ms) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
// Deliberately NOT `v || fallback` — 0 is a real value here and must survive. (CLAUDE.md: `|| 0` is the defect.)
const orNull = (v) => (v === undefined ? null : v);
// dealCalc.calculate() returns DISPLAY-FORMATTED STRINGS ('60785', '-27.2'), not numbers — deckModel's
// own num() re-parses them with parseFloat. Mirror that exactly, or every calc-sourced input reads as
// "missing" and the audit invents fabrication defects that are artifacts of this script. Non-numeric and
// absent both collapse to null, so a genuinely missing figure is still caught.
const numLike = (v) => { if (v === null || v === undefined) return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// Bound a stage regardless of what is stalling inside it. Rejects with a message naming the stage, so a
// hang is a diagnosable red line rather than a hung terminal. The underlying work is abandoned, not
// cancelled — acceptable here because the process exits immediately after reporting.
function withDeadline(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`stage exceeded its ${secs(ms)} ceiling — ${label} is hung (see CONFIG.timeouts.stage)`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

async function getJson(url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); }
    catch { throw new Error(`non-JSON response (HTTP ${r.status}): ${text.slice(0, 120)}`); }
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${body?.error || text.slice(0, 120)}`);
    return body;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`timed out after ${timeoutMs}ms`);
    throw e;
  } finally { clearTimeout(timer); }
}

// ── load the REAL app modules ────────────────────────────────────────────────────────────────────────
// CRA/webpack resolves extensionless relative imports ('./netDebt'); Node ESM does not. Rewrite only the
// import SPECIFIERS to absolute file: URLs and evaluate the untouched source. This runs the production
// dealCalc/deckModel — not a reimplementation — which is the whole point of calling §4 "deck assembly".
// Resolve to DATA URLs all the way down. Rewriting a dependency specifier to a file: URL works, but Node
// then emits MODULE_TYPELESS_PACKAGE_JSON for each src/ file it loads that way — noise on every run. A
// data: URL is deterministic from content, so Node dedupes shared dependencies to one instance anyway.
const _urlCache = new Map();
async function appModuleUrl(absPath) {
  if (_urlCache.has(absPath)) return _urlCache.get(absPath);
  let src = await readFile(absPath, 'utf8');
  const dir = path.dirname(absPath);
  for (const spec of [...src.matchAll(/from\s+'(\.[^']+)'/g)].map((m) => m[1])) {
    let target = path.resolve(dir, spec);
    for (const cand of [target, `${target}.js`, path.join(target, 'index.js')]) {
      try { await readFile(cand, 'utf8'); target = cand; break; } catch { /* next candidate */ }
    }
    src = src.split(`from '${spec}'`).join(`from '${await appModuleUrl(target)}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(src).toString('base64')}`;
  _urlCache.set(absPath, url);
  return url;
}
const loadAppModule = async (absPath) => import(await appModuleUrl(absPath));

// ── §0  Preflight — the replicated-mapping guard ─────────────────────────────────────────────────────
// toCalcInputs() and numLike() are MIRRORS of code owned by another file: App.js's setInputs blocks
// (App.js:774 / :816) and deckModel's internal num(). CLAUDE.md flags src/App.js as being worked by a
// concurrent session, so those mirrors will drift, and a drifted mirror is the worst kind of failure here
// — the run still goes green while the audit is reasoning about inputs the app no longer produces.
//
// Three checks, all offline:
//   0a  golden fixture   frozen /quote payloads → toCalcInputs() must equal the committed output
//   0b  App.js mapping   the company*→data.* pairs in App.js must equal the table declared here
//   0c  deckModel parse  buildDeckModel must still parse the STRINGS dealCalc emits
const FIXTURE_PATH = 'scripts/fixtures/runthrough-mapping.json';

// The mapping this script replicates, declared explicitly so 0b has something to compare against.
// key = the company<A|B> suffix in App.js;  value = the /quote field it reads.
// `consumed` records whether dealCalc actually reads inputs.company<X> — a new App.js mapping that
// dealCalc consumes is a hard failure (toCalcInputs must learn it); one it ignores is informational.
const APP_MAPPING = {
  Revenue: 'revenue', EBITDA: 'ebitda', NetIncome: 'netIncome', Shares: 'shares',
  OperatingIncome: 'operatingIncome', GrossProfit: 'grossProfit', FreeCashFlow: 'freeCashFlow',
  DilutedShares: 'dilutedShares', EPS: 'eps', Cash: 'cash', Sti: 'shortTermInvestments', Debt: 'debt',
  BsAsOf: 'balanceSheetAsOf', BsBasis: 'balanceSheetBasis',
};
// LtmRevenue is not a plain `data.X` read — it is the guarded form below, checked separately.
const LTM_FORM = /company([AB])LtmRevenue:\s*data\.ltm\?\.trusted\s*\?\s*data\.ltm\.revenue\s*:\s*null/g;
// Deliberately NOT carried into toCalcInputs: dealCalc never reads them (they are display metadata).
const NOT_FORWARDED = new Set(['BsAsOf', 'BsBasis']);
// Fields whose App.js form is NOT a plain `data.X` read and are verified by a dedicated rule instead.
// The generic scan still matches their prefix (`companyALtmRevenue: data.ltm?.trusted ? …` yields
// field=LtmRevenue src=ltm), so without this they read as an unmirrored new mapping and the control fails.
const SPECIAL_FORM = new Set(['LtmRevenue']);

async function checkAppMapping(appSrc, calcSrc) {
  const app  = appSrc  ?? await readFile(path.join(REPO, 'src/App.js'), 'utf8');
  const calc = calcSrc ?? await readFile(path.join(REPO, 'src/utils/dealCalc.js'), 'utf8');
  const consumed = new Set([...calc.matchAll(/inputs\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
  const found = { A: {}, B: {} };
  for (const m of app.matchAll(/company([AB])([A-Za-z0-9]+):\s*data\.([A-Za-z0-9]+)/g)) found[m[1]][m[2]] = m[3];

  const problems = [];
  for (const side of ['A', 'B']) {
    for (const [field, src] of Object.entries(APP_MAPPING)) {
      const got = found[side][field];
      if (got === undefined) problems.push(`App.js no longer maps company${side}${field} from a data.* field`);
      else if (got !== src) problems.push(`company${side}${field} now reads data.${got}, this script expects data.${src}`);
    }
    // A mapping App.js gained that we do not mirror. Only a failure when dealCalc reads it.
    for (const [field, src] of Object.entries(found[side])) {
      if (APP_MAPPING[field] !== undefined || SPECIAL_FORM.has(field)) continue;
      const key = `company${side}${field}`;
      if (consumed.has(key)) problems.push(`App.js added ${key} = data.${src} and dealCalc reads it — toCalcInputs() must forward it`);
    }
  }
  const ltmSides = new Set([...app.matchAll(LTM_FORM)].map((m) => m[1]));
  for (const side of ['A', 'B']) {
    if (!ltmSides.has(side)) problems.push(`company${side}LtmRevenue no longer uses the ltm?.trusted guard — B8 and min-cash basis assume it`);
  }
  const fwd = Object.keys(APP_MAPPING).filter((f) => !NOT_FORWARDED.has(f)).length;
  return { problems, detail: `${fwd} forwarded + ${NOT_FORWARDED.size} display-only fields, LTM guard intact on both sides` };
}

// Deep-compare two flat objects; report every key that differs, with both values.
function diffFlat(want, got) {
  const keys = [...new Set([...Object.keys(want), ...Object.keys(got)])].sort();
  const out = [];
  for (const k of keys) {
    const a = want[k], b = got[k];
    if (a === b) continue;
    if (isNum(a) && isNum(b) && close(a, b)) continue;
    out.push(`${k}: fixture ${JSON.stringify(a)} → now ${JSON.stringify(b)}`);
  }
  return out;
}

async function checkFixture(injected) {
  let fx = injected;
  if (!fx) {
    try { fx = JSON.parse(await readFile(path.join(REPO, FIXTURE_PATH), 'utf8')); }
    catch (e) { return { problems: [`fixture ${FIXTURE_PATH} unreadable (${e.message}) — regenerate with --update-fixture`], detail: '' }; }
  }
  const got = toCalcInputs({
    A: fx.quotes[fx.pair.acquirer], B: fx.quotes[fx.pair.target],
    priceA: fx.prices[fx.pair.acquirer], priceB: fx.prices[fx.pair.target], pair: fx.pair,
  });
  const diffs = diffFlat(fx.expected, got);
  return {
    problems: diffs.map((d) => `toCalcInputs drifted — ${d}`),
    detail: `${Object.keys(fx.expected).length} inputs match golden ${fx.pair.acquirer}/${fx.pair.target} (frozen ${fx.generatedAt.slice(0, 10)})`,
  };
}

// 0c — dealCalc emits display STRINGS; deckModel's num() parses them. numLike() mirrors that parse, and
// the whole derivation audit rests on it. Prove the assumption against the real buildDeckModel rather
// than trusting it: feed string-valued deal fields and require numeric output.
async function checkDeckModelParse() {
  const deckModel = await loadAppModule(path.join(REPO, 'src/lib/deckModel.js'));
  const m = deckModel.buildDeckModel({
    acquirer: { shares: 1000, sharePrice: 100, currentMarketCap: 100000 },
    target: { shares: 500, sharePrice: 50, currentMarketCap: 25000 },
    deal: { offerPrice: '60', cashPercent: 60, totalPrice: '30000', purchasePremium: '20.0', epsAccretion: '-5.5' },
  });
  const problems = [];
  const expect = [['offerPrice', 60], ['totalConsideration', 30000], ['premiumPct', 20], ['accretion.pct', -5.5]];
  const read = (k) => (k === 'accretion.pct' ? m.derived.accretion.pct : m.derived[k]);
  for (const [k, want] of expect) {
    const v = read(k);
    if (!isNum(v)) problems.push(`buildDeckModel no longer parses a string ${k} (got ${JSON.stringify(v)}) — numLike()'s assumption is broken`);
    else if (!close(v, want)) problems.push(`buildDeckModel parsed ${k} to ${v}, expected ${want}`);
  }
  return { problems, detail: `string→number parse holds for ${expect.length} deal fields` };
}

async function preflight() {
  const t = TICK();
  const [mapping, fixture, parse] = await Promise.all([checkAppMapping(), checkFixture(), checkDeckModelParse()]);
  const problems = [...mapping.problems, ...fixture.problems, ...parse.problems];
  return {
    ok: problems.length === 0, ms: msSince(t), problems,
    detail: problems.length === 0 ? `${fixture.detail} · ${mapping.detail} · ${parse.detail}` : `${problems.length} mapping drift(s)`,
  };
}

async function updateFixture(pair) {
  const [A, B] = await Promise.all([
    getJson(`${CONFIG.baseUrl}/quote?symbol=${pair.acquirer}`, CONFIG.timeouts.quote),
    getJson(`${CONFIG.baseUrl}/quote?symbol=${pair.target}`, CONFIG.timeouts.quote),
  ]);
  const [pa, pb] = await Promise.all([
    getJson(`${CONFIG.baseUrl}/api/price/${pair.acquirer}`, CONFIG.timeouts.price),
    getJson(`${CONFIG.baseUrl}/api/price/${pair.target}`, CONFIG.timeouts.price),
  ]);
  // Freeze ONLY the fields toCalcInputs reads, so an unrelated /quote addition does not churn the fixture.
  const keep = (q) => Object.fromEntries(Object.entries({
    revenue: q.revenue, ebitda: q.ebitda, netIncome: q.netIncome, operatingIncome: q.operatingIncome,
    grossProfit: q.grossProfit, freeCashFlow: q.freeCashFlow, shares: q.shares,
    dilutedShares: q.dilutedShares, eps: q.eps, cash: q.cash,
    shortTermInvestments: q.shortTermInvestments, debt: q.debt,
    ltm: q.ltm ? { trusted: q.ltm.trusted, revenue: q.ltm.revenue } : null,
  }));
  const quotes = { [pair.acquirer]: keep(A), [pair.target]: keep(B) };
  const prices = { [pair.acquirer]: pa.price, [pair.target]: pb.price };
  const expected = toCalcInputs({ A: quotes[pair.acquirer], B: quotes[pair.target], priceA: prices[pair.acquirer], priceB: prices[pair.target], pair });
  const body = {
    note: 'Golden fixture for scripts/runthrough.mjs §0a. Frozen /quote fields + prices, and the '
        + 'toCalcInputs() output they must produce. Regenerate ONLY when App.js’s mapping has '
        + 'deliberately changed: node scripts/runthrough.mjs --update-fixture',
    generatedAt: new Date().toISOString(), pair, quotes, prices, expected,
  };
  const file = path.join(REPO, FIXTURE_PATH);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  console.log(`\n  ${green('✓')} wrote ${FIXTURE_PATH} — golden ${pair.acquirer}/${pair.target}, ${Object.keys(expected).length} inputs\n`);
}

// ── §1  EDGAR companyfacts ───────────────────────────────────────────────────────────────────────────
// /quote is the endpoint App.js actually calls (App.js:37). dataSource === 'sec_edgar' is the server's own
// declaration that the figures came from companyfacts rather than a vendor fallback — a demo running on
// FMP-only data is a different (and much weaker) story than one running on filings, so it is checked.
async function stageEdgar(ticker) {
  const q = await getJson(`${CONFIG.baseUrl}/quote?symbol=${encodeURIComponent(ticker)}`, CONFIG.timeouts.quote);
  if (!q || typeof q !== 'object') throw new Error('empty /quote payload');
  if (q.error) throw new Error(q.error);
  if (!q.name) throw new Error('no company name — ticker did not resolve');
  // A ticker that resolves to a NAME but no figures still renders an empty deck on stage, so the core
  // set is a hard gate here rather than something the defect audit discovers five stages later.
  const core = { revenue: q.revenue, shares: q.shares, netIncome: q.netIncome };
  const absent = Object.entries(core).filter(([, v]) => !isNum(v)).map(([k]) => k);
  if (absent.length > 0) throw new Error(`${ticker} resolved to '${q.name}' but returned no ${absent.join(', ')} (dataSource '${q.dataSource || 'none'}') — the deck would be empty`);
  const onEdgar = q.dataSource === 'sec_edgar';
  return {
    payload: q,
    detail: `${ticker} ${q.name} · ${q.dataSource || 'source?'} · FY${q.fiscalYear ?? '?'} ending ${q.fiscalYearEnd || '?'}`,
    warn: onEdgar ? null : `dataSource is '${q.dataSource}', not sec_edgar — figures are NOT filing-sourced`,
  };
}

// ── §2  FMP forward estimates ────────────────────────────────────────────────────────────────────────
// The endpoint answers 200 with an empty shape and a `note` for a thin ticker rather than erroring, so an
// empty result must be read as a FAILED stage here — the Analyst Consensus exhibit would render bare.
async function stageEstimates(ticker) {
  const e = await getJson(`${CONFIG.baseUrl}/api/estimates/${encodeURIComponent(ticker)}`, CONFIG.timeouts.estimates);
  const rows = Array.isArray(e.estimates) ? e.estimates : [];
  const pt = e.priceTarget && isNum(e.priceTarget.consensus) ? e.priceTarget.consensus : null;
  if (rows.length === 0 && pt == null) throw new Error(e.note || 'no forward estimates and no price-target consensus');
  const fys = rows.map((r) => r.fy).filter((v) => v != null);
  return {
    payload: e,
    detail: `${ticker} ${rows.length} FY${rows.length === 1 ? '' : 's'}${fys.length ? ` (${fys.join(', ')})` : ''}`
          + `${pt != null ? ` · PT $${pt}` : ''}${e.cached ? dim(' [cached]') : ''}`,
    warn: rows.length === 0 ? `${ticker}: price target only, no forward revenue/EPS rows` : null,
  };
}

// ── §3  Live price ───────────────────────────────────────────────────────────────────────────────────
// Two calls on purpose. /api/price is the waterfall the app uses for the share price; /api/verified is the
// only place a quote's own asOf date and the cross-source spread are exposed, and both are needed for B6
// (staleness) and for catching a single-source price that silently disagrees with every other feed.
async function stagePrice(ticker) {
  const [p, v] = await Promise.all([
    getJson(`${CONFIG.baseUrl}/api/price/${encodeURIComponent(ticker)}`, CONFIG.timeouts.price),
    getJson(`${CONFIG.baseUrl}/api/verified/${encodeURIComponent(ticker)}`, CONFIG.timeouts.verified)
      .catch((e) => ({ _error: e.message })),
  ]);
  if (p.error || !isNum(p.price)) {
    const tried = (p.attempts || []).map((a) => `${a.source}${a.ok ? '' : '✗'}`).join(' ');
    throw new Error(`${p.error || 'no price'} — tried: ${tried || 'nothing'}`);
  }
  const pf = v && !v._error ? v.fields?.price : null;
  const meta = pf?.sourceMeta?.[pf?.chosenSource] || null;
  return {
    payload: { price: p, verified: v && !v._error ? v : null, verifiedError: v?._error || null },
    quoteAsOf: meta?.asOf || null,
    crossStatus: pf?.status || null,
    detail: `${ticker} $${p.price} via ${p.source}`
          + `${pf ? ` · x-src ${pf.status}${isNum(pf.maxDev) ? ` (${(pf.maxDev * 100).toFixed(2)}%)` : ''}` : ''}`
          + `${meta?.asOf ? dim(` · quoted ${meta.asOf}`) : ''}`,
    warn: v?._error ? `cross-source check unavailable (/api/verified: ${v._error})`
        : pf?.status === 'flagged' ? `${ticker}: sources disagree beyond tolerance — price may be wrong on every slide`
        : null,
  };
}

// ── §4  Deck assembly ────────────────────────────────────────────────────────────────────────────────
// Mirrors App.js's mapping from a /quote payload into dealCalc inputs (App.js:774-786) and then into the
// deck builders (App.js:1109-1121). Kept as ONE function so the mapping is inspectable in one place —
// if App.js's mapping changes, this is the single spot that has to follow it.
function toCalcInputs({ A, B, priceA, priceB, pair }) {
  const side = (c, P) => ({
    [`company${P}Revenue`]: orNull(c.revenue),
    [`company${P}EBITDA`]: orNull(c.ebitda),
    [`company${P}NetIncome`]: orNull(c.netIncome),
    [`company${P}OperatingIncome`]: orNull(c.operatingIncome),
    [`company${P}GrossProfit`]: orNull(c.grossProfit),
    [`company${P}FreeCashFlow`]: orNull(c.freeCashFlow),
    [`company${P}Shares`]: orNull(c.shares),
    [`company${P}DilutedShares`]: orNull(c.dilutedShares),
    [`company${P}EPS`]: orNull(c.eps),
    [`company${P}Cash`]: orNull(c.cash),
    [`company${P}Sti`]: orNull(c.shortTermInvestments),
    [`company${P}Debt`]: orNull(c.debt),
    // LTM only when the server marked it trusted — same guard App.js:781 applies.
    [`company${P}LtmRevenue`]: c.ltm?.trusted ? orNull(c.ltm.revenue) : null,
  });
  // The offer is an ASSUMPTION you type on stage (live target price × premium), not fetched data.
  const offerPricePerShare = isNum(priceB) ? priceB * (1 + pair.premiumPct / 100) : null;
  return {
    ...side(A, 'A'), ...side(B, 'B'),
    currentSharePriceA: orNull(priceA),
    currentSharePriceB: orNull(priceB),
    offerPricePerShare,
    offerValueTotal: 0,
    cashPercent: pair.cashPercent,
    synergiesY1: 0, synergiesY2: 0, synergiesY3: 0,
    minCashPct: 0.02,        // dealCalc.MIN_CASH_PCT_DEFAULT — re-read from the module below
  };
}

async function stageAssembly({ A, B, priceA, priceB, pair }) {
  const dealCalc = await loadAppModule(path.join(REPO, 'src/utils/dealCalc.js'));
  const deckModel = await loadAppModule(path.join(REPO, 'src/lib/deckModel.js'));
  // via loadAppModule too — a direct file: import of a src/ module makes Node emit a
  // MODULE_TYPELESS_PACKAGE_JSON warning on every run, which is noise in a tool you read at a glance.
  const registry = await loadAppModule(path.join(REPO, 'src/components/deck/deckRegistry.js'));

  const inputs = toCalcInputs({ A, B, priceA, priceB, pair });
  inputs.minCashPct = dealCalc.MIN_CASH_PCT_DEFAULT;   // take the real constant, don't hardcode a copy
  const results = dealCalc.calculate(inputs);

  // The deck builders' shape (App.js:1109-1121). currentMarketCap is guarded exactly as App.js guards it:
  // both legs must be > 0, else null — never a coerced 0.
  const company = (c, px, sh) => ({
    ticker: c.ticker, name: c.name,
    revenue: orNull(c.revenue), ebitda: orNull(c.ebitda), netIncome: orNull(c.netIncome),
    shares: orNull(sh), cash: orNull(c.cash), sti: orNull(c.shortTermInvestments), debt: orNull(c.debt),
    sharePrice: isNum(px) && px > 0 ? px : null,
    currentMarketCap: isNum(px) && px > 0 && isNum(sh) && sh > 0 ? px * sh : null,
  });
  const acquirer = company(A, priceA, A.shares);
  const target   = company(B, priceB, B.shares);
  const deal = {
    offerPrice: inputs.offerPricePerShare,
    cashPercent: pair.cashPercent,
    purchasePremium: results.purchasePremium,
    totalPrice: results.totalPurchasePrice,
    newSharesIssued: results.newSharesIssued,
    epsAccretion: results.epsChangePct,
    isAccretive: isNum(results.epsChangePct) ? results.epsChangePct >= 0 : false,
    proFormaEPS: results.proFormaEPS,
    combinedRevenue: results.combinedRevenue,
    synergiesY1: 0, synergiesY2: 0, synergiesY3: 0,
    _results: results,
    _dataDate: new Date().toISOString().slice(0, 10),
    hasMarketData: true,
  };
  const model = deckModel.buildDeckModel({ acquirer, target, deal });

  // Slide count as DeckShell computes it (DeckShell.js:64-86): a public deal drops the two private-only
  // exhibits. Both numbers are quoted on stage, so both are reported.
  const PRIVATE_ONLY = new Set(['privatevaluation', 'creditstats']);
  const active = registry.DECK_ORDER.filter((s) => !PRIVATE_ONLY.has(s.id));
  const slides = { onScreen: active.length, inPdf: active.filter((s) => s.showInPdf).length };

  return {
    payload: { inputs, results, model, slides, describe: deckModel.describeDeckModel(model) },
    detail: `${slides.onScreen} sections / ${slides.inPdf} PDF pages · ${deckModel.describeDeckModel(model)}`,
    warn: null,
  };
}

// ── §6  Defect audit ─────────────────────────────────────────────────────────────────────────────────
// Every check below is expressed as: this figure DERIVES from these inputs by this formula. That single
// shape yields four of the seven codes at once, and it is why B3 can be detected at all — you cannot know
// a number was fabricated without knowing what it was supposed to be made of.
const REL_TOL = 1e-6;
const close = (a, b) => {
  if (!isNum(a) || !isNum(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / scale <= REL_TOL;
};

function buildDerivations({ A, B, priceA, priceB, assembly, pair, netCashDebt }) {
  const d = assembly.model.derived;
  const r = assembly.results;
  const stockPct = 100 - pair.cashPercent;
  // inputs are named so a failure message can say WHICH input was missing.
  return [
    { field: 'currentPriceAcquirer', got: d.currentPriceAcquirer, inputs: { 'price(A)': priceA }, calc: (i) => i['price(A)'] },
    { field: 'currentPriceTarget',   got: d.currentPriceTarget,   inputs: { 'price(B)': priceB }, calc: (i) => i['price(B)'] },
    { field: 'marketCapAcquirer',    got: d.marketCapAcquirer,
      inputs: { 'price(A)': priceA, 'shares(A)': orNull(A.shares) }, calc: (i) => i['price(A)'] * i['shares(A)'] },
    { field: 'marketCapTarget',      got: d.marketCapTarget,
      inputs: { 'price(B)': priceB, 'shares(B)': orNull(B.shares) }, calc: (i) => i['price(B)'] * i['shares(B)'] },
    { field: 'offerPrice',           got: d.offerPrice,
      inputs: { 'price(B)': priceB }, calc: (i) => i['price(B)'] * (1 + pair.premiumPct / 100),
      assumption: `premium ${pair.premiumPct}% (typed on stage, not fetched)` },
    { field: 'preDealShares',        got: d.preDealShares, inputs: { 'shares(A)': orNull(A.shares) }, calc: (i) => i['shares(A)'] },
    { field: 'targetShares',         got: d.targetShares,  inputs: { 'shares(B)': orNull(B.shares) }, calc: (i) => i['shares(B)'] },
    { field: 'totalConsideration',   got: d.totalConsideration,
      inputs: { 'totalPurchasePrice(calc)': numLike(r.totalPurchasePrice) }, calc: (i) => i['totalPurchasePrice(calc)'] },
    // newShares: deckModel recomputes at full precision as stockConsideration ÷ acquirer price.
    { field: 'newShares',            got: d.newShares,
      inputs: { 'totalPrice': numLike(r.totalPurchasePrice), 'price(A)': priceA },
      calc: (i) => (i.totalPrice * (stockPct / 100)) / i['price(A)'] },
    { field: 'proFormaShares',       got: d.proFormaShares,
      inputs: { 'preDealShares': d.preDealShares, 'newShares': d.newShares },
      calc: (i) => i.preDealShares + i.newShares },
    { field: 'ownershipExistingPct', got: d.ownershipExistingPct,
      inputs: { 'preDealShares': d.preDealShares, 'proFormaShares': d.proFormaShares },
      calc: (i) => (i.preDealShares / i.proFormaShares) * 100 },
    { field: 'ownershipNewPct',      got: d.ownershipNewPct,
      inputs: { 'newShares': d.newShares, 'proFormaShares': d.proFormaShares },
      calc: (i) => (i.newShares / i.proFormaShares) * 100 },
    { field: 'pfEquityValue',        got: d.pfEquityValue,
      inputs: { 'marketCapAcquirer': d.marketCapAcquirer, 'totalConsideration': d.totalConsideration },
      calc: (i) => i.marketCapAcquirer + i.totalConsideration },
    { field: 'transactionEV',        got: d.transactionEV,
      inputs: { 'totalConsideration': d.totalConsideration, 'debt(B)': orNull(B.debt), 'cash(B)': orNull(B.cash) },
      calc: (i) => i.totalConsideration + netCashDebt(i['debt(B)'], i['cash(B)'], orNull(B.shortTermInvestments)) },
    { field: 'exchangeRatio',        got: d.exchangeRatio,
      inputs: { 'offerPrice': d.offerPrice, 'price(A)': priceA },
      calc: (i) => (i.offerPrice * (stockPct / 100)) / i['price(A)'] },
    { field: 'combinedRevenue',      got: d.combinedRevenue,
      inputs: { 'combinedRevenue(calc)': numLike(r.combinedRevenue) }, calc: (i) => i['combinedRevenue(calc)'] },
    { field: 'accretion.pct',        got: d.accretion.pct,
      inputs: { 'epsChangePct(calc)': numLike(r.epsChangePct) }, calc: (i) => i['epsChangePct(calc)'] },
    { field: 'accretion.proFormaEPS', got: d.accretion.proFormaEPS,
      inputs: { 'proFormaEPS(calc)': numLike(r.proFormaEPS) }, calc: (i) => i['proFormaEPS(calc)'] },
  ];
}

function auditDefects({ A, B, priceA, priceB, quoteAsOfA, quoteAsOfB, assembly, pair, netCashDebt, now }) {
  const defects = [];
  const add = (code, figure, message) => defects.push({ code, figure, message });
  const derivations = buildDerivations({ A, B, priceA, priceB, assembly, pair, netCashDebt });

  // ── B1/B2/B3/B4 — one pass over the derivation table ────────────────────────────────────────────
  let checked = 0;
  for (const dv of derivations) {
    checked++;
    const missing = Object.entries(dv.inputs).filter(([, v]) => !isNum(v)).map(([k]) => k);
    if (missing.length > 0) {
      // Inputs are incomplete → the ONLY honest output is null (renders as an em-dash).
      if (dv.got === null || dv.got === undefined) continue;              // correct null-honest behaviour
      if (dv.got === 0) add('B2', dv.field, `renders 0 while input${missing.length > 1 ? 's' : ''} ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing — a null coerced into a sum (CLAUDE.md pattern B)`);
      else add('B3', dv.field, `FABRICATED: shows ${fmtNum(dv.got)} but input${missing.length > 1 ? 's' : ''} ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing — no traceable source`);
      continue;
    }
    if (dv.got === null || dv.got === undefined) {
      add('B1', dv.field, `blank on the deck although every input was fetched (${Object.keys(dv.inputs).join(', ')})`);
      continue;
    }
    const want = dv.calc(dv.inputs);
    if (!close(dv.got, want)) {
      add('B4', dv.field, `shows ${fmtNum(dv.got)} but recomputing from ${Object.keys(dv.inputs).join(' , ')} gives ${fmtNum(want)}`);
    }
  }

  // ── B5 — untraced: the per-company snapshot must equal the fetched /quote figures exactly ────────
  // deckModel copies these through verbatim; any drift means a value entered the deck from somewhere
  // other than the fetch, which is precisely the "figure with no traceable source" case.
  const snap = [
    ['acquirer.revenue', assembly.model.verifiedData.acquirer.revenue, orNull(A.revenue)],
    ['acquirer.ebitda', assembly.model.verifiedData.acquirer.ebitda, orNull(A.ebitda)],
    ['acquirer.netIncome', assembly.model.verifiedData.acquirer.netIncome, orNull(A.netIncome)],
    ['acquirer.cash', assembly.model.verifiedData.acquirer.cash, orNull(A.cash)],
    ['acquirer.debt', assembly.model.verifiedData.acquirer.debt, orNull(A.debt)],
    ['target.revenue', assembly.model.verifiedData.target.revenue, orNull(B.revenue)],
    ['target.ebitda', assembly.model.verifiedData.target.ebitda, orNull(B.ebitda)],
    ['target.netIncome', assembly.model.verifiedData.target.netIncome, orNull(B.netIncome)],
    ['target.cash', assembly.model.verifiedData.target.cash, orNull(B.cash)],
    ['target.debt', assembly.model.verifiedData.target.debt, orNull(B.debt)],
  ];
  for (const [name, got, src] of snap) {
    checked++;
    if (got === null && src === null) continue;                       // honestly absent on both sides
    if (got !== null && src === null) { add('B5', name, `shows ${fmtNum(got)} but /quote returned nothing for it`); continue; }
    if (got === null && src !== null) { add('B1', name, `blank although /quote returned ${fmtNum(src)}`); continue; }
    if (!close(got, src)) add('B5', name, `shows ${fmtNum(got)} but /quote returned ${fmtNum(src)} — value did not come from the fetch`);
  }

  // ── B6 — stale quote ─────────────────────────────────────────────────────────────────────────────
  // The quote's own date, not the time we fetched it. Weekend/Monday widen the allowance because a
  // Friday close is legitimately days old when the market is shut — crying stale then is noise.
  const dow = now.getDay();                                            // 0 Sun … 6 Sat
  const allowance = (dow === 0 || dow === 6 || dow === 1) ? CONFIG.staleness.weekendGraceDays : CONFIG.staleness.maxQuoteAgeDays;
  for (const [label, asOf] of [[A.ticker, quoteAsOfA], [B.ticker, quoteAsOfB]]) {
    checked++;
    if (!asOf) { add('B6', `${label} quote date`, 'no asOf on the quote — staleness cannot be checked (see NOTES)'); continue; }
    const ageDays = Math.floor((now - new Date(`${asOf}T00:00:00Z`)) / 86400000);
    if (ageDays > allowance) add('B6', `${label} price`, `quote dated ${asOf} is ${ageDays}d old (allowance ${allowance}d) — the deck would show a stale price`);
  }

  // ── B7 — displayed-column period gap ─────────────────────────────────────────────────────────────
  // The figures the deck COMPARES (revenue, ebitda, netIncome) are the FY values from /quote for BOTH
  // sides — App.js:774 maps data.revenue, not data.ltm.revenue. So the honest comparability question is
  // how far apart the two fiscal year-ends are, not which side happens to have an LTM window.
  checked++;
  const gapDays = (A.fiscalYearEnd && B.fiscalYearEnd)
    ? Math.abs(new Date(A.fiscalYearEnd) - new Date(B.fiscalYearEnd)) / 86400000 : null;
  if (gapDays === null) {
    add('B7', 'period end', `fiscal year-end missing for ${!A.fiscalYearEnd ? A.ticker : B.ticker} — comparability cannot be checked`);
  } else if (gapDays > CONFIG.comparability.maxPeriodGapDays) {
    add('B7', 'period end', `${A.ticker} FY ends ${A.fiscalYearEnd}, ${B.ticker} FY ends ${B.fiscalYearEnd} — `
      + `${Math.round(gapDays)}d apart, past the ${CONFIG.comparability.maxPeriodGapDays}d limit; the two columns cover different economies`);
  }

  // ── B8 — LTM basis asymmetry ─────────────────────────────────────────────────────────────────────
  // Narrower and easy to miss: companyXLtmRevenue is set only when the server marks LTM trusted
  // (App.js:781). When one side has it and the other does not, dealCalc's min-cash / pfLtmRevenue basis
  // is built from one company's trailing window and the other's annual figure. It does not move the
  // displayed revenue columns, but it does move excess cash → new debt → accretion.
  checked++;
  const ltmA = A.ltm?.trusted === true, ltmB = B.ltm?.trusted === true;
  if (ltmA !== ltmB) {
    const has = ltmA ? A : B, lacks = ltmA ? B : A;
    add('B8', 'LTM basis', `${has.ticker} has a trusted LTM window (${has.ltm.asOf}) but ${lacks.ticker} falls back to annual`
      + `${lacks.ltm?.fallback ? ` ('${lacks.ltm.fallback}')` : ''} — min-cash and pro-forma LTM revenue mix the two bases`);
  }

  const basisOf = (c) => `FY ${c.fiscalYearEnd || '?'}${c.ltm?.trusted ? ` (+LTM ${c.ltm.asOf})` : ''}`;
  return {
    defects, checked,
    basis: { [A.ticker]: basisOf(A), [B.ticker]: basisOf(B) },
    periodGapDays: gapDays === null ? null : Math.round(gapDays),
  };
}

function fmtNum(v) {
  if (v === null || v === undefined) return '—';
  if (!isNum(v)) return String(v);
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return String(Number(v.toFixed(4)));
}

// ── run one pair through every stage ─────────────────────────────────────────────────────────────────
async function runPair(pair, { full }) {
  const label = `${pair.acquirer}/${pair.target}`;
  const stages = [];
  const t0 = TICK();
  const record = (n, name, r) => { stages.push({ n, name, ...r }); return r; };
  const run = async (n, name, fn) => {
    const s = TICK();
    try {
      const r = await withDeadline(fn(), CONFIG.timeouts.stage, `§${n} ${name}`);
      return record(n, name, { ok: true, ms: msSince(s), detail: r.detail, warn: r.warn, payload: r.payload });
    } catch (e) {
      record(n, name, { ok: false, ms: msSince(s), detail: e.message, warn: null, payload: null });
      // Carry `audit` through the wrap — §6 attaches its findings to the error, and losing them here
      // would report "6 defects" with no list, which is exactly the useless output this script exists to avoid.
      throw Object.assign(new Error(`§${n} ${name}: ${e.message}`), { stage: n, audit: e.audit });
    }
  };

  const out = { pair, label, stages, defects: [], checked: 0, slides: null, genMs: null, totalMs: null, artifact: null, basis: null };
  try {
    // §1 both sides in parallel — this is the slow stage and the demo fetches them together too.
    const [qa, qb] = await run(1, 'EDGAR companyfacts', async () => {
      const [ra, rb] = await Promise.all([stageEdgar(pair.acquirer), stageEdgar(pair.target)]);
      return { payload: [ra, rb], detail: `${ra.detail}  |  ${rb.detail}`, warn: [ra.warn, rb.warn].filter(Boolean).join(' · ') || null };
    }).then((r) => r.payload);
    const A = { ...qa.payload, ticker: pair.acquirer };
    const B = { ...qb.payload, ticker: pair.target };

    const [ea, eb] = await run(2, 'FMP forward estimates', async () => {  // NOTE: out.estimates is assigned right after, NOT at the end — §6 throwing must not lose it
      const [ra, rb] = await Promise.all([stageEstimates(pair.acquirer), stageEstimates(pair.target)]);
      return { payload: [ra, rb], detail: `${ra.detail}  |  ${rb.detail}`, warn: [ra.warn, rb.warn].filter(Boolean).join(' · ') || null };
    }).then((r) => r.payload);
    out.estimates = [ea, eb];

    const [pa, pb] = await run(3, 'Live price', async () => {
      const [ra, rb] = await Promise.all([stagePrice(pair.acquirer), stagePrice(pair.target)]);
      return { payload: [ra, rb], detail: `${ra.detail}  |  ${rb.detail}`, warn: [ra.warn, rb.warn].filter(Boolean).join(' · ') || null };
    }).then((r) => r.payload);

    const priceA = pa.payload.price.price, priceB = pb.payload.price.price;

    const asm = await run(4, 'Deck assembly', () => stageAssembly({ A, B, priceA, priceB, pair })).then((r) => r.payload);
    out.slides = asm.slides;
    // "Generation" = what the audience watches: fetch through assembled deck. Excludes disk write.
    out.genMs = msSince(t0);

    // §5 — output written. The app's own PDF export is browser-side (jsPDF + html2canvas in
    // DeckShell.js:112), so this writes the assembled deck + audit as the run artifact and proves it is
    // re-readable. It does NOT exercise jsPDF — see NOTES in the report.
    const artifact = await run(5, 'Output written', async () => {
      const dir = path.join(REPO, CONFIG.outDir);
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${pair.acquirer}-${pair.target}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      const body = {
        generatedAt: new Date().toISOString(), pair, slides: asm.slides,
        describe: asm.describe, model: asm.model, results: asm.results, inputs: asm.inputs,
      };
      await writeFile(file, JSON.stringify(body, null, 2), 'utf8');
      const back = JSON.parse(await readFile(file, 'utf8'));
      if (!back.model?.derived) throw new Error('artifact re-read but has no deck model');
      const bytes = Buffer.byteLength(JSON.stringify(body));
      return { payload: file, detail: `${path.relative(REPO, file)} (${(bytes / 1024).toFixed(0)} KB, re-read OK)`, warn: null };
    }).then((r) => r.payload);
    out.artifact = artifact;

    const netDebtMod = await loadAppModule(path.join(REPO, 'src/lib/netDebt.js'));
    const audit = await run(6, 'Data defect audit', async () => {
      const a = auditDefects({
        A, B, priceA, priceB,
        quoteAsOfA: pa.quoteAsOf, quoteAsOfB: pb.quoteAsOf,
        assembly: asm, pair, netCashDebt: netDebtMod.netCashDebt, now: new Date(),
      });
      const hard = a.defects.length;
      if (hard > 0) {
        const e = new Error(`${hard} defect${hard === 1 ? '' : 's'} across ${a.checked} figures`);
        e.audit = a;
        throw e;
      }
      return { payload: a, detail: `${a.checked} figures checked, 0 defects · basis ${Object.entries(a.basis).map(([k, v]) => `${k} ${v}`).join(' / ')}`, warn: null };
    }).then((r) => r.payload).catch((e) => {
      if (e.audit) { out.defects = e.audit.defects; out.checked = e.audit.checked; out.basis = e.audit.basis; }
      throw e;
    });
    out.checked = audit.checked; out.basis = audit.basis;
  } catch (e) {
    out.error = e.message;
  }
  out.totalMs = msSince(t0);
  return out;
}

// ── reporting ────────────────────────────────────────────────────────────────────────────────────────
const STAGE_W = 24;
function printStageLine(s, { full }) {
  const mark = s.ok ? green('✓') : red('✗');
  const name = `§${s.n} ${s.name}`.padEnd(STAGE_W);
  const time = full ? dim(` ${secs(s.ms).padStart(6)}`) : '';
  console.log(`  ${mark}  ${name}${time}  ${s.ok ? s.detail : red(s.detail)}`);
  if (s.warn) console.log(`      ${yellow('!')} ${yellow(s.warn)}`);
}

function printDefects(defects) {
  if (defects.length === 0) return;
  console.log(`\n  ${red(bold(`DEFECTS (${defects.length}) — these are the numbers that would be wrong on screen:`))}`);
  for (const d of defects) {
    console.log(`    ${red(d.code)}  ${bold(d.figure)}`);
    console.log(`         ${d.message}`);
  }
}

// ── self-test ────────────────────────────────────────────────────────────────────────────────────────
// CLAUDE.md: "a test that changes nothing looks identical to a passing test if you only read the exit
// code." A green run-through is worthless if the audit is incapable of going red, so --selftest builds a
// self-consistent synthetic deck, asserts it audits CLEAN, then breaks it one way at a time and asserts
// the matching code fires. Runs offline — no server, no network.
async function selfTest() {
  const netDebtMod = await loadAppModule(path.join(REPO, 'src/lib/netDebt.js'));
  const { netCashDebt } = netDebtMod;
  const pair = { acquirer: 'AAA', target: 'BBB', premiumPct: 20, cashPercent: 60 };
  const now = new Date('2026-09-01T12:00:00Z');          // a Tuesday — no weekend grace
  const today = '2026-09-01';

  const baseline = () => {
    const A = { ticker: 'AAA', name: 'Acq', shares: 1000, revenue: 5000, ebitda: 1000, netIncome: 500,
      cash: 200, debt: 300, shortTermInvestments: 50, fiscalYearEnd: '2026-06-30',
      ltm: { trusted: true, asOf: '2026-06-30', revenue: 5000 } };
    const B = { ticker: 'BBB', name: 'Tgt', shares: 500, revenue: 2000, ebitda: 400, netIncome: 200,
      cash: 100, debt: 150, shortTermInvestments: 25, fiscalYearEnd: '2026-06-30',
      ltm: { trusted: true, asOf: '2026-06-30', revenue: 2000 } };
    const priceA = 100, priceB = 50;
    const stockPct = 100 - pair.cashPercent;
    const offerPrice = priceB * (1 + pair.premiumPct / 100);
    const totalPrice = offerPrice * B.shares;
    const newShares = (totalPrice * (stockPct / 100)) / priceA;
    const proFormaShares = A.shares + newShares;
    const derived = {
      currentPriceAcquirer: priceA, currentPriceTarget: priceB,
      marketCapAcquirer: priceA * A.shares, marketCapTarget: priceB * B.shares,
      offerPrice, preDealShares: A.shares, targetShares: B.shares,
      totalConsideration: totalPrice, newShares, proFormaShares,
      ownershipExistingPct: (A.shares / proFormaShares) * 100,
      ownershipNewPct: (newShares / proFormaShares) * 100,
      pfEquityValue: priceA * A.shares + totalPrice,
      transactionEV: totalPrice + netCashDebt(B.debt, B.cash, B.shortTermInvestments),
      exchangeRatio: (offerPrice * (stockPct / 100)) / priceA,
      combinedRevenue: A.revenue + B.revenue,
      accretion: { pct: 5, proFormaEPS: 1.2 },
    };
    const vd = (c) => ({ revenue: c.revenue, ebitda: c.ebitda, netIncome: c.netIncome, cash: c.cash, debt: c.debt });
    const assembly = {
      model: { derived, verifiedData: { acquirer: vd(A), target: vd(B) } },
      results: { totalPurchasePrice: String(totalPrice), combinedRevenue: String(A.revenue + B.revenue),
                 epsChangePct: '5', proFormaEPS: '1.2' },
    };
    return { A, B, priceA, priceB, quoteAsOfA: today, quoteAsOfB: today, assembly, pair, netCashDebt, now };
  };

  const cases = [
    ['clean baseline audits with no defects', null, (s) => s],
    ['B1 blank', 'B1', (s) => { s.assembly.model.derived.marketCapAcquirer = null; return s; }],
    ['B2 zero-coerced', 'B2', (s) => { s.A.shares = null; s.assembly.model.derived.marketCapAcquirer = 0; return s; }],
    ['B3 fabricated', 'B3', (s) => { s.A.shares = null; return s; }],
    ['B4 formula drift', 'B4', (s) => { s.assembly.model.derived.marketCapAcquirer = 999; return s; }],
    ['B5 untraced', 'B5', (s) => { s.assembly.model.verifiedData.acquirer.revenue = 4321; return s; }],
    ['B6 stale quote', 'B6', (s) => { s.quoteAsOfB = '2026-08-01'; return s; }],
    ['B7 period gap', 'B7', (s) => { s.B.fiscalYearEnd = '2025-09-30'; return s; }],
    ['B8 LTM asymmetry', 'B8', (s) => { s.B.ltm = { trusted: false, asOf: null, fallback: 'annual' }; return s; }],
  ];

  console.log(`\n${bold('runthrough self-test')} ${dim('— can the audit actually go red?')}\n`);
  let bad = 0;
  for (const [name, expect, mutate] of cases) {
    const scenario = mutate(baseline());
    const { defects } = auditDefects(scenario);
    const codes = [...new Set(defects.map((d) => d.code))];
    const pass = expect === null ? defects.length === 0 : codes.includes(expect);
    if (!pass) bad++;
    console.log(`  ${pass ? green('✓') : red('✗')}  ${name.padEnd(38)} ${dim(codes.length ? `fired: ${codes.join(', ')}` : 'fired: none')}`);
    if (!pass) for (const d of defects) console.log(`        ${dim(`${d.code} ${d.figure}: ${d.message}`)}`);
  }

  // ── §0 drift detectors — same discipline: prove each can go red ─────────────────────────────────
  // Synthetic App.js sources, so this never depends on (or touches) the real file a concurrent session
  // is editing. The real-source case is the control: it must come back clean.
  const realApp = await readFile(path.join(REPO, 'src/App.js'), 'utf8');
  const realCalc = await readFile(path.join(REPO, 'src/utils/dealCalc.js'), 'utf8');
  const dropped = realApp.split('companyAEBITDA: data.ebitda').join('companyAEBITDA: 0');
  const renamed = realApp.split('companyBCash: data.cash').join('companyBCash: data.cashAndEquivalents');
  const addedConsumed = realApp.replace('companyARevenue: data.revenue', 'companyARevenue: data.revenue, companyABacklog: data.backlog');
  const noLtmGuard = realApp.split('companyBLtmRevenue: data.ltm?.trusted ? data.ltm.revenue : null').join('companyBLtmRevenue: data.ltm.revenue');
  const calcReadsBacklog = `${realCalc}\nconst _ = inputs.companyABacklog;`;

  const fx = JSON.parse(await readFile(path.join(REPO, FIXTURE_PATH), 'utf8'));
  const driftedFx = JSON.parse(JSON.stringify(fx));
  driftedFx.expected.companyACash = (driftedFx.expected.companyACash ?? 0) + 1;

  const mapCases = [
    ['real App.js audits clean (control)', 0, () => checkAppMapping(realApp, realCalc)],
    ['App.js drops a mapping', 1, () => checkAppMapping(dropped, realCalc)],
    ['App.js renames a source field', 1, () => checkAppMapping(renamed, realCalc)],
    ['App.js adds a field dealCalc reads', 1, () => checkAppMapping(addedConsumed, calcReadsBacklog)],
    ['LTM trusted-guard removed', 1, () => checkAppMapping(noLtmGuard, realCalc)],
    ['golden fixture drifts', 1, () => checkFixture(driftedFx)],
    ['real fixture matches (control)', 0, () => checkFixture()],
  ];
  for (const [name, wantProblems, fn] of mapCases) {
    const { problems } = await fn();
    const pass = wantProblems === 0 ? problems.length === 0 : problems.length > 0;
    if (!pass) bad++;
    console.log(`  ${pass ? green('✓') : red('✗')}  ${name.padEnd(38)} ${dim(problems.length ? `${problems.length} problem(s)` : 'clean')}`);
    if (!pass) for (const pr of problems) console.log(`        ${dim(pr)}`);
  }

  console.log(`\n  ${bad === 0 ? green(bold('SELFTEST PASS')) : red(bold(`SELFTEST FAIL — ${bad} case(s)`))}\n`);
  process.exit(bad === 0 ? 0 : 1);
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const full = argv.includes('--full');
  const pi = argv.indexOf('--pair');
  let pairs = full ? CONFIG.pairs : [CONFIG.pairs[0]];
  if (pi >= 0 && argv[pi + 1]) {
    const [a, t] = argv[pi + 1].toUpperCase().split('/');
    if (!a || !t) { console.error('--pair expects ACQ/TGT, e.g. --pair CRM/TEAM'); process.exit(2); }
    // Prefer this pair's OWN configured terms; fall back to pairs[0]'s only for a pair not in CONFIG.
    // Without this, `--pair NET/DDOG` silently ran at CRM/TEAM's premium and printed terms that were not
    // the ones configured for it.
    const base = CONFIG.pairs.find((q) => q.acquirer === a && q.target === t) || CONFIG.pairs[0];
    pairs = [{ acquirer: a, target: t, premiumPct: base.premiumPct, cashPercent: base.cashPercent }];
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
  node scripts/runthrough.mjs [--summary|--full] [--pair ACQ/TGT]

    --summary   (default) one pair, one line per stage, target <${(CONFIG.summaryBudgetMs / 1000).toFixed(0)}s
    --full      every configured pair, per-stage timing, fetched values, summary table
    --pair      override the pair, e.g. --pair CRM/TEAM
    --selftest  prove the defect audit can go red (offline, no server)
    --update-fixture  regenerate the §0a golden mapping fixture

  Exit 0 only when every stage and every defect check passed.
`);
    process.exit(0);
  }
  return { full, pairs };
}

async function main() {
  if (process.argv.includes('--selftest')) return selfTest();
  if (process.argv.includes('--update-fixture')) {
    try { await getJson(`${CONFIG.baseUrl}/api/sectors`, 5000); }
    catch (e) { console.log(`\n  ${red('✗')} server unreachable — ${e.message}\n  ${yellow('npm run start:server')}\n`); process.exit(2); }
    await updateFixture(CONFIG.pairs.find((p) => p.acquirer === 'NET') || CONFIG.pairs[0]);
    process.exit(0);
  }
  const { full, pairs } = parseArgs(process.argv.slice(2));
  const started = TICK();
  const stamp = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  console.log(`\n${bold('EasyM&A pre-demo run-through')} ${dim(`— ${full ? 'full' : 'summary'} mode`)}`);
  console.log(dim(`  ${CONFIG.baseUrl}   ${stamp}\n`));

  // §0 first: it is offline, it is fast, and a drifted mirror invalidates everything downstream — there
  // is no point spending network time on an audit whose input mapping no longer matches the app.
  const pre = await preflight();
  console.log(`  ${pre.ok ? green('✓') : red('✗')}  ${'§0 Preflight (mappings)'.padEnd(STAGE_W)}${full ? dim(` ${secs(pre.ms).padStart(6)}`) : ''}  ${pre.ok ? pre.detail : red(pre.detail)}`);
  if (!pre.ok) {
    console.log(`\n  ${red(bold('MAPPING DRIFT — the audit would be reasoning about the wrong inputs:'))}`);
    for (const pb of pre.problems) console.log(`    ${red('·')} ${pb}`);
    console.log(`\n  ${yellow('If App.js changed deliberately:')} update APP_MAPPING / toCalcInputs(), then`);
    console.log(`  ${yellow('regenerate the golden fixture:')}  node scripts/runthrough.mjs --update-fixture\n`);
    process.exit(1);
  }
  console.log('');

  // Fail fast and legibly when the server simply is not up — by far the most common reason this script
  // reports nothing useful, and the one with a one-line fix.
  try {
    await getJson(`${CONFIG.baseUrl}/api/sectors`, 5000);
  } catch (e) {
    console.log(`  ${red('✗')}  ${bold('server unreachable')}  ${CONFIG.baseUrl} — ${e.message}`);
    console.log(`\n  ${yellow('Start it first:')}  npm run start:server\n`);
    process.exit(2);
  }

  const results = [];
  for (const pair of pairs) {
    if (full || pairs.length > 1) console.log(`  ${bold(`${pair.acquirer} → ${pair.target}`)} ${dim(`(premium ${pair.premiumPct}%, cash ${pair.cashPercent}%)`)}`);
    const r = await runPair(pair, { full });
    results.push(r);
    for (const s of r.stages) printStageLine(s, { full });
    printDefects(r.defects);

    if (full && r.slides) {
      console.log(`\n  ${dim('fetched values:')}`);
      const [ea, eb] = r.estimates || [];
      for (const e of [ea, eb].filter(Boolean)) console.log(`    ${dim('estimates')} ${e.detail}`);
      console.log(`    ${dim('deck model')} ${r.stages.find((s) => s.n === 4)?.detail || ''}`);
    }
    if (r.slides) {
      console.log(`\n  ${bold('DEMO NUMBERS')}  wall clock ${bold(secs(r.totalMs))}  ·  generation ${bold(secs(r.genMs))}`
        + `  ·  ${bold(String(r.slides.onScreen))} slides on screen (${r.slides.inPdf} in the PDF)`);
    }
    console.log('');
  }

  // ── summary table (--full) ─────────────────────────────────────────────────────────────────────────
  if (full && results.length > 1) {
    console.log(bold('  SUMMARY'));
    console.log(dim('  pair            stages   defects   generation   slides   result'));
    for (const r of results) {
      const passed = r.stages.filter((s) => s.ok).length;
      const okAll = !r.error;
      console.log(`  ${r.label.padEnd(14)}  ${String(passed)}/${String(r.stages.length)}      `
        + `${String(r.defects.length).padStart(3)}      ${secs(r.genMs ?? r.totalMs).padStart(7)}      `
        + `${r.slides ? String(r.slides.onScreen).padStart(3) : '  —'}    ${okAll ? green('PASS') : red('FAIL')}`);
    }
    console.log('');
  }

  const totalMs = msSince(started);
  const failed = results.filter((r) => r.error);
  const totalDefects = results.reduce((n, r) => n + r.defects.length, 0);

  // Headline. Wall clock is the number quoted in the room, so it gets its own line rather than a dim
  // suffix on RESULT. Per-stage breakdown only in --full, where there is room for it.
  console.log(`  ${bold('ELAPSED')}  ${bold(secs(totalMs))} wall clock${results.length > 1 ? ` across ${results.length} pairs` : ''}`);
  if (full) {
    for (const r of results) {
      const parts = r.stages.map((st) => `§${st.n} ${secs(st.ms)}`).join(' · ');
      console.log(`    ${dim(`${r.label.padEnd(12)} ${secs(r.totalMs).padStart(7)}  ${parts}`)}`);
    }
  }

  if (failed.length === 0) {
    console.log(`  ${green(bold('RESULT  PASS'))} — ${results.length} pair${results.length === 1 ? '' : 's'}, every stage green, 0 defects`);
  } else {
    console.log(`  ${red(bold('RESULT  FAIL'))} — ${failed.length}/${results.length} pair${results.length === 1 ? '' : 's'} red`
      + `${totalDefects > 0 ? `, ${totalDefects} data defect${totalDefects === 1 ? '' : 's'}` : ''}`);
    for (const f of failed) console.log(`    ${red('·')} ${f.label}: ${f.error}`);
  }
  if (!full && totalMs > CONFIG.summaryBudgetMs) {
    console.log(`  ${yellow(`! over the ${(CONFIG.summaryBudgetMs / 1000).toFixed(0)}s summary budget (${secs(totalMs)}) — too slow to run right before walking in`)}`);
  }
  console.log('');
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(`\n${red('runthrough crashed:')} ${e.stack || e.message}\n`); process.exit(3); });
