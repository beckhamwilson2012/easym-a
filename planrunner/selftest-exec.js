'use strict';
// planrunner/selftest-exec.js — the executor's gates, each shown FAILING and PASSING.
//
// THE TRAP THIS ANSWERS: the executor is where "a check that passes without work
// happening" is most likely to appear. A gate exercised only on input it accepts proves
// nothing — an unconditional `return DONE` passes that test. So every gate below is run
// twice against the SAME plan, differing only in the mock agent's behaviour, and both
// verdicts are asserted.
//
// SAFETY: the executor commits, reverts with `reset --hard`, and runs `clean -fd`. It is
// NEVER pointed at this repo. Each case builds a throwaway git repo under
// planrunner/runs/exec-selftest/ containing a copy of planrunner/, and runs there.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');

const HERE = __dirname;
const WORK = path.join(HERE, 'runs', 'exec-selftest');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

let repoSeq = 0;
function makeRepo() {
  const dir = path.join(WORK, 'repo' + (++repoSeq));
  fs.mkdirSync(path.join(dir, 'planrunner'), { recursive: true });
  // Copy planrunner/ except runs/ — the scratch repo gets its own.
  for (const entry of fs.readdirSync(HERE)) {
    if (entry === 'runs') continue;
    execFileSync('cp', ['-R', path.join(HERE, entry), path.join(dir, 'planrunner', entry)]);
  }
  const g = args => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  g(['init', '-q']);
  g(['config', 'user.email', 'selftest@example.invalid']);
  g(['config', 'user.name', 'planrunner selftest']);
  g(['add', '--', 'planrunner']);
  g(['commit', '-q', '-m', 'scratch repo for the executor selftest']);
  return dir;
}

// Run the executor in a scratch repo. Returns the parsed record.
function run(plan, behaviours, extraEnv) {
  const dir = makeRepo();
  const runId = 'case' + repoSeq;
  const env = Object.assign({}, process.env, {
    PLANRUNNER_MOCK_AGENT: path.join(dir, 'planrunner/examples/agents/mock.sh'),
    PLANRUNNER_RUN_ID: runId,
    PLANRUNNER_AGENT_TIMEOUT_MS: '20000',
  }, extraEnv || {});
  for (const [k, v] of Object.entries(behaviours || {})) env['MOCK_BEHAVIOR_' + k] = v;
  const r = spawnSync('node', [path.join(dir, 'planrunner/execute.js'), path.join(dir, 'planrunner/examples/', plan)],
    { cwd: dir, encoding: 'utf8', env, timeout: 120000 });
  const recPath = path.join(dir, 'planrunner/runs', runId, 'record.json');
  const rec = fs.existsSync(recPath) ? JSON.parse(fs.readFileSync(recPath, 'utf8')) : null;
  return { dir, rec, runId, stdout: r.stdout || '', stderr: r.stderr || '', code: r.status };
}

const statuses = rec => (rec ? rec.phases.map(p => p.status) : ['<no record>']);
const statusOf = (rec, n) => { const p = rec && rec.phases.find(x => x.number === n); return p ? p.status : '<no phase ' + n + '>'; };

// ── gate table ──────────────────────────────────────────────────────────────────────
const GATES = [];
const gate = (name, note, reject, accept) => GATES.push({ name, note, reject, accept });

gate('RED SWAP — a red that will not go red (the runner establishes it, not the agent)',
  'identical plan and agent; phase 2 differs only in that phase 1 already fixed its subject',
  { what: 'phase 2, whose checkpoint already passes verify', want: 'PHASE_VACUOUS',
    run: () => statusOf(run('v2-drift.plan.md', { 1: 'fix-coerce', 2: 'cosmetic', 3: 'cosmetic-safe' }).rec, 2) },
  { what: 'phase 1, whose checkpoint genuinely fails verify', want: 'DONE_VERIFIED',
    run: () => statusOf(run('v2-drift.plan.md', { 1: 'fix-coerce', 2: 'cosmetic', 3: 'cosmetic-safe' }).rec, 1) });

