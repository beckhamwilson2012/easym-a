#!/usr/bin/env node
// tools/snapshot-diff.js — the harness's SECOND, independent grader.
//
// Compares two capture snapshots and emits JSON. It is deliberately independent of the fuzz analyzer
// (tools/sweep-analyzer/analyze.js): it imports NOTHING from there and carries NO deck field semantics,
// so a tokenization bug here cannot blind the analyzer too. Two graders, two failure modes.
//
//   Layer 1 (RENDERED) — positional cell tokenizer over each section's innerText, with row-shift-safe
//                        anchored alignment (LCS on the row label) when line counts diverge.
//   Layer 2 (ORACLE)   — structured field compare; distinguishes null / 0 / undefined explicitly.
//
// Nondeterminism: `ts` is excluded outright. Live prices / as-of dates are masked ONLY by explicit
// section+line COORDINATE (never a $-token sweep — that would blind us to real computed-figure changes).
// Every mask is reported in output.masked. An unmaskable live value is left in as honest noise.
//
// Usage: node tools/snapshot-diff.js <before> <after> [--out FILE]
//        <before>/<after> may each be a capture .json file OR a directory of capture .json files.

const fs = require('fs');
const path = require('path');

// ── Masking allowlist — SECTION + LINE coordinate, never a token pattern ─────────────────────────────
// A line is masked only if its section matches AND (its label (cell 0) matches `label`, OR the whole
// line matches `lineText`). Extend deliberately; everything masked is echoed into output.masked.
//
// DELIBERATELY NARROW — only two unambiguous live-market date phrases. Everything else is left UNMASKED
// as honest, auditable signal, for two separate reasons:
//   - Fiscal "As of <date>" period lines (§plAcquirer/§plTarget "As of 2026-03-31 ($M)") are REPORTED
//     balance-sheet dates; a change there is a real period-match regression, not drift. A generic
//     "as of <year>" matcher would have wrongly caught them, so it was removed.
//   - The three §verification live-price rows (Current Price / 52-Week High / 52-Week Low) were also
//     UNMASKED: masking the whole row suppressed its ✓/★ source-of-truth markers, and a silently
//     flipped verification marker is the deck-costing failure. Same-window recapture is the primary
//     nondeterminism control, so price drift should not occur in practice; if it does, a noisy price
//     diff costs five minutes. We accept possible price noise rather than ever hide a flipped ✓/★.
const MASK_COORDS = [
  { section: /./, lineText: /(reconciliation|market data) as of/i, reason: 'live market-data as-of date line' },
];
const EXCLUDE_TOPLEVEL = new Set(['ts']); // capture timestamp — excluded outright, always

// ── Four-state cell classifier — blank "" / "—" / "$0"(zero) / value. Never collapsed. ───────────────
const S = { BLANK: 'BLANK', DASH: 'DASH', ZERO: 'ZERO', VALUE: 'VALUE' };
function stateOf(cell) {
  const t = String(cell == null ? '' : cell).trim();
  if (t === '') return S.BLANK;
  if (/^(—|–|‑|-|N\/?A|n\/?m|n\.m\.?)$/i.test(t)) return S.DASH;
  const num = parseFloat(t.replace(/[$,%()x]/gi, '').replace(/\s*[MB]\b/i, '').trim());
  if (Number.isFinite(num)) return num === 0 ? S.ZERO : S.VALUE;
  return S.VALUE; // non-numeric text (labels / prose) is a "value" for change-detection purposes
}

// Classify a cell transition. Returns null when unchanged; otherwise {type, flag, oldState, newState}.
function classifyCell(oldCell, newCell) {
  const o = String(oldCell == null ? '' : oldCell).trim();
  const n = String(newCell == null ? '' : newCell).trim();
  if (o === n) return null;                       // byte-identical → no change
  const os = stateOf(o), ns = stateOf(n);
  let type = 'CHANGED', flag = false;
  if ((os === S.VALUE || os === S.ZERO) && (ns === S.BLANK || ns === S.DASH)) { type = 'POPULATED_TO_BLANK'; flag = true; }
  else if ((os === S.BLANK || os === S.DASH) && (ns === S.VALUE || ns === S.ZERO)) { type = 'BLANK_TO_POPULATED'; }
  if (os === S.DASH && ns === S.ZERO) { type = 'DASH_TO_ZERO'; flag = true; } // null-coerced-to-zero signature
  if (os === S.ZERO && ns === S.DASH) { type = 'ZERO_TO_DASH'; }
  return { type, flag, oldState: os, newState: ns };
}

