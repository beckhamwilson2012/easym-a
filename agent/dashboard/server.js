// agent/dashboard/server.js — standalone sweep monitor on :3002.
//
// SEPARATE PROCESS BY DESIGN. server.js (the app, :3001) is the code an agent MODIFIES during a run.
// If this dashboard were a route in that server, an agent change could break it mid-run and blind you
// exactly when you most need visibility. So this process imports NOTHING from the app — only node stdlib
// + express — and reads agent/* straight off disk. It must load and run with the app (:3001) STOPPED.
//
// Phase 1 = read-only monitor + STOP toggle. Plan intake (Phase 2) and launch (Phase 3) come later, gated.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PORT = process.env.DASH_PORT || 3002;
const AGENT_DIR = process.env.AGENT_DASHBOARD_ROOT || path.resolve(__dirname, '..'); // the agent/ directory
const REPO_ROOT = path.resolve(AGENT_DIR, '..');

const ap = (...a) => path.join(AGENT_DIR, ...a);
const readSafe = (fp) => { try { return fs.readFileSync(fp, 'utf8'); } catch { return null; } };
const statSafe = (fp) => { try { return fs.statSync(fp); } catch { return null; } };

// ── parsers (all defensive: a missing/short file yields empty, never a throw) ────────────────────────
function parseCsvLine(l) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { if (c === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } }
  out.push(cur); return out;
}
function parseCalibration() {
  const txt = readSafe(ap('calibration.csv'));
  if (!txt || !txt.trim()) return { header: [], rows: [], costTotal: 0 };
  const lines = txt.trim().split('\n');
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(l => { const c = parseCsvLine(l); const o = {}; header.forEach((h, i) => o[h] = c[i]); return o; });
  const costTotal = rows.reduce((s, r) => s + (parseFloat(r.cost_usd) || 0), 0);
  return { header, rows, costTotal };
}
function latestRun() {
  const runsDir = ap('runs');
  let dirs = [];
  try { dirs = fs.readdirSync(runsDir).filter(d => { const s = statSafe(path.join(runsDir, d)); return s && s.isDirectory(); }); } catch { return null; }
  if (!dirs.length) return null;
  dirs.sort((a, b) => statSafe(path.join(runsDir, b)).mtimeMs - statSafe(path.join(runsDir, a)).mtimeMs);
  return dirs[0];
}
function parseLoopLog(runId, tailLines = 60) {
  const out = { exists: false, tail: [], status: {}, elapsedSec: null };
  if (!runId) return out;
  const runDir = ap('runs', runId);
  const fp = path.join(runDir, 'loop.log');
  const txt = readSafe(fp);
  const st = statSafe(fp); const rst = statSafe(runDir);
  if (txt == null) { out.status.runId = runId; return out; }
  out.exists = true;
  const all = txt.split('\n');
  out.tail = all.slice(-tailLines);
  const grabLast = re => { for (let i = all.length - 1; i >= 0; i--) { const m = all[i].match(re); if (m) return m; } return null; };
  const s = out.status;
  let m;
  if ((m = grabLast(/START (.+?)\s+→\s+PROJECTED END ~(.+?)\s+\(/))) { s.start = m[1]; s.projectedEnd = m[2]; }
  if ((m = grabLast(/RUN (\S+) · branch (\S+) · (\d+) pairs · (\d+) open items · mode (\S+)/))) { s.runId = m[1]; s.branch = m[2]; s.pairs = +m[3]; s.openItems = +m[4]; s.mode = m[5]; }
  if ((m = grabLast(/── iter (\d+) · (.+)$/))) { s.iter = +m[1]; s.currentItem = m[2]; }
  if ((m = grabLast(/switching N\+1 -> 2N from iter (\d+)/))) { s.freezeSwitchedAtIter = +m[1]; s.mode = '2N'; }
  if ((m = grabLast(/baseline: (\d+) defects/))) { s.baselineDefects = +m[1]; }
  s.complete = /RUN \S+ COMPLETE/.test(txt);
  const startMs = (rst && rst.birthtimeMs) || (st && st.birthtimeMs) || null;
  const endMs = s.complete && st ? st.mtimeMs : Date.now();
  if (startMs) out.elapsedSec = Math.max(0, Math.round((endMs - startMs) / 1000));
  // liveness: never infer "running" from the log alone — a killed run would look healthy forever. Check
  // the actual process via run.pid (kill -0). States: COMPLETED | RUNNING | STALE (>30m no write) | DIED.
  s.lastLogLine = [...all].reverse().find(l => l.trim()) || '';
  // activity = most recent of the loop.log write OR a pair capture (/tmp/sweep_v2_raw). A baseline capture
  // is loop.log-silent for 20-40 min but still writes a pair file every ~30s — that is progress, not a hang.
  let activityMs = st ? st.mtimeMs : 0;
  try { const rd = '/tmp/sweep_v2_raw'; for (const f of fs.readdirSync(rd)) { const m = statSafe(path.join(rd, f)); if (m && m.mtimeMs > activityMs) activityMs = m.mtimeMs; } } catch {}
  s.lastWriteAgeSec = activityMs ? Math.round((Date.now() - activityMs) / 1000) : null;
  const pidTxt = readSafe(path.join(runDir, 'run.pid'));
  const pid = pidTxt ? parseInt(pidTxt.trim(), 10) : null;
  let alive = false;
  if (pid) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = e && e.code === 'EPERM'; } } // EPERM = exists but unsignalable
  s.pid = pid; s.pidAlive = alive;
  if (s.complete) s.runState = 'COMPLETED';
  else if (pid != null) s.runState = alive ? (s.lastWriteAgeSec > 1800 ? 'STALE' : 'RUNNING') : 'DIED';
  else s.runState = (s.lastWriteAgeSec != null && s.lastWriteAgeSec > 120) ? 'DIED' : 'RUNNING'; // pre-run.pid runs: infer from log staleness
  // phase (so a 25-min silent capture isn't mistaken for a hang) + time remaining from the projected end
  if (s.complete) s.phase = 'Complete';
  else if (!/baseline:\s*\d+\s*defects/.test(txt)) s.phase = 'Baseline capture';
  else if (s.iter) s.phase = 'Item ' + s.iter;
  else s.phase = 'Working';
  if (s.projectedEnd) { const pe = Date.parse(s.projectedEnd.replace(' ', 'T')); if (!isNaN(pe)) {
    s.minLeft = Math.max(0, Math.round((pe - Date.now()) / 60000));
    const d = new Date(pe); let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
    s.endClock = h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ap;
  } }
  return out;
}
function diagnosisList() {
  const dir = ap('diagnosis');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { return []; }
  return files.map(name => { const txt = readSafe(path.join(dir, name)) || ''; return { name, preview: txt.split('\n').slice(0, 2).join(' ').slice(0, 160) }; });
}
function commitsFor(branch, runId) {
  if (!branch) return [];
  // Prefer just THIS sweep's commits: everything since its restore tag. Fall back to recent history.
  const tag = runId ? `restore/pre-sweep-${runId}` : null;
  if (tag) { try { const o = execFileSync('git', ['-C', REPO_ROOT, 'log', '--oneline', `${tag}..${branch}`], { encoding: 'utf8' }).trim(); if (o) return o.split('\n'); } catch {} }
  try { return execFileSync('git', ['-C', REPO_ROOT, 'log', '--oneline', '-20', branch], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); }
  catch { return []; }
}
function queueOpen() {
  const txt = readSafe(ap('QUEUE.md'));
  if (!txt) return { open: 0, done: 0, parked: 0 };
  const open = (txt.split(/^## Open/m)[1] || '').split(/^## /m)[0];
  return { open: (open.match(/^- \[ \] /mg) || []).length, done: (open.match(/^- \[x\] /mg) || []).length, parked: (open.match(/^- \[~\] /mg) || []).length };
}

// ── Plan parser — DETERMINISTIC, NO LLM ──────────────────────────────────────────────────────────────
// The four FIELDS are load-bearing (pair, observed, expected, source); the SYNTAX is not. This extracts
// from free-form prose OR the structured "PAIR — desc / got: / want: / source:" format. A regex extractor
// structurally CANNOT fabricate, so the EXTRACTION RULE holds: extract only what is present — never infer
// a pair from context, never supply an expected value, never guess a source. Missing any of the four ->
// blocked, and we name exactly which. Loosening the syntax does NOT loosen the field requirement.
const HEADING_STATUS = { 'next up': 'queued', 'blocked on you': 'blocked', parked: 'skipped', done: 'done' };
const PAIR_SLASH = /\b([A-Z][A-Z0-9.]{0,5})\s*\/\s*([A-Z][A-Z0-9.]{0,5})\b/;         // AAPL/VZ, AAPL / VZ
const PAIR_VS = /\b([A-Z][A-Z0-9.]{0,5})\s+vs\.?\s+([A-Z][A-Z0-9.]{0,5})\b/;          // AAPL vs VZ
// The one way to read a pair out of arbitrary text, always NORMALISED to "A/B" so plan pairs and runtime
// pairs (loop.log item titles, calibration item text) compare as equals. planWithRuntime() used to call a
// PAIR_ANY that was never defined, so /api/state threw ReferenceError and the whole dashboard 500'd.
function pairIn(text) {
  const s = String(text || '');
  const m = s.match(PAIR_SLASH) || s.match(PAIR_VS);
  return m ? m[1].toUpperCase() + '/' + m[2].toUpperCase() : null;
}
// A source must be a CONCRETE reference (§, a filing, EDGAR, an exhibit id) — never bare prose like "exhibit".
const SOURCE_REF = /(§\s*\S+|\b(?:10|20|8)-?[KQF]\b|\bEDGAR\b|\bexhibit\s+[A-Z0-9]+\b|\bschedule\s+\S+|\bfootnote\s+\S+)/i;
// Negated contractions, expanded on a WORKING COPY before the markers run. "shouldn't be CNBC" otherwise
// misses the `should\s+` marker entirely and the item blocks for a missing expectation; expanding to
// "should not be CNBC" leaves the negation INSIDE the extracted value ("not be CNBC"), which is the whole
// point — a marker must never swallow the "not" and hand back the opposite of what was written.
const CONTRACTIONS = [
  [/\bshould\s*n['’]?t\b/gi, 'should not'], [/\bmust\s*n['’]?t\b/gi, 'must not'],
  [/\bwo\s*n['’]?t\b/gi, 'will not'],       [/\bca\s*n['’]?t\b/gi, 'can not'],
  [/\bdoes\s*n['’]?t\b/gi, 'does not'],     [/\bdo\s*n['’]?t\b/gi, 'do not'],
  [/\bis\s*n['’]?t\b/gi, 'is not'],         [/\bare\s*n['’]?t\b/gi, 'are not'],
  [/\bshouldnt\b/gi, 'should not'],         [/\bmustnt\b/gi, 'must not'],
];
function extractFields(rawText) {
  const it = { pair: null, observed: null, expected: null, source: null };
  let text = String(rawText || '');
  CONTRACTIONS.forEach(([re, to]) => { text = text.replace(re, to); });
  it.pair = pairIn(text);
  // free-form observed/expected via keyword markers; per/from/etc. are boundaries only (they end a value)
  const marks = [];
  const add = (re, field) => { const r = new RegExp(re, 'gi'); let m; while ((m = r.exec(text))) marks.push({ field, start: m.index, end: m.index + m[0].length }); };
  add('\\b(?:shows?|got|observed|currently|reads?|actual(?:ly)?|is\\s+now)\\b\\s*[:=-]?\\s*', 'observed');
  // An expectation may be BEHAVIORAL ("should not appear", "must not be null") rather than a number. The
  // modal is the marker; the optional verb after it never includes not/never, so a negated expectation
  // keeps its negation in the value. Nothing here requires a digit — "no warning at all" is a valid want.
  add('\\b(?:should|shall|must|ought\\s+to|needs?\\s+to|is\\s+supposed\\s+to|expects?|expected|wants?|wanted|correct(?:ly)?)\\b\\s*(?:be|being|show|shows|read|reads|render|renders|display|displays|appear|appears|says?|contain|contains)?\\b\\s*[:=-]?\\s*', 'expected');
  add('\\b(?:per|from|see|source|because|since|as\\s+of|cited?|citation)\\b', 'boundary');
  marks.sort((a, b) => a.start - b.start);
  // Drop marks that begin INSIDE the text another marker already consumed. "should show 46.6%" matches the
  // expected modal AND the observed `shows?` at the same "show" — without this the expected value is sliced
  // to nothing and the item blocks. Only nested (spurious) marks are removed; real ones never overlap.
  const kept = [];
  for (const m of marks) { if (kept.length && m.start < kept[kept.length - 1].end) continue; kept.push(m); }
  for (let i = 0; i < kept.length; i++) {
    const h = kept[i]; if (h.field === 'boundary') continue;
    const next = i + 1 < kept.length ? kept[i + 1].start : text.length;
    const val = text.slice(h.end, next).replace(/[,;\n].*$/s, '').replace(/[.\s]+$/, '').trim();
    if (val && !it[h.field]) it[h.field] = val;
  }
  const sm = text.match(SOURCE_REF); if (!it.source && sm) it.source = sm[1].replace(/\s+/g, ' ').trim();
  // structured labels override (capture to end of line). Back-compat: why: still maps to source.
  const lab = re => { const m = text.match(re); return m && m[1].trim() ? m[1].trim() : null; };
  const g = lab(/\bgot\s*:\s*([^\n]+)/i) || lab(/\bobserved\s*:\s*([^\n]+)/i); if (g) it.observed = g;
  const w = lab(/\bwant\s*:\s*([^\n]+)/i) || lab(/\bexpected\s*:\s*([^\n]+)/i); if (w) it.expected = w;
  const s = lab(/\b(?:source|why)\s*:\s*([^\n]+)/i); if (s) it.source = s;
  return it;
}
// A BLANK LINE separates items. Inside one block, a bullet only starts a NEW item when it names a ticker
// pair and the block already has one — so a bug written across two bullets
//     - AAPL/VZ combined gross margin shows 36.2%
//     - should be 46.6%, per §16
// is ONE item (it used to split into two, and both halves blocked for missing fields — the most confusing
// thing in the build). The pair test is what keeps the documented QUEUE format safe: two adjacent
// "- [ ] KO/NSRGY …" / "- [ ] AAPL/VZ …" items each name their own pair, so they still split. Merging them
// would silently swallow the second bug, which is worse than the split it fixes.
function splitBlocks(text) {
  const lines = String(text || '').split('\n');
  const starter = /^\s*(-\s*\[[ xX]\]\s+|[-*•]\s+|\d+[.)]\s+)/;   // "- [ ]", "-", "*", "1.", "2)"
  const heading = /^\s*##\s+(.+?)\s*$/;
  const out = []; let cur = null; let headStatus = 'queued';
  const flush = () => { if (cur && cur.lines.join(' ').trim()) out.push(cur); cur = null; };
  const open = (raw) => { cur = { lines: [raw], headStatus, checked: /^\s*-\s*\[[xX]\]/.test(raw), pair: pairIn(raw) }; };
  for (const raw of lines) {
    let hm;
    if ((hm = raw.match(heading)) && !starter.test(raw)) { flush(); const h = hm[1].trim().toLowerCase(); if (HEADING_STATUS[h]) headStatus = HEADING_STATUS[h]; continue; }
    if (/^\s*$/.test(raw)) { flush(); continue; }                 // blank line ends a block
    if (starter.test(raw)) {
      const p = pairIn(raw);
      if (!cur) { open(raw); continue; }
      if (p && cur.pair && p !== cur.pair) { flush(); open(raw); continue; }   // a different bug — split
      cur.lines.push(raw); if (!cur.pair) cur.pair = p;                        // a continuation bullet
      continue;
    }
    if (!cur) open(raw);
    else { cur.lines.push(raw); if (!cur.pair) cur.pair = pairIn(raw); }
  }
  flush();
  return out.map(b => ({ text: b.lines.join('\n').trim(), headStatus: b.headStatus, checked: b.checked }));
}
function parsePlan(text) {
  return splitBlocks(text).map(b => {
    const body = b.text.replace(/^\s*(-\s*\[[ xX]\]\s+|[-*•]\s+|\d+[.)]\s+)/, '');
    const it = extractFields(body);
    it.desc = (body.split('\n')[0] || '').trim().slice(0, 90) || it.pair || 'untitled';
    it.raw = b.text;
    it.missing = ['pair', 'observed', 'expected', 'source'].filter(k => !it[k]);
    it.status = b.checked ? 'done' : (it.missing.length ? 'blocked' : b.headStatus);
    return it;
  });
}
function countStatuses(items) { const c = { done: 0, running: 0, queued: 0, blocked: 0, skipped: 0 }; items.forEach(i => c[i.status] = (c[i.status] || 0) + 1); return c; }
function planPreview(items) {
  const counts = countStatuses(items);
  const summary = [`${counts.queued} queued · ${counts.blocked} blocked · ${counts.skipped} skipped · ${counts.done} done`];
  items.filter(i => i.status === 'blocked' && i.missing && i.missing.length).forEach(i => {
    const pairAlone = i.pair && i.missing.length === 3 && !i.missing.includes('pair');
    summary.push(`blocked: ${i.pair || i.desc} — missing ${i.missing.join(', ')}${pairAlone ? '  (a pair alone is not a repro)' : ''}`);
  });
  return { items, counts, summary };
}

