'use strict';
// planrunner/selftest.js — every gate, demonstrated to FAIL on a case where it should.
//
// THE DISCIPLINE THIS FILE ENFORCES: "a check that passes without work happening" is
// this project's named failure mode, and it has occurred four times. A gate exercised
// only on input it should accept proves nothing — an unconditional `return true` passes
// that test. So every gate below is run as a PAIR: one input it must REJECT, and one
// it must ACCEPT, differing in as little as possible.
//
// The marker rule (SPEC §2b) is the sharpest case: both halves run the SAME script with
// the SAME exit code, and the only difference between accepted and rejected is whether
// the VERIFY:ASSERTED line was printed. Nothing else can account for the verdict.

const fs = require('fs');
const path = require('path');
const { parsePlan } = require('./parse');
const { preflight } = require('./preflight');

const ROOT = path.resolve(__dirname, '..');
const WORK = path.join(__dirname, 'runs', 'selftest');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

const SANDBOX = 'planrunner/examples/sandbox';
const CHECKS = 'planrunner/examples/checks';

// A syntactically complete phase. Cases override exactly one thing.
function phase(over) {
  const f = Object.assign({
    n: 1, title: 'a phase',
    done: 'something observable changes',
    verify: 'node ' + CHECKS + '/null-not-zero.js',
    red: 'fails',
    touches: SANDBOX + '/coerce.js',
    turns: '10',
  }, over || {});
  const lines = ['## phase ' + f.n + ': ' + f.title];
  if (f.enter !== undefined) lines.push('  enter:     ' + f.enter);
  lines.push('  done:      ' + f.done);
  lines.push('  verify:    ' + f.verify);
  lines.push('  red:       ' + f.red);
  lines.push('  touches:   ' + f.touches);
  lines.push('  turns:     ' + f.turns);
  if (f.tripwire !== undefined) lines.push('  tripwire:  ' + f.tripwire);
  if (f.extra) lines.push(...f.extra);
  return lines.join('\n') + '\n';
}

let idx = 0;
function preflightOf(planText) {
  const p = path.join(WORK, 'case' + (++idx) + '.plan.md');
  fs.writeFileSync(p, planText);
  return preflight(p, { runId: 'selftest', runDir: path.join(WORK, 'artifacts', 'case' + idx) });
}
const parseOk = t => parsePlan(t, '<case>').ok;
const stateOf = t => { const r = preflightOf(t); return r.parsed.ok ? r.phases[0].state : 'PARSE_ERROR'; };

