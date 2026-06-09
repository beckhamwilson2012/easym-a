// FINAL QA: build a pair at the suggested offer and dump ALL 16 sections' visible text in order.
// Usage: node scripts/qaFull.mjs [AT AN TT TN]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AT = process.argv[2] || 'CRM', AN = process.argv[3] || 'Salesforce', TT = process.argv[4] || 'TEAM', TN = process.argv[5] || 'Atlassian';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--no-first-run', '--window-size=1500,2300'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 2300 });
const errs = []; p.on('pageerror', e => errs.push(e.message));
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
  console.log(`### QA BUILD: acquirer=${AT} target=${TT} | suggested offer=$${m ? m[1] : '?'} ###`);
  await clk(/Build merger model/); await sleep(1300); await p.mouse.click(750, 400);
  for (let idx = 0; idx <= 15; idx++) {
    if (idx > 0) { await p.mouse.click(750, 400); for (let k = 0; k < idx; k++) { await p.keyboard.press('ArrowRight'); await sleep(360); } }
    await sleep(1400);
    console.log(`\n=================== SECTION ${idx} ===================`);
    console.log(await activeText());
    // reset to dashboard for clean re-navigation
    for (let k = 0; k < idx; k++) { await p.keyboard.press('ArrowLeft'); await sleep(120); }
    await sleep(300);
  }
  console.log('\n[page errors: ' + errs.length + (errs.length ? ' :: ' + errs.slice(0, 5).join(' | ') : '') + ']');
} catch (e) { console.log('ERR', e.message); } finally { await b.close(); }
