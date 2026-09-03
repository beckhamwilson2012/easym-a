'use strict';
// planrunner/preflight.js — SPEC.md §6.1. Classify every phase BEFORE any phase runs.
//
// WHY THIS EXISTS: stripping the sweep harness's count gate turns four fall-through
// branches into halts (agent/run-sweep.sh:1323, :1336, :1353, :1374 — each currently
// reads "falling through to the count gate"), and SPEC §2-§5 add more. A runner that
// halts mid-night is one you babysit. Almost every one of those halts is PREDICTABLE
// before a token is spent, so we predict them all at once and hand back a plan report.
// The human fixes the plan up front instead of being woken six times.
//
// This is agent/run-sweep.sh:1003-1028 — fail in under a second, before the lock, the
// port, the tree or the tag — applied to a whole plan instead of one runner's externals.
//
// NOTHING IS PIPED TO /dev/null. Every check's stdout AND stderr is written under
// planrunner/runs/<id>/preflight/. SPEC §6.3; a halt without its output is unactionable.

const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { parseFile, formatParsed, NOT_DECLARED } = require('./parse');

const ROOT = path.resolve(__dirname, '..');
const CHECK_TIMEOUT_MS = Number(process.env.PLANRUNNER_CHECK_TIMEOUT_MS || 30000);

// The marker a `verify` must print to prove its assertions actually ran. SPEC §2b.
// Exit codes alone cannot tell "the assertion failed" from "the check never loaded":
// a Node require() of a module that does not exist throws, and node exits 1 — which
// agent/run-sweep.sh:1366 reads as a discriminating red. A load failure never reaches
// the line that prints this.
const RE_MARKER = /^VERIFY:ASSERTED[ \t]+(\d+)[ \t]*$/m;

function hasMarker(stdout) {
  const m = String(stdout || '').match(RE_MARKER);
  return !!m && parseInt(m[1], 10) >= 1;
}

// ── glob matching, over the files git actually knows about ──────────────────────────
let FILE_LIST = null;
function repoFiles() {
  if (FILE_LIST) return FILE_LIST;
  try {
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    FILE_LIST = out.split('\0').filter(Boolean);
  } catch (e) {
    FILE_LIST = [];
  }
  return FILE_LIST;
}
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}
function globMatches(glob) {
  const re = globToRegExp(glob);
  return repoFiles().filter(f => re.test(f));
}

