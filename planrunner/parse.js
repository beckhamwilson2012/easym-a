'use strict';
// planrunner/parse.js — the plan parser. SPEC.md §1-§5.
//
// THE ONE RULE: a phase this parser accepts must be gradeable. A phase whose `verify`
// is missing, empty, or not a syntactically valid command is REJECTED here — never
// accepted and then graded on nothing. That is the whole reason this file exists
// rather than a regex at the top of the runner.
//
// NEVER A SILENT DEFAULT. Every rejection carries a phase number, a field, and a
// reason. An optional field that is absent is recorded as the explicit sentinel
// NOT_DECLARED, so no reader can confuse "absent" with "defaulted to something".
// An unknown key, a duplicate key, or a line that is neither blank, comment, nor
// `key: value` is an ERROR — not something quietly skipped.
//
// Extraction is LITERAL and TO END OF LINE, the way repro_pair (agent/run-sweep.sh:211)
// and item_test (:245) already work in the sweep harness. A value may contain colons,
// commas, slashes and parentheses; only the FIRST colon after a known key delimits.
// CLAUDE.md:95 — a mid-line separator as delimiter bit this project once.

const fs = require('fs');
const { spawnSync } = require('child_process');

const NOT_DECLARED = '<not declared>';

// Field table. `kind` selects the validator below; nothing is validated by convention.
const FIELDS = {
  enter:    { required: false, kind: 'command' },
  done:     { required: true,  kind: 'prose'   },
  verify:   { required: true,  kind: 'command' },
  red:      { required: true,  kind: 'enum', values: ['fails', 'absent', 'none'] },
  touches:  { required: true,  kind: 'globs'   },
  turns:    { required: true,  kind: 'int', min: 1, max: 500 },
  tripwire: { required: false, kind: 'command' },
};
const FIELD_NAMES = Object.keys(FIELDS);

const RE_HEADER = /^##\s+phase\s+(\d+)\s*:\s*(.+?)\s*$/i;
// The key must be a bare word at the start of an indented line. Capture the value to
// END OF LINE — no trailing-comment stripping, because a `#` is legal inside a command.
const RE_FIELD = /^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/;
const RE_COMMENT = /^\s*#/;
// A line that opens like a phase header, so a typo'd one can be rejected rather than
// silently read as markdown prose.
const RE_HEADER_LOOSE = /^##\s*phase\b/i;

// The runner's own code. A phase may not declare it in `touches` — a plan that can edit
// the runner can edit its own grader. SPEC.md §6.1. The examples/ sandbox is NOT
// protected: it exists to be modified by example plans.
const RUNNER_PROTECTED = [
  /^planrunner\/[^/]+\.js$/,
  /^planrunner\/SPEC\.md$/,
  /^planrunner\/\.gitignore$/,
];

function shellSyntaxOk(cmd) {
  // `bash -n -c` reads the command without executing it: rc 0 = parses, 2 = syntax error.
  const r = spawnSync('bash', ['-n', '-c', cmd], { encoding: 'utf8', timeout: 5000 });
  if (r.error || r.status === null) return { ok: false, why: 'could not syntax-check (' + (r.error ? r.error.message : 'timeout') + ')' };
  if (r.status !== 0) return { ok: false, why: (r.stderr || '').trim().split('\n')[0] || 'bash reported a syntax error' };
  return { ok: true };
}

