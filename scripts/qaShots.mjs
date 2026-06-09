// VISUAL QA: build a pair at the suggested offer and capture a full-height PNG of every section
// (0..15) into OUTDIR. Expands the scroll container so tall slides aren't clipped; hides the
// offscreen aria-hidden PDF container so only the live section is captured.
// Usage: node scripts/qaShots.mjs <OUTDIR> [AT AN TT TN]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = process.argv[2] || '/tmp/qa_shots';
const AT = process.argv[3] || 'CRM', AN = process.argv[4] || 'Salesforce', TT = process.argv[5] || 'TEAM', TN = process.argv[6] || 'Atlassian';
mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--no-first-run', '--window-size=1500,2400'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 2400, deviceScaleFactor: 1.5 });
const errs = []; p.on('pageerror', e => errs.push(e.message));
async function wait(re, t = 18000) { const s = Date.now(); while (Date.now() - s < t) { if (re.test(await p.evaluate(() => document.body.innerText))) return true; await sleep(300); } return false; }
async function load(i, tk, nm) { const ins = await p.$$('input[id^="react-select"]'); await ins[i].click(); await ins[i].type(tk, { delay: 40 }); await sleep(1000); const c = await p.evaluate(() => { const o = document.querySelector('[id^="react-select"][id*="option"]'); if (o) { o.click(); return true; } return false; }); if (!c) await ins[i].press('Enter'); await wait(new RegExp(nm, 'i')); await sleep(1500); }
async function clk(re) { await p.evaluate(s => { const x = [...document.querySelectorAll('button')].find(y => new RegExp(s, 'i').test(y.textContent)); if (x) x.click(); }, re.source); await sleep(1200); }
async function shoot(idx) {
  await p.mouse.move(5, 5); // move cursor off the chart so no hover tooltip is captured
  await sleep(250);
  // Hide the offscreen PDF container; expand the visible scroll container to full height; tag it.
  const ok = await p.evaluate(() => {
    const h = document.querySelector('[aria-hidden="true"]'); if (h) h.style.display = 'none';
    const sc = [...document.querySelectorAll('div')].find(d => { const s = getComputedStyle(d); return s.overflowY === 'auto' && d.offsetHeight > 300; });
    if (!sc) return false;
    sc.id = 'qa-cap'; sc.style.height = 'auto'; sc.style.maxHeight = 'none'; sc.style.overflow = 'visible';
    return true;
  });
  await sleep(500);
  const el = ok ? await p.$('#qa-cap') : null;
  if (el) { await el.screenshot({ path: `${OUT}/s${String(idx).padStart(2, '0')}.png` }); }
  else { await p.screenshot({ path: `${OUT}/s${String(idx).padStart(2, '0')}.png` }); }
  await p.evaluate(() => { const e = document.getElementById('qa-cap'); if (e) e.removeAttribute('id'); });
}
try {
  await p.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await clk(/Auto-Lookup/); await load(0, AT, AN); await load(1, TT, TN);
  await wait(/[\d.]+\s*mkt/i, 9000); await sleep(900);
  const m = (await p.evaluate(() => document.body.innerText)).match(/Suggested:\s*\$?([\d.]+)\/share/i);
  if (m) { await p.evaluate(v => { const el = document.querySelector('input[name="offerPricePerShare"]'); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); }, m[1]); await sleep(400); }
  console.log(`### SHOTS: ${AT}/${TT} offer=$${m ? m[1] : '?'} -> ${OUT} ###`);
  await clk(/Build merger model/); await sleep(1300); await p.mouse.click(750, 400); await sleep(400);
  for (let idx = 0; idx <= 15; idx++) {
    if (idx > 0) { await p.keyboard.press('ArrowRight'); await sleep(700); }
    await sleep(900);
    await shoot(idx);
    process.stdout.write(`s${idx} `);
  }
  console.log(`\n[page errors: ${errs.length}${errs.length ? ' :: ' + errs.slice(0, 4).join(' | ') : ''}]`);
} catch (e) { console.log('ERR', e.message); } finally { await b.close(); }
