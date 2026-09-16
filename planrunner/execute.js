'use strict';
// planrunner/execute.js — the executor. SPEC.md §3-§6.
//
// Preflight classifies; this runs. The shape is lifted from agent/run-sweep.sh with the
// EasyM&A grading removed: checkpoint per phase, tree snapshot before the agent, agent
// under a wall-clock watchdog, RED established by the RUNNER, saved diff before anything
// destructive, commit or revert, ledger row either way.
//
// WHAT THIS REFUSES TO DO
//   - start on a dirty tree. It runs `reset --hard` and `clean -fd` on revert paths, and
//     a concurrent session's uncommitted work would be destroyed by both. run-sweep.sh
//     refuses for the same reason (:1031); so does this, and it names the dirty paths.
//   - take the agent's word for red. The agent is never asked to certify a before-state.
//   - claim authorship. The snapshot separates "changed before the agent" from "changed
//     during the agent"; it CANNOT separate the agent from a concurrent writer, and every
//     message it emits says so (GATE_SPEC.md:200-210).
//
// NOTHING IS PIPED TO /dev/null. Every verify, every tripwire, the agent's envelope and
// stderr, and the phase diff land under planrunner/runs/<id>/. SPEC §6.3.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');
const { parseFile } = require('./parse');
const { preflight } = require('./preflight');

const ROOT = path.resolve(__dirname, '..');
const PROMPT_FILE = path.join(__dirname, 'AGENT_PROMPT.md');
const VERIFY_TIMEOUT_MS = Number(process.env.PLANRUNNER_VERIFY_TIMEOUT_MS || 30000);
const AGENT_TIMEOUT_MS  = Number(process.env.PLANRUNNER_AGENT_TIMEOUT_MS  || 45 * 60 * 1000);
const BUDGET_USD        = Number(process.env.PLANRUNNER_BUDGET_USD || 25);
const RE_MARKER = /^VERIFY:ASSERTED[ \t]+(\d+)[ \t]*$/m;
const STATUS_TOKENS = ['DONE', 'BLOCKED', 'PARTIAL', 'FAILED'];

// ── git ─────────────────────────────────────────────────────────────────────────────
// stdio captures stderr rather than inheriting it: `git cat-file -e <rev>:<path>` is used
// as a PREDICATE in redSwap (does this path exist at the checkpoint?), and on the "no"
// answer git writes a fatal to stderr. Inheriting it prints an alarming line during a
// perfectly normal new-file swap.
const git   = (args, o) => execFileSync('git', ['-C', ROOT, ...args], Object.assign({ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }, o || {}));
const gitTry = (args) => { try { return { ok: true, out: git(args) }; } catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') }; } };
const dirtyPaths = () => git(['status', '--porcelain']).split('\n').filter(Boolean);

// Lifted from run-sweep.sh:676-697. Records (sha, path) for every dirty path before the
// agent, then diffs after: this is what makes staging explicit instead of `git add -A`.
function listDirty() {
  const out = git(['ls-files', '-m', '-o', '--exclude-standard', '-z']);
  return out.split('\0').filter(Boolean);
}
function hashAll(files) {
  if (!files.length) return [];
  return git(['hash-object', '--', ...files]).trim().split('\n');
}
function treeSnapshot() {
  const files = listDirty(); const h = hashAll(files);
  return new Map(files.map((f, i) => [f, h[i] || 'MISSING']));
}
// EXCLUDE is the runner's OWN run directory. Defence in depth, not decoration: the
// executor writes envelopes, diffs and verify logs INSIDE the repo it is operating on,
// so without this it reports its own artifacts as paths the agent changed — and the
// first thing that hits is TOUCH_VIOLATION, blaming the agent for the runner's writes.
// planrunner/.gitignore normally keeps them untracked, but a gate must not depend on a
// gitignore someone else can edit.
function changedSince(snap, exclude) {
  const files = listDirty(); const h = hashAll(files);
  return files.filter((f, i) => (h[i] || 'MISSING') !== snap.get(f))
              .filter(f => !exclude || !f.startsWith(exclude));
}

// ── globs ───────────────────────────────────────────────────────────────────────────
// Deliberately NOT reusing preflight's matcher: that one caches the file list at module
// load, and this process commits files as it goes, so a cached list would go stale
// exactly when a later phase's touches are evaluated.
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') { if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; } else re += '[^/]*'; }
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}
const matchesGlobs = (p, globs) => globs.some(g => globToRegExp(g).test(p));
function repoFilesNow() {
  return git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
}
function globsIntersect(a, b) {
  const files = repoFilesNow();
  const A = new Set(files.filter(f => matchesGlobs(f, a)));
  const B = files.filter(f => matchesGlobs(f, b));
  if (B.some(f => A.has(f))) return true;
  // Globs that match nothing yet (a red: absent phase creating a file) can still collide
  // with each other; compare them literally.
  const norm = s => s.replace(/\/+$/, '');
  const na = a.filter(g => !files.some(f => globToRegExp(g).test(f))).map(norm);
  const nb = b.filter(g => !files.some(f => globToRegExp(g).test(f))).map(norm);
  return na.some(g => nb.includes(g));
}

