// STAGE 10 sweep v2 — CAPTURE ONLY. Build each deck (Puppeteer) + fetch the raw
// per-company oracle (/quote,/api/price) at build time, save a durable raw record
// per pair to $SWEEP_RAW_DIR/{A}_{B}.json (default /tmp/sweep_v2_raw). Analysis is a separate pass so an
// expensive live build is never lost. Backoff on failure; never abort the batch.
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// SWEEP_APP_PORT — the app port this capture talks to. Default 3001, so every existing caller resolves
// the identical string it did before and nothing about a default run changes.
//
// It was a hardcoded literal, which is what made worktree isolation a PARTIAL mitigation: a second tree
// could have its own checkout and its own branch, but both trees resolved localhost:3001 to the same
// socket, so a sweep still captured against — and restart_server still killed — whatever else held that
// port. One writer per tree was therefore not enough; it had to be one app server per machine.
//
// The runner sets this from the SAME number it derives APP_PORT from, so the port it frees, the port it
// starts the server on, and the port this collector fetches from cannot drift apart. They could before:
// BASE_URL=...:3002 made the runner free :3002 and start a server that still listened on :3001 (no PORT
// was ever passed), while this constant captured :3001 regardless.
const APP_PORT = process.env.SWEEP_APP_PORT || '3001';
const BASE = `http://localhost:${APP_PORT}`;
// SWEEP_RAW_DIR run-scopes this directory. The default is unchanged, so any other caller behaves exactly
// as before — this is path plumbing, not a change to what a deck contains or to what counts as dirty.
//
// Why it exists: /tmp/sweep_v2_raw was ONE directory shared by every run. Run 20260816-212606's orphaned
// capture kept writing failure stubs into it while run -222441 captured, and -222441's `cp "$RAW"/*.json`
// swept 15 foreign stubs into its own baseline — a "25 defect" baseline whose true value was 10. The
// writer is here (156, 197) and the resume read is here (184), so scoping the runner's copy alone would
// not have stopped it.
const RAW = process.env.SWEEP_RAW_DIR || '/tmp/sweep_v2_raw';
const STATUS = process.env.SWEEP_STATUS_LOG || '/tmp/sweep_v2_status.log';
// Progress → the runner's loop.log (Part 1): a 50-pair capture used to print one line then go silent for
// ~88 min. The runner passes LOOP_LOG + CAPTURE_PHASE so each deck emits one honest "N/total pair ok|failed"
// line as it lands. No progress is invented — a line appears only when a deck actually finishes.
const LOOP_LOG = process.env.LOOP_LOG || '';
const CAP_PHASE = process.env.CAPTURE_PHASE || 'capture';
function plog(msg) { if (!LOOP_LOG) return; const t = new Date().toTimeString().slice(0, 8); try { fs.appendFileSync(LOOP_LOG, `[${t}] ${msg}\n`); } catch (_) {} }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pairs = process.argv[2] ? JSON.parse(process.argv[2]) : []; // [["A","B",offerOverrideOrNull],...] (empty when required as a module for tests)
const NOISE = /Download the React DevTools|Warning: .*defaultProps|source map|\[HMR\]|webpack|Recharts/i;

function get(path) {
  return new Promise((resolve) => {
    const req = http.get(BASE + path, { timeout: 30000 }, res => {
      let s = ''; res.on('data', d => s += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(s) }); }
                            catch (e) { resolve({ status: res.statusCode, json: null, raw: s.slice(0, 200) }); } });
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
  });
}

// Independent oracle: the raw fundamentals endpoints the app itself maps from.
async function oracle(t) {
  const q = await get(`/quote?symbol=${t}`);
  const p = await get(`/api/price/${t}`);
  const j = q.json || {};
  const pick = ['name','revenue','ebitda','operatingIncome','grossProfit','netIncome','shares','dilutedShares',
    'eps','cash','shortTermInvestments','debt','totalAssets','sharePrice','companyType','sic','sicDescription',
    'balanceSheetAsOf','fiscalYear','fiscalPeriod'];
  const o = {}; for (const k of pick) o[k] = j[k];
  o.ltm = j.ltm ? { trusted: j.ltm.trusted, revenue: j.ltm.revenue, ebitda: j.ltm.ebitda, netIncome: j.ltm.netIncome,
    operatingIncome: j.ltm.operatingIncome, grossProfit: j.ltm.grossProfit, eps: j.ltm.eps,
    dilutedShares: j.ltm.dilutedShares, asOf: j.ltm.asOf } : null;
  o.livePrice = p.json ? p.json.price : null;
  o.priceSource = p.json ? p.json.source : null;
  o._quoteStatus = q.status; o._priceStatus = p.status;
  return o;
}

