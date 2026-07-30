// Renders the REAL deck for UNH (acquirer) acquiring ADBE (target), but proxies every localhost:3001
// API call to the FIXED server on :3002 via request interception — so the deck renders on corrected
// data WITHOUT touching the running :3001. Dumps §4/§5 P&L EPS and the §7 accretion table.
// Run: node scripts/render_eps_proxy.mjs   (needs the React app on :3000 and fixed server on :3002)
import puppeteer from 'puppeteer-core';
import http from 'http';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--no-first-run', '--window-size=1500,2300'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 2300 });
const errs = []; p.on('pageerror', e => errs.push(e.message));

// Proxy :3001 → :3002 (fixed server). Everything else loads normally.
await p.setRequestInterception(true);
p.on('request', (req) => {
  const u = req.url();
  if (u.startsWith('http://localhost:3001/')) {
    const path = u.slice('http://localhost:3001'.length);
    http.get('http://localhost:3002' + path, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => req.respond({ status: r.statusCode || 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': r.headers['content-type'] || 'application/json' }, body: d }).catch(() => {}));
    }).on('error', () => req.respond({ status: 502, headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' }).catch(() => {}));
  } else { req.continue().catch(() => {}); }
});

async function wait(re, t = 20000) { const s = Date.now(); while (Date.now() - s < t) { if (re.test(await p.evaluate(() => document.body.innerText))) return true; await sleep(300); } return false; }
async function load(i, tk, nm) { const ins = await p.$$('input[id^="react-select"]'); await ins[i].click(); await ins[i].type(tk, { delay: 45 }); await sleep(1200); const c = await p.evaluate(() => { const o = document.querySelector('[id^="react-select"][id*="option"]'); if (o) { o.click(); return true; } return false; }); if (!c) await ins[i].press('Enter'); await wait(new RegExp(nm, 'i')); await sleep(1600); }
async function clk(re) { await p.evaluate(s => { const x = [...document.querySelectorAll('button')].find(y => new RegExp(s, 'i').test(y.textContent)); if (x) x.click(); }, re.source); await sleep(1200); }
async function activeText() { return p.evaluate(() => { const h = document.querySelector('[aria-hidden="true"]'); const pr = h ? h.style.display : null; if (h) h.style.display = 'none'; const sc = [...document.querySelectorAll('div')].find(d => { const s = getComputedStyle(d); return s.overflowY === 'auto' && d.offsetHeight > 300; }); const t = (sc || document.body).innerText; if (h) h.style.display = pr; return t.replace(/\n{2,}/g, '\n').trim(); }); }

try {
  await p.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await clk(/Auto-Lookup/);
  await load(0, 'UNH', 'UnitedHealth');   // acquirer
  await load(1, 'ADBE', 'Adobe');         // target
  await wait(/[\d.]+\s*mkt/i, 9000); await sleep(900);
  const m = (await p.evaluate(() => document.body.innerText)).match(/Suggested:\s*\$?([\d.]+)\/share/i);
  if (m) { await p.evaluate(v => { const el = document.querySelector('input[name="offerPricePerShare"]'); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); }, m[1]); await sleep(400); }
  console.log(`### RENDERED DECK (proxied to fixed :3002): UNH acquires ADBE · offer $${m ? m[1] : '?'} ###`);
  await clk(/Build merger model/); await sleep(1400); await p.mouse.click(750, 400);
  const grab = async (idx, title, re) => {
    await p.mouse.click(750, 400);
    for (let k = 0; k < idx; k++) { await p.keyboard.press('ArrowRight'); await sleep(360); }
    await sleep(1400);
    const t = await activeText();
    console.log(`\n=== ${title} (section ${idx}) ===`);
    console.log(t.split('\n').filter(l => re.test(l)).join('\n') || '(no matching lines)');
    for (let k = 0; k < idx; k++) { await p.keyboard.press('ArrowLeft'); await sleep(120); }
    await sleep(300);
  };
  await grab(4, '§4 Standalone P&L — Acquirer (UNH)', /Diluted EPS|EPS|Net Income|Revenue/i);
  await grab(5, '§5 Standalone P&L — Target (ADBE)', /Diluted EPS|EPS|Net Income/i);
  await grab(7, '§7 Pro Forma — ACCRETION TABLE', /Acquirer EPS|Pro Forma EPS|Accretion|Verdict|Year [123]|\$[\d,]+\.\d{2}|[+\-]?\d+\.\d%|Accretive|Dilutive/i);
  console.log('\n[page errors: ' + errs.length + (errs.length ? ' :: ' + errs.slice(0, 3).join(' | ') : '') + ']');
} catch (e) { console.log('ERR', e.message); } finally { await b.close(); }