// ── running a check, durably ────────────────────────────────────────────────────────
function runCheck(cmd, artifactBase) {
  const r = spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', timeout: VERIFY_TIMEOUT_MS,
    env: Object.assign({}, process.env, { PLANRUNNER: '1' }) });
  const stdout = r.stdout || '', stderr = r.stderr || '';
  let code, note = '';
  if (r.error && r.error.code === 'ETIMEDOUT') { code = 2; note = 'timed out'; }
  else if (r.status === null) { code = 2; note = 'killed by signal ' + r.signal; }
  else if (![0, 1, 2].includes(r.status)) { code = 2; note = 'exited ' + r.status + ' (not 0/1/2) — read as ERROR, never as a fail'; }
  else code = r.status;
  const m = stdout.match(RE_MARKER);
  const marker = !!m && parseInt(m[1], 10) >= 1;
  if (artifactBase) {
    fs.mkdirSync(path.dirname(artifactBase), { recursive: true });
    fs.writeFileSync(artifactBase + '.cmd', cmd + '\n');
    fs.writeFileSync(artifactBase + '.out', stdout);
    fs.writeFileSync(artifactBase + '.err', stderr);
  }
  return { code, marker, stdout, stderr, note };
}

// ── the RED swap — run-sweep.sh:910-928 ─────────────────────────────────────────────
// Restore the paths the agent actually changed to the checkpoint, leaving EVERYTHING
// else — the verify command above all — exactly as it is, so app code is the only thing
// that differs between the two runs. File-level backup/restore into the run dir, not
// `git stash`: the restore has to be exactly reversible without consulting git state.
function redSwap(direction, paths, checkpoint, swapDir) {
  for (const p of paths) {
    const live = path.join(ROOT, p);
    const held = path.join(swapDir, p);
    if (direction === 'in') {
      fs.mkdirSync(path.dirname(held), { recursive: true });
      if (fs.existsSync(live)) fs.copyFileSync(live, held);
      const at = gitTry(['cat-file', '-e', checkpoint + ':' + p]);
      if (at.ok) {
        const blob = git(['show', checkpoint + ':' + p]);
        fs.mkdirSync(path.dirname(live), { recursive: true });
        fs.writeFileSync(live, blob);
      } else {
        fs.rmSync(live, { force: true });   // the agent CREATED it; the checkpoint had none
      }
    } else {
      if (fs.existsSync(held)) { fs.mkdirSync(path.dirname(live), { recursive: true }); fs.copyFileSync(held, live); }
      else fs.rmSync(live, { force: true });
    }
  }
}

// ── agent envelope — run-sweep.sh:635-646, :706-714 ─────────────────────────────────
function readEnvelope(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return { ok: false, reason: 'unreadable-envelope', isError: 'ABSENT', subtype: 'ABSENT', turns: 0, cost: 0 }; }
  const isError = j.is_error === true ? 'true' : (j.is_error === false ? 'false' : 'ABSENT');
  const subtype = j.subtype || j.terminal_reason || 'ABSENT';
  const turns = Number(j.num_turns || 0), cost = Number(j.total_cost_usd || 0);
  if (j.is_error === true) return { ok: false, reason: 'error-envelope:' + subtype, isError, subtype, turns, cost, result: String(j.result || '') };
  const text = typeof j.result === 'string' ? j.result : '';
  const m = text.match(new RegExp('^\\s*STATUS:\\s*(' + STATUS_TOKENS.join('|') + ')\\s*(?:\\(([^)]*)\\))?', 'mi'));
  if (!m) return { ok: false, reason: 'no-status-token', isError, subtype, turns, cost, result: text };
  return { ok: true, token: m[1].toUpperCase(), detail: (m[2] || '').trim(), isError, subtype, turns, cost, result: text };
}

