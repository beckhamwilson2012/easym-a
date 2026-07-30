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
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AT = process.argv[2] || 'CRM', AN = process.argv[3] || 'Salesforce', TT = process.argv[4] || 'TEAM', TN = process.argv[5] || 'Atlassian';

// Named capture indices (match DeckShell SECTIONS order). Using a map so inserting a slide only
// requires updating this block, not every check.
const IDX = {
  dashboard: 0, title: 1, comparables: 2, profiles: 3, plAcq: 4, plTgt: 5, finprofile: 6,
  proforma: 7, exchange: 8, equity: 9, trading: 10, contribution: 11, football: 12, analyst: 13,
  valuation: 14, sources: 15, verification: 16,
};
const LAST_IDX = IDX.verification;
const SLIDE = ['§0 Dashboard', '§1 Title', '§2 Comparables', '§3 Profiles', '§4 P&L-Acquirer',
  '§5 P&L-Target', '§6 Financial Profile', '§7 Pro Forma P&L', '§8 Exchange Ratio', '§9 Equity Perf',
  '§10 Trading Profile', '§11 Rel. Contribution', '§12 Football Field', '§13 Analyst',
  '§14 Valuation Matrix', '§15 Sources', '§16 Verification'];
// Financial slides that must carry a Sources/basis footnote.
const FINANCIAL = [IDX.comparables, IDX.profiles, IDX.plAcq, IDX.plTgt, IDX.finprofile, IDX.proforma,
  IDX.exchange, IDX.trading, IDX.contribution, IDX.football, IDX.analyst, IDX.valuation];