// ── the gate table ──────────────────────────────────────────────────────────────────
// Each entry: a gate, an input it must REJECT, and an input it must ACCEPT.
const GATES = [
  { gate: 'MARKER RULE — verify exits 0 while asserting nothing (SPEC §2b)',
    note: 'same script, same exit code 0; ONLY the marker line differs',
    reject: { what: 'exit 0, no VERIFY:ASSERTED', want: 'HALT',
      run: () => stateOf(phase({ red: 'none', verify: 'MARKER=0 node ' + CHECKS + '/toggle-pass.js' })) },
    accept: { what: 'exit 0, VERIFY:ASSERTED printed', want: 'EXECUTABLE',
      run: () => stateOf(phase({ red: 'none', verify: 'MARKER=1 node ' + CHECKS + '/toggle-pass.js' })) } },

  { gate: 'VACUOUS RED — exit 1 that is a load failure, not an assertion failure',
    note: 'the MODULE_NOT_FOUND case: node exits 1 without ever asserting',
    reject: { what: 'red: fails, verify exits 1 with no marker', want: 'HALT',
      run: () => stateOf(phase({ red: 'fails', verify: 'node ' + CHECKS + '/health-endpoint.js', touches: SANDBOX + '/coerce.js' })) },
    accept: { what: 'red: fails, verify exits 1 with marker', want: 'EXECUTABLE',
      run: () => stateOf(phase({ red: 'fails' })) } },

  { gate: 'RED: ABSENT mis-declared — the subject exists and really failed',
    reject: { what: 'red: absent, but the check ran and failed', want: 'HALT',
      run: () => stateOf(phase({ red: 'absent', verify: 'node ' + CHECKS + '/null-not-zero.js' })) },
    accept: { what: 'red: absent, check could not run (no marker)', want: 'EXECUTABLE',
      run: () => stateOf(phase({ red: 'absent', verify: 'node ' + CHECKS + '/health-endpoint.js', touches: SANDBOX + '/health.js' })) } },

  { gate: 'RED: NONE — the invariant must already hold at HEAD',
    reject: { what: 'red: none, verify fails at HEAD', want: 'HALT',
      run: () => stateOf(phase({ red: 'none', verify: 'node ' + CHECKS + '/null-not-zero.js' })) },
    accept: { what: 'red: none, verify passes at HEAD with marker', want: 'EXECUTABLE',
      run: () => stateOf(phase({ red: 'none', verify: 'node ' + CHECKS + '/already-null-safe.js', touches: SANDBOX + '/safe.js' })) } },

  { gate: 'ALREADY RESOLVED — a skip, not a halt (ITERATION_PROMPT.md:124-127)',
    reject: { what: 'red: fails, verify already passes at HEAD', want: 'RESOLVED_UPSTREAM',
      run: () => stateOf(phase({ verify: 'node ' + CHECKS + '/already-null-safe.js', touches: SANDBOX + '/safe.js' })) },
    accept: { what: 'red: fails, verify still fails at HEAD', want: 'EXECUTABLE',
      run: () => stateOf(phase({})) } },

  { gate: 'COMMAND EXISTENCE — verify names a script not on disk',
    reject: { what: 'verify runs a script that does not exist', want: 'HALT',
      run: () => stateOf(phase({ verify: 'node ' + CHECKS + '/nope-not-here.js' })) },
    accept: { what: 'verify runs a script that exists', want: 'EXECUTABLE',
      run: () => stateOf(phase({})) } },

  { gate: 'ENTER — a false predicate halts before verify is ever run',
    reject: { what: 'enter is false', want: 'HALT',
      run: () => stateOf(phase({ enter: 'test -f ' + SANDBOX + '/not-there.js' })) },
    accept: { what: 'enter is true', want: 'EXECUTABLE',
      run: () => stateOf(phase({ enter: 'test -f ' + SANDBOX + '/coerce.js' })) } },

  { gate: 'TOUCHES — red: fails requires the subject to already exist',
    reject: { what: 'red: fails, touches matches no file', want: 'HALT',
      run: () => stateOf(phase({ touches: SANDBOX + '/never-existed.js' })) },
    accept: { what: 'red: absent, touches matches no file (as declared)', want: 'EXECUTABLE',
      run: () => stateOf(phase({ red: 'absent', verify: 'node ' + CHECKS + '/health-endpoint.js', touches: SANDBOX + '/health.js' })) } },

  { gate: 'TOUCHES — a plan may not scope itself to the runner\'s own code',
    reject: { what: 'touches planrunner/preflight.js', want: 'PARSE_ERROR',
      run: () => stateOf(phase({ touches: 'planrunner/preflight.js' })) },
    accept: { what: 'touches the examples sandbox', want: 'EXECUTABLE',
      run: () => stateOf(phase({})) } },

  // ── parser gates ──────────────────────────────────────────────────────────────────
  { gate: 'PARSER — verify is required',
    reject: { what: 'no verify field', want: false, run: () => parseOk('## phase 1: x\n  done: d\n  red: fails\n  touches: ' + SANDBOX + '/coerce.js\n  turns: 5\n') },
    accept: { what: 'verify present',   want: true,  run: () => parseOk(phase({})) } },

  { gate: 'PARSER — verify must be a valid shell command',
    reject: { what: 'trailing && (syntax error)', want: false, run: () => parseOk(phase({ verify: 'node x.js &&' })) },
    accept: { what: 'well-formed command',        want: true,  run: () => parseOk(phase({})) } },

  { gate: 'PARSER — red must be one of the three states',
    reject: { what: 'red: maybe', want: false, run: () => parseOk(phase({ red: 'maybe' })) },
    accept: { what: 'red: fails', want: true,  run: () => parseOk(phase({})) } },

  { gate: 'PARSER — turns must be a positive integer in range',
    reject: { what: 'turns: as many as it takes', want: false, run: () => parseOk(phase({ turns: 'as many as it takes' })) },
    accept: { what: 'turns: 10',                  want: true,  run: () => parseOk(phase({})) } },

  { gate: 'PARSER — turns out of range',
    reject: { what: 'turns: 9999', want: false, run: () => parseOk(phase({ turns: '9999' })) },
    accept: { what: 'turns: 500',  want: true,  run: () => parseOk(phase({ turns: '500' })) } },

  { gate: 'PARSER — an empty value is a mistake, never a default',
    reject: { what: 'done: <empty>', want: false, run: () => parseOk(phase({ done: '' })) },
    accept: { what: 'done: prose',   want: true,  run: () => parseOk(phase({})) } },

  { gate: 'PARSER — a duplicated key would let the second value silently win',
    reject: { what: 'red declared twice', want: false, run: () => parseOk(phase({ extra: ['  red:       none'] })) },
    accept: { what: 'red declared once',  want: true,  run: () => parseOk(phase({})) } },

  { gate: 'PARSER — an unknown key is not silently ignored',
    reject: { what: 'budget: 50',  want: false, run: () => parseOk(phase({ extra: ['  budget:    50'] })) },
    accept: { what: 'known keys only', want: true, run: () => parseOk(phase({})) } },

  { gate: 'PARSER — a stray line inside a phase is not skipped',
    reject: { what: 'free prose inside a phase', want: false, run: () => parseOk(phase({ extra: ['  this is not a field'] })) },
    accept: { what: 'no stray lines',            want: true,  run: () => parseOk(phase({})) } },

  { gate: 'PARSER — a typo\'d phase header is not read as prose',
    reject: { what: '"## phase one: x"', want: false, run: () => parseOk('## phase one: x\n' + phase({}).split('\n').slice(1).join('\n')) },
    accept: { what: '"## phase 1: x"',   want: true,  run: () => parseOk(phase({})) } },

  { gate: 'PARSER — touches globs must be repo-relative',
    reject: { what: 'absolute path',  want: false, run: () => parseOk(phase({ touches: '/etc/passwd' })) },
    accept: { what: 'relative path',  want: true,  run: () => parseOk(phase({})) } },

  { gate: 'PARSER — touches globs may not escape the repo',
    reject: { what: '../../etc/passwd', want: false, run: () => parseOk(phase({ touches: '../../etc/passwd' })) },
    accept: { what: 'inside the repo',  want: true,  run: () => parseOk(phase({})) } },

  { gate: 'PARSER — a file with no phase header is not a plan',
    reject: { what: 'prose only', want: false, run: () => parseOk('# just a document\n\nsome prose.\n') },
    accept: { what: 'one phase',  want: true,  run: () => parseOk(phase({})) } },
];

// ── run ─────────────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const show = v => typeof v === 'boolean' ? (v ? 'ACCEPTED' : 'REJECTED') : v;

console.log('planrunner selftest — every gate shown REJECTING and ACCEPTING');
console.log('='.repeat(78));
for (const g of GATES) {
  console.log('');
  console.log('GATE: ' + g.gate);
  if (g.note) console.log('      (' + g.note + ')');
  for (const side of ['reject', 'accept']) {
    const c = g[side];
    let got, err = null;
    try { got = c.run(); } catch (e) { err = e; got = 'THREW: ' + e.message; }
    const ok = !err && got === c.want;
    if (ok) pass++; else fail++;
    console.log('   must ' + side.toUpperCase().padEnd(6) + ' ' + c.what.padEnd(46) +
                ' → ' + String(show(got)).padEnd(18) + (ok ? '✓' : '✗ EXPECTED ' + show(c.want)));
  }
}
console.log('');
console.log('='.repeat(78));
console.log(pass + ' passed · ' + fail + ' failed · ' + GATES.length + ' gates, each shown failing and passing');
process.exit(fail ? 1 : 0);