gate('PARTIAL-PLAN CONTINUATION — a halt must not stop non-intersecting phases',
  null,
  { what: 'phase 4, whose touches DO intersect the halted phase 2', want: 'SKIPPED_DEPENDENT',
    run: () => statusOf(run('v2-drift.plan.md', { 1: 'fix-coerce', 2: 'cosmetic', 3: 'cosmetic-safe', 4: 'fix-coerce' }).rec, 4) },
  { what: 'phase 3, whose touches do NOT intersect it', want: 'DONE_UNCHANGED',
    run: () => statusOf(run('v2-drift.plan.md', { 1: 'fix-coerce', 2: 'cosmetic', 3: 'cosmetic-safe', 4: 'fix-coerce' }).rec, 3) });

gate('TOUCHES — a write outside the declared globs',
  'same plan, same phase; only where the agent writes differs',
  { what: 'agent writes sandbox/stray.js, outside touches', want: 'TOUCH_VIOLATION',
    run: () => statusOf(run('v3-touches.plan.md', { 1: 'stray' }).rec, 1) },
  { what: 'agent writes only sandbox/coerce.js, inside touches', want: 'DONE_VERIFIED',
    run: () => statusOf(run('v3-touches.plan.md', { 1: 'fix-coerce' }).rec, 1) });

gate('TRIPWIRE — an invariant that held at declaration and fails after a later phase',
  'same plan; phase 2 either breaks the invariant or leaves it intact',
  { what: 'phase 2 breaks safe.js under a shallow verify', want: 'HALTED',
    run: () => { const r = run('v4-tripwire.plan.md', { 1: 'create-health', 2: 'break-safe', 3: 'fix-coerce' }); return r.rec && r.rec.halted ? 'HALTED' : 'not halted'; } },
  { what: 'phase 2 leaves safe.js behaviour intact', want: 'not halted',
    run: () => { const r = run('v4-tripwire.plan.md', { 1: 'create-health', 2: 'cosmetic-safe', 3: 'fix-coerce' }); return r.rec && r.rec.halted ? 'HALTED' : 'not halted'; } });

gate('TRIPWIRE — a halted plan must not run later phases',
  null,
  { what: 'phase 3 after a tripwire halt', want: '<no phase 3>',
    run: () => statusOf(run('v4-tripwire.plan.md', { 1: 'create-health', 2: 'break-safe', 3: 'fix-coerce' }).rec, 3) },
  { what: 'phase 3 when the tripwire holds', want: 'DONE_VERIFIED',
    run: () => statusOf(run('v4-tripwire.plan.md', { 1: 'create-health', 2: 'cosmetic-safe', 3: 'fix-coerce' }).rec, 3) });

gate('VERIFY_FAILED — the agent claims DONE on a tree that does not pass its own verify',
  null,
  { what: 'agent edits the file but does not fix it', want: 'VERIFY_FAILED',
    run: () => statusOf(run('v3-touches.plan.md', { 1: 'fake-done' }).rec, 1) },
  { what: 'agent actually fixes it', want: 'DONE_VERIFIED',
    run: () => statusOf(run('v3-touches.plan.md', { 1: 'fix-coerce' }).rec, 1) });

gate('PHASE_VACUOUS — DONE claimed with an empty diff',
  'red and green would be the same tree, so a pass proves nothing',
  { what: 'agent changes nothing and claims DONE', want: 'PHASE_VACUOUS',
    run: () => statusOf(run('v3-touches.plan.md', { 1: 'noop' }).rec, 1) },
  { what: 'agent changes the file and claims DONE', want: 'DONE_VERIFIED',
    run: () => statusOf(run('v3-touches.plan.md', { 1: 'fix-coerce' }).rec, 1) });

gate('VERIFY_TAMPERED — the agent edits the check that grades it',
  null,
  { what: 'agent rewrites its own verify script to pass', want: 'VERIFY_TAMPERED',
    run: () => statusOf(run('v3-touches.plan.md', { 1: 'tamper' }).rec, 1) },
  { what: 'agent leaves the verify script alone', want: 'DONE_VERIFIED',
    run: () => statusOf(run('v3-touches.plan.md', { 1: 'fix-coerce' }).rec, 1) });