// ── the agent, under a wall-clock watchdog — run-sweep.sh:965-998 ───────────────────
// Async on purpose: spawnSync would block the event loop, so a SIGTERM arriving mid-phase
// could not be handled and the saved diff and record would be lost — which is exactly the
// case the kill test exercises.
function runAgentAsync(phase, envelopePath, scratchDir, artifactBase) {
  return new Promise(resolve => {
    const mock = process.env.PLANRUNNER_MOCK_AGENT;
    let child, stderrChunks = [];
    if (mock) {
      const phaseFile = artifactBase + '.phase.json';
      fs.writeFileSync(phaseFile, JSON.stringify(phase, null, 2));
      child = spawn('bash', [mock, phaseFile, envelopePath, ROOT], { cwd: ROOT, detached: true,
        env: Object.assign({}, process.env, { PLANRUNNER_SCRATCH: scratchDir }) });
    } else {
      const prompt = fs.readFileSync(PROMPT_FILE, 'utf8') +
        '\n\nSCRATCH DIR: ' + scratchDir + '\n\nTURN BUDGET: ' + phase.fields.turns +
        ' turns. At about 75% (~' + Math.floor(phase.fields.turns * 3 / 4) + ') stop and report STATUS: PARTIAL.\n' +
        '\nPHASE: ' + JSON.stringify(phase.fields, null, 2) + '\n';
      // env -u ANTHROPIC_API_KEY, as run-sweep.sh:971 does: a shell that sourced .env must
      // never silently switch this to per-token API billing.
      const env = Object.assign({}, process.env); delete env.ANTHROPIC_API_KEY;
      child = spawn('claude', ['-p', '--output-format', 'json', '--max-turns', String(phase.fields.turns),
        '--permission-mode', 'acceptEdits'], { cwd: ROOT, detached: true, env });
      child.stdin.end(prompt);
      const out = fs.createWriteStream(envelopePath);
      child.stdout.pipe(out);
    }
    if (child.stdout && mock) child.stdout.on('data', () => {});
    child.stderr.on('data', d => stderrChunks.push(d));

    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {}
      done = true;
      fs.writeFileSync(artifactBase + '.err', Buffer.concat(stderrChunks));
      resolve({ timedOut: true });
    }, AGENT_TIMEOUT_MS);

    child.on('exit', () => {
      if (done) return;
      done = true; clearTimeout(timer);
      fs.writeFileSync(artifactBase + '.err', Buffer.concat(stderrChunks));
      resolve({ timedOut: false });
    });
  });
}

