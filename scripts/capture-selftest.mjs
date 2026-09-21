#!/usr/bin/env node
// scripts/capture-selftest.mjs — standalone proof that tools/sweep-analyzer/capture.js can drive the
// post-d1bfd2d entry flow to a rendered deck. Run against a live app server (default :3001).
//
// Two parts, because one of them cannot be seen in the output records:
//   A. MID-FLOW — our own browser walks the flow and asserts the " loaded" count goes 1 → 2, and that the
//      build button is enabled afterwards. capture.js only records `loadedCount` on its FAILURE path, and
//      the entry panel (with its "✓ NAME loaded" markers) is gone once the deck renders — a successful run
//      genuinely measures 0 there. Asserting it here keeps the record schema untouched.
//   B. END STATE — capture.js itself, as the sweep invokes it, on three pairs: ok:true, stage:'done',
//      pdfPages > 0, and a record key set unchanged from before the re-point.
//
// The selectors are EXTRACTED from capture.js, never copied: if someone edits those two regexes, part A
// walks the new ones and part B still has to reach a deck, so this test cannot silently pass a stale copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURE = path.join(ROOT, 'tools/sweep-analyzer/capture.js');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = process.env.SWEEP_APP_PORT || '3001';
const BASE = `http://localhost:${PORT}`;
const PAIRS = [['AAPL', 'VZ', null], ['KO', 'NSRGY', null], ['NET', 'DDOG', null]];  // queue repro pairs
const require_ = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n) => { console.log(`  \x1b[32m✓\x1b[0m ${n}`); pass++; };
const bad = (n, e) => { console.log(`  \x1b[31m✗\x1b[0m ${n}\n      ${e.message || e}`); fail++; };
const t = async (n, fn) => { try { await fn(); ok(n); } catch (e) { bad(n, e); } };

// ── selectors, read out of capture.js ────────────────────────────────────────────────────────────────
const src = fs.readFileSync(CAPTURE, 'utf8');
const literal = (re, what) => {
  const m = re.exec(src);
  assert.ok(m, `could not read the ${what} selector out of capture.js — did its shape change?`);
  return new RegExp(m[1]);
};
const ENTRY_RE = literal(/some\(x => \/(.+?)\/\.test\(x\.textContent\)\)/, 'entry-screen');
const BUILD_RE = literal(/find\(e => \/(.+?)\/\.test\(e\.textContent\)\); return el && !el\.disabled/, 'build-button');

console.log(`\ncapture.js drives: entry ${ENTRY_RE} · build ${BUILD_RE}\n`);
console.log('A. mid-flow (our browser, capture.js\'s selectors)');
await t('dead post-d1bfd2d selectors are gone from capture.js', () => {
  const live = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');   // ignore the explaining comments
  assert.doesNotMatch(live, /Auto-Lookup/, 'capture.js still waits on the removed Auto-Lookup button');
  assert.doesNotMatch(live, /Build merger model/, 'capture.js still waits on the removed build button');
});