// working queue = dashboard state (plan.json). Pasting REPLACES it, preserving items already `done`.
const PLAN_FILE = path.join(__dirname, 'plan.json');
function readPlan() { try { return JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8')); } catch { return []; } }
function writePlan(items) { try { fs.writeFileSync(PLAN_FILE, JSON.stringify(items, null, 1)); } catch {} }
function mergePreservingDone(parsed, old) {
  const key = i => (i.pair || '') + '|' + (i.desc || '');
  const parsedKeys = new Set(parsed.map(key));
  parsed.forEach(i => { const o = old.find(x => key(x) === key(i)); if (o && o.status === 'done') i.status = 'done'; });
  return [...parsed, ...old.filter(o => o.status === 'done' && !parsedKeys.has(key(o)))];
}
// runtime overlay: match plan pairs to the live run's current item / calibration DONE rows
function planWithRuntime() {
  const items = readPlan();
  const log = parseLoopLog(latestRun());
  const cal = parseCalibration();
  const curPair = (log.status.currentItem && !log.status.complete) ? pairIn(log.status.currentItem) : null;
  const donePairs = new Set(cal.rows.filter(r => r.status === 'DONE').map(r => pairIn(r.item)).filter(Boolean));
  items.forEach(i => { if (i.status === 'queued') { if (curPair && i.pair === curPair) i.status = 'running'; else if (i.pair && donePairs.has(i.pair)) i.status = 'done'; } });
  return { items, counts: countStatuses(items) };
}

// QUEUE.md append (on launch only) — append-only; got/want/why map to observed/expected/source.
function insertIntoSection(content, section, block) {
  if (!block) return content;
  const lines = content.split('\n');
  const start = lines.findIndex(l => new RegExp('^## ' + section + '\\b').test(l));
  if (start < 0) return content.replace(/\n*$/, '') + `\n\n## ${section}\n\n${block}\n`;
  let end = start + 1; while (end < lines.length && !/^## /.test(lines[end])) end++;
  const before = lines.slice(0, end); const after = lines.slice(end);
  while (before.length && /^\s*$/.test(before[before.length - 1])) before.pop();
  return [...before, '', block, '', ...after].join('\n').replace(/\n{3,}/g, '\n\n');
}
function appendQueuedToQueueMd(items) {
  const queued = items.filter(i => i.status === 'queued');
  if (!queued.length) return { appended: 0 };
  const block = queued.map(i => `- [ ] **${i.pair} — ${i.desc}**\n  - pair: ${i.pair} · observed: ${i.observed} · expected: ${i.expected} · source: ${i.source}`).join('\n');
  let content = readSafe(ap('QUEUE.md')); if (content == null) return { appended: 0, error: 'QUEUE.md not found' };
  fs.writeFileSync(ap('QUEUE.md'), insertIntoSection(content, 'Open', block));
  return { appended: queued.length };
}

// ── preflight (async: git + claude + app :3001 + queued + a quick freeze proxy) ───────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
// probe: `up` = we got ANY HTTP response (a 429 means the app is up-but-throttled, NOT down). `body` is the
// text only on 2xx. Use 127.0.0.1 (some setups 429 the `localhost` host header while 127.0.0.1 answers 200).
async function httpProbe(url) { try { const r = await fetch(url, { signal: AbortSignal.timeout(4000) }); return { up: true, status: r.status, body: r.ok ? await r.text() : null }; } catch { return { up: false, status: 0, body: null }; } }
async function preflight() {
  const checks = [];
  let treeClean = false; try { treeClean = execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain'], { encoding: 'utf8' }).trim() === ''; } catch {}
  checks.push({ name: 'tree clean', ok: treeClean, detail: treeClean ? 'clean' : 'commit or stash uncommitted changes first' });
  // check with `bash -c` (NOT -lc): this uses the dashboard process's own PATH — exactly what the runner
  // inherits when the dashboard spawns it. If open-dashboard.sh put ~/.local/bin on PATH, both see claude.
  let claudeOk = false; try { execFileSync('bash', ['-c', 'command -v claude'], { stdio: 'ignore' }); claudeOk = true; } catch {}
  checks.push({ name: 'claude on PATH', ok: claudeOk, detail: claudeOk ? 'found' : 'install the CLI / add ~/.local/bin to the launcher PATH' });
  const URL = 'http://127.0.0.1:3001/api/price/AAPL';
  const a = await httpProbe(URL);
  checks.push({ name: 'app :3001 up', ok: a.up, detail: a.up ? `responding (HTTP ${a.status})` : 'no response — start the app on :3001' });
  const queued = queueOpen().open;   // the runner reads QUEUE.md ## Open (plan.json is the paste-staging area)
  checks.push({ name: 'a queued item', ok: queued >= 1, detail: queued >= 1 ? `${queued} unchecked in QUEUE.md ## Open` : 'no unchecked items in QUEUE.md ## Open' });
  // freeze proxy — reuse the up-check quote as read A; one more after a pause. Rate-limit tolerant: only a
  // genuine two-200 MISMATCH blocks. If we can't get two clean reads, defer to the runner's 60s check
  // (the authoritative gate) rather than false-block on the app's own throttling.
  let fok, fdetail;
  if (!a.up) { fok = false; fdetail = 'app down'; }
  else { await sleep(1500); const b = await httpProbe(URL);
    if (a.body && b.body) { fok = a.body === b.body; fdetail = fok ? 'stable (quick proxy; runner does the authoritative 60s check)' : 'MOVING — two reads differ, N+1 unsafe'; }
    else { fok = true; fdetail = 'deferred to runner (app throttled the quick check; runner does the 60s check)'; } }
  checks.push({ name: 'prices frozen', ok: fok, detail: fdetail });
  const budgetUsd = parseFloat(process.env.BUDGET_USD || '25');
  return { checks, allOk: checks.every(c => c.ok), queued, budgetUsd };
}

// ── summary (from calibration.csv + the branch commit log — numbers from data, never an LLM) ──────────
function buildSummary() {
  const cal = parseCalibration();
  const log = parseLoopLog(latestRun());
  const commits = commitsFor(log.status.branch, log.status.runId);
  const decisions = commits.map(c => { const m = c.match(/^(\S+)\s+sweep\([^)]*\) iter \d+: (.+?) \[(\w+)\]/); return m ? { sha: m[1], item: m[2], status: m[3] } : null; }).filter(Boolean);
  // attach defect deltas from calibration by matching item text
  decisions.forEach(d => { const row = cal.rows.find(r => (r.item || '').slice(0, 20) && d.item.includes((r.item || '').slice(0, 12))); if (row) d.defects = `${row.defects_before}→${row.defects_after}`; });
  const committed = cal.rows.filter(r => r.status === 'DONE' || r.status === 'RESOLVED_UPSTREAM').length;
  const reverted = cal.rows.filter(r => ['REGRESSION', 'FAILED', 'TIMEOUT'].includes(r.status)).length;
  const baseline = log.status.baselineDefects != null ? log.status.baselineDefects : null;
  const last = cal.rows[cal.rows.length - 1];
  const defectsAfter = last ? Number(last.defects_after) : baseline;
  return { committed, reverted, defectsBefore: baseline, defectsAfter, spent: cal.costTotal, decisions };
}

// past runs, for the history strip — one line per run_id in calibration.csv, newest first. Read-only
// aggregation of rows that already exist; it decides nothing.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function buildPastRuns() {
  const rows = parseCalibration().rows;
  const by = new Map();
  rows.forEach(r => {
    const id = r.run_id; if (!id) return;
    if (!by.has(id)) by.set(id, { runId: id, tried: 0, kept: 0, cost: 0, before: null, after: null });
    const g = by.get(id);
    g.tried++;
    // "kept" = actually improved (a DONE that lowered the count) or resolved upstream — never a no-op/UNVERIFIED
    if ((r.status === 'DONE' && Number(r.defects_after) < Number(r.defects_before)) || r.status === 'RESOLVED_UPSTREAM') g.kept++;
    g.cost += parseFloat(r.cost_usd) || 0;
    const b = Number(r.defects_before), a = Number(r.defects_after);
    if (g.before == null && Number.isFinite(b)) g.before = b;   // first row's before
    if (Number.isFinite(a)) g.after = a;                        // last row's after
  });
  return [...by.values()].reverse().map(g => {
    const m = String(g.runId).match(/^(\d{4})(\d{2})(\d{2})/);
    const improved = g.kept >= 1;
    return {
      runId: g.runId,
      date: m ? `${MON[+m[2] - 1] || m[2]} ${+m[3]}` : g.runId,
      desc: improved ? `Fixed ${g.kept} of ${g.tried}` : `Nothing kept of ${g.tried}`,
      defects: (g.before != null && g.after != null) ? `${g.before} → ${g.after}` : null,
      cost: g.cost,
      muted: !improved,                                          // improved nothing / stopped early → muted (Part 7)
    };
  });
}

// ── PART 3: one honest status, from the live loop.log + run.pid + calibration ─────────────────────────
// Eight states, plain English, no internal tokens. RUNNING → Sweeping(before)/Fixing/Sweeping(after)/
// Comparing, read off the phase markers the runner now emits. Terminal → Finished / Finished-but-unverified
// / Stopped, from what the run actually produced. A kept change that moved NO number is never 'Finished' —
// it is 'Finished-but-unverified' (the false-DONE that hid on run 150838). Idle when nothing has ever run.
function livePhase(tail) {                        // last phase marker in the tail wins; deck resets per capture
  let phase = 'agent', deck = null, iter = null, item = null, agentMin = null;
  for (const line of tail || []) {
    let m;
    if ((m = line.match(/capture START · (\S+)/)))            { phase = /after/i.test(m[1]) ? 'after' : 'before'; deck = null; }
    else if ((m = line.match(/capture (?:\S+ )?(\d+)\/(\d+)/))) { deck = { i: +m[1], n: +m[2] }; }
    else if (/capture END|baseline:\s*\d+\s*defects/.test(line)) { phase = 'agent'; deck = null; }
    else if ((m = line.match(/── iter (\d+) · (.+)$/)))       { iter = +m[1]; item = m[2]; phase = 'agent'; agentMin = null; }
    else if ((m = line.match(/claude -p working… (\d+)m/)))   { phase = 'agent'; agentMin = +m[1]; }
    else if (/GATE:/.test(line))                              { phase = 'comparing'; }
  }
  return { phase, deck, iter, item, agentMin };
}
function notesExist() { try { return fs.readdirSync(ap('diagnosis')).some(f => /\.(md|json|err)$/.test(f)); } catch { return false; } }
function stoppedState(runId, log, cal, forcedWhy, elapsed, spent) {
  const s = log.status;
  const rows = cal.rows.filter(r => r.run_id === runId);
  const last = rows[rows.length - 1];
  const iterN = last ? last.iter : (s.iter || 1);
  const pair = last ? pairIn(last.item) : (s.currentItem ? pairIn(s.currentItem) : null);
  const itemLabel = `item ${iterN}${pair ? ` (${pair})` : ''}`;
  const status = last ? last.status : null;
  const REASON = {
    NO_VERDICT: `Claude Code ran out of turns on ${itemLabel}`,
    TIMEOUT: `Claude Code hit the time limit on ${itemLabel}`,
    BUILD_BROKEN: `the change stopped the app from starting`,
    REGRESSION: `the change made the deck worse and was thrown away`,
    FAILED: `Claude Code could not fix ${itemLabel}`,
    NO_CHANGE: `Claude Code changed nothing on ${itemLabel}`,
    INDETERMINATE: `the check could not run (rate-limited)`,
  };
  const why = forcedWhy || REASON[status] || `the run stopped on ${itemLabel}`;
  const reverted = !s.complete || ['NO_VERDICT', 'TIMEOUT', 'BUILD_BROKEN', 'REGRESSION', 'NO_CHANGE', 'FAILED', 'INDETERMINATE'].includes(status);
  return {
    key: 'stopped', color: 'red', headline: 'Stopped',
    plain: `Stopped — ${why}.`,
    lines: [
      `Your code: ${reverted ? 'untouched (reverted to where it was)' : 'committed — check the deck'}.`,
      `${itemLabel.charAt(0).toUpperCase() + itemLabel.slice(1)}: still open.`,
      notesExist() ? 'Notes: agent/diagnosis/.' : null,
    ].filter(Boolean),
    elapsedSec: elapsed, spentUsd: spent,
  };
}
function resolveStatus() {
  const runId = latestRun();
  const log = parseLoopLog(runId);
  const s = log.status;
  const cal = parseCalibration();
  const waiting = queueOpen().open;
  const spent = cal.costTotal;
  const elapsed = log.elapsedSec;
  const idle = { key: 'idle', color: 'gray', headline: 'Idle', plain: 'Nothing is running',
    lines: [waiting ? `${waiting} bug${waiting !== 1 ? 's' : ''} waiting.` : 'No bugs queued.'], elapsedSec: null, spentUsd: spent };
  if (!runId) return idle;
  if (s.runState === 'RUNNING' || s.runState === 'STALE') {
    const ph = livePhase(log.tail);
    const deckStr = ph.deck ? `deck ${ph.deck.i} of ${ph.deck.n}` : 'the decks';
    const base = { elapsedSec: elapsed, spentUsd: spent };
    if (ph.phase === 'before') return { ...base, key: 'sweeping', color: 'blue', headline: 'Sweeping', plain: `Checking ${deckStr}`, lines: ['Taking a picture of every deck before anything changes'] };
    if (ph.phase === 'after')  return { ...base, key: 'sweeping', color: 'blue', headline: 'Sweeping', plain: `Re-checking ${deckStr}`, lines: ['Taking the after picture to compare against'] };
    if (ph.phase === 'comparing') return { ...base, key: 'comparing', color: 'purple', headline: 'Comparing', plain: 'Grading before vs after', lines: ['Deciding whether to keep the change or throw it away'] };
    return { ...base, key: 'fixing', color: 'amber', headline: 'Fixing', plain: `Claude Code is on item ${ph.iter || 1}${ph.agentMin ? ` · ${ph.agentMin}m so far` : ''}`, lines: ['Writing code. No progress shown until it finishes.'] };
  }
  if (s.runState === 'DIED' && !s.complete)
    return stoppedState(runId, log, cal, 'the run was killed before it finished', elapsed, spent);
  if (s.complete) {
    const rows = cal.rows.filter(r => r.run_id === runId);
    const fixed = rows.filter(r => r.status === 'DONE' && Number(r.defects_after) < Number(r.defects_before)).length;
    const unverified = rows.filter(r => r.status === 'UNVERIFIED').length;
    const before = s.baselineDefects != null ? s.baselineDefects : null;
    const lastRow = rows[rows.length - 1];
    const after = lastRow ? Number(lastRow.defects_after) : before;
    if (fixed >= 1) return { key: 'finished', color: 'green', headline: 'Finished',
      plain: `Fixed ${fixed} bug${fixed !== 1 ? 's' : ''}, ${waiting} still waiting`,
      lines: (before != null && after != null) ? [`Defects: ${before} → ${after}`] : [],
      warn: 'Check the deck yourself before trusting this.', elapsedSec: elapsed, spentUsd: spent };
    if (unverified >= 1) return { key: 'unverified', color: 'amber', headline: 'Finished — not verified',
      plain: 'A change was kept, but nothing measurably improved',
      lines: ['The item stays open. A kept change that moved no number is not a fix.',
        (before != null && after != null) ? `Defects: ${before} → ${after} (unchanged)` : ''].filter(Boolean),
      warn: 'Check the deck yourself before trusting this.', elapsedSec: elapsed, spentUsd: spent };
    return stoppedState(runId, log, cal, null, elapsed, spent);
  }
  return idle;
}

// ── PART 6: the work queue in plain English — from QUEUE.md (never plan.json); NO internal tokens ──────
const INTERNAL_TOKENS = /\bN\+1\b|\b2N\b|revert_signal|GATE[-\s]?2?[AB]?(?:\.\d+)?|cross-?Surface|null-?in-?Sum|RESOLVED_UPSTREAM|\b[ABD]-[A-Za-z]+\b|GP\/COGS[-\w]*|debt-dropped|ebitdaMsg|BUG\d+|by-root|per-pair/gi;
function stripInternal(s) {
  return String(s || '').replace(/\((?:[^()]*root[^()]*)\)/gi, '').replace(INTERNAL_TOKENS, '')
    .replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/[\s·—-]+$/, '').trim();
}
function plainTitle(rawTitle) {
  let t = rawTitle.replace(/\*\*/g, '').replace(/^\d+[.)]\s*/, '');
  t = t.split(/\s+—\s+/)[0].replace(/\([^)]*\)/g, '');
  return stripInternal(t) || rawTitle.replace(/\*\*/g, '').trim();
}
// label-first pair read — NEVER a greedy scan. item 1's title carries "GATE-2A root: GP/COGS-crossSurface",
// which a free pairIn() reads as the pair "GP/COGS"; the real repro pair is on the `pair:` label (GOOGL/AMZN).
function queuePair(blk) {
  const TICK = '[A-Z][A-Z0-9.]{0,5}';
  let m = blk.match(new RegExp('\\bpair\\s*:\\s*(' + TICK + ')\\s*/\\s*(' + TICK + ')'));
  if (m) return (m[1] + '/' + m[2]).toUpperCase();
  const title = (blk.split('\n')[0] || '').replace(/^\s*-\s*\[[^\]]\]\s*/, '').replace(/\*\*/g, '').replace(/^\d+[.)]\s*/, '').trim();
  m = title.match(new RegExp('^(' + TICK + ')\\s*/\\s*(' + TICK + ')\\b'));
  return m ? (m[1] + '/' + m[2]).toUpperCase() : null;
}
const titleKey = s => String(s || '').replace(/\*\*/g, '').replace(/^\s*-\s*\[[^\]]\]\s*/, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 18);
const keyOverlap = (a, b) => !!a && !!b && (a.startsWith(b.slice(0, 12)) || b.startsWith(a.slice(0, 12)));
function queueItems() {
  const txt = readSafe(ap('QUEUE.md')); if (!txt) return [];
  const open = (txt.split(/^## Open/m)[1] || '').split(/^## /m)[0];
  const L = open.split('\n');
  const cal = parseCalibration();
  const log = parseLoopLog(latestRun());
  const curKey = (log.status.currentItem && !log.status.complete) ? titleKey(log.status.currentItem) : null;
  const items = [];
  for (let i = 0; i < L.length; i++) {
    const mk = L[i].match(/^-\s*\[([ xX~])\]\s*(.+)$/); if (!mk) continue;
    const body = [L[i]]; for (let j = i + 1; j < L.length; j++) { if (/^-\s*\[/.test(L[j]) || /^## /.test(L[j])) break; body.push(L[j]); }
    const blk = body.join('\n');
    const checked = mk[1].toLowerCase() === 'x';
    const pair = queuePair(blk);
    const tkey = titleKey(mk[2]);
    let state = checked ? 'done' : (mk[1] === '~' ? 'parked' : 'waiting');
    if (!checked && keyOverlap(curKey, tkey)) state = 'working';
    let caveat = null;
    if (/downstream of item|if item \d|once .* (?:is )?(?:done|populated|fixed)|stops being null|upstream of/i.test(blk))
      caveat = 'may fix itself once an earlier item is done';
    if (cal.rows.some(r => ['NO_VERDICT', 'UNVERIFIED', 'TIMEOUT', 'FAILED'].includes(r.status) && keyOverlap(titleKey(r.item), tkey)))
      caveat = "reopened — last attempt wasn't verified";
    items.push({ title: plainTitle(mk[2]), pair, state, caveat });
  }
  return items;
}

function buildState() {
  const runId = latestRun();
  const log = parseLoopLog(runId);
  const budget = settingsBudget();   // the effective "Stop at" from sweep.settings (or the runner's hardcoded default)
  return {
    agentDir: AGENT_DIR, repoRoot: REPO_ROOT, now: Date.now(),
    latestRun: runId, hasAnyRun: !!runId,
    status: resolveStatus(),                       // Part 3 — the one honest state at the top
    queue: queueItems(),                           // Part 6 — plain-English work queue from QUEUE.md
    live: { status: log.status, loopLogExists: log.exists, logTail: log.tail, elapsedSec: log.elapsedSec,
      pairsDone: (() => { try { return fs.readdirSync('/tmp/sweep_v2_raw').filter(f => f.endsWith('.json')).length; } catch { return 0; } })(),
      pairsTotal: (() => { try { return fs.readdirSync(path.join(REPO_ROOT, 'docs/sweep-v2/captures')).filter(f => f.endsWith('.json')).length || 50; } catch { return 50; } })() },
    plan: planWithRuntime(),
    summary: buildSummary(),
    pastRuns: buildPastRuns(),
    budgetUsd: budget, budgetIsDefault: !process.env.BUDGET_USD,
    stopExists: !!statSafe(ap('STOP')),
    undo: runId ? readSafe(ap('runs', runId, 'UNDO.txt')) : null,
  };
}

// ── PART 3/5: settings the runner reads from a config file (env still overrides; hardcoded fallback stays) ─
// The dashboard writes CFG_*=VALUE lines to agent/sweep.settings; run-sweep.sh sources it as DEFAULTS. We NEVER
// display a hardcoded placeholder — the "current value" is the config value if set, else the runner's own
// hardcoded fallback parsed live from run-sweep.sh. Numbers only on write (the file is sourced by bash).
const SETTINGS_FILE = ap('sweep.settings');
const SETTINGS_META = [
  { key: 'BUDGET_USD',  label: 'Stop at',            kind: 'money', explain: "A hard ceiling. It stops, it doesn't spend past this." },
  { key: 'PAIRS_LIMIT', label: 'Decks to check',     kind: 'decks', explain: 'More is slower. The 5 repro decks are always included.' },
  { key: 'MAX_ITER',    label: 'Bugs per run',       kind: 'int',   explain: 'Stops after this many, even if more are waiting.' },
  { key: 'MAX_TURNS',   label: 'Turn limit per bug', kind: 'int',   explain: 'How long Claude Code gets on one bug before it gives up.' },
];
function readSettingsFile() {
  const txt = readSafe(SETTINGS_FILE) || ''; const o = {};
  for (const line of txt.split('\n')) { if (/^\s*#/.test(line)) continue; const m = line.match(/^\s*CFG_(\w+)\s*=\s*(.*?)\s*$/); if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return o;
}
function runnerDefault(v) {                          // the hardcoded fallback, parsed LIVE from run-sweep.sh
  const txt = readSafe(ap('run-sweep.sh')) || '';
  let m = txt.match(new RegExp('^' + v + '="\\$\\{' + v + ':-\\$\\{CFG_' + v + ':-([^}]*)\\}\\}"', 'm'));   // VAR="${VAR:-${CFG_VAR:-DEF}}"
  if (m) return m[1];
  m = txt.match(new RegExp('^' + v + '="\\$\\{' + v + ':-([^}]*)\\}"', 'm'));                                // VAR="${VAR:-DEF}"
  return m ? m[1] : null;
}
function deckCount() { try { return fs.readdirSync(path.join(REPO_ROOT, 'docs/sweep-v2/captures')).filter(f => f.endsWith('.json')).length || 50; } catch { return 50; } }
function currentSettings() {
  const cfg = readSettingsFile();
  const decks = deckCount();
  return SETTINGS_META.map(m => {
    const def = runnerDefault(m.key);
    const raw = cfg[m.key] != null ? cfg[m.key] : def;                 // config value, else the live hardcoded default
    let display = raw == null ? '' : String(raw);
    if (m.kind === 'decks' && (raw == null || String(raw) === '0')) display = String(decks);   // PAIRS_LIMIT 0 = all
    return { key: m.key, label: m.label, kind: m.kind, explain: m.explain, value: raw, display, fromConfig: cfg[m.key] != null, runnerDefault: def, deckCount: decks };
  });
}
function settingsBudget() { const b = (currentSettings().find(x => x.key === 'BUDGET_USD') || {}).value; return parseFloat(b) || parseFloat(runnerDefault('BUDGET_USD')) || 50; }
function writeSettings(patch) {
  const cfg = readSettingsFile();
  const decks = deckCount();
  for (const m of SETTINGS_META) {
    if (patch[m.key] == null || String(patch[m.key]).trim() === '') continue;
    let v = String(patch[m.key]).trim();
    if (!/^\d+(\.\d+)?$/.test(v)) continue;                            // numbers ONLY — this file is sourced by bash
    if (m.kind === 'decks' && Number(v) >= decks) v = '0';            // "all" → PAIRS_LIMIT=0
    cfg[m.key] = v;
  }
  const out = ['# Sweep settings — written by the dashboard Settings page. run-sweep.sh sources this as DEFAULTS;',
    '# an env var at launch (e.g. BUDGET_USD=8) STILL overrides, and the hardcoded fallback applies if a key is',
    '# missing. Numbers only (this file is sourced by bash).', ''];
  for (const m of SETTINGS_META) if (cfg[m.key] != null) out.push(`CFG_${m.key}=${cfg[m.key]}`);
  try { fs.writeFileSync(SETTINGS_FILE, out.join('\n') + '\n'); return { ok: true }; } catch (e) { return { error: String(e) }; }
}

// ── PART 4: launchd toggles — REAL state from `launchctl list`, NEVER cached. Read is safe and runs on load;
// the write (bootstrap/bootout) fires ONLY on an explicit toggle, so building/reading this never loads a job.
const LAUNCHD_JOBS = [
  { key: 'nightly',  label: 'com.beckham.sweep',          title: 'Run every night at 6:30',        explain: 'Starts a sweep automatically each night.' },
  { key: 'watchdog', label: 'com.beckham.sweep-watchdog', title: 'Stop a run that stalls 25 minutes', explain: 'Kills a run that has gone quiet for 25 minutes.' },
];
function launchctlOk() { try { execFileSync('launchctl', ['list'], { stdio: 'ignore' }); return true; } catch { return false; } }
function jobLoaded(label) { try { execFileSync('launchctl', ['list', label], { stdio: 'ignore' }); return true; } catch { return false; } }
function launchdView() {
  const ok = launchctlOk();
  const uid = process.getuid ? process.getuid() : 501;
  const home = process.env.HOME || '';
  const jobs = LAUNCHD_JOBS.map(j => {
    const plist = path.join(home, 'Library/LaunchAgents', j.label + '.plist');
    const hasPlist = !!statSafe(plist);
    return { key: j.key, label: j.label, title: j.title, explain: j.explain,
      loaded: ok ? jobLoaded(j.label) : false, hasPlist, controllable: ok && hasPlist,
      onCmd: `launchctl bootstrap gui/${uid} ${plist}`, offCmd: `launchctl bootout gui/${uid}/${j.label}` };
  });
  return { available: ok, jobs };
}

const app = express();
app.use(express.json());
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/api/state', (_req, res) => { try { res.json(buildState()); } catch (e) { res.status(500).json({ error: String(e) }); } });
app.get('/api/preflight', async (_req, res) => { try { res.json(await preflight()); } catch (e) { res.status(500).json({ error: String(e) }); } });
app.get('/api/diagnosis/:name', (req, res) => {
  const name = path.basename(req.params.name || '');
  if (!name.endsWith('.md')) return res.status(400).type('text/plain').send('bad name');
  const txt = readSafe(ap('diagnosis', name));
  if (txt == null) return res.status(404).type('text/plain').send('not found');
  res.type('text/plain').send(txt);
});
app.get('/api/stop', (_req, res) => res.json({ exists: !!statSafe(ap('STOP')) }));
app.post('/api/stop', (_req, res) => { try { fs.writeFileSync(ap('STOP'), 'requested via dashboard\n'); res.json({ exists: true }); } catch (e) { res.status(500).json({ error: String(e) }); } });
app.delete('/api/stop', (_req, res) => { try { fs.rmSync(ap('STOP'), { force: true }); res.json({ exists: false }); } catch (e) { res.status(500).json({ error: String(e) }); } });

// parse preview (read-only, no write)
app.post('/api/parse', (req, res) => { try { res.json(planPreview(parsePlan((req.body && req.body.text) || ''))); } catch (e) { res.status(500).json({ error: String(e) }); } });
// paste → REPLACE the working queue (preserving done items). Writes plan.json only, NOT QUEUE.md.
// "Add to queue" — APPEND-ONLY: new items go to the end, existing items and their order are preserved.
app.post('/api/plan', (req, res) => {
  try {
    const parsed = parsePlan((req.body && req.body.text) || '');
    const existing = readPlan();
    const key = i => (i.pair || '') + '|' + (i.desc || '');
    const have = new Set(existing.map(key));
    const merged = [...existing, ...parsed.filter(i => !have.has(key(i)))];
    writePlan(merged);
    res.json(planPreview(merged));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});
app.get('/api/plan', (_req, res) => { try { res.json(planPreview(readPlan())); } catch (e) { res.status(500).json({ error: String(e) }); } });
// CLEAR — empty the working queue. "Add to queue" is append-only by design, so every re-parse of a plan
// STACKS: plan.json had grown to 47 entries (41 prose blocks that were never repros + 7 duplicate keys)
// with no way to reset short of editing the file by hand. Clearing touches plan.json ONLY — QUEUE.md,
// calibration.csv and the run history are never rewritten from here.
app.delete('/api/plan', (_req, res) => { try { writePlan([]); res.json(planPreview([])); } catch (e) { res.status(500).json({ error: String(e) }); } });
// LAUNCH — the only write action beyond plan.json. Server-side gated on preflight; appends queued items to
// QUEUE.md (append-only) and spawns run-sweep.sh detached. Refuses on any failed precondition.
app.post('/api/launch', async (req, res) => {
  try {
    const pf = await preflight();
    if (!pf.allOk) return res.status(412).json({ error: 'preflight failed', checks: pf.checks });
    const appended = appendQueuedToQueueMd(readPlan());
    // Settings (sweep.settings) drives budget / iters / turns / decks for a dashboard launch — strip these
    // from the spawn env so the config is authoritative here. A TERMINAL launch's own env still wins.
    const { spawn } = require('child_process');
    const env = { ...process.env }; ['BUDGET_USD', 'PAIRS_LIMIT', 'MAX_ITER', 'MAX_TURNS'].forEach(k => delete env[k]);
    const child = spawn('bash', [ap('run-sweep.sh')], { cwd: REPO_ROOT, detached: true, stdio: 'ignore', env });
    child.unref();
    res.json({ launched: true, pid: child.pid, appended: appended.appended });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// settings (Part 3) — GET the live values, POST to write agent/sweep.settings (numbers only)
app.get('/api/settings', (_req, res) => { try { res.json({ settings: currentSettings() }); } catch (e) { res.status(500).json({ error: String(e) }); } });
app.post('/api/settings', (req, res) => { try { const r = writeSettings(req.body || {}); if (r.error) return res.status(500).json(r); res.json({ settings: currentSettings() }); } catch (e) { res.status(500).json({ error: String(e) }); } });
// launchd toggles (Part 4) — GET reads REAL state (never cached, never loads); POST toggles on explicit action
app.get('/api/launchd', (_req, res) => { try { res.json(launchdView()); } catch (e) { res.status(500).json({ error: String(e) }); } });
app.post('/api/launchd', (req, res) => {
  try {
    const { key, on } = req.body || {};
    const job = LAUNCHD_JOBS.find(j => j.key === key);
    if (!job) return res.status(400).json({ error: 'unknown job' });
    const uid = process.getuid();
    const plist = path.join(process.env.HOME || '', 'Library/LaunchAgents', job.label + '.plist');
    if (!statSafe(plist)) return res.status(412).json({ error: 'plist missing', plist });
    try {
      if (on) execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plist], { stdio: 'ignore' });
      else    execFileSync('launchctl', ['bootout', `gui/${uid}/${job.label}`], { stdio: 'ignore' });
    } catch (e) {
      // shelling out to launchctl did not work in this environment — report it, do NOT fake success
      return res.status(500).json({ error: 'launchctl failed — run it from a terminal', detail: String(e.message || e).slice(0, 200), loaded: jobLoaded(job.label) });
    }
    res.json({ key, loaded: jobLoaded(job.label) });          // re-read REAL state after the toggle, never assume
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

const server = app.listen(PORT, () => console.log(`sweep dashboard on http://localhost:${PORT}  (agent dir: ${AGENT_DIR})`));
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`FATAL: port ${PORT} is already in use — the sweep dashboard cannot start. Free port ${PORT} (lsof -iTCP:${PORT}) or set DASH_PORT.`); process.exit(1); }
  throw e;
});