// ── the record — SPEC §6.3 ──────────────────────────────────────────────────────────
// claimed / verified / surprised. `claimed` is the agent's own words; `verified` is what
// the runner measured itself; `surprised` is every place the two disagree, or where
// reality differed from the plan. A phase with an empty `surprised` is one where nothing
// unexpected happened — which is information, not decoration.
class Record {
  constructor(meta) { Object.assign(this, meta); this.phases = []; this.tripwires = []; this.halted = false; this.haltReason = null; }
  add(p) { this.phases.push(p); this.flush(); return p; }
  flush() {
    fs.mkdirSync(this.runDir, { recursive: true });
    fs.writeFileSync(path.join(this.runDir, 'record.json'), JSON.stringify(this, null, 2));
    fs.writeFileSync(path.join(this.runDir, 'record.md'), this.toMarkdown());
  }
  toMarkdown() {
    const L = [];
    L.push('# Plan record — ' + this.plan);
    L.push('');
    L.push('- run: `' + this.runId + '`');
    L.push('- branch: `' + this.branch + '`');
    L.push('- base: `' + this.base + '`');
    if (this.halted) L.push('- **PLAN HALTED** — ' + this.haltReason);
    L.push('');
    for (const p of this.phases) {
      L.push('## phase ' + p.number + ': ' + p.title);
      L.push('');
      L.push('**' + p.status + '**' + (p.reason ? ' — ' + p.reason : ''));
      L.push('');
      L.push('| | |');
      L.push('|---|---|');
      L.push('| claimed | ' + (p.claimed || '_no agent ran_') + ' |');
      L.push('| verified | ' + (p.verified || '_nothing measured_') + ' |');
      L.push('| surprised | ' + (p.surprised && p.surprised.length ? p.surprised.join('<br>') : '_nothing unexpected_') + ' |');
      L.push('');
      if (p.repro) { L.push('Reproduce:'); L.push(''); L.push('```'); L.push(p.repro); L.push('```'); L.push(''); }
      if (p.artifacts && p.artifacts.length) { L.push('Artifacts: ' + p.artifacts.map(a => '`' + a + '`').join(' · ')); L.push(''); }
    }
    if (this.tripwires.length) {
      L.push('## tripwires');
      L.push('');
      for (const t of this.tripwires) L.push('- after phase ' + t.after + ': `' + t.cmd + '` → ' + t.result);
      L.push('');
    }
    return L.join('\n');
  }
}

