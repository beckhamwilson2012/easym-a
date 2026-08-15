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

const server = app.listen(PORT, () => console.log(`sweep dashboard on http://localhost:${PORT}  (agent dir: ${AGENT_DIR})`));
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`FATAL: port ${PORT} is already in use — the sweep dashboard cannot start. Free port ${PORT} (lsof -iTCP:${PORT}) or set DASH_PORT.`); process.exit(1); }
  throw e;
});
