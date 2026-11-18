#!/usr/bin/env node
// Run with: node server/services/__tests__/registrationFailOpen.test.js
// Fix 21: a FAILED registration check never blocks a company. The real /quote route runs here, with every HTTPS call
// answered by a fake, so there is no network. Only a successful EDGAR answer showing a Form 15 or 25-NSE may refuse.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

// Before server.js loads: its SIC cache lands in this folder, and the key is a placeholder.
process.env.TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'registration-failopen-'));
const scratch = process.env.TMPDIR;
process.env.FMP_KEY = 'test-placeholder';

const { checkRegistration, withDeadline, REGISTRATION_UNAVAILABLE } = require('../registrationStatus');
const SERVER = path.resolve(__dirname, '../../../server.js');

const COMPANIES = {
  HNGE: { name: 'Hinge Health, Inc.', cik: '0001953100', ticker: 'HNGE' },
  OMDA: { name: 'Omada Health, Inc.', cik: '0001516119', ticker: 'OMDA' },
  TALK: { name: 'Talkspace, Inc.', cik: '0001803901', ticker: 'TALK' },
};
const LISTED = ['HNGE', 'OMDA'];
const filings = (rows) => ({ recent: { form: rows.map((r) => r[0]), filingDate: rows.map((r) => r[1]) } });

function secAnswer(p) {
  if (p === '/files/company_tickers.json') {
    return Object.fromEntries(LISTED.map((t, i) => [i, { ticker: t, title: COMPANIES[t].name, cik_str: Number(COMPANIES[t].cik) }]));
  }
  if (p === `/submissions/CIK${COMPANIES.TALK.cik}.json`) {
    return { name: COMPANIES.TALK.name, tickers: [], filings: filings([['15-12G', '2026-08-27'], ['10-Q', '2026-08-06']]) };
  }
  return null;   // anything else from EDGAR: not needed here, so the company falls through to FMP
}
function fmpAnswer(p) {
  const sym = new URL(`https://x${p}`).searchParams.get('symbol');
  const c = COMPANIES[sym];
  if (!c) return [];
  if (p.startsWith('/stable/profile')) return [{ symbol: sym, companyName: c.name, cik: c.cik, price: 20, marketCap: 2000000000, currency: 'USD' }];
  if (p.startsWith('/stable/income-statement')) return [{ revenue: 500000000, netIncome: 25000000, eps: 0.25, reportedCurrency: 'USD' }];
  if (p.startsWith('/stable/balance-sheet-statement')) return [{ cashAndCashEquivalents: 100000000, totalDebt: 0, reportedCurrency: 'USD' }];
  return [];
}

// fault(host, path) → undefined (answer normally) | an HTTP status | 'timeout' | 'no-network'
function installFakeHttps(fault) {
  https.get = (opts, onResponse) => {
    const req = new EventEmitter();
    req.setTimeout = (_ms, onIdle) => { req.onIdle = onIdle; return req; };
    req.destroy = (err) => setImmediate(() => req.emit('error', err));
    const respond = (status, body) => {
      const res = Readable.from(status >= 400 ? [] : [JSON.stringify(body)]);
      res.statusCode = status; res.headers = {};
      onResponse(res);
    };
    setImmediate(() => {
      const isSec = /(^|\.)sec\.gov$/.test(opts.hostname);
      const f = isSec ? fault(opts.hostname, opts.path) : undefined;
      if (f === 'timeout') return req.onIdle && req.onIdle();   // the idle timer in get() fires; with no timer it just hangs
      if (f === 'no-network') return req.emit('error', new Error('getaddrinfo ENOTFOUND ' + opts.hostname));
      if (typeof f === 'number') return respond(f);
      if (!isSec) return respond(200, fmpAnswer(opts.path));
      const body = secAnswer(opts.path);
      return body ? respond(200, body) : respond(404);
    });
    return req;
  };
}

// A fresh copy of the server, so no list or check result carries over between cases.
async function withServer(fault, run) {
  let current = fault;
  installFakeHttps((h, p) => current(h, p));
  delete require.cache[SERVER];
  const realLog = console.log;
  console.log = () => {};   // server.js prints its route table on load
  const { app } = require(SERVER);
  console.log = realLog;
  const listener = await new Promise((r) => { const l = app.listen(0, () => r(l)); });
  const base = `http://127.0.0.1:${listener.address().port}`;
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    await run({
      quote: async (t) => { const r = await fetch(`${base}/quote?symbol=${t}`); return { status: r.status, body: await r.json() }; },
      setFault: (f) => { current = f; },
      warnings,
    });
  } finally {
    console.warn = realWarn;
    await new Promise((r) => listener.close(r));
  }
}