function validate(phaseNo, field, raw, errors) {
  const spec = FIELDS[field];
  const value = raw.trim();

  if (value === '') {
    errors.push({ phase: phaseNo, field, reason: 'declared but empty — an empty value is not a default, it is a mistake' });
    return null;
  }

  switch (spec.kind) {
    case 'prose':
      return value;

    case 'command': {
      const syn = shellSyntaxOk(value);
      if (!syn.ok) {
        errors.push({ phase: phaseNo, field, reason: 'not a syntactically valid shell command: ' + syn.why });
        return null;
      }
      return value;
    }

    case 'enum':
      if (!spec.values.includes(value)) {
        errors.push({ phase: phaseNo, field, reason: 'must be one of ' + spec.values.join(' | ') + ' — got ' + JSON.stringify(value) });
        return null;
      }
      return value;

    case 'int': {
      if (!/^\d+$/.test(value)) {
        errors.push({ phase: phaseNo, field, reason: 'must be a positive integer — got ' + JSON.stringify(value) });
        return null;
      }
      const n = parseInt(value, 10);
      if (n < spec.min || n > spec.max) {
        errors.push({ phase: phaseNo, field, reason: 'must be between ' + spec.min + ' and ' + spec.max + ' — got ' + n });
        return null;
      }
      return n;
    }

    case 'globs': {
      // Comma-separated. Split on commas ONLY here, where the grammar says a list is a
      // list — never as a general-purpose value delimiter.
      const globs = value.split(',').map(g => g.trim()).filter(g => g !== '');
      if (globs.length === 0) {
        errors.push({ phase: phaseNo, field, reason: 'no globs after splitting on commas' });
        return null;
      }
      for (const g of globs) {
        if (g.startsWith('/')) {
          errors.push({ phase: phaseNo, field, reason: 'glob ' + JSON.stringify(g) + ' is absolute — touches globs are repo-relative' });
          return null;
        }
        if (g.split('/').includes('..')) {
          errors.push({ phase: phaseNo, field, reason: 'glob ' + JSON.stringify(g) + ' escapes the repo with ".."' });
          return null;
        }
        if (RUNNER_PROTECTED.some(re => re.test(g))) {
          errors.push({ phase: phaseNo, field, reason: 'glob ' + JSON.stringify(g) + ' names the runner\'s own code — a plan that can edit the runner can edit its own grader' });
          return null;
        }
      }
      return globs;
    }

    default:
      throw new Error('unknown field kind ' + spec.kind);
  }
}

