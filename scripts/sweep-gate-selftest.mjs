#!/usr/bin/env node
// scripts/sweep-gate-selftest.mjs — the two run-sweep.sh changes of 2026-10-07, each tested against the
// real function text extracted from the script (never a copy) and, for the short-circuit, against the
// recorded artifacts of run 20260929-193005 iter 1.
//   1. commit_ledger — commits the runner's own ledger paths on the run's OWN branch, and refuses to
//      commit anything when HEAD is someone else's branch. A run must end with a clean tree.
//   2. the no-op short-circuit condition — fires on iter 1's real numbers (no app-code change, byte-
//      identical bundle), and must NOT fire for a server-side fix, whose bundle is also byte-identical.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SWEEP = path.join(ROOT, 'agent/run-sweep.sh');
const src = fs.readFileSync(SWEEP, 'utf8');

let pass = 0, fail = 0;
const ok = (n) => { console.log(`  \x1b[32m✓\x1b[0m ${n}`); pass++; };
const bad = (n, e) => { console.log(`  \x1b[31m✗\x1b[0m ${n}\n      ${e.message || e}`); fail++; };
const t = (n, fn) => { try { fn(); ok(n); } catch (e) { bad(n, e); } };

const fn = (name) => {
  const m = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm').exec(src);
  assert.ok(m, `could not extract ${name}() from run-sweep.sh`);
  return m[0];
};
const sh = (script, cwd) => {
  // the harness script lives OUTSIDE the repo under test: dropping it inside would show up as `?? h.sh`
  // and make the "tree is clean after the run" assertion test the harness instead of commit_ledger.
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'h-')), 'h.sh');
  fs.writeFileSync(f, script);
  const r = spawnSync('/bin/bash', [f], { cwd, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const repo = (branch) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  fs.mkdirSync(path.join(d, 'agent'), { recursive: true });
  for (const f of ['agent/QUEUE.md', 'agent/DECISIONS.md', 'agent/calibration.csv']) fs.writeFileSync(path.join(d, f), 'seed\n');
  const q = (c) => spawnSync('/bin/bash', ['-c', c], { cwd: d, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  q('git init -q . && git add -A && git commit -qm seed');
  if (branch) q(`git checkout -q -b ${branch}`);
  return d;
};
const PRELUDE = (dir, runId) => `set -uo pipefail
ROOT=${JSON.stringify(dir)}; AGENT_DIR="$ROOT/agent"; RUN_ID=${runId}
QUEUE="$AGENT_DIR/QUEUE.md"; DECISIONS="$AGENT_DIR/DECISIONS.md"; CALIB="$AGENT_DIR/calibration.csv"
gitr() { git -C "$ROOT" "$@"; }
log() { printf '%s\\n' "$*"; }
${fn('commit_ledger')}
`;

console.log('\n1. commit_ledger');
t('commits the ledger on the run\'s OWN branch and leaves the tree clean', () => {
  const d = repo('sweep/auto-20261007-120000');
  fs.appendFileSync(path.join(d, 'agent/DECISIONS.md'), '- [12:00:00 · run 20261007-120000 · iter ?] a ledger row\n');
  const r = sh(PRELUDE(d, '20261007-120000') + 'commit_ledger\ngit -C "$ROOT" status --porcelain\n', d);
  assert.match(r.out, /ledger committed: [0-9a-f]{7}/, r.out);
  const dirty = r.out.split('\n').filter((l) => /^ ?[AMD?]/.test(l));
  assert.deepEqual(dirty, [], `tree not clean after the run: ${JSON.stringify(dirty)}`);
  const msg = spawnSync('git', ['-C', d, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(msg, 'sweep(20261007-120000): ledger', `commit message was "${msg}"`);
  console.log(`      "${msg}", tree clean`);
});
t('refuses to commit when HEAD is NOT the run\'s branch (operator dirt stays theirs)', () => {
  const d = repo(null);                                           // still on the default branch
  fs.appendFileSync(path.join(d, 'agent/DECISIONS.md'), 'operator work in progress\n');
  const r = sh(PRELUDE(d, '20261007-120000') + 'commit_ledger\ngit -C "$ROOT" status --porcelain\n', d);
  assert.doesNotMatch(r.out, /ledger committed/, 'it committed on the operator\'s branch');
  assert.match(r.out, /^ ?M agent\/DECISIONS\.md/m, `the operator's change should still be uncommitted: ${r.out}`);
  const n = Number(spawnSync('git', ['-C', d, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).stdout.trim());
  assert.equal(n, 1, 'no new commit should exist');
});
t('commits nothing, and says nothing, when no ledger path is dirty', () => {
  const d = repo('sweep/auto-20261007-120000');
  const r = sh(PRELUDE(d, '20261007-120000') + 'commit_ledger\necho "rc=$?"\n', d);
  assert.doesNotMatch(r.out, /ledger committed/, r.out);
  assert.match(r.out, /rc=0/);
});
t('never stages a path outside the ledger (no add -A anywhere in the function)', () => {
  const f = fn('commit_ledger');
  assert.doesNotMatch(f, /add\s+-A|add\s+\./, 'commit_ledger must stage explicit paths only');
  for (const v of ['$CALIB', '$DECISIONS', '$QUEUE']) assert.ok(f.includes(v), `${v} should be staged`);
  const d = repo('sweep/auto-20261007-120000');
  fs.writeFileSync(path.join(d, 'server.js'), 'app code the agent left behind\n');
  fs.appendFileSync(path.join(d, 'agent/calibration.csv'), 'row\n');
  const r = sh(PRELUDE(d, '20261007-120000') + 'commit_ledger\ngit -C "$ROOT" status --porcelain\n', d);
  assert.match(r.out, /ledger committed/);
  assert.match(r.out, /\?\? server\.js/, `app code must NOT be swept into the ledger commit: ${r.out}`);
  console.log('      app code left untracked, only calibration.csv committed');
});

console.log('\n2. no-op short-circuit, against run 20260929-193005 iter 1');
const COND = (() => {
  const m = /if \[\[ "\$\{SNAP_N:-0\}" -eq 0 && "\$\{APP_CHANGED_N:-0\}" -eq 0 && "\$\{BUNDLE_IDENTICAL:-0\}" -eq 1 \]\]/.exec(src);
  assert.ok(m, 'the short-circuit condition is not in run-sweep.sh in the expected shape');
  return m[0];
})();
const fires = (snap, app, bundle) => sh(`set -uo pipefail
SNAP_N=${snap}; APP_CHANGED_N=${app}; BUNDLE_IDENTICAL=${bundle}
${COND}; then echo FIRES; else echo MEASURES; fi
`, os.tmpdir()).out.trim();

t('iter 1\'s real numbers (snapshot 0, no app paths, identical bundle) → fires', () => {
  // from agent/runs/20260929-193005/loop.log: "tree snapshot: 0 dirty path(s) before agent",
  // "bundle main.aa39afea.js (byte-identical …)", token BLOCKED, and commit 458d0be touched only
  // agent/DECISIONS.md, agent/QUEUE.md, agent/calibration.csv and agent/diagnosis/ — zero app paths.
  assert.equal(fires(0, 0, 1), 'FIRES');
  console.log('      would have skipped the 84m after-capture that scored REGRESSION on a flaky DAL/ALK deck');
});
t('a SERVER-SIDE fix (edits present, bundle identical) → still measured', () => {
  assert.equal(fires(0, 1, 1), 'MEASURES');     // the 20260815-150838 trap
});
t('a client-side fix (edits present, new bundle) → still measured', () => {
  assert.equal(fires(0, 1, 0), 'MEASURES');
});
t('pre-existing dirt before the agent → measured, never short-circuited', () => {
  assert.equal(fires(2, 0, 1), 'MEASURES');
});
t('the detector is app-code paths, not `git status` (iter 1 left a diagnosis note)', () => {
  const block = src.slice(src.indexOf('# ── no-op short-circuit'), src.indexOf('# after-capture (capture failure'));
  assert.match(block, /APP_CHANGED_N="\$\(app_paths_of \| grep -c ''/, 'must count app_paths_of, not agent_changed');
  assert.doesNotMatch(block, /if .*agent_changed/, 'agent_changed would be true for a diagnosis-only iteration');
});
t('it records the token but never credits a DONE claim as a fix', () => {
  const block = src.slice(src.indexOf('# ── no-op short-circuit'), src.indexOf('# after-capture (capture failure'));
  assert.match(block, /finalize NO_CHANGE/, 'the verdict must be NO_CHANGE — nothing was measured');
  assert.match(block, /DONE\*\|RESOLVED_UPSTREAM\*\)/, 'a success token on an unchanged tree must be called out');
  assert.match(block, /STATUS_TOKEN/, 'the agent token must be recorded in the reason');
});
t('run-sweep.sh still parses', () => {
  assert.equal(spawnSync('/bin/bash', ['-n', SWEEP], { encoding: 'utf8' }).status, 0);
});

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} passed, ${fail} failed\x1b[0m\n`);
process.exit(fail ? 1 : 0);
