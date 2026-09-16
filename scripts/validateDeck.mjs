// ─────────────────────────────────────────────────────────────────────────────
// C3 — Post-generation deck VALIDATOR (per MASTER_DECK_SPEC handoff §C3).
//
// Renders a generated deck for a given acquirer/target pair and asserts the cross-slide
// invariants that guarantee a deck never drifts into the master PDF's contradictions:
//   • acquirer market cap identical across slides
//   • offer price / current price identical across slides
//   • ownership % identical across slides
//   • accretion sign consistent (headline vs Year-1)
//   • DATA_DATE identical across slides (day-level)
//   • formatting: EPS >= 2 decimals; no cell begins with '='; (leading '+' -> WARN, PDF-only)
//   • standalone-P&L forecast GAAP profit cells blank ('—')  [NA until multi-year layout exists]
//   • every financial slide carries a Sources/basis footnote
//
// Each check logs PASS / FAIL / WARN / NA with the offending slide + value. The process exits
// non-zero if ANY hard check FAILs — this is the guardrail that future spec-conformance work runs
// against. Usage: node scripts/validateDeck.mjs [ACQ_TKR ACQ_NAME TGT_TKR TGT_NAME]
// ─────────────────────────────────────────────────────────────────────────────
import puppeteer from 'puppeteer-core';
import { readFile } from 'node:fs/promises';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ARGS = process.argv.slice(2).filter(a => !a.startsWith('--'));   // flags are not tickers
const AT = ARGS[0] || 'CRM', AN = ARGS[1] || 'Salesforce', TT = ARGS[2] || 'TEAM', TN = ARGS[3] || 'Atlassian';

// ── Slide map — DERIVED from deckRegistry, never hardcoded ──────────────────────────────────────
// This block used to be a hand-written 17-entry index map. It went stale: four of its ids
// (finprofile, trading, football, valuation) no longer have a component in DeckShell's COMPONENTS map,
// while seven real sections (targetprofile, shareholders, txnstructure, privatevaluation, creditstats,
// exchangeratio, verification2) were missing from it. Because the checks index captured slides
// POSITIONALLY, every assertion after the first divergence was reading a different slide than its
// message claimed — and `IDX.trading` being undefined made `sections[undefined]` undefined, so the
// checks that named a dead section silently degraded to WARN instead of failing loudly.
//
// deckRegistry.DECK_ORDER is the single source of section order. Read it through a data: URL so Node
// does not emit MODULE_TYPELESS_PACKAGE_JSON for a src/ file on every run.
const REG_SRC = await readFile(new URL('../src/components/deck/deckRegistry.js', import.meta.url), 'utf8');
const { DECK_ORDER } = await import(`data:text/javascript;base64,${Buffer.from(REG_SRC).toString('base64')}`);

// DeckShell drops the private-only exhibits for a public deal (DeckShell.js:64-70), and validateDeck
// only ever drives a public pair — so the captured order is the public active set.
const PRIVATE_ONLY = new Set(['privatevaluation', 'creditstats']);
const ACTIVE = DECK_ORDER.filter(s => !PRIVATE_ONLY.has(s.id));
const IDX = Object.fromEntries(ACTIVE.map((s, i) => [s.id, i]));
const LAST_IDX = ACTIVE.length - 1;
const SLIDE = ACTIVE.map((s, i) => `§${i} ${s.label}`);

// Resolve an id or die. This is the actual fix for the bug class: a renamed or removed section now
// stops the run with the id that went missing, instead of quietly yielding `undefined` and letting
// every downstream check read an empty slide and report a confident, wrong verdict.
const sec = (id) => {
  const i = IDX[id];
  if (i === undefined) throw new Error(`validateDeck: deckRegistry has no section '${id}' — update the id list in this file`);
  return i;
};

// Financial slides that must carry a Sources/basis footnote = every lettered exhibit in the active
// set. Derived from `kind`, so a new exhibit is covered the day it is added.
const FINANCIAL = ACTIVE.map((s, i) => [s, i]).filter(([s]) => s.kind === 'exhibit').map(([, i]) => i);