// Fast-bail wait. Resolves 'ok' the instant the target " loaded" count is reached — byte-identical to the
// original 80s waitForFunction on the SUCCESS path. Resolves 'ratelimited' EARLY (after a short grace)
// only if a 429 appeared on the console AND the ticker still has not loaded, instead of idling the full
// 80s after what the diagnosis showed is a fast upstream failure. A benign nongaap 429 that still lets
// the deck load never trips it, because the loaded-wait resolves first. The 80000ms budget is unchanged.
function waitLoadedOrBail(page, want) {
  return new Promise((resolve, reject) => {
    let done = false, saw429 = false;
    const onConsole = m => { if (m.type() === 'error' && /429|Too Many Requests/i.test(m.text())) saw429 = true; };
    page.on('console', onConsole);
    const finish = (fn, v) => { if (!done) { done = true; page.off('console', onConsole); fn(v); } };
    page.waitForFunction(n => (document.body.innerText.match(/ loaded/g) || []).length >= n, { timeout: 80000 }, want)
      .then(() => finish(resolve, 'ok'))
      .catch(err => saw429 ? finish(resolve, 'ratelimited') : finish(reject, err));
    const BAIL_AFTER = 15000, STEP = 1000; let elapsed = 0;                        // fast-bail on a stalled load
    const tick = async () => {
      if (done) return;
      elapsed += STEP;
      if (saw429 && elapsed >= BAIL_AFTER) {
        const loaded = await page.evaluate(w => (document.body.innerText.match(/ loaded/g) || []).length >= w, want).catch(() => false);
        if (!loaded) return finish(resolve, 'ratelimited');
      }
      if (!done) setTimeout(tick, STEP);
    };
    setTimeout(tick, STEP);
  });
}

// On the SUCCESS path this is byte-identical to the original (click, type, Enter, wait). On a rate-limited
// stall it bails fast, backs off exponentially, and retries up to 3 attempts before throwing with
// reason=RATE_LIMITED so the caller can distinguish a transient network event from a code failure.
async function loadTicker(page, idx, t) {
  const ins = await page.$$('input[id^="react-select"]');
  if (ins.length < idx + 1) throw new Error(`no react-select input ${idx}`);
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0) { await ins[idx].click({ clickCount: 3 }); await page.keyboard.press('Backspace'); } // clear residual on retry only
    await ins[idx].click(); await ins[idx].type(t, { delay: 15 }); await sleep(160); await page.keyboard.press('Enter');
    const outcome = await waitLoadedOrBail(page, idx + 1);
    if (outcome === 'ok') return;
    if (attempt >= 2) { const e = new Error(`loadTicker ${t}: rate-limited, gave up after 3 attempts`); e.reason = 'RATE_LIMITED'; throw e; }
    await sleep(2000 * Math.pow(2, attempt)); // exponential backoff: 2s, 4s
  }
}

