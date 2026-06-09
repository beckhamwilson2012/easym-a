// Focused high-res capture of §8 (Equity Performance) — the priority visual check. Parks the cursor
// off-chart, navigates to §8, and screenshots just the section card at 2x for crisp dot inspection.
// Usage: node scripts/qaShot8.mjs <OUTFILE> [AT AN TT TN]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = process.argv[2] || '/tmp/s8.png';
const AT = process.argv[3] || 'CRM', AN = process.argv[4] || 'Salesforce', TT = process.argv[5] || 'TEAM', TN = process.argv[6] || 'Atlassian';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--no-first-run', '--window-size=1100,1700'] });
const p = await b.newPage(); await p.setViewport({ width: 1100, height: 1700, deviceScaleFactor: 2 });
async function wait(re, t = 18000) { const s = Date.now(); while (Date.now() - s < t) { if (re.test(await p.evaluate(() => document.body.innerText))) return true; await sleep(300); } return false; }
async function load(i, tk, nm) { const ins = await p.$$('input[id^="react-select"]'); await ins[i].click(); await ins[i].type(tk, { delay: 40 }); await sleep(1000); const c = await p.evaluate(() => { const o = document.querySelector('[id^="react-select"][id*="option"]'); if (o) { o.click(); return true; } return false; }); if (!c) await ins[i].press('Enter'); await wait(new RegExp(nm, 'i')); await sleep(1500); }
async function clk(re) { await p.evaluate(s => { const x = [...document.querySelectorAll('button')].find(y => new RegExp(s, 'i').test(y.textContent)); if (x) x.click(); }, re.source); await sleep(1200); }
try {
  await p.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await clk(/Auto-Lookup/); await load(0, AT, AN); await load(1, TT, TN);
  await wait(/[\d.]+\s*mkt/i, 9000); await sleep(900);
  const m = (await p.evaluate(() => document.body.innerText)).match(/Suggested:\s*\$?([\d.]+)\/share/i);
  if (m) { await p.evaluate(v => { const el = document.querySelector('input[name="offerPricePerShare"]'); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); }, m[1]); await sleep(400); }
  await clk(/Build merger model/); await sleep(1300);
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.mouse.click(120, 300); // click a neutral spot (left rail) to focus the deck without hovering the chart
  for (let i = 0; i < 8; i++) { await p.keyboard.press('ArrowRight'); await sleep(450); }
  await sleep(1200);
  await p.mouse.move(5, 5); await sleep(300);
  const el = await p.evaluateHandle(() => {
    const h = document.querySelector('[aria-hidden="true"]'); if (h) h.style.display = 'none';
    const sc = [...document.querySelectorAll('div')].find(d => { const s = getComputedStyle(d); return s.overflowY === 'auto' && d.offsetHeight > 300; });
    if (sc) { sc.style.height = 'auto'; sc.style.maxHeight = 'none'; sc.style.overflow = 'visible'; }
    return sc;
  });
  await p.mouse.move(5, 5); await sleep(300);
  if (el && el.asElement()) await el.asElement().screenshot({ path: OUT });
  else await p.screenshot({ path: OUT });
  console.log('saved', OUT);
} catch (e) { console.log('ERR', e.message); } finally { await b.close(); }