// ── command existence ───────────────────────────────────────────────────────────────
// A `verify` naming a script that is not on disk is the "unverifiable phase" case: it
// would sail through parsing (it is valid shell) and only fail at runtime, after the
// agent had already been paid for. Caught here instead.
function commandExists(cmd) {
  const tokens = cmd.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;  // env prefixes
  const prog = tokens[i];
  if (!prog) return { ok: false, why: 'no program in the command' };

  const r = spawnSync('bash', ['-c', 'command -v -- "$1" >/dev/null 2>&1', 'x', prog], { timeout: 5000 });
  if (r.status !== 0) return { ok: false, why: 'program ' + JSON.stringify(prog) + ' not found on PATH' };

  // Only the SCRIPT ARGUMENT OF AN INTERPRETER is required to exist.
  //
  // A blanket "every path-looking argument must be on disk" rule is WRONG, and the
  // example plan caught it: `test -f <path>` exists precisely to ask whether a path is
  // there, so requiring the path to be there turns a legitimately-false predicate into
  // a bogus "missing dependency" halt — the right outcome reported for the wrong
  // reason, which is worse than no check. Only a script an interpreter is about to
  // RUN is a genuine dependency.
  const INTERPRETERS = ['node', 'nodejs', 'python', 'python3', 'bash', 'sh', 'zsh', 'ruby', 'perl'];
  const base = prog.replace(/^.*\//, '');
  if (!INTERPRETERS.includes(base)) return { ok: true };

  const args = tokens.slice(i + 1);
  // -e/--eval/-c carry inline code, not a path — there is no file to check.
  if (args.some(a => a === '-e' || a === '--eval' || a === '-c')) return { ok: true };

  const script = args.find(a => !a.startsWith('-'));
  if (!script) return { ok: true };                          // a REPL invocation; nothing to check
  const bare = script.replace(/^["']|["']$/g, '');
  if (bare.startsWith('/') || bare.includes('://')) return { ok: true };
  if (!fs.existsSync(path.join(ROOT, bare))) {
    return { ok: false, why: 'script ' + JSON.stringify(bare) + ' is not on disk' };
  }
  return { ok: true };
}

// ── running a check, durably ────────────────────────────────────────────────────────
function runCheck(cmd, artifactBase) {
  const r = spawnSync('bash', ['-c', cmd], {
    cwd: ROOT, encoding: 'utf8', timeout: CHECK_TIMEOUT_MS,
    env: Object.assign({}, process.env, { PLANRUNNER: '1' }),
  });
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';

  let code;
  let note = '';
  if (r.error && r.error.code === 'ETIMEDOUT') { code = 2; note = 'timed out after ' + CHECK_TIMEOUT_MS + 'ms — read as ERROR, never as a fail'; }
  else if (r.status === null) { code = 2; note = 'killed by signal ' + r.signal + ' — read as ERROR'; }
  else if (![0, 1, 2].includes(r.status)) { code = 2; note = 'exited ' + r.status + ' (not 0/1/2) — read as ERROR, never as a fail'; }
  else code = r.status;

  if (artifactBase) {
    fs.mkdirSync(path.dirname(artifactBase), { recursive: true });
    fs.writeFileSync(artifactBase + '.out', stdout);
    fs.writeFileSync(artifactBase + '.err', stderr);
    fs.writeFileSync(artifactBase + '.cmd', cmd + '\n');
  }
  return { code, rawStatus: r.status, stdout, stderr, marker: hasMarker(stdout), note };
}

// ── the classification table — SPEC §3 ──────────────────────────────────────────────
// Returns { state, reason }. state ∈ EXECUTABLE | RESOLVED_UPSTREAM | HALT
function classify(red, res) {
  const { code, marker } = res;

  // THE MARKER RULE FIRST, and it applies to every `red:` state. A check that exits 0
  // while asserting nothing is the failure this gate exists for — it is indistinguishable
  // from a passing check if you only read the exit code (CLAUDE.md:62-64).
  if (code === 0 && !marker) {
    return { state: 'HALT', reason: 'verify exited 0 but never printed VERIFY:ASSERTED — a check that asserts nothing cannot grade a phase' };
  }

  if (red === 'fails') {
    if (code === 0) return { state: 'RESOLVED_UPSTREAM', reason: 'verify already passes at HEAD — the phase premise is already true; skip it, do not work it' };
    if (code === 1 && marker) return { state: 'EXECUTABLE', reason: 'verify fails at HEAD with assertions run — red is establishable' };
    if (code === 1) return { state: 'HALT', reason: 'verify exits 1 at HEAD without VERIFY:ASSERTED — the check never ran, so red would be vacuous (this is the MODULE_NOT_FOUND case)' };
    return { state: 'HALT', reason: 'verify could not run at HEAD (exit 2) — red cannot be established' + (res.note ? ': ' + res.note : '') };
  }

  if (red === 'absent') {
    if (code === 0) return { state: 'RESOLVED_UPSTREAM', reason: 'verify already passes at HEAD — the capability is already present' };
    if (marker) return { state: 'HALT', reason: 'declared red: absent, but the check RAN and failed at HEAD — the thing exists and is broken, so this phase is red: fails' };
    return { state: 'EXECUTABLE', reason: 'verify is non-zero at HEAD without assertions — consistent with the subject not existing yet' };
  }

  if (red === 'none') {
    if (code === 0) return { state: 'EXECUTABLE', reason: 'invariant holds at HEAD; the unchanged green is the evidence' };
    return { state: 'HALT', reason: 'red: none requires the invariant to hold at HEAD, but verify exited ' + code + ' — nothing to preserve' + (res.note ? ': ' + res.note : '') };
  }

  return { state: 'HALT', reason: 'unreachable: unknown red state ' + JSON.stringify(red) };
}

// ── the preflight itself ────────────────────────────────────────────────────────────
function preflight(planPath, opts) {
  const o = opts || {};
  const runId = o.runId || new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const runDir = o.runDir || path.join(__dirname, 'runs', runId, 'preflight');

  const parsed = parseFile(planPath);
  const report = { source: planPath, runId, runDir, parsed, phases: [], summary: null };

  if (!parsed.ok) {
    report.summary = { executable: 0, halted: 0, resolved: 0, parseErrors: parsed.errors.length, verdict: 'NOT RUNNABLE — the plan does not parse' };
    return report;
  }

  for (const p of parsed.phases) {
    const rec = { number: p.number, title: p.title, checks: {}, state: null, reason: null };
    const base = f => path.join(runDir, 'phase' + p.number + '-' + f);

    // 1. command existence — cheapest, and it is the "unverifiable phase" catcher.
    let fatal = null;
    for (const field of ['verify', 'enter', 'tripwire']) {
      const cmd = p.fields[field];
      if (cmd === NOT_DECLARED || cmd === null) continue;
      const ex = commandExists(cmd);
      rec.checks[field + ':exists'] = ex.ok ? 'ok' : 'MISSING — ' + ex.why;
      if (!ex.ok && !fatal) fatal = { field, why: ex.why };
    }
    if (fatal) {
      rec.state = 'HALT';
      rec.reason = fatal.field + ' names something that is not on disk: ' + fatal.why + ' — unverifiable, caught before the agent runs';
      report.phases.push(rec); continue;
    }

    // 2. touches globs.
    //    The rule is CONDITIONED ON `red:`, because the states mean different things
    //    about whether the subject already exists:
    //      red: fails / none — the subject must exist to HAVE a before-state, so every
    //                          glob must match at least one file.
    //      red: absent       — the subject does not exist yet BY DECLARATION, so an
    //                          unmatched glob is expected. Its parent directory must
    //                          still exist, which is what catches a typo'd path.
    //    Requiring a match unconditionally would reject every new-file phase — exactly
    //    the phase type `red: absent` was added for.
    const unmatched = p.fields.touches.filter(g => globMatches(g).length === 0);
    if (p.fields.red === 'absent') {
      const badParent = unmatched.filter(g => {
        const dir = path.dirname(g.replace(/\*.*$/, 'x'));
        return dir !== '.' && !fs.existsSync(path.join(ROOT, dir));
      });
      rec.checks['touches:globs'] = badParent.length ? 'NO PARENT DIR — ' + badParent.join(', ')
        : 'ok (red: absent — ' + unmatched.length + ' of ' + p.fields.touches.length + ' not yet on disk, as declared)';
      if (badParent.length) {
        rec.state = 'HALT';
        rec.reason = 'touches glob(s) name a directory that does not exist: ' + badParent.join(', ') + ' — a new file is expected under red: absent, a new tree is a typo';
        report.phases.push(rec); continue;
      }
    } else {
      rec.checks['touches:globs'] = unmatched.length ? 'NO MATCH — ' + unmatched.join(', ')
        : 'ok (' + p.fields.touches.map(g => g + ' → ' + globMatches(g).length).join(', ') + ')';
      if (unmatched.length) {
        rec.state = 'HALT';
        rec.reason = 'touches glob(s) match no file: ' + unmatched.join(', ') + ' — red: ' + p.fields.red + ' requires the subject to already exist';
        report.phases.push(rec); continue;
      }
    }

    // 3. enter — BEFORE verify. A false enter must halt before anything runs (SPEC §6.1).
    if (p.fields.enter !== NOT_DECLARED) {
      const er = runCheck(p.fields.enter, base('enter'));
      rec.checks['enter'] = 'exit ' + er.code + (er.note ? ' (' + er.note + ')' : '');
      if (er.code !== 0) {
        rec.state = 'HALT';
        rec.reason = 'enter predicate is false (exit ' + er.code + ') — halted before verify was run or any work attempted';
        rec.checks['verify'] = '<not run — enter was false>';
        report.phases.push(rec); continue;
      }
    } else {
      rec.checks['enter'] = '<not declared> — always enterable';
    }

    // 4. verify AT HEAD — the classification that makes the plan report worth reading.
    const vr = runCheck(p.fields.verify, base('verify-at-head'));
    rec.checks['verify'] = 'exit ' + vr.code + ' · marker ' + (vr.marker ? 'present' : 'ABSENT') + (vr.note ? ' (' + vr.note + ')' : '');
    const cls = classify(p.fields.red, vr);
    rec.state = cls.state; rec.reason = cls.reason;

    // 5. tripwire at HEAD. Conclusive only for a phase-1 tripwire; later ones may depend
    //    on earlier phases, so a HEAD failure there is deferred, not fatal. SPEC §5.2.
    if (p.fields.tripwire !== NOT_DECLARED) {
      const tr = runCheck(p.fields.tripwire, base('tripwire-at-head'));
      if (tr.code === 0) rec.checks['tripwire'] = 'holds at HEAD';
      else if (p.number === 1) {
        rec.checks['tripwire'] = 'FAILS at HEAD (exit ' + tr.code + ')';
        rec.state = 'HALT';
        rec.reason = 'TRIPWIRE_BORN_RED: the invariant is already violated where it is declared — an invariant that can only fire on its own falsity';
      } else {
        rec.checks['tripwire'] = 'fails at HEAD (exit ' + tr.code + ') — deferred: may depend on an earlier phase';
      }
    }

    report.phases.push(rec);
  }

  const executable = report.phases.filter(p => p.state === 'EXECUTABLE').length;
  const halted     = report.phases.filter(p => p.state === 'HALT').length;
  const resolved   = report.phases.filter(p => p.state === 'RESOLVED_UPSTREAM').length;
  let verdict;
  if (executable === 0 && resolved === 0) verdict = 'NOT RUNNABLE — no phase can execute';
  else if (halted > 0) verdict = 'RUNNABLE IN PART — ' + executable + ' of ' + report.phases.length + ' phases can execute; ' + halted + ' need a human';
  else verdict = 'RUNNABLE — every phase is executable or already resolved';
  report.summary = { executable, halted, resolved, parseErrors: 0, verdict };
  return report;
}

function formatReport(r) {
  const out = [];
  out.push('PLAN PREFLIGHT — ' + r.source);
  out.push('artifacts: ' + path.relative(ROOT, r.runDir) + '/   (every check\'s stdout AND stderr, never /dev/null)');
  out.push('');
  if (!r.parsed.ok) {
    out.push('  THE PLAN DOES NOT PARSE — no phase was run, nothing was executed.');
    out.push('');
    out.push(formatParsed(r.parsed).split('\n').map(l => '  ' + l).join('\n'));
    out.push('');
    out.push('VERDICT: ' + r.summary.verdict);
    return out.join('\n');
  }
  const label = { EXECUTABLE: 'EXECUTABLE', HALT: 'HALT', RESOLVED_UPSTREAM: 'RESOLVED_UPSTREAM' };
  for (const p of r.phases) {
    out.push('  phase ' + String(p.number).padEnd(2) + ' ' + label[p.state].padEnd(18) + ' ' + p.title);
    out.push('           ' + p.reason);
    for (const [k, v] of Object.entries(p.checks)) out.push('           · ' + k.padEnd(16) + ' ' + v);
    out.push('');
  }
  out.push('SUMMARY: ' + r.summary.executable + ' executable · ' + r.summary.halted + ' halted · ' + r.summary.resolved + ' resolved-upstream');
  out.push('VERDICT: ' + r.summary.verdict);
  return out.join('\n');
}

module.exports = { preflight, formatReport, classify, hasMarker, commandExists, globMatches, runCheck, RE_MARKER };

if (require.main === module) {
  const planPath = process.argv[2];
  if (!planPath) { console.error('usage: node planrunner/preflight.js <plan.md>'); process.exit(2); }
  const r = preflight(planPath);
  console.log(formatReport(r));
  // 0 = fully runnable · 1 = runnable in part · 2 = not runnable / does not parse
  if (!r.parsed.ok || r.summary.verdict.startsWith('NOT RUNNABLE')) process.exit(2);
  process.exit(r.summary.halted > 0 ? 1 : 0);
}
