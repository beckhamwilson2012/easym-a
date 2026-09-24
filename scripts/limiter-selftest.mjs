#!/usr/bin/env node
// scripts/limiter-selftest.mjs — proves the `general` limiter skips loopback and still limits everyone else.
// Three levels, because a 500/15-min ceiling cannot be exercised by a handful of calls:
//   1. the predicate's truth table (server/utils/isLoopback.js)
//   2. a REAL express-rate-limit instance wired exactly like server.js's `general`, driven over HTTP:
//      loopback sails past the ceiling, a forwarded remote IP gets 429 on cue
//   3. the live server: 520 requests from localhost — 20 past the real ceiling — must yield zero 429s,
//      plus the 10 sequential /quote calls asked for
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const { isLoopback } = require_(path.join(ROOT, 'server/utils/isLoopback.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n) => { console.log(`  \x1b[32m✓\x1b[0m ${n}`); pass++; };
const bad = (n, e) => { console.log(`  \x1b[31m✗\x1b[0m ${n}\n      ${e.message || e}`); fail++; };
const t = async (n, fn) => { try { await fn(); ok(n); } catch (e) { bad(n, e); } };

console.log('\n1. the predicate');
await t('loopback forms are local; everything else is not', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']) assert.equal(isLoopback(ip), true, ip);
  for (const ip of ['203.0.113.7', '10.0.0.4', '192.168.1.22', '8.8.8.8', '', null, undefined, '127.0.0.1.evil.com'])
    assert.equal(isLoopback(ip), false, `${ip} must NOT count as loopback`);
});

console.log('\n2. a real limiter, wired like server.js');
await t('loopback is never limited; a remote IP is limited at the ceiling', async () => {
  const express = require_(path.join(ROOT, 'node_modules/express'));
  const rateLimit = require_(path.join(ROOT, 'node_modules/express-rate-limit'));
  const app = express();
  app.set('trust proxy', true);   // TEST ONLY — lets the test present a non-loopback req.ip via X-Forwarded-For
  app.use('/api', rateLimit({ windowMs: 60_000, max: 3, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests. Try again shortly.' }, skip: (req) => isLoopback(req.ip),
    // the library warns that `trust proxy: true` lets a client forge its IP — correct, and exactly why
    // this test app sets it and server.js does not. Silenced here so a real failure stays visible.
    validate: { trustProxy: false } }));
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = srv.address().port;
  try {
    const hit = (headers) => fetch(`http://127.0.0.1:${port}/api/ping`, { headers }).then((r) => r.status);
    const local = [];
    for (let i = 0; i < 12; i++) local.push(await hit({}));                       // 4x the ceiling
    assert.deepEqual([...new Set(local)], [200], `loopback saw ${JSON.stringify(local)}`);
    const remote = [];
    for (let i = 0; i < 5; i++) remote.push(await hit({ 'X-Forwarded-For': '203.0.113.7' }));
    assert.deepEqual(remote, [200, 200, 200, 429, 429], `remote saw ${JSON.stringify(remote)}`);
    console.log(`      loopback 12/12 → 200 · remote → ${remote.join(',')}`);
  } finally { srv.close(); }
});

console.log('\n3. the live server (the real 500/15-min ceiling)');
const PORT = '3017';
const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  cwd: ROOT, env: { ...process.env, PORT, FMP_KEY: '' },   // no key → /quote answers fast, no upstream calls
});
let out = '';
srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
try {
  const up = await (async () => {
    for (let i = 0; i < 60; i++) {
      try { await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(1500) }); return true; } catch { await sleep(400); }
    }
    return false;
  })();
  await t('server is up on the test port', () => assert.ok(up, `no server on ${PORT}: ${out.slice(-200)}`));

  await t('520 sequential /api/sectors from localhost — 20 past the ceiling — zero 429s', async () => {
    const codes = {};
    for (let i = 0; i < 520; i++) {
      const s = (await fetch(`http://127.0.0.1:${PORT}/api/sectors`)).status;
      codes[s] = (codes[s] || 0) + 1;
    }
    assert.equal(codes['429'] || 0, 0, `got ${codes['429']} rate-limited responses: ${JSON.stringify(codes)}`);
    console.log(`      ${JSON.stringify(codes)}  (without the skip, request 501 would be 429)`);
  });

  await t('10 sequential /quote calls from localhost return no 429', async () => {
    const codes = [];
    for (let i = 0; i < 10; i++) codes.push((await fetch(`http://127.0.0.1:${PORT}/quote?symbol=ZZZZTEST`)).status);
    assert.equal(codes.filter((c) => c === 429).length, 0, `codes: ${JSON.stringify(codes)}`);
    console.log(`      statuses: ${[...new Set(codes)].join(',')}`);
  });

  await t('the llm tier is NOT skipped for loopback (money routes stay guarded)', () => {
    const src = require_('node:fs').readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const llmBlock = src.slice(src.indexOf('const llm = rateLimit('), src.indexOf('app.use(\'/api\', general)'));
    assert.doesNotMatch(llmBlock, /skip\s*:/, 'the llm limiter must not have gained a skip');
  });
} finally { srv.kill('SIGKILL'); }

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