gate('NO_VERDICT — an errored envelope is not a verdict, whatever is on disk',
  'run-sweep.sh:1200-1255: a non-empty diff is not a verdict',
  { what: 'agent cut off (is_error) with work on disk', want: 'NO_VERDICT',
    run: () => statusOf(run('v3-touches.plan.md', { 1: 'cutoff' }).rec, 1) },
  { what: 'agent returns a clean envelope with a STATUS token', want: 'DONE_VERIFIED',
    run: () => statusOf(run('v3-touches.plan.md', { 1: 'fix-coerce' }).rec, 1) });

gate('AGENT_BLOCKED — only DONE proceeds to verification',
  null,
  { what: 'agent reports BLOCKED', want: 'AGENT_BLOCKED',
    run: () => statusOf(run('v3-touches.plan.md', { 1: 'blocked' }).rec, 1) },
  { what: 'agent reports DONE', want: 'DONE_VERIFIED',
    run: () => statusOf(run('v3-touches.plan.md', { 1: 'fix-coerce' }).rec, 1) });

gate('RED: ABSENT keeps its own weaker status — it is never DONE_VERIFIED',
  'proving a capability exists now is not proving this work is why',
  { what: 'a new-file phase that succeeds', want: 'DONE_UNPROVEN_RED',
    run: () => statusOf(run('small.plan.md', { 1: 'create-health', 2: 'fix-coerce' }).rec, 1) },
  { what: 'a bug-fix phase that succeeds', want: 'DONE_VERIFIED',
    run: () => statusOf(run('small.plan.md', { 1: 'create-health', 2: 'fix-coerce' }).rec, 2) });

gate('DIRTY TREE — the executor must refuse to start where it would destroy work',
  'it reverts with reset --hard and clean -fd',
  { what: 'an uncommitted file present at start', want: 'refused',
    run: () => {
      const dir = makeRepo();
      fs.writeFileSync(path.join(dir, 'someone-elses-work.txt'), 'uncommitted\n');
      const r = spawnSync('node', [path.join(dir, 'planrunner/execute.js'), path.join(dir, 'planrunner/examples/v3-touches.plan.md')],
        { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { PLANRUNNER_MOCK_AGENT: path.join(dir, 'planrunner/examples/agents/mock.sh') }), timeout: 60000 });
      const stillThere = fs.existsSync(path.join(dir, 'someone-elses-work.txt'));
      return (/working tree is DIRTY/.test(r.stderr) && stillThere) ? 'refused' : 'ran anyway (stderr: ' + r.stderr.slice(0, 60) + ')';
    } },
  { what: 'a clean tree at start', want: 'DONE_VERIFIED',
    run: () => statusOf(run('v3-touches.plan.md', { 1: 'fix-coerce' }).rec, 1) });

// ── run ─────────────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
console.log('planrunner EXECUTOR selftest — every gate shown REJECTING and ACCEPTING');
console.log('='.repeat(84));
for (const g of GATES) {
  console.log('');
  console.log('GATE: ' + g.name);
  if (g.note) console.log('      (' + g.note + ')');
  for (const side of ['reject', 'accept']) {
    const c = g[side];
    let got;
    try { got = c.run(); } catch (e) { got = 'THREW: ' + e.message; }
    const ok = got === c.want;
    if (ok) pass++; else fail++;
    console.log('   must ' + side.toUpperCase().padEnd(6) + ' ' + c.what.padEnd(52) + ' → ' + String(got).padEnd(20) + (ok ? '✓' : '✗ EXPECTED ' + c.want));
  }
}
console.log('');
console.log('='.repeat(84));
console.log(pass + ' passed · ' + fail + ' failed · ' + GATES.length + ' gates, each shown failing and passing');
process.exit(fail ? 1 : 0);