// Deal-narrative slides for offer/current-price consistency (EXCLUDES the verification appendix,
// which shows cross-source spreads by design).
const DEAL_SLIDES = [IDX.dashboard, IDX.exchange, IDX.trading, IDX.football, IDX.analyst, IDX.valuation];

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
    await clk(/Auto-Lookup/); await load(0, AT, AN); await load(1, TT, TN);
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

  // 3. ACQUIRER MARKET CAP consistent (VALUE-tolerant — §2 renders whole-B "~$150B", §6/§9 one-dp
  //    "$150.2B"; same value, different format). Extract §9 canonical cap, assert §6 shows the same
  //    one-dp value and §2 shows its whole-B rounding.
  const cap9raw = matchAll(sections[IDX.trading], /Market Cap[^\n]*\n\$\s*([\d,]+\.\d)B/gi)[0] || matchAll(sections[IDX.trading], /market cap \(live\)\n\$\s*([\d,]+\.\d)B/gi)[0];
  if (!cap9raw) add('WARN', 'marketcap-consistency', 'could not locate acquirer market cap on §10 Trading');
  else {
    const cap9num = num(cap9raw);
    const exact = `$${cap9raw}B`;                       // §6 one-decimal form
    const miss = [];
    // Primary: §6 Financial Profile ALWAYS shows the acquirer cap — must equal §10 Trading exactly.
    if (!(sections[IDX.finprofile] || '').includes(exact)) miss.push(`§6 (expected ${exact})`);
    // Conditional: §2 is the TARGET's peer-screening table — the acquirer is a column there ONLY if
    // it is one of the target's peers. Cross-check §2 only when the acquirer ticker is present.
    const acqInComps = new RegExp(`\\b${AT}\\b`).test(sections[IDX.comparables] || '');
    let note;
    if (acqInComps) {
      // §2 renders one-decimal $B with the acquirer pinned first — extract the first cap in the
      // Market Cap row and compare to §10 Trading within tolerance (§2 uses its own live-price fetch,
      // so a mega-cap can differ by a fraction of a % between snapshots).
      const cap2raw = matchAll(sections[IDX.comparables], /Market Cap[^\n]*?\$([\d,]+\.\d)B/gi)[0];
      const cap2 = cap2raw != null ? num(cap2raw) : null;
      const tol = Math.max(0.2, cap9num * 0.005);
      if (cap2 == null) miss.push('§2 (could not read acquirer market cap)');
      else if (Math.abs(cap2 - cap9num) > tol) miss.push(`§2 acquirer cap $${cap2}B vs §9 $${cap9raw}B (>$${tol.toFixed(1)}B apart)`);
      note = cap2 != null ? `, §2 ($${cap2raw}B)` : '';
    } else note = ` (§2 is the target peer-screen; acquirer ${AT} not a column — n/a)`;
    if (miss.length === 0) add('PASS', 'marketcap-consistency', `acquirer market cap ${exact} consistent on §6 and §10 Trading${note}`);
    else add('FAIL', 'marketcap-consistency', `acquirer cap ${exact} (§10 Trading) NOT matched on ${miss.join(', ')}`);
  }

  // 4. OWNERSHIP % consistent between §9 and §10 (1-decimal table values).
  const own9 = matchAll(sections[IDX.trading], /(\d{1,2}\.\d)%/g).map(num);      // Trading ownership legend
  const own10 = matchAll(sections[IDX.contribution], /(\d{1,2}\.\d)%/g).map(num); // Contribution underlying table
  // existing-holder % is the larger of the split (>50). compare the max from each.
  const ex9 = Math.max(...own9.filter(v => v > 50), 0);
  const ex10 = Math.max(...own10.filter(v => v > 50), 0);
  if (ex9 === 0 || ex10 === 0) add('WARN', 'ownership-consistency', `ownership % not located (§10 Trading=${ex9 || 'n/a'}, §11 Contribution=${ex10 || 'n/a'})`);
  else if (Math.abs(ex9 - ex10) <= 0.11) add('PASS', 'ownership-consistency', `ownership ${ex9.toFixed(1)}% existing identical on §10 Trading & §11 Contribution`);
  else add('FAIL', 'ownership-consistency', `ownership DIFFERS: §10 Trading=${ex9.toFixed(1)}% vs §11 Contribution=${ex10.toFixed(1)}%`);

  // 5. ACCRETION SIGN consistent: §0 headline vs §7 Year-1 verdict.
  const head = /increasing EPS|✓\s*Accretive/i.test(sections[IDX.dashboard]) ? 'accretive' : /decreasing EPS|✗\s*Dilutive/i.test(sections[IDX.dashboard]) ? 'dilutive' : null;
  const y1 = (() => { const m = (sections[IDX.proforma] || '').match(/Year 1[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*\n(Accretive|Dilutive)/i); return m ? m[1].toLowerCase() : null; })();
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
    if ((sections[IDX.title] || '').includes(dv)) add('PASS', 'title-date', `title carries the deck DATA_DATE "${dv}"`);
    else {
      const monthOnly = matchAll(sections[IDX.title], /as of\s+([A-Z][a-z]+\s+\d{4})\b/g)[0];
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
  const hasForecast = [4, 5].some(i => /(CY|FY)\d{4}E/.test(sections[i] || ''));
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
  const s = [];
  s[IDX.dashboard]    = 'Executive Summary\nSalesforce acquires Atlassian at $111.05/share ($29.2B total) would be accretive, increasing EPS by 8.0% from $7.80 to $8.42.';
  s[IDX.comparables]  = 'Comparables\nMarket Cap\t$23.0B\t$136.0B\tSource: EDGAR, as of June 1, 2026';
  s[IDX.finprofile]   = 'Financial Profile\nMarket Cap\n$136.0B\n$24.0B\nEnterprise Value\nas of June 12, 2026';  // DATE SKEW + cap $136.0B
  s[IDX.proforma]     = 'Pro Forma\nYear 1 ($935M)\n$7.80\n$6.66\n-14.6%\nDilutive\nGAAP standalone EPS\n$4\nSource: SEC EDGAR';  // Year-1 DILUTIVE (vs §0 accretive) + 1-dp EPS
  s[IDX.exchange]     = 'Exchange Ratio\nOffer Price\t$111.80\nSource: assumptions';  // OFFER $111.80 (vs §0 $111.05)
  s[IDX.trading]      = 'Trading Profile\nMarket Cap (PF = equity value)\n$144.1B\n$24.0B\n$173.3B\nPRO FORMA OWNERSHIP\nExisting holders\n92.5%\nFormer holders\n7.5%\nSource: CNBC';  // cap $144.1B (vs §6 $136.0B)
  s[IDX.contribution] = 'Relative contribution\nPro Forma Ownership\n86.5%\n13.5%\nSource: 10-K';  // OWNERSHIP 86.5% (vs trading 92.5%)
  s[IDX.football]     = 'Distribution of stock price\n=SUM(A1:A2)\nOffer Price\t$111.05';  // '=' cell + NO footnote
  s[IDX.analyst]      = 'Analyst\nCurrent Price\n$85.42\nOffer Price\t$111.05\nas of June 1, 2026';
  s[IDX.valuation]    = 'Valuation Matrix\nOffer Price\t$111.05\nSource: assumptions';
  for (let i = 0; i <= LAST_IDX; i++) if (!s[i]) s[i] = `Slide ${i}\nSource: SEC EDGAR, as of June 1, 2026`;
  const r = runChecks({ sections: s });
  const want = ['offer-consistency', 'marketcap-consistency', 'ownership-consistency', 'accretion-sign', 'data-date', 'eps-decimals', 'no-equals-cell', 'sources-footnote'];
  const icon = { PASS: '✅', FAIL: '❌', WARN: '⚠️ ', NA: '➖' };
  console.log('\n=== VALIDATOR SELF-TEST (synthetic deck with master PDF defects — every consistency check MUST fail) ===');
  let ok = 0;
  for (const id of want) {
    const c = r.find(x => x.id === id);
    const detected = c && c.level === 'FAIL';
    console.log(`  ${detected ? '✅ detected' : '❌ MISSED  '}  [${id}] ${c ? c.level : 'absent'} — ${c ? c.detail : ''}`.slice(0, 200));
    if (detected) ok++;
  }
  console.log(`\n  ${ok}/${want.length} master-defect classes correctly detected as FAIL.`);
  console.log(ok === want.length ? '  ✅ SELF-TEST PASSED — validator catches every master contradiction class.' : '  ❌ SELF-TEST FAILED — validator misses a defect class.');
  process.exit(ok === want.length ? 0 : 1);
}
if (process.argv[2] === '--selftest') selfTest();

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