async function runPair(browser, A, B, offerOverride) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const cErr = [], cWarn = [], pErr = [];
  page.on('console', m => { const t = m.text(); if (m.type() === 'error') cErr.push(t); else if (m.type() === 'warning' && !NOISE.test(t)) cWarn.push(t); });
  page.on('pageerror', e => pErr.push(e.message));
  const rec = { pair: `${A}/${B}`, A, B, offerOverride: offerOverride || null, ts: new Date().toISOString(), ok: false, stage: 'start' };
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // POST-d1bfd2d ENTRY FLOW (re-pointed 2026-09-17). The old Auto-Lookup/Manual mode chooser is gone;
    // the landing screen is deal-type-first and `Public → Public` (chooseDealType('pubpub'), src/App.js:1498)
    // sets both sides public and mode='entry' in one click. Every capture pair is ticker/ticker, so pubpub is
    // always the right branch. The arrow class tolerates → / -> / - so a glyph change does not break capture.
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(x => /Public\s*[→>-]+\s*Public/.test(x.textContent)), { timeout: 30000 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find(x => /Public\s*[→>-]+\s*Public/.test(x.textContent)).click());
    await page.waitForSelector('input[id^="react-select"]', { timeout: 30000 });
    rec.stage = 'loadA'; await loadTicker(page, 0, A);
    rec.stage = 'loadB'; await loadTicker(page, 1, B);
    await sleep(1600);
    // offer: explicit override (ground truth) OR the app's suggested 30% ("Use this")
    if (offerOverride != null) {
      rec.stage = 'offerOverride';
      await page.evaluate((v) => {
        const el = [...document.querySelectorAll('input')].find(i => /offer/i.test(i.name || '') || /offer/i.test(i.getAttribute('aria-label') || ''));
        return null; // fallthrough: override handled below via name=offerPricePerShare
      }, offerOverride);
      const set = await page.evaluate((v) => {
        const el = document.querySelector('input[name="offerPricePerShare"]');
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }, offerOverride);
      rec.offerSet = set;
    } else {
      rec.stage = 'offer';
      rec.suggestedOfferApplied = await page.evaluate(() => { const el = [...document.querySelectorAll('button')].find(b => /Use this/.test(b.textContent)); if (el) { el.click(); return true; } return false; });
    }
    rec.stage = 'buildEnable';
    // d1bfd2d also renamed this button: 'Build merger model →' → 'Run Analysis →', now gated on
    // (bothReady && offerSet) rather than offerPricePerShare > 0 (src/App.js:1534). Same !disabled wait.
    await page.waitForFunction(() => { const el = [...document.querySelectorAll('button')].find(e => /Run Analysis/.test(e.textContent)); return el && !el.disabled; }, { timeout: 30000 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find(e => /Run Analysis/.test(e.textContent)).click());
    rec.stage = 'deck';
    await page.waitForSelector('[data-section-id="verification2"]', { timeout: 80000 });
    let prev = -1, st = 0; for (let i = 0; i < 32; i++) { await sleep(1500); const n = await page.$$eval('[data-section-id="verification"] tbody tr', e => e.length).catch(() => 0); if (n === prev && n > 0) { if (++st >= 2) break; } else st = 0; prev = n; }
    rec.stage = 'extract';
    const data = await page.evaluate(() => {
      const secs = {}; document.querySelectorAll('[data-section-id]').forEach(el => secs[el.getAttribute('data-section-id')] = el.innerText);
      return { pdfPages: document.querySelectorAll('[data-section-id]').length, sections: secs, bodyText: document.body.innerText };
    });
    rec.pdfPages = data.pdfPages;
    rec.sections = data.sections;
    rec.bodyText = data.bodyText;
    rec.ok = true; rec.stage = 'done';
  } catch (e) {
    rec.error = e.message;
    rec.reason = e.reason || 'OTHER'; // RATE_LIMITED (environmental) vs OTHER (code/load) — only set on failure
    try { rec.loadedCount = await page.evaluate(() => (document.body.innerText.match(/ loaded/g) || []).length); } catch (_) {}
  } finally {
    rec.consoleErrors = [...new Set(cErr)]; rec.consoleWarnings = [...new Set(cWarn)]; rec.pageErrors = [...new Set(pErr)];
    await page.close();
  }
  // oracle right after build (minimise drift)
  try { rec.oracleA = await oracle(A); rec.oracleB = await oracle(B); } catch (e) { rec.oracleError = e.message; }
  fs.writeFileSync(`${RAW}/${A}_${B}.json`, JSON.stringify(rec));
  return rec;
}

const GAP = parseInt(process.env.GAP_MS || '30000', 10);       // inter-build spacing — stay under 500/15min
const COOLDOWN = parseInt(process.argv[3] || '0', 10);          // startup idle (ms) to let a tripped window reset
// A capture is DIRTY unless the DECK itself is complete. A benign console-429 (the /api/nongaap LLM
// limiter, 30/hr) is fine — the deck builds on GAAP fallback. But rate-limit stress during a build can
// silently drop EDGAR-sourced rows (CMCSA/PARA: no Equity/EV rows, source "CNBC only") or fail prices
// (CVS/CI: Equity/EV render "⚠"). Neither raises a pageError and cErr can be 0, so gate on the rendered
// artifact: §2 must be EDGAR-sourced AND (non-bank) carry a numeric target Enterprise Value.
function deckComplete(r) {
  if (!r.ok || (r.pageErrors || []).length > 0) return false;
  const c = (r.sections && r.sections.comparables) || '';
  const body = r.bodyText || '';
  if (!/EDGAR/i.test(c)) return false;                       // degraded to CNBC-only → EDGAR fetch failed
  const isBank = /Bank M&A Mode|CET1|P ?\/ ?TBV/i.test(body);
  if (isBank) return true;                                   // banks legitimately suppress EV leverage
  const evLine = c.split('\n').find(l => /Enterprise Value/i.test(l) && /\t/.test(l));
  if (!evLine) return false;
  const p = evLine.split('\t'); const li = p.findIndex(z => /Enterprise Value/i.test(z));
  const tgt = li >= 0 && p.length >= li + 3 ? p[li + 2].trim() : '';
  return /\d/.test(tgt);                                     // numeric (not ⚠ / —)
}
const dirty = r => !deckComplete(r)
  || !(r.oracleA && r.oracleA._quoteStatus === 200) || !(r.oracleB && r.oracleB._quoteStatus === 200);
