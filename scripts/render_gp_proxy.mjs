// Renders the real deck for {acquirer} acquires {target}, proxying :3001 → fixed :3002, and dumps the
// gross-profit / gross-margin / opex lines from §4, §5, §6, §7 (pro-forma GP) and §10 (contribution).
// Usage: node scripts/render_gp_proxy.mjs AT AN TT TN
import puppeteer from 'puppeteer-core';
import http from 'http';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AT = process.argv[2], AN = process.argv[3], TT = process.argv[4], TN = process.argv[5];
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--no-first-run', '--window-size=1500,2300'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 2300 });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.setRequestInterception(true);
p.on('request', (req) => {
  const u = req.url();
  if (u.startsWith('http://localhost:3001/')) {
    const path = u.slice('http://localhost:3001'.length);
    http.get('http://localhost:3002' + path, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => req.respond({ status: r.statusCode || 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': r.headers['content-type'] || 'application/json' }, body: d }).catch(() => {})); }).on('error', () => req.respond({ status: 502, headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' }).catch(() => {}));
  } else { req.continue().catch(() => {}); }
});
const wait = async (re, t = 20000) => { const s = Date.now(); while (Date.now() - s < t) { if (re.test(await p.evaluate(() => document.body.innerText))) return true; await sleep(300); } return false; };
const load = async (i, tk, nm) => { const ins = await p.$$('input[id^="react-select"]'); await ins[i].click(); await ins[i].type(tk, { delay: 45 }); await sleep(1200); const c = await p.evaluate(() => { const o = document.querySelector('[id^="react-select"][id*="option"]'); if (o) { o.click(); return true; } return false; }); if (!c) await ins[i].press('Enter'); await wait(new RegExp(nm, 'i')); await sleep(1600); };
const clk = async (re) => { await p.evaluate(s => { const x = [...document.querySelectorAll('button')].find(y => new RegExp(s, 'i').test(y.textContent)); if (x) x.click(); }, re.source); await sleep(1200); };
const activeText = () => p.evaluate(() => { const h = document.querySelector('[aria-hidden="true"]'); const pr = h ? h.style.display : null; if (h) h.style.display = 'none'; const sc = [...document.querySelectorAll('div')].find(d => { const s = getComputedStyle(d); return s.overflowY === 'auto' && d.offsetHeight > 300; }); const t = (sc || document.body).innerText; if (h) h.style.display = pr; return t.replace(/\n{2,}/g, '\n').trim(); });
try {
  await p.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await clk(/Auto-Lookup/); await load(0, AT, AN); await load(1, TT, TN);
  await wait(/[\d.]+\s*mkt/i, 9000); await sleep(900);
  const m = (await p.evaluate(() => document.body.innerText)).match(/Suggested:\s*\$?([\d.]+)\/share/i);
  if (m) { await p.evaluate(v => { const el = document.querySelector('input[name="offerPricePerShare"]'); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); }, m[1]); await sleep(400); }
  console.log(`### ${AT} acquires ${TT} (proxied to fixed :3002) ###`);
  await clk(/Build merger model/); await sleep(1400); await p.mouse.click(750, 400);
  const grab = async (idx, title, re) => {
    await p.mouse.click(750, 400);
    for (let k = 0; k < idx; k++) { await p.keyboard.press('ArrowRight'); await sleep(340); }
    await sleep(1300);
    const t = await activeText();
    console.log(`\n--- ${title} (section ${idx}) ---`);
    const lines = t.split('\n'); const out = [];
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) out.push(lines[i] + (i + 1 < lines.length && /^[\(\-$\d]/.test(lines[i + 1].trim()) ? '  →  ' + lines[i + 1].trim() : ''));
    console.log(out.join('\n') || '(no match)');
    for (let k = 0; k < idx; k++) { await p.keyboard.press('ArrowLeft'); await sleep(110); }
    await sleep(250);
  };
  await grab(4, '§4 P&L Acquirer', /Gross Profit|Gross Margin|Operating Expense/i);
  await grab(5, '§5 P&L Target', /Gross Profit|Gross Margin|Operating Expense/i);
  await grab(6, '§6 Financial Profile', /Gross Profit/i);
  await grab(7, '§7 Pro Forma', /Gross Profit/i);
  await grab(11, '§10 Relative Contribution', /Gross Profit/i);
  console.log('\n[page errors: ' + errs.length + (errs.length ? ' :: ' + errs.slice(0, 3).join(' | ') : '') + ']');
} catch (e) { console.log('ERR', e.message); } finally { await b.close(); }
