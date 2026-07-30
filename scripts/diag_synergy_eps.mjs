// DIAGNOSTIC ONLY (no app code changed). Renders CRM(acquirer)/TEAM(target) on the live :3000 app.
// PASS A: fresh auto-fill build → reads Year-1 synergy at (a) input field, (b) Dashboard, (c) §7,
//         plus standalone EPS on §4 and the Dashboard accretion baseline / pro-forma EPS.
// PASS B: click the "Base" Quick-preset BEFORE building → reads the same synergy locations to show
//         the preset writes a combined-revenue value (~$933M) via a separate code path.
// Read-only against :3001 (normal GET /quote). Usage: node scripts/diag_synergy_eps.mjs
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AT = 'CRM', AN = 'Salesforce', TT = 'TEAM', TN = 'Atlassian';

const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--no-first-run', '--window-size=1500,2300'] });
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 2300 });
const errs = []; p.on('pageerror', e => errs.push(e.message));
const bodyText = () => p.evaluate(() => document.body.innerText);
const wait = async (re, t = 20000) => { const s = Date.now(); while (Date.now() - s < t) { if (re.test(await bodyText())) return true; await sleep(300); } return false; };
const load = async (i, tk, nm) => { const ins = await p.$$('input[id^="react-select"]'); await ins[i].click(); await ins[i].type(tk, { delay: 45 }); await sleep(1200); const c = await p.evaluate(() => { const o = document.querySelector('[id^="react-select"][id*="option"]'); if (o) { o.click(); return true; } return false; }); if (!c) await ins[i].press('Enter'); await wait(new RegExp(nm, 'i')); await sleep(1500); };
const clk = async (re) => { await p.evaluate(s => { const x = [...document.querySelectorAll('button')].find(y => new RegExp(s, 'i').test(y.textContent)); if (x) x.click(); }, re.source); await sleep(1100); };
const setOffer = async () => { const m = (await bodyText()).match(/Suggested:\s*\$?([\d.]+)\/share/i) || (await bodyText()).match(/\$([\d.]+)\/share/i); if (m) { await p.evaluate(v => { const el = document.querySelector('input[name="offerPricePerShare"]'); if (!el) return; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); }, m[1]); await sleep(400); } };
const readInput = (name) => p.evaluate(n => { const el = document.querySelector(`input[name="${n}"]`); return el ? el.value : '(field not in DOM)'; }, name);
const activeText = () => p.evaluate(() => { const h = document.querySelector('[aria-hidden="true"]'); const pr = h ? h.style.display : null; if (h) h.style.display = 'none'; const sc = [...document.querySelectorAll('div')].find(d => { const s = getComputedStyle(d); return s.overflowY === 'auto' && d.offsetHeight > 300; }); const t = (sc || document.body).innerText; if (h) h.style.display = pr; return t.replace(/\n{2,}/g, '\n').trim(); });
const grab = async (idx, re) => { await p.mouse.click(750, 400); for (let k = 0; k < idx; k++) { await p.keyboard.press('ArrowRight'); await sleep(330); } await sleep(1100); const t = await activeText(); const lines = t.split('\n'); const out = []; for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) out.push(lines[i].trim() + (i + 1 < lines.length && /^[\(\-+$\d.]/.test((lines[i + 1] || '').trim()) ? '  →  ' + lines[i + 1].trim() : '')); for (let k = 0; k < idx; k++) { await p.keyboard.press('ArrowLeft'); await sleep(100); } await sleep(200); return out; };
const synFromDash = async () => { await p.mouse.click(750, 400); await sleep(400); const t = await activeText(); const m = t.match(/Year 1[\s\S]{0,40}?\$([\d,]+)M/i); return m ? m[1] : '?'; };

async function buildAndCapture(tag) {
  console.log(`\n================ ${tag} ================`);
  const inPre = await readInput('synergiesY1');
  console.log(`(a) input field synergiesY1 BEFORE build: "${inPre}"`);
  await clk(/Build merger model/); await sleep(1700); await p.mouse.click(750, 400); await sleep(400);
  const inPost = await readInput('synergiesY1');
  console.log(`(a) input field synergiesY1 AFTER build:  "${inPost}"`);
  console.log(`(b) Dashboard §0 Year-1 synergy:  $${await synFromDash()}M`);
  const s7 = await grab(7, /Synerg/i);
  console.log(`(c) §7 Pro Forma synergy lines:\n    ${s7.join('\n    ') || '(none)'}`);
  // EPS bases
  const dashEps = await grab(0, /EPS|Accret|Pro Forma|Dilut/i);
  console.log(`    Dashboard EPS/accretion lines:\n    ${dashEps.join('\n    ') || '(none)'}`);
  const s4 = await grab(4, /EPS|Net Income|Dilut|Shares/i);
  console.log(`    §4 P&L Acquirer (CRM) EPS lines:\n    ${s4.join('\n    ') || '(none)'}`);
}

try {
  // ---- PASS A: fresh auto-fill ----
  await p.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await clk(/Auto-Lookup/); await load(0, AT, AN); await load(1, TT, TN);
  await wait(/[\d.]+\s*mkt/i, 9000); await sleep(800); await setOffer();
  await buildAndCapture('PASS A — fresh auto-fill (expect target-scaled ~$104M)');

  // ---- PASS B: click "Base" Quick-preset before building ----
  await p.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await clk(/Auto-Lookup/); await load(0, AT, AN); await load(1, TT, TN);
  await wait(/[\d.]+\s*mkt/i, 9000); await sleep(800); await setOffer();
  // Click the "Base" preset button inside the Synergies card (text has "Base" and a "%")
  const presetClicked = await p.evaluate(() => { const btn = [...document.querySelectorAll('button')].find(x => /Base/.test(x.textContent) && /%/.test(x.textContent) && /Y3=/.test(x.textContent)); if (btn) { btn.click(); return btn.textContent.replace(/\s+/g, ' ').trim(); } return null; });
  console.log(`\n[Pass B] clicked preset button: ${presetClicked || 'NOT FOUND'}`);
  await sleep(600);
  await buildAndCapture('PASS B — "Base" preset clicked (expect combined-revenue ~$933M)');

  console.log('\n[page errors: ' + errs.length + (errs.length ? ' :: ' + errs.slice(0, 3).join(' | ') : '') + ']');
} catch (e) { console.log('ERR', e.message, e.stack); } finally { await b.close(); }
