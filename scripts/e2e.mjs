import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => { console.log(`${c ? '✓' : '✗ FAIL'}  ${m}`); if (!c) failures++; };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--no-first-run', '--window-size=1400,1800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
page.on('pageerror', e => console.log('  [pageerror]', e.message));

async function waitForText(re, timeout = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const txt = await page.evaluate(() => document.body.innerText);
    if (re.test(txt)) return true;
    await sleep(300);
  }
  return false;
}

async function loadTicker(panelIndex, ticker, expectName) {
  const inputs = await page.$$('input[id^="react-select"]');
  const input = inputs[panelIndex];
  await input.click();
  await input.type(ticker, { delay: 40 });
  await sleep(1000); // debounced search
  const clicked = await page.evaluate(() => {
    const opt = document.querySelector('[id^="react-select"][id*="option"]');
    if (opt) { opt.click(); return true; }
    return false;
  });
  if (!clicked) await input.press('Enter');
  const got = await waitForText(new RegExp(expectName, 'i'), 15000); // wait for EDGAR quote + price
  await sleep(1200); // let live price settle into state
  return got;
}

async function setNumber(name, value) {
  const sel = `input[name="${name}"]`;
  await page.waitForSelector(sel, { timeout: 5000 });
  // Canonical React-compatible set: use the native value setter then dispatch a bubbling
  // input event so React's onChange fires with the full replaced value (no append/selection issues).
  await page.evaluate((s, val) => {
    const el = document.querySelector(s);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }, sel, String(value));
  await sleep(400);
  return page.$eval(sel, n => n.value);
}

async function clickBtn(re) {
  await page.evaluate((src) => {
    const b = [...document.querySelectorAll('button')].find(x => new RegExp(src, 'i').test(x.textContent));
    if (b) b.click();
  }, re.source);
  await sleep(1500);
}

async function narrativeParts() {
  return page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/([A-Za-z0-9.,& ]+?)'s acquisition of ([A-Za-z0-9.,& ]+?) at \$/);
    return m ? { acquirer: m[1].trim(), target: m[2].trim() } : null;
  });
}

const grab = () => page.evaluate(() => {
  const t = document.body.innerText;
  const m = (re) => { const x = t.match(re); return x ? x[1] : null; };
  return {
    newShares: m(/New Shares Issued\s*([\d.,]+)M/i),
    proFormaEPS: m(/Pro Forma EPS[^$]*\$([\d.]+)/i),
    premium: m(/Purchase Premium\s*([+\-]?[\d.]+)%/i),
    epsImpact: m(/EPS Impact\s*([+\-]?[\d.]+)%/i),
    verdict: /✓ Accretive/.test(t) ? 'Accretive' : /✗ Dilutive/.test(t) ? 'Dilutive' : '?',
  };
});

try {
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.evaluate(() => {
    const auto = [...document.querySelectorAll('button')].find(b => /Auto-Lookup/i.test(b.textContent));
    if (auto) auto.click();
  });
  await sleep(600);

  console.log('── Loading CRM (acquirer) and TEAM (target) ──');
  ok(await loadTicker(0, 'CRM', 'Salesforce'), 'Acquirer Salesforce loaded');
  ok(await loadTicker(1, 'TEAM', 'Atlassian'), 'Target Atlassian loaded');
  const preBuild = await page.evaluate(() => document.body.innerText);
  ok(/262\s*M?\s*sh/i.test(preBuild), 'TEAM shares ≈262M shown (not blank)');

  const offerSet = await setNumber('offerPricePerShare', 150);
  ok(offerSet === '150', `Offer field reads 150 (got "${offerSet}")`);
  await clickBtn(/Build merger model/);

  console.log('\n── Dashboard @ offer $150 ──');
  const np = await narrativeParts();
  console.log('  narrative parts:', JSON.stringify(np));
  ok(np && /Salesforce/i.test(np.acquirer), 'Narrative ACQUIRER is Salesforce (no role flip)');
  ok(np && /Atlassian/i.test(np.target), 'Narrative TARGET is Atlassian (no role flip)');

  const v150 = await grab();
  console.log('  values:', JSON.stringify(v150));
  ok(v150.verdict === 'Dilutive', 'Verdict = Dilutive');
  ok(v150.newShares && Math.abs(parseFloat(v150.newShares.replace(/,/g,'')) - 84) < 3, `New Shares ≈84M (got ${v150.newShares})`);
  ok(v150.newShares !== '0', 'New Shares NOT 0M');
  ok(v150.proFormaEPS && Math.abs(parseFloat(v150.proFormaEPS) - 6.92) < 0.12, `Pro Forma EPS ≈$6.92 (got $${v150.proFormaEPS})`);
  ok(v150.proFormaEPS !== '0.00', 'Pro Forma EPS NOT $0.00');
  ok(v150.premium && Math.abs(parseFloat(v150.premium) - 51.9) < 2, `Premium ≈+51.9% (got ${v150.premium}%)`);

  console.log('\n── Reactivity: offer $150 → $180 ──');
  await clickBtn(/Edit Inputs/);
  const offerSet2 = await setNumber('offerPricePerShare', 180);
  ok(offerSet2 === '180', `Offer field re-reads 180 (got "${offerSet2}")`);
  await clickBtn(/Build merger model/);
  const v180 = await grab();
  console.log('  $150:', JSON.stringify(v150));
  console.log('  $180:', JSON.stringify(v180));
  ok(v150.newShares !== v180.newShares, 'New Shares changed');
  ok(v150.proFormaEPS !== v180.proFormaEPS, 'Pro Forma EPS changed');
  ok(parseFloat(v180.premium) > parseFloat(v150.premium), `Premium increased (${v150.premium}% → ${v180.premium}%)`);
  ok(Math.abs(parseFloat(v180.premium) - 82.3) < 2, `Premium ≈+82.3% at $180 (got ${v180.premium}%)`);

  console.log('\n── Reactivity: cash 60% → 20% (at $180) ──');
  await clickBtn(/Edit Inputs/);
  // move the cash slider via its range input if present
  const slider = await page.$('input[type="range"]');
  if (slider) {
    await page.evaluate(() => {
      const r = document.querySelector('input[type="range"]');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(r, '20');
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(400);
  }
  await clickBtn(/Build merger model/);
  const vCash20 = await grab();
  console.log('  cash20:', JSON.stringify(vCash20));
  ok(vCash20.newShares !== v180.newShares, `New Shares changed with cash mix (${v180.newShares} → ${vCash20.newShares})`);

  console.log(`\n${failures === 0 ? '✅ E2E ALL PASS' : '❌ ' + failures + ' E2E FAILED'}`);
} catch (e) {
  console.log('ERROR', e.message, e.stack);
  failures++;
} finally {
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}
