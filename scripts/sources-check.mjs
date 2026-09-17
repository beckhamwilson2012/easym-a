#!/usr/bin/env node
// scripts/sources-check.mjs — `npm run sources:check`. Hits every source the /quote chain depends on and
// prints ONE status line each. Exits non-zero if EDGAR or FMP fail: those two are the fundamentals chain, so
// a failure there means /quote can only return absent values. Yahoo is price-only and advisory — a 429 from
// it is Yahoo rate-limiting this IP, not a broken build, so it never fails the check.
//
// Reads FMP_KEY from ma-app/.env (never printed — only its length, and only when missing/invalid matters).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const SEC_UA = 'EasyMandA contact@easymanda.com';          // SEC requires a contact UA; 403 without one
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15000;

async function probe({ name, url, headers, required, check }) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const ms = Date.now() - t0;
    if (!r.ok) return { name, required, ok: false, line: `HTTP ${r.status} · ${ms}ms` };
    const body = await r.json();
    const detail = check ? check(body) : 'ok';
    return { name, required, ok: detail !== null, line: detail === null ? `HTTP ${r.status} but unusable payload · ${ms}ms` : `HTTP ${r.status} · ${ms}ms · ${detail}` };
  } catch (e) {
    return { name, required, ok: false, line: `${e.name === 'TimeoutError' ? `timeout after ${TIMEOUT_MS}ms` : e.message}` };
  }
}

const key = process.env.FMP_KEY || '';
const probes = [
  { name: 'edgar  (company_tickers)', required: true, url: 'https://www.sec.gov/files/company_tickers.json',
    headers: { 'User-Agent': SEC_UA },
    check: (j) => { const n = Object.keys(j || {}).length; return n > 1000 ? `${n} tickers` : null; } },
  { name: 'fmp    (income-statement)', required: true,
    url: `https://financialmodelingprep.com/stable/income-statement?symbol=AAPL&period=annual&limit=1&apikey=${encodeURIComponent(key)}`,
    check: (j) => (Array.isArray(j) && j[0] && j[0].symbol === 'AAPL' ? `AAPL FY${j[0].fiscalYear ?? '?'} revenue ${j[0].revenue ?? '?'}` : null) },
  { name: 'yahoo  (v8 chart, price)', required: false,
    url: 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d',
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
    check: (j) => { const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice; return p != null ? `AAPL ${p}` : null; } },
];

if (!key) console.log('  note: FMP_KEY is empty in ma-app/.env — the fmp probe will read as 401');

const results = [];
for (const p of probes) results.push(await probe(p));   // serial: never burst a rate-limited source
for (const r of results) {
  console.log(`  ${r.ok ? 'OK  ' : 'FAIL'}  ${r.name.padEnd(26)} ${r.line}${r.required ? '' : '   (advisory — price only)'}`);
}
const failed = results.filter((r) => r.required && !r.ok);
if (failed.length) {
  console.log(`\n  fundamentals chain BROKEN: ${failed.map((f) => f.name.trim().split(' ')[0]).join(', ')} — /quote can only return absent values`);
  process.exit(1);
}
console.log('\n  fundamentals chain OK (edgar → fmp)');
