import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--no-first-run', '--window-size=1400,2000'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 2000 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

async function waitForText(re, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (re.test(await page.evaluate(() => document.body.innerText))) return true;
    await sleep(300);
  }
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
  const sel = `input[name="${name}"]`;
  await page.waitForSelector(sel);
  await page.evaluate((s, val) => { const el = document.querySelector(s); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); }, sel, String(value));
  await sleep(400);
}
async function clickBtn(re) { await page.evaluate(s => { const b = [...document.querySelectorAll('button')].find(x => new RegExp(s,'i').test(x.textContent)); if (b) b.click(); }, re.source); await sleep(1200); }

try {
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await clickBtn(/Auto-Lookup/);
  await loadTicker(0, 'CRM', 'Salesforce');
  await loadTicker(1, 'TEAM', 'Atlassian');
  await setNumber('offerPricePerShare', 150);
  // fill synergies via Base preset if present
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('Base')); if (b) b.click(); });
  await sleep(400);
  await clickBtn(/Build merger model/);
  await sleep(1500);

  // Enumerate deck tabs
  const tabs = await page.evaluate(() => {
    // tab bar buttons — find the row of section tabs
    const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
    return btns;
  });
  // Click each section via the tab bar and dump a snippet
  const sectionLabels = ['Dashboard','Title','Comparables','Target Briefing','Target Overview','Price Performance','Football Field','Standalone P&L','Valuation (AVP)','Synergy Overview','Pro Forma P&L','Strategic Rationale','Data Verification'];
  console.log('── Deck section content (CRM acquires TEAM, $150, Base synergies) ──\n');
  for (const label of sectionLabels) {
    const clicked = await page.evaluate((lab) => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === lab);
      if (b) { b.click(); return true; } return false;
    }, label);
    if (!clicked) { console.log(`### ${label}: [tab not found]\n`); continue; }
    await sleep(700);
    const txt = await page.evaluate(() => {
      const main = document.querySelector('[style*="max-width"]') || document.body;
      return document.body.innerText;
    });
    // Grab a compact view: lines, truncated
    const compact = txt.replace(/\n{2,}/g, '\n').split('\n').slice(0, 40).join(' | ').slice(0, 900);
    console.log(`### ${label}\n${compact}\n`);
  }

  // Fiscal-year label checks
  const all = await page.evaluate(() => document.body.innerText);
  console.log('── Fiscal-year label sanity ──');
  console.log('Mentions FY26/FY2026:', /FY\s?-?\s?2?6|FY2026/i.test(all));
  console.log('Mentions FY25/FY2025:', /FY\s?-?\s?2?5|FY2025/i.test(all));

  // PDF export crash check
  console.log('\n── PDF export crash check ──');
  const errBefore = errors.length;
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Export Dashboard PDF|Export/i.test(x.textContent)); if (b) b.click(); });
  await sleep(4000);
  console.log('pageerrors during export:', errors.length - errBefore);

  console.log('\n── Total page errors:', errors.length, '──');
  if (errors.length) console.log(errors.slice(0, 10).join('\n'));
} catch (e) {
  console.log('ERROR', e.message);
} finally {
  await browser.close();
}
