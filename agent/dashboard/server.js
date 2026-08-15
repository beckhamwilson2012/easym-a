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
  s.lastWriteAgeSec = st ? Math.round((Date.now() - st.mtimeMs) / 1000) : null;
  const pidTxt = readSafe(path.join(runDir, 'run.pid'));
  const pid = pidTxt ? parseInt(pidTxt.trim(), 10) : null;
  let alive = false;
  if (pid) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = e && e.code === 'EPERM'; } } // EPERM = exists but unsignalable
  s.pid = pid; s.pidAlive = alive;
  if (s.complete) s.runState = 'COMPLETED';
  else if (pid != null) s.runState = alive ? (s.lastWriteAgeSec > 1800 ? 'STALE' : 'RUNNING') : 'DIED';
  else s.runState = (s.lastWriteAgeSec != null && s.lastWriteAgeSec > 120) ? 'DIED' : 'RUNNING'; // pre-run.pid runs: infer from log staleness
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

// ── Plan parser — DETERMINISTIC, NO LLM (see CLAUDE.md for the format) ────────────────────────────────
// A regex extractor structurally CANNOT fabricate a value, so it never auto-fills a missing field — that
// guarantee is the whole point. got/want/why capture to END OF LINE only (values may contain commas,
// slashes, parens; NO mid-line separator — a greedy "·" split bit us once). Missing any of got/want/why
// -> blocked, and we name which. A pair with no detail lines -> blocked (a pair alone is not a repro).
const HEADING_STATUS = { 'next up': 'queued', 'blocked on you': 'blocked', parked: 'skipped', done: 'done' };
const PAIR_TITLE = /^([A-Z][A-Z0-9.]{0,5}\/[A-Z][A-Z0-9.]{0,5})\s*[—–-]\s*(.*)$/;   // PAIR — desc
const PAIR_ANY = /\b([A-Z][A-Z0-9.]{0,5}\/[A-Z][A-Z0-9.]{0,5})\b/;
function parsePlan(text) {
  const lines = String(text || '').split('\n');
  const itemRe = /^\s*-\s*\[([ xX])\]\s+(.+?)\s*$/;
  const detailRe = /^\s+(got|want|why)\s*:\s*(.*)$/i;            // indented; capture to end of line only
  const headingRe = /^\s*##\s+(.+?)\s*$/;
  const items = []; let cur = null; let headStatus = 'queued';
  const finalize = () => {
    if (!cur) return;
    cur.missing = ['got', 'want', 'why'].filter(k => !cur[k]);
    cur.status = cur.checked ? 'done' : (cur.missing.length ? 'blocked' : cur.headStatus);
    items.push(cur); cur = null;
  };
  for (const raw of lines) {
    let m;
    if (!itemRe.test(raw) && (m = raw.match(headingRe))) { finalize(); const h = m[1].trim().toLowerCase(); if (HEADING_STATUS[h]) headStatus = HEADING_STATUS[h]; continue; }
    if ((m = raw.match(itemRe))) {
      finalize();
      const checked = m[1].toLowerCase() === 'x'; const title = m[2].trim();
      cur = { title, checked, headStatus, got: null, want: null, why: null };
      const tm = title.match(PAIR_TITLE);
      if (tm) { cur.pair = tm[1]; cur.desc = tm[2].trim(); }
      else { const pm = title.match(PAIR_ANY); cur.pair = pm ? pm[1] : null; cur.desc = title; }
      continue;
    }
    if (cur && (m = raw.match(detailRe))) { cur[m[1].toLowerCase()] = m[2].trim() || null; continue; }
  }
  finalize();
  return items;
}
function countStatuses(items) { const c = { done: 0, running: 0, queued: 0, blocked: 0, skipped: 0 }; items.forEach(i => c[i.status] = (c[i.status] || 0) + 1); return c; }
function planPreview(items) {
  const counts = countStatuses(items);
  const summary = [`${counts.queued} queued · ${counts.blocked} blocked · ${counts.skipped} skipped · ${counts.done} done`];
  items.filter(i => i.status === 'blocked' && i.missing && i.missing.length).forEach(i =>
    summary.push(`blocked: ${i.pair || i.desc} — missing ${i.missing.join(', ')}${i.missing.length === 3 ? '  (a pair alone is not a repro)' : ''}`));
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
  const curPair = (log.status.currentItem && !log.status.complete) ? (log.status.currentItem.match(PAIR_ANY) || [])[1] : null;
  const donePairs = new Set(cal.rows.filter(r => r.status === 'DONE').map(r => (String(r.item).match(PAIR_ANY) || [])[1]).filter(Boolean));
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
  const block = queued.map(i => `- [ ] **${i.pair} — ${i.desc}**\n  - pair: ${i.pair} · observed: ${i.got} · expected: ${i.want} · source: ${i.why}`).join('\n');
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

function buildState() {
  const runId = latestRun();
  const log = parseLoopLog(runId);
  const budget = parseFloat(process.env.BUDGET_USD || '25');
  return {
    agentDir: AGENT_DIR, repoRoot: REPO_ROOT, now: Date.now(),
    latestRun: runId, hasAnyRun: !!runId,
    live: { status: log.status, loopLogExists: log.exists, logTail: log.tail, elapsedSec: log.elapsedSec },
    plan: planWithRuntime(),
    summary: buildSummary(),
    budgetUsd: budget, budgetIsDefault: !process.env.BUDGET_USD,
    stopExists: !!statSafe(ap('STOP')),
    undo: runId ? readSafe(ap('runs', runId, 'UNDO.txt')) : null,
  };
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
app.post('/api/plan', (req, res) => {
  try {
    const parsed = parsePlan((req.body && req.body.text) || '');
    const merged = mergePreservingDone(parsed, readPlan());
    writePlan(merged);
    res.json(planPreview(merged));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});
app.get('/api/plan', (_req, res) => { try { res.json(planPreview(readPlan())); } catch (e) { res.status(500).json({ error: String(e) }); } });
// LAUNCH — the only write action beyond plan.json. Server-side gated on preflight; appends queued items to
// QUEUE.md (append-only) and spawns run-sweep.sh detached. Refuses on any failed precondition.
app.post('/api/launch', async (req, res) => {
  try {
    const pf = await preflight();
    if (!pf.allOk) return res.status(412).json({ error: 'preflight failed', checks: pf.checks });
    const appended = appendQueuedToQueueMd(readPlan());
    const { spawn } = require('child_process');
    const child = spawn('bash', [ap('run-sweep.sh')], { cwd: REPO_ROOT, detached: true, stdio: 'ignore', env: { ...process.env, BUDGET_USD: String(pf.budgetUsd) } });
    child.unref();
    res.json({ launched: true, pid: child.pid, appended: appended.appended });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

const server = app.listen(PORT, () => console.log(`sweep dashboard on http://localhost:${PORT}  (agent dir: ${AGENT_DIR})`));
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`FATAL: port ${PORT} is already in use — the sweep dashboard cannot start. Free port ${PORT} (lsof -iTCP:${PORT}) or set DASH_PORT.`); process.exit(1); }
  throw e;
});