// ── Layer 1 tokenizer ────────────────────────────────────────────────────────────────────────────────
function tokenize(text) {
  return String(text || '').split('\n').map(line => (line.includes('\t') ? line.split('\t') : [line]));
}
function label(row) { return (row && row[0] != null ? String(row[0]) : '').trim(); }
// Alignment key: anchor on the label (stable across value changes) when it exists; otherwise fall back
// to the full row text so identical unlabeled spacer rows still anchor instead of becoming add/del noise.
function keyOf(row) { const l = label(row); return l !== '' ? 'L:' + l : 'R:' + (row || []).join('\t'); }

function maskHit(sectionId, row) {
  const line = (row || []).join(' ');
  for (const m of MASK_COORDS) {
    if (!m.section.test(sectionId)) continue;
    if (m.label && m.label.test(label(row))) return m.reason;
    if (m.lineText && m.lineText.test(line)) return m.reason;
  }
  return null;
}

// LCS over two alignment-key arrays → ops: {op:'match',bi,ai} | {op:'del',bi} | {op:'add',ai}
function lcsAlign(bKeys, aKeys) {
  const B = bKeys.length, A = aKeys.length;
  const dp = Array.from({ length: B + 1 }, () => new Array(A + 1).fill(0));
  for (let i = B - 1; i >= 0; i--) for (let j = A - 1; j >= 0; j--)
    dp[i][j] = (bKeys[i] === aKeys[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0, j = 0, matched = 0;
  while (i < B && j < A) {
    if (bKeys[i] === aKeys[j]) { ops.push({ op: 'match', bi: i, ai: j }); i++; j++; matched++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: 'del', bi: i }); i++; }
    else { ops.push({ op: 'add', ai: j }); j++; }
  }
  while (i < B) ops.push({ op: 'del', bi: i++ });
  while (j < A) ops.push({ op: 'add', ai: j++ });
  return { ops, matched };
}

function diffSection(id, bText, aText, maskedOut) {
  const B = tokenize(bText), A = tokenize(aText);
  const cellChanges = [], rowChanges = [];
  const emitRowDiff = (bRow, aRow, rowRef) => {
    if (maskHit(id, bRow) || maskHit(id, aRow)) {
      const reason = maskHit(id, bRow) || maskHit(id, aRow);
      maskedOut.push({ section: id, row: rowRef, label: label(bRow) || label(aRow), reason });
      return;
    }
    const w = Math.max(bRow.length, aRow.length);
    for (let c = 0; c < w; c++) {
      const ch = classifyCell(bRow[c], aRow[c]);
      if (ch) cellChanges.push({ section: id, row: rowRef, cell: c, old: (bRow[c] ?? '').toString().trim(), new: (aRow[c] ?? '').toString().trim(), ...ch });
    }
  };

  if (B.length === A.length) {
    for (let r = 0; r < B.length; r++) emitRowDiff(B[r], A[r], r);
    return { cellChanges, rowChanges, structureChanged: null };
  }

  // line-count mismatch → anchored alignment on the row key (label, or full row for spacers)
  const { ops, matched } = lcsAlign(B.map(keyOf), A.map(keyOf));
  if (matched < Math.max(1, Math.floor(Math.min(B.length, A.length) * 0.5))) {
    return { cellChanges: [], rowChanges: [], structureChanged: { section: id, beforeLines: B.length, afterLines: A.length } };
  }
  for (const op of ops) {
    if (op.op === 'match') emitRowDiff(B[op.bi], A[op.ai], `~${op.ai}`);
    else if (op.op === 'del') rowChanges.push({ section: id, type: 'ROW_REMOVED', label: label(B[op.bi]), cells: B[op.bi] });
    else rowChanges.push({ section: id, type: 'ROW_ADDED', label: label(A[op.ai]), cells: A[op.ai] });
  }
  return { cellChanges, rowChanges, structureChanged: null };
}

