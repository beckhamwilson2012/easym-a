// DEFINITIVE component-level proof: intercept /api/verified responses and INJECT a Yahoo price
// cross-check into sourceMeta (simulating Yahoo responding), then render §14 and §15 and confirm the
// fix filters Yahoo out of the prose AND the appendix columns. Without the fix, §14 would read
// "CNBC, Nasdaq and Yahoo Finance" and §15 would gain a Yahoo column.
import puppeteer from 'puppeteer-core';
import http from 'http';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AT = 'MSFT', AN = 'Microsoft', TT = 'ADBE', TN = 'Adobe';
const getJson = (path) => new Promise((res) => { http.get('http://localhost:3001' + path, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', () => res(null)); });

// Pre-fetch + inject yahoo ONCE per ticker (deterministic — no in-handler race).
const injected = {};
for (const t of ['MSFT', 'ADBE']) {
  const data = await getJson('/api/verified/' + t);
  if (data?.fields?.price) {
    const px = data.fields.price.value;
    data.fields.price.sourceMeta = { ...(data.fields.price.sourceMeta || {}), yahoo: { value: px, asOf: '2026-06-09', period: null } };
    data.fields.price.status = 'verified';
    if (data.fields.week52High) data.fields.week52High.sourceMeta = { ...(data.fields.week52High.sourceMeta || {}), yahoo: { value: data.fields.week52High.value, asOf: '2026-06-09', period: null } };
  }
  injected[t] = JSON.stringify(data);
  console.log(`pre-injected ${t} price sources -> [${Object.keys(data?.fields?.price?.sourceMeta || {}).join(',')}]`);
}

const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--no-first-run', '--window-size=1500,2300'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 2300 });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (req) => {
  const m = req.url().match(/\/api\/verified\/([A-Z]+)/i);
  if (m && injected[m[1].toUpperCase()]) {
    // Must include CORS headers — the page is :3000 fetching :3001; without them the browser blocks
    // the synthesized response and the component gets null data (blank slide), invalidating the test.
    return req.respond({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: injected[m[1].toUpperCase()],
    });
  }
  return req.continue();
});
async function wait(re, t = 18000) { const s = Date.now(); while (Date.now() - s < t) { if (re.test(await p.evaluate(() => document.body.innerText))) return true; await sleep(300); } return false; }
async function load(i, tk, nm) { const ins = await p.$$('input[id^="react-select"]'); await ins[i].click(); await ins[i].type(tk, { delay: 40 }); await sleep(1000); const c = await p.evaluate(() => { const o = document.querySelector('[id^="react-select"][id*="option"]'); if (o) { o.click(); return true; } return false; }); if (!c) await ins[i].press('Enter'); await wait(new RegExp(nm, 'i')); await sleep(1500); }
async function clk(re) { await p.evaluate(s => { const x = [...document.querySelectorAll('button')].find(y => new RegExp(s, 'i').test(y.textContent)); if (x) x.click(); }, re.source); await sleep(1200); }
async function activeText() { return p.evaluate(() => { const h = document.querySelector('[aria-hidden="true"]'); const pr = h ? h.style.display : null; if (h) h.style.display = 'none'; const sc = [...document.querySelectorAll('div')].find(d => { const s = getComputedStyle(d); return s.overflowY === 'auto' && d.offsetHeight > 300; }); const t = (sc || document.body).innerText; if (h) h.style.display = pr; return t.replace(/\n{2,}/g, '\n').trim(); }); }
try {
  await p.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await clk(/Auto-Lookup/); await load(0, AT, AN); await load(1, TT, TN);
  await wait(/[\d.]+\s*mkt/i, 9000); await sleep(900);
  const m = (await p.evaluate(() => document.body.innerText)).match(/Suggested:\s*\$?([\d.]+)\/share/i);
  if (m) { await p.evaluate(v => { const el = document.querySelector('input[name="offerPricePerShare"]'); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); }, m[1]); await sleep(400); }
  await clk(/Build merger model/); await sleep(1300); await p.mouse.click(750, 400);
  for (let i = 0; i < 14; i++) { await p.keyboard.press('ArrowRight'); await sleep(380); }
  await sleep(1500);
  const t14 = await activeText();
  await p.keyboard.press('ArrowRight'); await sleep(1200);
  const t15 = await activeText();
  const has = (t, re) => re.test(t);
  console.log('INJECTED yahoo into /api/verified price.sourceMeta for MSFT & ADBE.');
  console.log('§14 names Yahoo:', has(t14, /Yahoo/) ? 'YES (FAIL)' : 'no (PASS)');
  console.log('§14 pricing line:', (t14.match(/are sourced from[^.]*\./) || ['(not found)'])[0]);
  console.log('§15 has Yahoo column:', has(t15, /Yahoo/) ? 'YES (FAIL)' : 'no (PASS)');
  console.log('§15 price row verified status present:', has(t15, /Current Price/) ? 'yes' : 'no');
  console.log('[page errors: ' + errs.length + ']');
} catch (e) { console.log('ERR', e.message); } finally { await b.close(); }
