#!/usr/bin/env node
// scripts/sources-selftest.mjs — `npm run sources:selftest`. Proves the four behaviours changed on
// 2026-09-17, each against the REAL code (no mocking framework):
//   1. dotenv resolves .env from server.js's own directory, so a foreign cwd still loads FMP_KEY
//   2. an exhausted fundamentals chain prints exactly ONE line, the WARN, and no per-source chatter
//   3. a Yahoo 429 is skipped — one log line, null, no retry, no throw
//   4. sweep-watchdog.sh classifies a completed run with "0 ok" as FAILED (exit 1)
//   5. run-sweep.sh itself exits 2 when its final capture summary is "0 ok of N"
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server.js');
const AGENT = path.join(ROOT, 'agent');
const WATCHDOG = path.join(os.homedir(), 'bin/agents/sweep-watchdog.sh');
const require_ = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (n) => { console.log(`  \x1b[32m✓\x1b[0m ${n}`); pass++; };
const bad = (n, e) => { console.log(`  \x1b[31m✗\x1b[0m ${n}\n      ${e.message || e}`); fail++; };
const t = async (n, fn) => { try { await fn(); ok(n); } catch (e) { bad(n, e); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(port, ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) }); return true; } catch { await sleep(400); }
  }
  return false;
}

console.log('\n1. dotenv is pinned to server.js\'s directory');
await t('server.js:1 passes an explicit path to dotenv', () => {
  const head = fs.readFileSync(SERVER, 'utf8').split('\n').slice(0, 6).join('\n');
  assert.match(head, /require\('dotenv'\)\.config\(\{ path: require\('path'\)\.join\(__dirname, '\.env'\) \}\)/);
});
await t('FMP_KEY loads when cwd is agent/ (the sweep\'s WorkingDirectory)', async () => {
  const code = `require(${JSON.stringify(SERVER)}); setTimeout(() => { console.log('FMP_KEY_LEN=' + (process.env.FMP_KEY || '').length); process.exit(0); }, 2000);`;
  const r = spawnSync(process.execPath, ['-e', code], { cwd: AGENT, env: { ...process.env, PORT: '3013' }, encoding: 'utf8', timeout: 60000 });
  const m = /FMP_KEY_LEN=(\d+)/.exec(r.stdout || '');
  assert.ok(m, `no FMP_KEY_LEN in output: ${(r.stdout || r.stderr || '').slice(-200)}`);
  assert.ok(Number(m[1]) > 0, `key length ${m[1]} — .env not found from ${AGENT}`);
  console.log(`      cwd=agent/ → FMP_KEY length ${m[1]} (value never read)`);
});

console.log('\n2. exhausted fundamentals chain → one WARN line, no per-source noise');
await t('FMP 401 + no CIK → single `fundamentals unavailable: edgar=no-cik fmp=error:HTTP 401…`', async () => {
  const srv = spawn(process.execPath, [SERVER], { cwd: ROOT, env: { ...process.env, PORT: '3014', FMP_KEY: 'invalid-test-key-0000' } });
  let out = '';
  srv.stdout.on('data', (d) => (out += d));
  srv.stderr.on('data', (d) => (out += d));
  try {
    assert.ok(await waitForPort(3014), 'probe server never came up on 3014');
    const before = out.length;
    const r = await fetch('http://127.0.0.1:3014/quote?symbol=ZZZZTEST', { signal: AbortSignal.timeout(60000) });
    const body = await r.json();
    await sleep(300);
    const fresh = out.slice(before).split('\n').filter((l) => l.includes('ZZZZTEST'));
    assert.equal(body.dataSource, 'none', `expected dataSource none, got ${body.dataSource}`);
    assert.equal(body.revenue, null, 'revenue must be absent, never 0');
    const warns = fresh.filter((l) => /fundamentals unavailable:/.test(l));
    assert.equal(warns.length, 1, `expected 1 WARN, got ${warns.length}: ${JSON.stringify(fresh)}`);
    assert.match(warns[0], /edgar=no-cik fmp=error:HTTP 401/);
    const noise = fresh.filter((l) => /Trying |EDGAR result|FMP |FMP result|quote request|Final result/.test(l));
    assert.equal(noise.length, 0, `per-source noise at default level: ${JSON.stringify(noise)}`);
    assert.equal(fresh.length, 1, `expected exactly 1 line for the request, got: ${JSON.stringify(fresh)}`);
    console.log(`      ${warns[0].trim()}`);
  } finally { srv.kill('SIGKILL'); }
});