const allSec = (f) => () => f;
const submissionsOnly = (f) => (host) => (host === 'data.sec.gov' ? f : undefined);
const assertLoaded = (t, r) => {
  assert.strictEqual(r.status, 200, `${t}: HTTP ${r.status}`);
  assert.strictEqual(r.body.error, undefined, `${t} was refused: ${r.body.error}`);
  assert.strictEqual(r.body.name, COMPANIES[t].name);
  assert.strictEqual(r.body.dataSource, 'fmp');
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

for (const [label, f] of [['HTTP 429', 429], ['timeout', 'timeout'], ['HTTP 503', 503], ['no network', 'no-network']]) {
  for (const t of ['HNGE', 'OMDA']) {
    test(`${t} loads when every SEC request fails: ${label}`, () => withServer(allSec(f), async ({ quote, warnings }) => {
      assertLoaded(t, await quote(t));
      assert.ok(warnings.some((w) => w.includes(`[${t}] ${REGISTRATION_UNAVAILABLE}`)), `no log line: ${warnings.join(' | ')}`);
    }));
    test(`${t} loads when only data.sec.gov fails: ${label}`, () => withServer(submissionsOnly(f), async ({ quote }) => {
      assertLoaded(t, await quote(t));
    }));
  }
}

test('an unlisted company also loads when the check fails: TALK on a 429', () => withServer(allSec(429), async ({ quote, warnings }) => {
  assertLoaded('TALK', await quote('TALK'));
  assert.ok(warnings.some((w) => w.includes(`[TALK] ${REGISTRATION_UNAVAILABLE}`)));
}));
test('a successful EDGAR answer showing a Form 15 refuses TALK', () => withServer(() => undefined, async ({ quote }) => {
  const r = await quote('TALK');
  assert.strictEqual(r.body.code, 'deregistered');
  assert.strictEqual(r.body.error, 'Talkspace, Inc. deregistered with the SEC on 2026-08-27 (Form 15-12G); no current filings');
}));
test('a failure is not remembered: TALK loads on a 429, then is refused once EDGAR answers', () => withServer(submissionsOnly(429), async ({ quote, setFault }) => {
  assertLoaded('TALK', await quote('TALK'));
  setFault(() => undefined);
  assert.strictEqual((await quote('TALK')).body.code, 'deregistered');
}));

const never = () => new Promise(() => {});
const check = (over) => {
  const logged = [];
  return checkRegistration('HNGE', { resolveCik: async () => COMPANIES.HNGE.cik, deadlineMs: 20, warn: (m) => logged.push(m), ...over }).then((r) => ({ ...r, logged }));
};
test('checkRegistration: a request that never returns is a failed check, not a wait', async () => {
  const r = await check({ fetchSubmissions: never });
  assert.deepStrictEqual([r.checked, r.block], [false, null]);
  assert.match(r.logged[0], /^\[HNGE\] registration check unavailable: /);
});
test('checkRegistration: a 200 with no filing history is a failed check', async () => {
  const r = await check({ fetchSubmissions: async () => ({ name: 'Hinge Health, Inc.' }) });
  assert.deepStrictEqual([r.checked, r.block], [false, null]);
});
test('checkRegistration: a failed CIK lookup is a failed check', async () => {
  const r = await check({ resolveCik: async () => { throw new Error('HTTP 429 from financialmodelingprep.com'); }, fetchSubmissions: never });
  assert.deepStrictEqual([r.checked, r.block], [false, null]);
});
test('checkRegistration: a clean answer is checked and clear, with no log line', async () => {
  const r = await check({ fetchSubmissions: async () => ({ tickers: ['HNGE'], filings: filings([['10-Q', '2026-11-05']]) }) });
  assert.deepStrictEqual([r.checked, r.block, r.logged.length], [true, null, 0]);
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try { await withDeadline(fn(), 25000); passed += 1; console.log(`  ok  ${name}`); }
    catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); }
  }
  console.log(`${passed}/${tests.length} passed`);
  fs.rmSync(scratch, { recursive: true, force: true });
  process.exit(passed === tests.length ? 0 : 1);
})();
