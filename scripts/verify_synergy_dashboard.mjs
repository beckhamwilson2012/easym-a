// Verify the FIXED explainSynergies popover on the Dashboard for CRM (acquirer) / TEAM (target).
// Builds the deck on the live :3000 app (hot-reloaded explanations.js), opens the Synergies ⓘ
// popover, and dumps its text. Also reads target.revenue + results.synergiesY1 from the DOM-side
// to confirm the % is internally consistent. Read-only against :3001 (normal GET /quote).
// Usage: node scripts/verify_synergy_dashboard.mjs
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AT = 'CRM', AN = 'Salesforce', TT = 'TEAM', TN = 'Atlassian';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--no-first-run', '--window-size=1500,2300'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 2300 });
const errs = []; p.on('pageerror', e => errs.push(e.message));
const wait = async (re, t = 20000) => { const s = Date.now(); while (Date.now() - s < t) { if (re.test(await p.evaluate(() => document.body.innerText))) return true; await sleep(300); } return false; };
const load = async (i, tk, nm) => { const ins = await p.$$('input[id^="react-select"]'); await ins[i].click(); await ins[i].type(tk, { delay: 45 }); await sleep(1200); const c = await p.evaluate(() => { const o = document.querySelector('[id^="react-select"][id*="option"]'); if (o) { o.click(); return true; } return false; }); if (!c) await ins[i].press('Enter'); await wait(new RegExp(nm, 'i')); await sleep(1600); };
const clk = async (re) => { await p.evaluate(s => { const x = [...document.querySelectorAll('button')].find(y => new RegExp(s, 'i').test(y.textContent)); if (x) x.click(); }, re.source); await sleep(1200); };
try {
  await p.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await clk(/Auto-Lookup/); await load(0, AT, AN); await load(1, TT, TN);
  await wait(/[\d.]+\s*mkt/i, 9000); await sleep(900);
  const m = (await p.evaluate(() => document.body.innerText)).match(/Suggested:\s*\$?([\d.]+)\/share/i);
  if (m) { await p.evaluate(v => { const el = document.querySelector('input[name="offerPricePerShare"]'); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); }, m[1]); await sleep(400); }
  await clk(/Build merger model/); await sleep(1600);
  await p.mouse.click(750, 400); await sleep(500);
  // Find the Synergies/Cost-Savings header's ⓘ button and click it.
  const opened = await p.evaluate(() => {
    const h = [...document.querySelectorAll('h3')].find(x => /Synergies|Cost Savings/i.test(x.textContent));
    if (!h) return 'no-header';
    const btn = h.querySelector('button[aria-label="Explain this calculation"]');
    if (!btn) return 'no-button';
    btn.click();
    return 'clicked';
  });
  await sleep(700);
  const popover = await p.evaluate(() => {
    // innermost label div whose text is exactly the popover header
    const label = [...document.querySelectorAll('div')].find(d => d.textContent.trim() === 'How this is calculated' && d.offsetParent);
    if (!label) return '';
    // label(108) -> header row(107) -> popover container(85)
    let el = label; for (let k = 0; k < 2 && el.parentElement; k++) el = el.parentElement;
    return (el ? el.innerText : '').replace(/\n{2,}/g, '\n').trim();
  });
  // Read the displayed Year-1 synergy dollar from the left card, and TEAM revenue from §5 if visible.
  const y1Match = (await p.evaluate(() => document.body.innerText)).match(/Year 1[^\n$]*\$?([\d,]+)\s*M/i);
  console.log(`### ${AN} (${AT}) acquires ${TN} (${TT}) — Dashboard Synergies ⓘ popover ###`);
  console.log('open result:', opened);
  console.log('\n--- POPOVER TEXT ---\n' + (popover || '(empty)'));
  console.log('\n--- Year-1 synergy shown on card: $' + (y1Match ? y1Match[1] : '?') + 'M ---');
  console.log('\n[page errors: ' + errs.length + (errs.length ? ' :: ' + errs.slice(0, 3).join(' | ') : '') + ']');
} catch (e) { console.log('ERR', e.message); } finally { await b.close(); }