// ── Layer 2 — oracle field compare (distinguishes null / 0 / undefined) ────────────────────────────────
function oracleState(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'number' && v === 0) return 'zero';
  if (v === '') return 'blank';
  return 'value';
}
function diffOracle(before, after) {
  const b = before || {}, a = after || {};
  const changes = [];
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    const bs = oracleState(b[k]), as = oracleState(a[k]);
    const same = bs === as && JSON.stringify(b[k]) === JSON.stringify(a[k]);
    if (!same) {
      const flag = (bs === 'null' && as === 'zero') || (bs === 'value' && (as === 'null' || as === 'undefined' || as === 'zero'));
      changes.push({ field: k, old: b[k] ?? null, new: a[k] ?? null, oldState: bs, newState: as, flag });
    }
  }
  return changes;
}

// ── Build status per GATE_SPEC (b) — read ok/stage/sections-count from the capture ────────────────────
function analyzable(cap) {
  return cap && cap.ok === true && cap.stage === 'done' && Object.keys(cap.sections || {}).length > 1;
}
function buildTransition(before, after) {
  const ba = analyzable(before), aa = analyzable(after);
  if (ba && aa) return { before: 'analyzable', after: 'analyzable', transition: 'normal' };
  if (!ba && !aa) return { before: 'not-analyzable', after: 'not-analyzable', transition: 'tolerate' };
  if (ba && !aa) return { before: 'analyzable', after: 'not-analyzable', transition: 'BECAME_NOT_ANALYZABLE', revert: true };
  return { before: 'not-analyzable', after: 'analyzable', transition: 'improved' };
}

// ── Snapshot loading (file or directory) ───────────────────────────────────────────────────────────────
function loadSnapshot(p) {
  const st = fs.statSync(p);
  const files = st.isDirectory() ? fs.readdirSync(p).filter(f => f.endsWith('.json')).map(f => path.join(p, f)) : [p];
  const byPair = {};
  for (const fp of files) {
    let c; try { c = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { continue; }
    if (c && c.pair) byPair[c.pair] = { cap: c, file: fp };
  }
  return byPair;
}

function diffPair(bCap, aCap) {
  const masked = [];
  const build = buildTransition(bCap, aCap);
  // Only diff rendered sections when both sides are analyzable — otherwise section content is absent/partial
  let cellChanges = [], rowChanges = [], structureChanged = [];
  if (analyzable(bCap) && analyzable(aCap)) {
    const ids = new Set([...Object.keys(bCap.sections || {}), ...Object.keys(aCap.sections || {})]);
    for (const id of ids) {
      const r = diffSection(id, (bCap.sections || {})[id], (aCap.sections || {})[id], masked);
      cellChanges.push(...r.cellChanges); rowChanges.push(...r.rowChanges);
      if (r.structureChanged) structureChanged.push(r.structureChanged);
    }
  }
  const oracleChanges = { A: diffOracle(bCap.oracleA, aCap.oracleA), B: diffOracle(bCap.oracleB, aCap.oracleB) };
  return { buildStatus: build, cellChanges, rowChanges, structureChanged, oracleChanges, masked };
}

function main() {
  const args = process.argv.slice(2).filter(a => a !== '--out');
  const outIdx = process.argv.indexOf('--out');
  const outFile = outIdx >= 0 ? process.argv[outIdx + 1] : null;
  const [beforePath, afterPath] = args;
  if (!beforePath || !afterPath) { console.error('usage: node tools/snapshot-diff.js <before> <after> [--out FILE]'); process.exit(2); }

  const before = loadSnapshot(beforePath), after = loadSnapshot(afterPath);
  const pairs = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const out = { excluded_toplevel: [...EXCLUDE_TOPLEVEL], masked: [], pairs: {}, revert_signal: false };

  for (const pair of pairs) {
    const b = before[pair]?.cap, a = after[pair]?.cap;
    if (!b || !a) { out.pairs[pair] = { note: !b ? 'absent in BEFORE' : 'absent in AFTER' }; continue; }
    const d = diffPair(b, a);
    out.masked.push(...d.masked);
    if (d.buildStatus.revert) out.revert_signal = true;
    delete d.masked;
    out.pairs[pair] = d;
  }
  // dedupe masked coordinates
  const seen = new Set();
  out.masked = out.masked.filter(m => { const k = `${m.section}|${m.label}|${m.reason}`; if (seen.has(k)) return false; seen.add(k); return true; });

  const json = JSON.stringify(out, null, 1);
  if (outFile) fs.writeFileSync(outFile, json);
  else console.log(json);
}

if (require.main === module) main();
module.exports = { stateOf, classifyCell, tokenize, lcsAlign, diffSection, diffOracle, analyzable, buildTransition };