await t('QUOTE_TRACE=1 brings the per-source lines back (gated, not deleted)', async () => {
  const srv = spawn(process.execPath, [SERVER], { cwd: ROOT, env: { ...process.env, PORT: '3015', FMP_KEY: 'invalid-test-key-0000', QUOTE_TRACE: '1' } });
  let out = '';
  srv.stdout.on('data', (d) => (out += d));
  srv.stderr.on('data', (d) => (out += d));
  try {
    assert.ok(await waitForPort(3015), 'probe server never came up on 3015');
    const before = out.length;
    await fetch('http://127.0.0.1:3015/quote?symbol=ZZZZTEST', { signal: AbortSignal.timeout(60000) });
    await sleep(300);
    const fresh = out.slice(before).split('\n').filter((l) => l.includes('ZZZZTEST'));
    assert.ok(fresh.length > 1, `expected trace chatter, got ${JSON.stringify(fresh)}`);
    assert.ok(fresh.some((l) => /FMP — fetching income/.test(l)), 'per-source FMP line missing under QUOTE_TRACE=1');
    assert.equal(fresh.filter((l) => /fundamentals unavailable:/.test(l)).length, 1, 'WARN must still be exactly one line');
    console.log(`      ${fresh.length} lines with QUOTE_TRACE=1, still exactly one WARN`);
  } finally { srv.kill('SIGKILL'); }
});

console.log('\n3. Yahoo 429 is skipped, not retried');
await t('fetchPrice → null, one log line, exactly one HTTP attempt, no throw', async () => {
  const httpGet = require_(path.join(ROOT, 'server/utils/httpGet.js'));
  let calls = 0;
  httpGet.get = async () => { calls++; throw new Error('HTTP 429 from query1.finance.yahoo.com'); };
  const yc = require_(path.join(ROOT, 'server/services/yahooClient.js'));   // captures the patched get
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  let price;
  try { price = await yc.fetchPrice('AAPL'); } finally { console.warn = orig; }
  assert.equal(price, null, `expected null, got ${price}`);
  assert.equal(calls, 1, `expected 1 attempt (no sibling-host retry), got ${calls}`);
  assert.equal(warns.filter((w) => /yahoo price skipped: HTTP 429/.test(w)).length, 1, `log lines: ${JSON.stringify(warns)}`);
  console.log(`      ${warns[0]}`);
});

console.log('\n4. watchdog grades a completed run with 0 ok as FAILED');
const running = spawnSync('/usr/bin/pgrep', ['-f', '[r]un-sweep.sh'], { encoding: 'utf8' }).stdout.trim();
const fixture = (summary) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-test-'));
  const run = path.join(dir, 'agent', 'runs', '20260916-124247');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'loop.log'),
    `[19:50:25] capture END · baseline · ${summary} · 409m\n[19:50:25] RUN 20260916-124247 COMPLETE · branch sweep/auto-20260916-124247\n`);
  return dir;
};
const runWatchdog = (dir) => {
  const env = { ...process.env, SWEEP_AGENT_DIR: path.join(dir, 'agent'), SWEEP_WATCHDOG_LOG: path.join(dir, 'wd.log'),
    SWEEP_WATCHDOG_STATE: path.join(dir, 'state'), SWEEP_WATCHDOG_REPORTED: path.join(dir, 'reported'), WATCHDOG_NO_NOTIFY: '1' };
  const r = spawnSync('/bin/bash', [WATCHDOG], { env, encoding: 'utf8', timeout: 30000 });
  const log = fs.existsSync(path.join(dir, 'wd.log')) ? fs.readFileSync(path.join(dir, 'wd.log'), 'utf8') : '';
  return { code: r.status, log };
};
if (running) {
  console.log('  — skipped: a run-sweep.sh is in flight, so the watchdog takes its stall path');
} else {
  await t('"50 decks captured (0 ok)" → exit 1 and a FAILED log line', () => {
    const { code, log } = runWatchdog(fixture('50 decks captured (0 ok)'));
    assert.equal(code, 1, `expected exit 1, got ${code}`);
    assert.match(log, /FAILED 0 ok — 50 decks captured \(0 ok\)/);
    console.log(`      ${log.trim()}`);
  });
  await t('"50 decks captured (48 ok)" → exit 0 and no FAILED line', () => {
    const { code, log } = runWatchdog(fixture('50 decks captured (48 ok)'));
    assert.equal(code, 0, `expected exit 0, got ${code}`);
    assert.doesNotMatch(log, /FAILED/);
  });
  await t('a FAILED run is announced once, not on every tick', () => {
    const dir = fixture('50 decks captured (0 ok)');
    const a = runWatchdog(dir), b = runWatchdog(dir);
    assert.equal(a.code, 1); assert.equal(b.code, 1, 'must keep reporting failure while that run is the newest');
    assert.equal((b.log.match(/FAILED 0 ok/g) || []).length, 1, 'log line repeated per tick');
  });
}

