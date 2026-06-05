import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--no-first-run', '--window-size=1500,2200'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 2200 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/Download the React DevTools|404/.test(m.text())) errors.push('console: ' + m.text().slice(0,160)); });

async function waitForText(re, timeout = 16000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (re.test(await page.evaluate(() => document.body.innerText))) return true; await sleep(300); }
  return false;
}
async function loadTicker(i, ticker, name) {
  const inputs = await page.$$('input[id^="react-select"]');
  await inputs[i].click(); await inputs[i].type(ticker, { delay: 40 }); await sleep(1000);
  const clicked = await page.evaluate(() => { const o = document.querySelector('[id^="react-select"][id*="option"]'); if (o) { o.click(); return true; } return false; });
  if (!clicked) await inputs[i].press('Enter');
  await waitForText(new RegExp(name, 'i')); await sleep(1200);
}
async function setNumber(name, value) {
  const sel = `input[name="${name}"]`; await page.waitForSelector(sel);
  await page.evaluate((s, val) => { const el = document.querySelector(s); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); }, sel, String(value));
  await sleep(300);
}
async function clickBtn(re) { await page.evaluate(s => { const b = [...document.querySelectorAll('button')].find(x => new RegExp(s,'i').test(x.textContent)); if (b) b.click(); }, re.source); await sleep(1200); }

try {
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await clickBtn(/Auto-Lookup/);
  await loadTicker(0, 'CRM', 'Salesforce');
  await loadTicker(1, 'TEAM', 'Atlassian');
  await setNumber('offerPricePerShare', 150);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('Base')); if (b) b.click(); });
  await sleep(400);
  await clickBtn(/Build merger model/);
  await sleep(1500);
  // focus the deck area so arrow keys work
  await page.evaluate(() => window.focus());
  await page.mouse.click(750, 400);

  console.log('── Walking deck sections via ArrowRight (CRM acquires TEAM, $150, Base) ──\n');
  let prevHeading = '';
  for (let i = 0; i < 16; i++) {
    const errBefore = errors.length;
    // read the active section: the tab bar shows "N / M" and the section has a PageHeader title or h3
    const info = await page.evaluate(() => {
      const pos = (document.body.innerText.match(/(\d+)\s*\/\s*(\d+)/) || [])[0] || '';
      // section heading: first PageHeader (white-on-blue) or h3 in the scroll area
      const headings = [...document.querySelectorAll('div,h2,h3')].map(n => n.textContent.trim()).filter(Boolean);
      // exhibit label + title heuristics
      const m = document.body.innerText.split('\n').map(s=>s.trim()).filter(Boolean);
      return { pos, firstLines: m.slice(0, 6) };
    });
    // grab a distinctive heading line (Exhibit or Standalone/Pro Forma/etc.)
    const heading = await page.evaluate(() => {
      const t = document.body.innerText;
      const cand = t.match(/(Standalone P&L[^\n]*|Pro Forma P&L[^\n]*|Company Profiles[^\n]*|Financial (Profile|Comparison)[^\n]*|Trading Profile[^\n]*|Relative Contribution[^\n]*|Distribution of Stock[^\n]*|Analyst Consensus[^\n]*|Valuation Matrix[^\n]*|Sources? (&|and) Methodology[^\n]*|Equity Performance[^\n]*|Data Verification[^\n]*|Acquisition[^\n]*|M&A Target Review[^\n]*|Potential Acquisition[^\n]*|Comparable[^\n]*)/i);
      return cand ? cand[1].slice(0,70) : '(no heading match)';
    });
    console.log(`[${info.pos}] ${heading}${errors.length > errBefore ? '   ⚠️ +' + (errors.length - errBefore) + ' err' : ''}`);
    await page.keyboard.press('ArrowRight');
    await sleep(650);
  }

  const all = await page.evaluate(() => document.body.innerText);
  console.log('\n── Fiscal-year sanity (across deck) ──');
  console.log('FY2026 present:', /FY\s?2026|FY26/.test(all), '| FY2025 present:', /FY\s?2025|FY25/.test(all));

  console.log('\n── PDF export crash check ──');
  const eb = errors.length;
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Export/i.test(x.textContent)); if (b) b.click(); });
  await sleep(4500);
  console.log('errors during export:', errors.length - eb);
  console.log('\n── TOTAL page errors:', errors.length, '──');
  if (errors.length) console.log(errors.slice(0, 14).join('\n'));
} catch (e) {
  console.log('ERROR', e.message);
} finally {
  await browser.close();
}
