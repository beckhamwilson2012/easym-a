// VERIFY (Fix 3): build CRM/TEAM live, navigate to §10 Relative Contribution, dump the FCF row
// and capture the [§10 FCF] console log to confirm fetched FCF (not the proxy) is consumed.
// §10 is reference section index 9 (DeckShell SECTIONS: 0=dashboard, then 1..14 reference).
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const idx = parseInt(process.argv[2] || '10', 10);
const AT = process.argv[3] || 'CRM', AN = process.argv[4] || 'Salesforce', TT = process.argv[5] || 'TEAM', TN = process.argv[6] || 'Atlassian';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--no-first-run', '--window-size=1500,2300'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 2300 });
const logs = []; p.on('console', m => { const t = m.text(); if (/§10 FCF/.test(t)) logs.push(t); });
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
  for (let i = 0; i < idx; i++) { await p.keyboard.press('ArrowRight'); await sleep(420); }
  await sleep(1800);
  console.log('===== §10 RELATIVE CONTRIBUTION (after Fix 3) =====');
  console.log(await activeText());
  console.log('\n===== [§10 FCF] console log (consumed value) =====');
  console.log(logs.length ? logs[logs.length - 1] : '(no §10 FCF log captured)');
} catch (e) { console.log('ERR', e.message); } finally { await b.close(); }