console.log('\n5. run-sweep.sh exit contract: 0 ok → exit 2');
// The block is EXTRACTED from run-sweep.sh between its sentinels, never copied: the test runs the same
// text the sweep runs, under the same shell options (`set -uo pipefail`), with log() and RUN_DIR stubbed.
const SWEEP = path.join(ROOT, 'agent/run-sweep.sh');
const block = (() => {
  const m = /# >>> exit-contract[^\n]*\n([\s\S]*?)# <<< exit-contract/.exec(fs.readFileSync(SWEEP, 'utf8'));
  assert.ok(m, 'exit-contract sentinels missing from agent/run-sweep.sh');
  return m[1];
})();
const runContract = (loopLogLines) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-exit-'));
  if (loopLogLines !== null) fs.writeFileSync(path.join(dir, 'loop.log'), loopLogLines.join('\n') + '\n');
  const harness = path.join(dir, 'contract.sh');
  fs.writeFileSync(harness, `set -uo pipefail\nRUN_ID=20260916-124247\nRUN_DIR=${JSON.stringify(dir)}\nlog() { printf '%s\\n' "$*"; }\n${block}`);
  const r = spawnSync('/bin/bash', [harness], { encoding: 'utf8', timeout: 20000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const CAP_OK = '[13:00:50] capture END · baseline · 50 decks captured (48 ok) · 21m';
const CAP_ZERO = '[19:50:25] capture END · baseline · 50 decks captured (0 ok) · 409m';
await t('final summary "(0 ok)" → exit 2, and says so in loop.log', () => {
  const { code, out } = runContract([CAP_OK, CAP_ZERO, '[19:50:25] RUN 20260916-124247 COMPLETE']);
  assert.equal(code, 2, `expected exit 2, got ${code} · ${out.trim()}`);
  assert.match(out, /FAILED · 50 decks captured \(0 ok\) — zero analyzable decks/);
  console.log(`      exit 2 · ${out.trim()}`);
});
await t('a later good capture wins: last summary "(48 ok)" → exit 0', () => {
  const { code, out } = runContract([CAP_ZERO, CAP_OK]);
  assert.equal(code, 0, `expected exit 0, got ${code} · ${out.trim()}`);
  assert.doesNotMatch(out, /FAILED/);
});
await t('a real run (48 ok) → exit 0', () => {
  assert.equal(runContract([CAP_OK]).code, 0);
});
await t('no capture summary at all → exit 0, no crash under `set -uo pipefail`', () => {
  const { code, out } = runContract(['[13:00:49] build OK']);
  assert.equal(code, 0, `expected exit 0, got ${code} · ${out.trim()}`);
  assert.doesNotMatch(out, /unbound variable|No such file/);
});
await t('missing loop.log and an unknown "(? ok)" count are not proven zeros → exit 0', () => {
  assert.equal(runContract(null).code, 0, 'missing loop.log must not fail the run');
  assert.equal(runContract(['[19:50:25] capture END · baseline · 50 decks captured (? ok) · 409m']).code, 0);
});
await t('the EXIT trap shape used by run-sweep.sh preserves exit 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-trap-'));
  const f = path.join(dir, 'trap.sh');
  // same shape as run-sweep.sh:202 — three handlers that return, none of which calls exit
  fs.writeFileSync(f, 'set -uo pipefail\nfinalize_abnormal() { return 0; }\ncleanup_children() { :; }\nrelease_lock() { false; }\non_exit() { finalize_abnormal; cleanup_children; release_lock; }\ntrap on_exit EXIT INT TERM\nexit 2\n');
  assert.equal(spawnSync('/bin/bash', [f], { encoding: 'utf8' }).status, 2, 'the trap swallowed the exit code');
});
await t('run-sweep.sh still parses', () => {
  const r = spawnSync('/bin/bash', ['-n', SWEEP], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