// ── main ────────────────────────────────────────────────────────────────────────────
async function execute(planPath, opts) {
  const o = opts || {};
  const runId = o.runId || process.env.PLANRUNNER_RUN_ID || new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const runDir = path.join(__dirname, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });

  // ── refuse a dirty tree. This runs reset --hard and clean -fd; a concurrent session's
  //    uncommitted work would not survive either.
  const dirty = dirtyPaths();
  if (dirty.length && !o.allowDirty) {
    return { fatal: 'working tree is DIRTY — refusing to start. This runner reverts with `reset --hard` and `clean -fd`, which would destroy uncommitted work that is not its own.\n  ' + dirty.join('\n  ') };
  }

  const pre = preflight(planPath, { runId, runDir: path.join(runDir, 'preflight') });
  if (!pre.parsed.ok) return { fatal: 'plan does not parse — nothing was executed', pre };

  const base = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const slug = path.basename(planPath).replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]/g, '-');
  const branch = 'planrunner/' + slug + '-' + runId;
  git(['tag', 'planrunner/restore-' + runId]);
  git(['checkout', '-q', '-b', branch]);
  fs.writeFileSync(path.join(runDir, 'UNDO.txt'),
    '# Discard this entire run in one line (from ' + ROOT + '):\n' +
    'git checkout ' + base + ' && git branch -D ' + branch + ' && git tag -d planrunner/restore-' + runId + '\n');

  const runRel = path.relative(ROOT, runDir) + '/';
  const rec = new Record({ plan: planPath, runId, runDir, branch, base });
  const state = { rec, runDir, runRel, phase: null, snapshot: null };
  installSignalHandlers(state);

  const byNumber = new Map(pre.parsed.phases.map(p => [p.number, p]));
  const haltedTouches = [];      // touches of phases that halted — later intersecting phases are skipped
  const activeTripwires = [];    // { after, cmd } — re-run after every phase from declaration on
  let costTotal = 0;

  for (const cls of pre.phases) {
    const phase = byNumber.get(cls.number);
    const touches = phase.fields.touches;
    const art = [];
    const base_ = f => path.join(runDir, 'phase' + cls.number + '-' + f);

    // ── carried over from preflight ────────────────────────────────────────────────
    if (cls.state === 'HALT') {
      rec.add({ number: cls.number, title: cls.title, status: 'HALTED_PREFLIGHT', reason: cls.reason,
        claimed: null, verified: 'preflight: ' + Object.entries(cls.checks).map(([k, v]) => k + '=' + v).join(' · '),
        surprised: [], repro: 'node planrunner/preflight.js ' + planPath, artifacts: [] });
      haltedTouches.push(touches);
      continue;
    }
    if (cls.state === 'RESOLVED_UPSTREAM') {
      rec.add({ number: cls.number, title: cls.title, status: 'SKIPPED_RESOLVED', reason: cls.reason,
        claimed: null, verified: 'verify already passes at HEAD — no agent was run', surprised: [], artifacts: [] });
      continue;
    }

    // ── partial-plan continuation, SPEC §6.2 ───────────────────────────────────────
    const blocker = haltedTouches.find(t => globsIntersect(touches, t));
    if (blocker) {
      rec.add({ number: cls.number, title: cls.title, status: 'SKIPPED_DEPENDENT',
        reason: 'an earlier phase halted and its touches intersect this one (' + blocker.join(', ') + ') — running this would build on an unverified tree',
        claimed: null, verified: null, surprised: [], artifacts: [] });
      haltedTouches.push(touches);
      continue;
    }

    if (costTotal > BUDGET_USD) {
      rec.halted = true; rec.haltReason = 'budget $' + BUDGET_USD + ' exceeded ($' + costTotal.toFixed(2) + ')';
      rec.flush(); break;
    }

    // ── run the phase ──────────────────────────────────────────────────────────────
    const checkpoint = git(['rev-parse', 'HEAD']).trim();
    const snapshot = treeSnapshot();
    const scratch = path.join(runDir, 'scratch', 'phase' + cls.number);
    fs.mkdirSync(scratch, { recursive: true });
    state.phase = { number: cls.number, title: cls.title, checkpoint }; state.snapshot = snapshot;

    const envelopePath = base_('agent') + '.json';
    const agentRun = await runAgentAsync(phase, envelopePath, scratch, base_('agent'));
    art.push(path.relative(ROOT, envelopePath));

    const changed = changedSince(snapshot, runRel);

    // SAVED DIFF, BEFORE ANYTHING DESTRUCTIVE — whatever the verdict turns out to be.
    // run-sweep.sh:1229-1237 does this for one status; here it is unconditional, because
    // the phase you most want to read afterwards is the one that got reverted.
    saveDiff(changed, base_('work') + '.diff');
    if (changed.length) art.push(path.relative(ROOT, base_('work') + '.diff'));

    const finishPhase = (status, reason, extra) => {
      const p = Object.assign({ number: cls.number, title: cls.title, status, reason, artifacts: art }, extra || {});
      rec.add(p); return p;
    };
    const revert = () => { git(['reset', '--hard', '-q', checkpoint]); git(['clean', '-fdq']); };

    if (agentRun.timedOut) {
      revert();
      finishPhase('TIMEOUT', 'agent exceeded ' + AGENT_TIMEOUT_MS + 'ms and was tree-killed',
        { claimed: '_agent was killed before it reported_', verified: 'no verification attempted; work reverted (diff saved first)',
          surprised: ['agent produced no verdict within the wall clock'], repro: reproFor(phase) });
      haltedTouches.push(touches); continue;
    }

    const env = readEnvelope(envelopePath);
    costTotal += env.cost;
    const claimed = env.ok ? ('`STATUS: ' + env.token + (env.detail ? '(' + env.detail + ')' : '') + '` · ' + env.turns + ' turns · $' + env.cost.toFixed(2))
                           : ('_no verdict_ (' + env.reason + ') · ' + env.turns + ' turns');
    const surprised = [];

    if (!env.ok) {
      revert();
      finishPhase('NO_VERDICT', 'agent envelope is unusable: ' + env.reason,
        { claimed, verified: 'no verification attempted — an untrustworthy result never spends a verify',
          surprised: changed.length ? ['agent left ' + changed.length + ' changed path(s) with no verdict; reverted, diff saved'] : [],
          repro: reproFor(phase) });
      haltedTouches.push(touches); continue;
    }
    if (env.token !== 'DONE') {
      revert();
      finishPhase('AGENT_' + env.token, 'agent reported ' + env.token + ' — nothing to verify',
        { claimed, verified: 'no verification attempted; the agent did not claim the phase was done',
          surprised: changed.length ? ['agent reported ' + env.token + ' but left ' + changed.length + ' changed path(s); reverted unmeasured'] : [],
          repro: reproFor(phase) });
      haltedTouches.push(touches); continue;
    }

    // ── the verify command is read-only to the agent (GATE_SPEC.md:410-425) ────────
    // CHECKED BEFORE the touches gate on purpose. Both can fire on the same write, and
    // "you edited the check that grades you" is the more specific and more serious
    // finding; reporting it as a generic scope violation would bury it. It is also the
    // only one of the two that is reachable when a plan's touches is broad enough to
    // legitimately cover its own verify script.
    const verifyScript = scriptOf(phase.fields.verify);
    if (verifyScript && changed.includes(verifyScript)) {
      revert();
      finishPhase('VERIFY_TAMPERED', 'the agent changed ' + verifyScript + ', which is the file its own verify runs — a check the agent can weaken cannot grade the agent',
        { claimed, verified: 'changed: ' + changed.join(', '), surprised: ['verify script modified during the phase window'], repro: reproFor(phase) });
      haltedTouches.push(touches); continue;
    }

    // ── post-hoc touches enforcement, SPEC §4 ──────────────────────────────────────
    const outside = changed.filter(p => !matchesGlobs(p, touches));
    if (outside.length) {
      revert();
      finishPhase('TOUCH_VIOLATION',
        'path(s) outside `touches` changed during the phase window — by the agent, or by a concurrent writer; ' +
        'the snapshot cannot tell those apart, so authorship is not claimed and the phase is reverted: ' + outside.join(', '),
        { claimed, verified: 'declared touches: ' + touches.join(', ') + ' · changed: ' + changed.join(', '),
          surprised: ['changed outside touches: ' + outside.join(', ')], repro: reproFor(phase) });
      haltedTouches.push(touches); continue;
    }

    if (!changed.length) {
      revert();
      finishPhase('PHASE_VACUOUS', 'the agent claimed DONE but changed nothing — red and green would be the same tree, so a pass proves nothing',
        { claimed, verified: 'changed paths: none', surprised: ['agent claimed DONE with an empty diff'], repro: reproFor(phase) });
      haltedTouches.push(touches); continue;
    }

    // ── GREEN, on the agent's tree ─────────────────────────────────────────────────
    const green = runCheck(phase.fields.verify, base_('verify-green'));
    art.push(path.relative(ROOT, base_('verify-green') + '.out'), path.relative(ROOT, base_('verify-green') + '.err'));

    if (green.code === 0 && !green.marker) {
      revert();
      finishPhase('PHASE_VACUOUS', 'verify exited 0 without printing VERIFY:ASSERTED — a check that asserts nothing cannot certify a phase',
        { claimed, verified: 'green: exit 0, marker ABSENT', surprised: ['verify passed while asserting nothing'], repro: reproFor(phase) });
      haltedTouches.push(touches); continue;
    }
    if (green.code === 1) {
      revert();
      finishPhase('VERIFY_FAILED', 'the declared verify FAILS on the agent\'s own tree — the claimed work is falsified',
        { claimed, verified: 'green: exit 1' + (green.marker ? ' with assertions run' : ''),
          surprised: ['agent claimed DONE but its own tree does not pass verify'], repro: reproFor(phase) });
      haltedTouches.push(touches); continue;
    }
    if (green.code === 2) {
      revert();
      finishPhase('VERIFY_ERROR', 'verify could not run on the agent\'s tree (exit 2) — an unrunnable check is never a fail, but it cannot certify either',
        { claimed, verified: 'green: exit 2' + (green.note ? ' (' + green.note + ')' : ''),
          surprised: ['verify unrunnable after the phase'], repro: reproFor(phase) });
      haltedTouches.push(touches); continue;
    }

    // ── RED, established by the RUNNER ─────────────────────────────────────────────
    const swapDir = path.join(runDir, 'redswap-phase' + cls.number);
    fs.mkdirSync(swapDir, { recursive: true });
    redSwap('in', changed, checkpoint, swapDir);
    const red = runCheck(phase.fields.verify, base_('verify-red'));
    redSwap('out', changed, checkpoint, swapDir);
    art.push(path.relative(ROOT, base_('verify-red') + '.out'));

    const verified = 'green exit ' + green.code + '/marker ' + (green.marker ? 'yes' : 'no') +
                     ' · red exit ' + red.code + '/marker ' + (red.marker ? 'yes' : 'no') +
                     ' · runner-established, ' + changed.length + ' path(s) swapped';

    const outcome = classifyRedGreen(phase.fields.red, red);
    if (outcome.state === 'HALT') {
      revert();
      finishPhase(outcome.status, outcome.reason,
        { claimed, verified, surprised: [outcome.surprise], repro: reproFor(phase) });
      haltedTouches.push(touches); continue;
    }

    // ── commit, staging EXPLICIT paths — never `git add -A` ────────────────────────
    for (const p of changed) gitTry(['add', '--', p]);
    git(['commit', '-q', '-m', 'planrunner(' + runId + ') phase ' + cls.number + ': ' + cls.title + ' [' + outcome.status + ']\n\n' +
      'verify: ' + phase.fields.verify + '\nred: ' + phase.fields.red + ' · green exit ' + green.code + ' · red exit ' + red.code + '\n' +
      'files: ' + changed.join(', ') + '\n\n' + outcome.reason]);

    if (phase.fields.red === 'absent') surprised.push('red was not provable by assertion — the subject did not exist at the checkpoint, so this is DONE_UNPROVEN_RED, not DONE_VERIFIED');
    finishPhase(outcome.status, outcome.reason, { claimed, verified, surprised, repro: reproFor(phase) });

    // ── tripwires — declared here, re-run from here on ─────────────────────────────
    if (phase.fields.tripwire !== '<not declared>') activeTripwires.push({ cmd: phase.fields.tripwire, from: cls.number });
    const trip = runTripwires(activeTripwires, cls.number, runDir, rec);
    if (trip) {
      rec.halted = true;
      rec.haltReason = 'TRIPWIRE after phase ' + cls.number + ': `' + trip.cmd + '` was holding when declared (phase ' + trip.from + ') and fails now. A violated plan-wide invariant means the tree is no longer trusted, so the whole plan stops.';
      const last = rec.phases[rec.phases.length - 1];
      last.surprised = (last.surprised || []).concat(['broke a tripwire that was holding at declaration: ' + trip.cmd]);
      rec.flush(); break;
    }
  }

  rec.flush();
  return { rec, pre, branch, base, runDir };
}