let midflow = null;
await t('landing → Public→Public → AAPL loaded (1) → VZ loaded (2) → build button enabled', async () => {
  const puppeteer = require_(path.join(ROOT, 'node_modules/puppeteer-core'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });                       // identical to capture.js:119
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const count = () => page.evaluate(() => (document.body.innerText.match(/ loaded/g) || []).length);
    assert.equal(await count(), 0, 'the landing screen should show no loaded tickers');
    await page.waitForFunction((s) => [...document.querySelectorAll('button')].some((x) => new RegExp(s).test(x.textContent)), { timeout: 30000 }, ENTRY_RE.source);
    await page.evaluate((s) => [...document.querySelectorAll('button')].find((x) => new RegExp(s).test(x.textContent)).click(), ENTRY_RE.source);
    await page.waitForSelector('input[id^="react-select"]', { timeout: 30000 });
    const seen = [];
    for (const [idx, tk] of [[0, 'AAPL'], [1, 'VZ']]) {
      const ins = await page.$$('input[id^="react-select"]');
      await ins[idx].click(); await ins[idx].type(tk, { delay: 15 }); await sleep(160);
      await page.keyboard.press('Enter');
      await page.waitForFunction((n) => (document.body.innerText.match(/ loaded/g) || []).length >= n, { timeout: 80000 }, idx + 1);
      seen.push(await count());
    }
    assert.deepEqual(seen, [1, 2], `loadedCount should step 1 → 2, got ${JSON.stringify(seen)}`);
    await sleep(1600);
    await page.evaluate(() => { const el = [...document.querySelectorAll('button')].find((b) => /Use this/.test(b.textContent)); if (el) el.click(); });
    await page.waitForFunction((s) => { const el = [...document.querySelectorAll('button')].find((e) => new RegExp(s).test(e.textContent)); return el && !el.disabled; }, { timeout: 30000 }, BUILD_RE.source);
    midflow = seen;
    console.log(`      loadedCount 0 → ${seen.join(' → ')}, build button enabled`);
  } finally { await browser.close(); }
});

console.log('\nB. end state (capture.js itself, as the sweep invokes it)');
const RAW = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-selftest-'));
const records = {};
await t(`capture.js runs ${PAIRS.length} pairs to completion`, async () => {
  const t0 = Date.now();
  const child = spawn(process.execPath, [CAPTURE, JSON.stringify(PAIRS)], {
    cwd: ROOT,
    env: { ...process.env, SWEEP_RAW_DIR: RAW, SWEEP_STATUS_LOG: path.join(RAW, 'status.log'), SWEEP_APP_PORT: PORT },
  });
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  const code = await new Promise((r) => child.on('close', r));
  console.log(`      ${err.trim().split('\n').pop()}   (${Math.round((Date.now() - t0) / 1000)}s, exit ${code})`);
  for (const [A, B] of PAIRS) {
    const f = path.join(RAW, `${A}_${B}.json`);
    assert.ok(fs.existsSync(f), `no record written for ${A}/${B}`);
    records[`${A}/${B}`] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
});

for (const [A, B] of PAIRS) {
  await t(`${A}/${B} → ok:true, stage:'done', pdfPages > 0`, () => {
    const r = records[`${A}/${B}`];
    assert.ok(r, 'record missing');
    assert.equal(r.ok, true, `ok=${r.ok} stage=${r.stage} error=${r.error}`);
    assert.equal(r.stage, 'done', `stage=${r.stage}`);
    assert.ok(r.pdfPages > 0, `pdfPages=${r.pdfPages}`);
    console.log(`      pdfPages=${r.pdfPages} sections=${Object.keys(r.sections || {}).length} cErr=${(r.consoleErrors || []).length} oracleA=${r.oracleA ? 'present' : 'null'}`);
  });
}

await t('record schema is unchanged by the re-point', () => {
  // The re-point touched two waitFor/click calls only; every field below is written by code this change
  // never entered. A new or missing key means the collector's OUTPUT changed, which would re-baseline the
  // graders — exactly what this test exists to catch.
  const EXPECTED = ['pair', 'A', 'B', 'offerOverride', 'ts', 'ok', 'stage', 'suggestedOfferApplied',
    'pdfPages', 'sections', 'bodyText', 'consoleErrors', 'consoleWarnings', 'pageErrors', 'oracleA', 'oracleB'];
  for (const k of Object.keys(records)) {
    const got = Object.keys(records[k]).sort();
    const missing = EXPECTED.filter((x) => !got.includes(x));
    const extra = got.filter((x) => !EXPECTED.includes(x));
    assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, `${k}: missing=${missing} extra=${extra}`);
  }
  console.log(`      ${EXPECTED.length} keys, identical across all ${Object.keys(records).length} records`);
});

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} passed, ${fail} failed\x1b[0m  (raw records: ${RAW})\n`);
process.exit(fail ? 1 : 0);
