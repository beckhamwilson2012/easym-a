// Stage 11-C standing no-op harness — deterministic manual-entry capture.
//
// Manual entry does NO live fetch, so the same inputs always produce the same deck. That makes a
// with-edit vs without-edit byte-diff a valid no-op gate — unlike the ticker path, where live price
// drift (e.g. CRM $193.79 -> $215.77 over four days) makes any byte comparison structurally useless.
//
// Reads the recorded input set from STAGE_11C_NOOP_INPUTS.json (single source of truth), drives the
// manual form, builds, and writes every [data-section-id] innerText to OUT for an exact A/B diff.
//
// env OUT = output json path (default /tmp/noop_out.json)
// env INPUTS = input-set json path (default ../../STAGE_11C_NOOP_INPUTS.json relative to this file)
const path = require('path');
const fs = require('fs');
const APP_ROOT = path.resolve(__dirname, '..', '..');
const puppeteer = require(path.join(APP_ROOT, 'node_modules', 'puppeteer-core'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT || '/tmp/noop_out.json';
const INPUTS = process.env.INPUTS || path.join(APP_ROOT, 'STAGE_11C_NOOP_INPUTS.json');
const spec = JSON.parse(fs.readFileSync(INPUTS, 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const setF = async (page, name, val) => {
  const ok = await page.evaluate((n, v) => {
    const el = document.querySelector(`input[name="${n}"]`);
    if (!el) return false;
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, name, val);
  return ok;
};

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const cErr = [], pErr = [];
  page.on('console', m => { if (m.type() === 'error') cErr.push(m.text()); });
  page.on('pageerror', e => pErr.push(e.message));

  await page.goto('http://localhost:3001', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(x => /Manual Entry/.test(x.textContent)), { timeout: 30000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(x => /Manual Entry/.test(x.textContent)).click());
  await page.waitForSelector('input[name="companyARevenue"]', { timeout: 30000 });

  // Set every recorded form input; track any field the DOM did not expose (would break determinism).
  const missing = [];
  for (const [name, val] of Object.entries(spec.formInputs)) {
    const ok = await setF(page, name, val);
    if (!ok) missing.push(name);
  }
  await sleep(600);

  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(x => /Run Analysis/.test(x.textContent)), { timeout: 30000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(x => /Run Analysis/.test(x.textContent)).click());
  await page.waitForSelector('[data-section-id="verification2"]', { timeout: 60000 });
  await sleep(3000);

  const out = await page.evaluate(() => {
    const secs = {};
    document.querySelectorAll('[data-section-id]').forEach(el => secs[el.getAttribute('data-section-id')] = el.innerText);
    const body = document.body.innerText;
    return { secs, hasNaN: /NaN/.test(body), hasUndef: /undefined/.test(body) };
  });

  const result = {
    label: process.env.RUN_LABEL || null,
    sectionCount: Object.keys(out.secs).length,
    missingInputs: missing,
    hasNaN: out.hasNaN,
    hasUndef: out.hasUndef,
    cErr, pErr,
    sections: out.secs,
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  console.log(`[${result.label}] -> ${OUT} | sections=${result.sectionCount} | missing=[${missing.join(',')}] | cErr=${cErr.length} pErr=${pErr.length} | NaN=${out.hasNaN} undef=${out.hasUndef}`);
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
