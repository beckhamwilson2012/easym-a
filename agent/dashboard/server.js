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

// ── Phase 2: plan intake ──────────────────────────────────────────────────────────────────────────
// DETERMINISTIC extractor — NO LLM. The whole value is REJECTION: an item missing any of the four fields
// (pair, observed, expected, source) returns BLOCKED and burns a full iteration (~22 min of capture). A
// deterministic parser cannot hallucinate a value, so it can never auto-fill a missing field — it only
// reports which labels are literally present in the pasted text. Nothing here infers a pair, value, or
// source from context. (If this ever used an LLM, the prompt would have to say EXTRACT ONLY, never supply
// a plausible value for a field the notes don't contain — but it doesn't; it's pure regex.)
const REQUIRED = ['pair', 'observed', 'expected', 'source'];
function splitItems(text) {
  const lines = String(text || '').split('\n');
  const isStart = l => /^\s*(\d+[.)]|[-*•])\s+/.test(l);
  const blank = l => /^\s*$/.test(l);
  const out = [];
  if (lines.some(isStart)) {
    let cur = null;
    for (const l of lines) { if (isStart(l)) { cur = [l]; out.push(cur); } else if (cur) cur.push(l); }
  } else {
    let buf = [];
    for (const l of lines) { if (blank(l)) { if (buf.length) { out.push(buf); buf = []; } } else buf.push(l); }
    if (buf.length) out.push(buf);
  }
  return out.map(b => b.join('\n').trim()).filter(Boolean);
}
function detectFields(block) {
  // capture up to the next "·" field-separator or newline — NOT greedy across sibling fields on one line
  const label = k => { const m = block.match(new RegExp('\\b' + k + '\\b\\s*[:\\-]\\s*([^·\\n]+)', 'i')); return m && m[1].trim() ? m[1].trim() : null; };
  const fields = {};
  for (const k of REQUIRED) fields[k] = label(k);
  // pair may also be a literal ticker-pair token in the text — that is EXTRACTION (it is present verbatim),
  // not inference. It still does NOT make the item complete on its own; the other three must be present too.
  if (!fields.pair) { const t = block.match(/\b([A-Z][A-Z.]{0,5}\/[A-Z][A-Z.]{0,5})\b/); if (t) fields.pair = t[1]; }
  const missing = REQUIRED.filter(k => !fields[k]);
  const title = (block.split('\n')[0] || '').replace(/^\s*(\d+[.)]|[-*•])\s+/, '').replace(/\s*(pair|observed|expected|source)\s*[:\-].*/i, '').trim() || (fields.pair || 'untitled');
  return { raw: block, title: title.slice(0, 80), fields, missing, complete: missing.length === 0 };
}
function parsePlan(text) {
  const items = splitItems(text).map(detectFields);
  const n = items.length;
  const complete = items.filter(i => i.complete).length;
  const miss = { pair: 0, observed: 0, expected: 0, source: 0 };
  items.forEach(i => i.missing.forEach(k => miss[k]++));
  const summary = [`${complete} of ${n} item(s) are COMPLETE (ready for ## Open); ${n - complete} are INCOMPLETE.`];
  const label = { pair: 'a reproducing pair', observed: 'an observed value', expected: 'an expected value', source: 'a source' };
  for (const k of REQUIRED) if (miss[k]) summary.push(`${miss[k]} of ${n} item(s) are missing ${label[k]}. These will return BLOCKED without being fixed.`);
  return { items, summary, counts: { total: n, complete, incomplete: n - complete } };
}
// Build the exact QUEUE text that WOULD be appended. COMPLETE -> ## Open; INCOMPLETE -> ## Discovered
// (never ## Open). Missing fields are shown as "(missing)" — never invented.
function renderAppend(items) {
  const open = items.filter(i => i.complete).map(i =>
    `- [ ] **${i.title}**\n  - pair: ${i.fields.pair} · observed: ${i.fields.observed} · expected: ${i.fields.expected} · source: ${i.fields.source}`);
  const disc = items.filter(i => !i.complete).map(i =>
    `- ${i.title} — from pasted plan (INCOMPLETE, MISSING: ${i.missing.join(', ')}). Not actionable until all four fields are supplied.\n  - pair: ${i.fields.pair || '(missing)'} · observed: ${i.fields.observed || '(missing)'} · expected: ${i.fields.expected || '(missing)'} · source: ${i.fields.source || '(missing)'}`);
  return { openBlock: open.join('\n'), discBlock: disc.join('\n'), openCount: open.length, discCount: disc.length };
}
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

// ── the combined state the page polls (~2s) ──────────────────────────────────────────────────────────
function buildState() {
  const runId = latestRun();
  const log = parseLoopLog(runId);
  const cal = parseCalibration();
  const budget = parseFloat(process.env.BUDGET_USD || '50');
  return {
    agentDir: AGENT_DIR, repoRoot: REPO_ROOT, now: Date.now(),
    latestRun: runId, hasAnyRun: !!runId,
    status: log.status, loopLogExists: log.exists, logTail: log.tail, elapsedSec: log.elapsedSec,
    queue: queueOpen(),
    calibration: cal, costTotal: cal.costTotal, budgetUsd: budget, budgetIsDefault: !process.env.BUDGET_USD,
    stopExists: !!statSafe(ap('STOP')),
    decisions: readSafe(ap('DECISIONS.md')),
    diagnosis: diagnosisList(),
    commits: commitsFor(log.status.branch, log.status.runId),
    undo: runId ? readSafe(ap('runs', runId, 'UNDO.txt')) : null,
  };
}

const app = express();
app.use(express.json());
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/api/state', (_req, res) => { try { res.json(buildState()); } catch (e) { res.status(500).json({ error: String(e) }); } });
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

// Phase 2 — plan intake (parse is read-only; append requires explicit confirm and is append-only)
app.post('/api/parse', (req, res) => { try { res.json(parsePlan((req.body && req.body.text) || '')); } catch (e) { res.status(500).json({ error: String(e) }); } });
app.post('/api/queue/append', (req, res) => {
  try {
    const text = (req.body && req.body.text) || '';
    const confirm = !!(req.body && req.body.confirm);
    const { items } = parsePlan(text);
    const { openBlock, discBlock, openCount, discCount } = renderAppend(items);
    const parts = [];
    if (openBlock) parts.push('>>> appended to ## Open (COMPLETE items):\n' + openBlock);
    if (discBlock) parts.push('>>> appended to ## Discovered (INCOMPLETE — never ## Open):\n' + discBlock);
    const diff = parts.join('\n\n') || '(nothing to append)';
    if (!confirm) return res.json({ dryRun: true, diff, openCount, discCount });
    let content = readSafe(ap('QUEUE.md'));
    if (content == null) return res.status(500).json({ error: 'QUEUE.md not found' });
    if (openBlock) content = insertIntoSection(content, 'Open', openBlock);        // append-only
    if (discBlock) content = insertIntoSection(content, 'Discovered', discBlock);   // append-only
    fs.writeFileSync(ap('QUEUE.md'), content);
    res.json({ written: true, diff, openCount, discCount });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

const server = app.listen(PORT, () => console.log(`sweep dashboard on http://localhost:${PORT}  (agent dir: ${AGENT_DIR})`));
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`FATAL: port ${PORT} is already in use — the sweep dashboard cannot start. Free port ${PORT} (lsof -iTCP:${PORT}) or set DASH_PORT.`); process.exit(1); }
  throw e;
});
