import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--no-first-run', '--window-size=1500,2400'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 2400 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

async function waitForText(re, t = 18000) {
  const s = Date.now();
  while (Date.now() - s < t) { if (re.test(await page.evaluate(() => document.body.innerText))) return true; await sleep(300); }
  return false;
}
async function loadTicker(i, tk, nm) {
  const ins = await page.$$('input[id^="react-select"]');
  await ins[i].click(); await ins[i].type(tk, { delay: 40 }); await sleep(1000);
  const c = await page.evaluate(() => { const o = document.querySelector('[id^="react-select"][id*="option"]'); if (o) { o.click(); return true; } return false; });
  if (!c) await ins[i].press('Enter');
  await waitForText(new RegExp(nm, 'i')); await sleep(1500);
}
async function clickBtn(re) { await page.evaluate(s => { const b = [...document.querySelectorAll('button')].find(x => new RegExp(s, 'i').test(x.textContent)); if (b) b.click(); }, re.source); await sleep(1200); }
// read ONLY the visible active section by hiding the offscreen PDF container
async function activeText() {
  return page.evaluate(() => {
    const hid = document.querySelector('[aria-hidden="true"]');
    const prev = hid ? hid.style.display : null;
    if (hid) hid.style.display = 'none';
    const scroll = [...document.querySelectorAll('div')].find(d => { const s = getComputedStyle(d); return s.overflowY === 'auto' && d.offsetHeight > 300; });
    const txt = (scroll || document.body).innerText;
    if (hid) hid.style.display = prev;
    return txt.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  });
}

try {
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await clickBtn(/Auto-Lookup/);
  await loadTicker(0, 'CRM', 'Salesforce');
  await loadTicker(1, 'TEAM', 'Atlassian');

  // Use the SUGGESTED offer (live price × 1.30). Extract from the badge, set the field exactly.
  const panel = await page.evaluate(() => document.body.innerText);
  const m = panel.match(/Suggested:\s*\$?([\d.]+)\/share/i);
  const suggested = m ? m[1] : null;
  console.log('SUGGESTED OFFER (from badge): $' + (suggested || '??') + '/share');
  if (suggested) {
    await page.evaluate((val) => {
      const el = document.querySelector('input[name="offerPricePerShare"]');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur();
    }, suggested);
    await sleep(400);
  }
  // Synergies auto-fill on build (handleSubmit fills the suggested ramp when they're 0).
  await clickBtn(/Build merger model/);
  await sleep(1500);
  await page.mouse.click(750, 400); // focus deck for arrow-key nav

  const NAMES = [
    'DASHBOARD', '1. TITLE', '2. COMPARABLES', '3. COMPANY PROFILES',
    '4. STANDALONE P&L — ACQUIRER', '5. STANDALONE P&L — TARGET', '6. FINANCIAL PROFILE',
    '7. PRO FORMA P&L (+ ACCRETION)', '8. EQUITY PERFORMANCE', '9. TRADING PROFILE & OWNERSHIP',
    '10. RELATIVE CONTRIBUTION', '11. DISTRIBUTION OF STOCK PRICE', '12. ANALYST CONSENSUS',
    '13. VALUATION MATRIX', '14. SOURCES & METHODOLOGY', 'APPENDIX. DATA VERIFICATION',
  ];

  for (let idx = 0; idx <= 15; idx++) {
    const t = await activeText();
    console.log('\n\n################################################################');
    console.log('### SECTION ' + NAMES[idx]);
    console.log('################################################################');
    console.log(t);
    await page.keyboard.press('ArrowRight');
    await sleep(650);
  }

  console.log('\n\n### PAGE ERRORS during walk: ' + errors.length);
  if (errors.length) console.log(errors.join('\n'));
} catch (e) {
  console.log('ERROR', e.message, e.stack);
} finally {
  await browser.close();
}