function classifyRedGreen(redDecl, red) {
  if (redDecl === 'fails') {
    if (red.code === 1 && red.marker) return { state: 'OK', status: 'DONE_VERIFIED', reason: 'verify fails at the checkpoint with assertions run and passes on this tree — the check discriminates' };
    if (red.code === 0) return { state: 'HALT', status: 'PHASE_VACUOUS', reason: 'the verify passes at the checkpoint too — it cannot tell this phase\'s work from its absence', surprise: 'red did not go red: the checkpoint already satisfies this verify (an earlier phase may have resolved it)' };
    if (red.code === 1) return { state: 'HALT', status: 'PHASE_VACUOUS', reason: 'verify exits 1 at the checkpoint WITHOUT printing VERIFY:ASSERTED — the check never ran, so red is vacuous', surprise: 'red exit 1 came from a load failure, not an assertion' };
    return { state: 'HALT', status: 'RED_UNPROVEN', reason: 'verify could not run at the checkpoint (exit 2) — red is unproven, and an unprovable red cannot certify a phase', surprise: 'verify unrunnable on the checkpoint tree' };
  }
  if (redDecl === 'absent') {
    if (red.code !== 0 && !red.marker) return { state: 'OK', status: 'DONE_UNPROVEN_RED', reason: 'verify passes here and could not run at the checkpoint — consistent with the subject not existing before; the capability exists now, but the runner did not prove this work is why' };
    if (red.code === 0) return { state: 'HALT', status: 'PHASE_VACUOUS', reason: 'verify passes at the checkpoint too — the capability was already there', surprise: 'declared red: absent, but the subject already worked at the checkpoint' };
    return { state: 'HALT', status: 'RED_MISDECLARED', reason: 'declared red: absent, but the check RAN and failed at the checkpoint — the subject existed and was broken, so this phase is red: fails', surprise: 'red state mis-declared: assertions ran at the checkpoint' };
  }
  // red: none — the check inverts; the unchanged green is the evidence.
  if (red.code === 0 && red.marker) return { state: 'OK', status: 'DONE_UNCHANGED', reason: 'the invariant holds at the checkpoint and still holds here, and the diff is non-empty — behavior preserved across a real change' };
  return { state: 'HALT', status: 'PHASE_VACUOUS', reason: 'red: none requires the invariant to hold at the checkpoint, but verify exited ' + red.code + ' there', surprise: 'a red: none phase whose invariant did not hold before it started' };
}