// Returns { ok, plan, errors }. Never throws on a bad PLAN — only on unreadable input.
// A caller that ignores `errors` and reads `plan` gets the phases that parsed; `ok` is
// false whenever anything at all was rejected.
function parsePlan(text, source) {
  const errors = [];
  const phases = [];
  const lines = String(text).split('\n');

  let cur = null;          // phase under construction
  let seenHeader = false;
  const seenNumbers = new Map();

  const finish = () => {
    if (!cur) return;
    for (const f of FIELD_NAMES) {
      if (FIELDS[f].required && !(f in cur.fields)) {
        // Distinguish "never written" from "written and rejected above". Reporting a
        // field the author DID write as "missing" sends them looking for the wrong bug.
        errors.push({ phase: cur.number, field: f, reason: (f in cur.raw)
          ? 'required field was declared but its value was rejected above — the phase is left with no usable ' + f
          : 'required field is missing' });
      }
    }
    phases.push(cur);
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    if (line.trim() === '') continue;

    // ORDER MATTERS: a phase header starts with "##", so it must be matched BEFORE the
    // comment rule — otherwise every header is read as a comment and the plan parses as
    // a preamble with no phases at all.
    const h = line.match(RE_HEADER);
    if (!h && RE_HEADER_LOOSE.test(line)) {
      // Looks like a phase header but is not one. Never skipped as prose: a typo'd
      // header would silently orphan every field beneath it.
      errors.push({ phase: '<header>', field: '<header>', line: lineNo,
        reason: 'looks like a phase header but does not match "## phase <n>: <title>": ' + JSON.stringify(line.trim().slice(0, 60)) });
      continue;
    }
    if (!h && RE_COMMENT.test(line)) continue;   // markdown prose / comment
    if (h) {
      finish();
      seenHeader = true;
      const num = parseInt(h[1], 10);
      if (seenNumbers.has(num)) {
        errors.push({ phase: num, field: '<header>', line: lineNo, reason: 'duplicate phase number — also declared at line ' + seenNumbers.get(num) });
      }
      seenNumbers.set(num, lineNo);
      cur = { number: num, title: h[2], line: lineNo, fields: {}, raw: {} };
      continue;
    }

    const f = line.match(RE_FIELD);
    if (f) {
      const key = f[1].toLowerCase();
      const rawValue = f[2];

      if (!FIELD_NAMES.includes(key)) {
        errors.push({ phase: cur ? cur.number : '<preamble>', field: key, line: lineNo,
          reason: 'unknown field — known fields are ' + FIELD_NAMES.join(', ') });
        continue;
      }
      if (!cur) {
        errors.push({ phase: '<preamble>', field: key, line: lineNo,
          reason: 'phase field appears before any "## phase N:" header' });
        continue;
      }
      if (key in cur.raw) {
        errors.push({ phase: cur.number, field: key, line: lineNo,
          reason: 'declared twice — the second value would silently win' });
        continue;
      }
      cur.raw[key] = rawValue;
      const v = validate(cur.number, key, rawValue, errors);
      if (v !== null) cur.fields[key] = v;
      continue;
    }

    // Inside a phase, anything that is not blank / comment / known field is an error.
    // Before the first header it is plan preamble prose, which is not parsed.
    if (cur) {
      errors.push({ phase: cur.number, field: '<line>', line: lineNo,
        reason: 'not blank, not a comment, and not "key: value" — refusing to skip it silently: ' + JSON.stringify(line.trim().slice(0, 60)) });
    }
  }
  finish();

  if (!seenHeader) errors.push({ phase: '<plan>', field: '<header>', reason: 'no "## phase N: title" header found — this is not a plan' });
  if (seenHeader && phases.length === 0) errors.push({ phase: '<plan>', field: '<phases>', reason: 'no phases parsed' });

  // Normalise: fill optional fields with the explicit sentinel, never a silent default.
  for (const p of phases) {
    for (const f of FIELD_NAMES) {
      if (!(f in p.fields)) p.fields[f] = FIELDS[f].required ? null : NOT_DECLARED;
    }
  }

  return { ok: errors.length === 0, source: source || '<string>', phases, errors };
}

function parseFile(path) {
  return parsePlan(fs.readFileSync(path, 'utf8'), path);
}

function formatParsed(result) {
  const out = [];
  out.push('PLAN: ' + result.source);
  out.push('  parsed ' + result.phases.length + ' phase(s) · ' + result.errors.length + ' error(s) · ' + (result.ok ? 'ACCEPTED' : 'REJECTED'));
  for (const p of result.phases) {
    out.push('');
    out.push('  ## phase ' + p.number + ': ' + p.title + '   (line ' + p.line + ')');
    for (const f of FIELD_NAMES) {
      const v = p.fields[f];
      const shown = v === null ? '<MISSING — required>' : Array.isArray(v) ? v.join(', ') : String(v);
      out.push('      ' + (f + ':').padEnd(10) + ' ' + shown);
    }
  }
  if (result.errors.length) {
    out.push('');
    out.push('  ERRORS (' + result.errors.length + ') — each one rejects, none defaults:');
    for (const e of result.errors) {
      out.push('    phase ' + e.phase + ' · ' + e.field + (e.line ? ' (line ' + e.line + ')' : '') + ': ' + e.reason);
    }
  }
  return out.join('\n');
}

module.exports = { parsePlan, parseFile, formatParsed, FIELDS, FIELD_NAMES, NOT_DECLARED, RUNNER_PROTECTED };

if (require.main === module) {
  const path = process.argv[2];
  if (!path) { console.error('usage: node planrunner/parse.js <plan.md>'); process.exit(2); }
  const r = parseFile(path);
  console.log(formatParsed(r));
  process.exit(r.ok ? 0 : 1);
}