// resumable: a pair already captured CLEANLY is skipped, so relaunches only fill gaps
function alreadyClean(A, B) {
  try { const r = JSON.parse(fs.readFileSync(`${RAW}/${A}_${B}.json`, 'utf8')); return !dirty(r); } catch (e) { return false; }
}

// Guarded so `require()`-ing this file for tests does NOT launch the batch. When run as a script
// (require.main === module) it executes exactly as before — successful-capture output is unchanged.
if (require.main === module) (async () => {
  if (COOLDOWN > 0) { process.stderr.write(`cooldown ${COOLDOWN / 1000}s...`); await sleep(COOLDOWN); }
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const retry = [];
  const one = async (A, B, off, tag) => {
    process.stderr.write(`\n>>> ${tag}${A}/${B}${off ? '@' + off : ''} ...`);
    let r;
    try { r = await runPair(browser, A, B, off); }
    catch (e) { r = { pair: `${A}/${B}`, ok: false, error: 'FATAL ' + e.message, stage: 'fatal' }; fs.writeFileSync(`${RAW}/${A}_${B}.json`, JSON.stringify(r)); }
    const d = dirty(r);
    const line = `${r.ok ? (d ? 'DIRTY' : 'OK ') : 'FAIL'} ${tag}${r.pair.padEnd(12)} pages=${r.pdfPages ?? '-'} cErr=${(r.consoleErrors || []).length} pErr=${(r.pageErrors || []).length} dbtA=${r.oracleA ? r.oracleA.debt : '?'} dbtB=${r.oracleB ? r.oracleB.debt : '?'} ${r.error ? ('ERR@' + r.stage + ':' + r.error.slice(0, 40)) : ''}`;
    fs.appendFileSync(STATUS, `[${new Date().toISOString()}] ${line}\n`);
    process.stderr.write(' ' + (r.ok ? (d ? 'dirty' : 'ok') : 'FAIL ' + r.stage));
    return { r, d };
  };
  let idx = 0; const total = pairs.length;
  plog(`  ${CAP_PHASE}: ${total} decks starting`);
  for (const [A, B, off] of pairs) {
    idx++;
    if (off == null && alreadyClean(A, B)) { process.stderr.write(`\n=== skip ${A}/${B} (already clean) ===`); fs.appendFileSync(STATUS, `[${new Date().toISOString()}] SKIP ${A}/${B} (already clean)\n`); plog(`  ${CAP_PHASE} ${idx}/${total} ${A}/${B} — skip (already clean)`); continue; }
    const { r, d } = await one(A, B, off, '');
    plog(`  ${CAP_PHASE} ${idx}/${total} ${A}/${B} — ${r.ok ? (d ? 'dirty' : 'ok') : 'FAILED'}`);
    if (d) retry.push([A, B, off]);
    await sleep(GAP);
  }
  // retry-once pass — by now any window-boundary 429s have cleared
  if (retry.length) {
    process.stderr.write(`\n--- RETRY PASS (${retry.length}) after 90s ---`);
    fs.appendFileSync(STATUS, `[${new Date().toISOString()}] --- RETRY PASS ${retry.length}: ${retry.map(p => p[0] + '/' + p[1]).join(' ')} ---\n`);
    await sleep(90000);
    for (const [A, B, off] of retry) { const { r, d } = await one(A, B, off, 'RETRY:'); plog(`  ${CAP_PHASE} retry ${A}/${B} — ${r.ok ? (d ? 'dirty' : 'ok') : 'FAILED'}`); await sleep(GAP); }
  }
  await browser.close();
  process.stderr.write('\nCAPTURE BATCH DONE\n');
  fs.appendFileSync(STATUS, `[${new Date().toISOString()}] CAPTURE BATCH DONE (retry=${retry.length})\n`);
})().catch(e => { fs.appendFileSync(STATUS, `FATAL ${e.message}\n`); process.exit(1); });

module.exports = { loadTicker, waitLoadedOrBail, runPair }; // test-only exports; no effect when run as a script