// Deal-narrative slides for offer/current-price consistency. These are the sections that actually
// render an offer or current price today (grepped from src/components/deck/sections/), EXCLUDING the
// verification appendices, which show cross-source spreads by design.
const DEAL_SLIDES = ['dashboard', 'comparables', 'proforma', 'txnstructure', 'exchange', 'exchangeratio', 'analyst'].map(sec);

// ── Capture all 16 sections' visible text (mirrors scripts/qaFull.mjs navigation) ──────────────
async function capture() {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--no-first-run', '--window-size=1500,2300'] });
  const p = await b.newPage(); await p.setViewport({ width: 1500, height: 2300 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const wait = async (re, t = 18000) => { const s = Date.now(); while (Date.now() - s < t) { if (re.test(await p.evaluate(() => document.body.innerText))) return true; await sleep(300); } return false; };
  const load = async (i, tk, nm) => { const ins = await p.$$('input[id^="react-select"]'); await ins[i].click(); await ins[i].type(tk, { delay: 40 }); await sleep(1000); const c = await p.evaluate(() => { const o = document.querySelector('[id^="react-select"][id*="option"]'); if (o) { o.click(); return true; } return false; }); if (!c) await ins[i].press('Enter'); await wait(new RegExp(nm, 'i')); await sleep(1500); };
  const clk = async (re) => { await p.evaluate(s => { const x = [...document.querySelectorAll('button')].find(y => new RegExp(s, 'i').test(y.textContent)); if (x) x.click(); }, re.source); await sleep(1200); };
  const activeText = () => p.evaluate(() => { const h = document.querySelector('[aria-hidden="true"]'); const pr = h ? h.style.display : null; if (h) h.style.display = 'none'; const sc = [...document.querySelectorAll('div')].find(d => { const s = getComputedStyle(d); return s.overflowY === 'auto' && d.offsetHeight > 300; }); const t = (sc || document.body).innerText; if (h) h.style.display = pr; return t.replace(/\n{2,}/g, '\n').trim(); });
  const sections = [];
  let offer = '?';
  try {
    await p.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
    // The landing page now gates the app behind a deal-type choice (Start Analysis → Public → Public).
    // The old single `Auto-Lookup` button no longer exists; without these two clicks the ticker inputs
    // never mount and capture() throws on `ins[0].click()` against an empty selector list. This is a
    // SEPARATE staleness from the slide map — it made every live run of this validator crash.
    await clk(/Start Analysis/); await sleep(1200);
    await clk(/Public\s*→\s*Public/); await sleep(2000);
    await load(0, AT, AN); await load(1, TT, TN);
    await wait(/[\d.]+\s*mkt/i, 9000); await sleep(900);
    const m = (await p.evaluate(() => document.body.innerText)).match(/Suggested:\s*\$?([\d.]+)\/share/i);
    if (m) { await p.evaluate(v => { const el = document.querySelector('input[name="offerPricePerShare"]'); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); }, m[1]); await sleep(400); offer = m[1]; }
    await clk(/Build merger model/); await sleep(1300); await p.mouse.click(750, 400);
    for (let idx = 0; idx <= LAST_IDX; idx++) {
      if (idx > 0) { await p.mouse.click(750, 400); for (let k = 0; k < idx; k++) { await p.keyboard.press('ArrowRight'); await sleep(360); } }
      await sleep(1300);
      sections[idx] = await activeText();
      for (let k = 0; k < idx; k++) { await p.keyboard.press('ArrowLeft'); await sleep(120); }
      await sleep(250);
    }
  } finally { await b.close(); }
  return { sections, offer, errs };
}

// ── Extraction helpers ──────────────────────────────────────────────────────────────────────
const matchAll = (txt, re) => [...(txt || '').matchAll(re)].map(m => m[1]);
const num = (s) => parseFloat(String(s).replace(/,/g, ''));
const uniqNums = (arr, tol) => { const out = []; for (const v of arr) { if (!out.some(u => Math.abs(u - v) <= tol)) out.push(v); } return out; };

// ── Checks ──────────────────────────────────────────────────────────────────────────────────
function runChecks({ sections }) {
  const results = [];
  const add = (level, id, detail) => results.push({ level, id, detail });

  // 1. OFFER PRICE consistent across deal slides. Match ONLY the explicitly-labeled offer ("Offer:"
  //    / "Offer Price\t") and the §0 executive headline ("...at $X/share ($YB total)"). Deliberately
  //    EXCLUDES §0's sensitivity price-ladder ($105.54…$123.13 for 20–40% premium scenarios), which
  //    is a designed range, not contradictory offers.
  const offers = [];
  matchAll(sections[0], /at\s+\$\s*([\d,]+\.\d{2})\s*\/\s*share/gi).forEach(v => offers.push({ slide: 0, v: num(v) }));
  for (const i of DEAL_SLIDES) matchAll(sections[i], /Offer(?:\s*Price)?\s*[:\t\n]+\s*\$?\s*([\d,]+\.\d{2})/gi).forEach(v => offers.push({ slide: i, v: num(v) }));
  const offerVals = uniqNums(offers.map(o => o.v), 0.011);
  if (offers.length === 0) add('WARN', 'offer-consistency', 'no offer price found on deal slides');
  else if (offerVals.length === 1) add('PASS', 'offer-consistency', `offer $${offerVals[0].toFixed(2)} identical across ${[...new Set(offers.map(o => SLIDE[o.slide]))].join(', ')}`);
  else add('FAIL', 'offer-consistency', `offer price DIFFERS: ${offers.map(o => `${SLIDE[o.slide]}=$${o.v.toFixed(2)}`).join(' | ')}`);

  // 2. CURRENT (target) PRICE consistent across deal slides.
  const curs = [];
  for (const i of DEAL_SLIDES) matchAll(sections[i], /Current\s*(?:Stock\s*)?Price[:\s\n✓]*\$\s*([\d,]+\.\d{2})/gi).forEach(v => curs.push({ slide: i, v: num(v) }));
  const curVals = uniqNums(curs.map(c => c.v), 0.011);
  if (curs.length === 0) add('WARN', 'current-price-consistency', 'no current price labeled on deal slides');
  else if (curVals.length === 1) add('PASS', 'current-price-consistency', `current price $${curVals[0].toFixed(2)} identical across ${[...new Set(curs.map(c => SLIDE[c.slide]))].join(', ')}`);
  else add('FAIL', 'current-price-consistency', `current price DIFFERS: ${curs.map(c => `${SLIDE[c.slide]}=$${c.v.toFixed(2)}`).join(' | ')}`);

  // 3. ACQUIRER MARKET CAP consistent across slides.
  //    STRUCTURALLY NA as of the current deck. This check compared §6 Financial Profile against §10
  //    Trading Profile; neither section exists any more (no component in DeckShell's COMPONENTS map).
  //    Today exactly ONE section renders a "Market Cap" — Comparables — so there is no second rendering
  //    for it to contradict, and a cross-slide check cannot be constructed. Reported as NA with the
  //    value actually on the slide, so the loss of coverage is visible rather than silently passing.
  //    Reinstate as a real check the moment a second section renders market cap.
  {
    const capRaw = matchAll(sections[sec('comparables')], /Market Cap[^\n]*?\$([\d,]+\.\d)B/gi)[0];
    const acqInComps = new RegExp(`\\b${AT}\\b`).test(sections[sec('comparables')] || '');
    add('NA', 'marketcap-consistency',
      `only §${sec('comparables')} Comparables renders a market cap${capRaw ? ` (first column $${capRaw}B)` : ' (none readable)'}`
      + `${acqInComps ? `, acquirer ${AT} is a column` : `, acquirer ${AT} not a column (target peer-screen)`}`
      + ' — no second rendering exists to cross-check; §6 Financial Profile and §10 Trading Profile were removed from the deck');
  }

  // 4. OWNERSHIP % consistent between the two sections that render it.
  //    Was §10 Trading vs §11 Contribution; Trading no longer exists. Exchange Ratio & Deal Terms and
  //    Relative Contribution are the two sections rendering a pro-forma ownership split today
  //    (SectionExchangeRatio.js / SectionRelativeContribution.js), so they are the real cross-check.
  const ownA = matchAll(sections[sec('exchange')], /(\d{1,2}\.\d)%/g).map(num);
  const ownB = matchAll(sections[sec('contribution')], /(\d{1,2}\.\d)%/g).map(num);
  // existing-holder % is the larger of the split (>50). compare the max from each.
  const exA = Math.max(...ownA.filter(v => v > 50), 0);
  const exB = Math.max(...ownB.filter(v => v > 50), 0);
  const LBL_A = SLIDE[sec('exchange')], LBL_B = SLIDE[sec('contribution')];
  if (exA === 0 || exB === 0) add('WARN', 'ownership-consistency', `ownership % not located (${LBL_A}=${exA || 'n/a'}, ${LBL_B}=${exB || 'n/a'})`);
  else if (Math.abs(exA - exB) <= 0.11) add('PASS', 'ownership-consistency', `ownership ${exA.toFixed(1)}% existing identical on ${LBL_A} & ${LBL_B}`);
  else add('FAIL', 'ownership-consistency', `ownership DIFFERS: ${LBL_A}=${exA.toFixed(1)}% vs ${LBL_B}=${exB.toFixed(1)}%`);

  // 5. ACCRETION SIGN consistent: §0 headline vs §7 Year-1 verdict.
  const head = /increasing EPS|✓\s*Accretive/i.test(sections[sec('dashboard')]) ? 'accretive' : /decreasing EPS|✗\s*Dilutive/i.test(sections[sec('dashboard')]) ? 'dilutive' : null;
  const y1 = (() => { const m = (sections[sec('proforma')] || '').match(/Year 1[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*\n(Accretive|Dilutive)/i); return m ? m[1].toLowerCase() : null; })();
  if (!head || !y1) add('WARN', 'accretion-sign', `verdict not located (§0=${head || 'n/a'}, §7-Y1=${y1 || 'n/a'})`);
  else if (head === y1) add('PASS', 'accretion-sign', `headline & §7 Year-1 agree: ${head}`);
  else add('FAIL', 'accretion-sign', `accretion sign DIFFERS: §0 headline=${head} vs §7 Year-1=${y1}`);

  // 6. DATA_DATE consistent (day-level) across slides.
  const days = [];
  sections.forEach((t, i) => matchAll(t, /as of\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/g).forEach(dStr => days.push({ slide: i, d: dStr })));
  const dayVals = [...new Set(days.map(d => d.d))];
  if (days.length === 0) add('WARN', 'data-date', 'no day-level "as of" dates found');
  else if (dayVals.length === 1) add('PASS', 'data-date', `single DATA_DATE "${dayVals[0]}" across ${days.length} slide mentions`);
  else add('FAIL', 'data-date', `DATA_DATE skew: ${days.map(d => `${SLIDE[d.slide]}="${d.d}"`).join(' | ')}`);

  // Title slide must carry the deck's day-level DATA_DATE, not a bare month (Defect #1 leak: the
  // title previously rendered the browser's current month via new Date()). A month-only string
  // ("June 2026") slips under the day-level regex above, so check the title explicitly.
  if (dayVals.length >= 1) {
    const dv = dayVals[0];
    if ((sections[sec('title')] || '').includes(dv)) add('PASS', 'title-date', `title carries the deck DATA_DATE "${dv}"`);
    else {
      const monthOnly = matchAll(sections[sec('title')], /as of\s+([A-Z][a-z]+\s+\d{4})\b/g)[0];
      add('FAIL', 'title-date', monthOnly
        ? `title shows month-only "${monthOnly}" instead of the deck DATA_DATE "${dv}" (Defect #1 — likely render-time new Date())`
        : `title slide is missing the deck DATA_DATE "${dv}"`);
    }
  }

  // 7. EPS >= 2 decimals. Scan labeled EPS dollar values.
  const epsBad = [];
  sections.forEach((t, i) => {
    // EPS value may be inline OR on the next line after the label ("EPS (NI ÷ shares)\n$8.03").
    // [^$\d]{0,40} spans label text + a newline but stops before the first digit/'$'.
    matchAll(t, /EPS[^$\d]{0,40}\$\s*(\d+(?:\.\d+)?)/gi).forEach(v => { if (!/\.\d{2}$/.test(v)) epsBad.push({ slide: i, v }); });
    matchAll(t, /\$(\d+(?:\.\d+)?)\s+to\s+\$\d/gi).forEach(v => { if (!/\.\d{2}$/.test(v)) epsBad.push({ slide: i, v }); });
  });
  if (epsBad.length === 0) add('PASS', 'eps-decimals', 'all EPS values render with 2 decimals');
  else add('FAIL', 'eps-decimals', `EPS with <2 decimals: ${epsBad.map(e => `${SLIDE[e.slide]}=$${e.v}`).join(', ')}`);

  // 8. No cell begins with '=' (FAIL, spreadsheet injection); leading '+' -> WARN (PDF-only, sign).
  const eqCells = [], plusCells = [];
  sections.forEach((t, i) => (t || '').split('\n').forEach(line => {
    const c = line.trim();
    if (/^=/.test(c)) eqCells.push({ slide: i, c });
    else if (/^\+/.test(c)) plusCells.push({ slide: i, c });
  }));
  if (eqCells.length === 0) add('PASS', 'no-equals-cell', "no cell begins with '='");
  else add('FAIL', 'no-equals-cell', `cells begin with '=': ${eqCells.map(e => `${SLIDE[e.slide]}:"${e.c}"`).join(', ')}`);
  if (plusCells.length) add('WARN', 'leading-plus', `${plusCells.length} cell(s) begin with '+' (e.g. ${plusCells.slice(0, 3).map(e => `${SLIDE[e.slide]}:"${e.c}"`).join(', ')}). Harmless in PDF (signed indicator); would break a future Google-Sheets export — strip on CSV/Sheets path.`);

  // 9. Standalone P&L forecast GAAP profit cells blank ('—'). NA unless forecast columns exist.
  const hasForecast = [sec('plAcquirer'), sec('plTarget')].some(i => /(CY|FY)\d{4}E/.test(sections[i] || ''));
  if (!hasForecast) add('NA', 'projected-gaap-blank', 'standalone P&L is single-period LTM (no forecast columns yet) — check activates when multi-year layout (spec §2) is built');
  else add('PASS', 'projected-gaap-blank', 'forecast columns present — manual review of blank profit cells advised');

  // 10. Every financial slide carries a Sources/basis footnote.
  const noFoot = FINANCIAL.filter(i => !/source|as of|per (transaction|deal) (assumptions|structure)|GAAP|estimat/i.test(sections[i] || ''));
  if (noFoot.length === 0) add('PASS', 'sources-footnote', `all ${FINANCIAL.length} financial slides carry a Sources/basis footnote`);
  else add('FAIL', 'sources-footnote', `financial slides missing footnote: ${noFoot.map(i => SLIDE[i]).join(', ')}`);

  return results;
}

// ── Self-test: prove the validator DETECTS the master PDF's contradictions (negative test) ────
// Builds synthetic slides reproducing each master defect and asserts the matching check FAILs.
function selfTest() {
  // Synthetic slides reproducing each master-PDF defect class, seeded by SECTION ID so this fixture
  // follows the registry instead of rotting the way the old positional one did. The defect roles that
  // used to live on removed sections have moved to the sections that render those values today:
  //   date skew   §6 Financial Profile  → Company Profiles
  //   ownership   §10 Trading Profile   → Exchange Ratio & Deal Terms
  //   '=' cell    §12 Football Field    → Exchange Ratio Analysis
  const s = [];
  s[sec('dashboard')]     = 'Executive Summary\nSalesforce acquires Atlassian at $111.05/share ($29.2B total) would be accretive, increasing EPS by 8.0% from $7.80 to $8.42.';
  s[sec('comparables')]   = 'Comparables\nMarket Cap\t$23.0B\t$136.0B\tSource: EDGAR, as of June 1, 2026';
  s[sec('profiles')]      = 'Company Profiles\nEnterprise Value\n$136.0B\nas of June 12, 2026';                       // DATE SKEW
  s[sec('proforma')]      = 'Pro Forma\nYear 1 ($935M)\n$7.80\n$6.66\n-14.6%\nDilutive\nGAAP standalone EPS\n$4\nSource: SEC EDGAR';  // Y1 DILUTIVE vs §0 accretive + 1-dp EPS
  s[sec('exchange')]      = 'Exchange Ratio & Deal Terms\nOffer Price\t$111.80\nPRO FORMA OWNERSHIP\nExisting holders\n92.5%\nFormer holders\n7.5%\nSource: assumptions';  // OFFER differs + ownership 92.5%
  s[sec('contribution')]  = 'Relative contribution\nPro Forma Ownership\n86.5%\n13.5%\nSource: 10-K';                 // OWNERSHIP 86.5% vs 92.5%
  s[sec('exchangeratio')] = 'Exchange Ratio Analysis\n=SUM(A1:A2)\nOffer Price\t$111.05';                              // '=' cell + NO footnote
  s[sec('analyst')]       = 'Analyst\nCurrent Price\n$85.42\nOffer Price\t$111.05\nas of June 1, 2026';
  s[sec('txnstructure')]  = 'Transaction Structure\nOffer Price\t$111.05\nSource: assumptions';
  for (let i = 0; i <= LAST_IDX; i++) if (!s[i]) s[i] = `Slide ${i}\nSource: SEC EDGAR, as of June 1, 2026`;
  const r = runChecks({ sections: s });
  const wantFail = ['offer-consistency', 'ownership-consistency', 'accretion-sign', 'data-date',
    'eps-decimals', 'no-equals-cell', 'sources-footnote'];
  // marketcap-consistency can no longer be constructed — only one section renders a market cap. It must
  // report NA, and asserting that keeps the coverage loss visible instead of letting it read as a pass.
  const wantNA = ['marketcap-consistency'];
  console.log('\n=== VALIDATOR SELF-TEST (synthetic deck with master PDF defects) ===');
  console.log(`  slide map: ${ACTIVE.length} public sections derived from deckRegistry (${LAST_IDX + 1} captured)`);
  let ok = 0;
  for (const id of wantFail) {
    const c = r.find(x => x.id === id);
    const detected = c && c.level === 'FAIL';
    console.log(`  ${detected ? '✅ detected' : '❌ MISSED  '}  [${id}] ${c ? c.level : 'absent'} — ${c ? c.detail : ''}`.slice(0, 200));
    if (detected) ok++;
  }
  for (const id of wantNA) {
    const c = r.find(x => x.id === id);
    const isNA = c && c.level === 'NA';
    console.log(`  ${isNA ? '➖ n/a as expected' : '❌ UNEXPECTED     '}  [${id}] ${c ? c.level : 'absent'} — ${c ? c.detail : ''}`.slice(0, 220));
    if (isNA) ok++;
  }
  const total = wantFail.length + wantNA.length;
  console.log(`\n  ${ok}/${total} defect classes behaving as expected (${wantFail.length} must FAIL, ${wantNA.length} structurally NA).`);
  console.log(ok === total ? '  ✅ SELF-TEST PASSED.' : '  ❌ SELF-TEST FAILED.');
  process.exit(ok === total ? 0 : 1);
}
if (process.argv.includes('--selftest')) selfTest();

// ── Main ────────────────────────────────────────────────────────────────────────────────────
const { sections, offer, errs } = await capture();
console.log(`\n=== DECK VALIDATOR :: ${AT} acquires ${TT} @ offer $${offer} ===`);
if (errs.length) console.log(`  [page errors: ${errs.length} :: ${errs.slice(0, 3).join(' | ')}]`);
const results = runChecks({ sections });
const icon = { PASS: '✅', FAIL: '❌', WARN: '⚠️ ', NA: '➖' };
for (const r of results) console.log(`  ${icon[r.level]} [${r.id}] ${r.detail}`);
const fails = results.filter(r => r.level === 'FAIL');
const warns = results.filter(r => r.level === 'WARN');
console.log(`\n  ${results.filter(r => r.level === 'PASS').length} pass · ${fails.length} fail · ${warns.length} warn · ${results.filter(r => r.level === 'NA').length} n/a`);
console.log(fails.length === 0 ? '  ✅ VALIDATOR PASSED — no cross-slide contradictions.' : '  ❌ VALIDATOR FAILED.');
process.exit(fails.length === 0 ? 0 : 1);