function runTripwires(active, afterPhase, runDir, rec) {
  for (const t of active) {
    const r = runCheck(t.cmd, path.join(runDir, 'tripwire-after-phase' + afterPhase));
    rec.tripwires.push({ after: afterPhase, from: t.from, cmd: t.cmd, result: r.code === 0 ? 'holds' : 'VIOLATED (exit ' + r.code + ')' });
    if (r.code !== 0) return t;
  }
  return null;
}

// `git diff HEAD` alone misses files the agent CREATED. Intent-to-add them first so a new
// file's contents are in the saved diff, then undo the staging — the diff is evidence,
// not a commit.
function saveDiff(changed, out) {
  if (!changed.length) { fs.writeFileSync(out, '(no paths changed during the phase window)\n'); return; }
  for (const p of changed) gitTry(['add', '-N', '--', p]);
  const d = gitTry(['diff', 'HEAD']);
  fs.writeFileSync(out, d.ok ? d.out : '(could not produce a diff)\n' + d.out);
  for (const p of changed) gitTry(['reset', '-q', '--', p]);
}

function scriptOf(cmd) {
  const t = cmd.trim().split(/\s+/);
  let i = 0; while (i < t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i])) i++;
  const base = (t[i] || '').replace(/^.*\//, '');
  if (!['node', 'nodejs', 'python', 'python3', 'bash', 'sh', 'ruby', 'perl'].includes(base)) return null;
  const a = t.slice(i + 1).find(x => !x.startsWith('-'));
  return a ? a.replace(/^["']|["']$/g, '') : null;
}
const reproFor = phase => 'cd ' + ROOT + ' && ' + phase.fields.verify;

// ── a killed run must not be invisible — run-sweep.sh:811-842 ───────────────────────
function installSignalHandlers(state) {
  let firing = false;
  const handler = sig => {
    if (firing) return; firing = true;
    try {
      const p = state.phase;
      if (p && state.snapshot) {
        const changed = changedSince(state.snapshot, state.runRel);
        saveDiff(changed, path.join(state.runDir, 'killed-phase' + p.number + '.diff'));
        state.rec.add({ number: p.number, title: p.title, status: 'KILLED',
          reason: 'the runner received ' + sig + ' during this phase; work on disk was saved to killed-phase' + p.number + '.diff and left in the tree, NOT reverted and NOT committed',
          claimed: '_the agent had not reported when the runner died_',
          verified: 'nothing verified — the phase did not reach its verify',
          surprised: ['run ended abnormally on ' + sig],
          repro: 'cd ' + ROOT + ' && git diff HEAD', artifacts: ['planrunner/runs/' + state.rec.runId + '/killed-phase' + p.number + '.diff'] });
      }
      state.rec.halted = true;
      state.rec.haltReason = 'killed by ' + sig;
      state.rec.flush();
    } catch (e) { /* a handler that throws must still exit */ }
    process.exit(130);
  };
  process.on('SIGINT', () => handler('SIGINT'));
  process.on('SIGTERM', () => handler('SIGTERM'));
}

module.exports = { execute, classifyRedGreen, globsIntersect, matchesGlobs, redSwap, readEnvelope, scriptOf };

if (require.main === module) {
  const planPath = process.argv[2];
  if (!planPath) { console.error('usage: node planrunner/execute.js <plan.md>'); process.exit(2); }
  execute(planPath).then(r => {
    if (r.fatal) { console.error('FATAL: ' + r.fatal); process.exit(2); }
    console.log(r.rec.toMarkdown());
    console.log('\nrecord: ' + path.relative(ROOT, r.runDir) + '/record.md');
    process.exit(r.rec.halted ? 1 : 0);
  }).catch(e => { console.error(e); process.exit(2); });
}
