// ITEM 17 — live three-leg LTM check. Read-only /api/pnl per TARGET ticker (no deck rebuild).
// annual + latest interim − prior interim. audit.periods carries the leg PERIODS (metric-agnostic); the
// null-prior-leg bug = trusted LTM computed with annual+latest present but priorInterim NULL (silently zeroed).
const http = require('http'), fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:3001';
const RAW = process.env.RAW_DIR || path.join(__dirname, '..', '..', 'docs', 'sweep-v2', 'captures');
const FLAGS = process.env.FLAGS || '/tmp/sweep_v2_flags.json';
const get = p => new Promise(r => { const q = http.get(BASE + p, { timeout: 30000 }, res => { let s = ''; res.on('data', d => s += d); res.on('end', () => { try { r(JSON.parse(s)); } catch (e) { r(null); } }); }); q.on('error', () => r(null)); q.on('timeout', () => { q.destroy(); r(null); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// target tickers = B side of every analyzable capture in RAW, + MSFT (control 5). Record each pair's capture ts.
const targets = [];
for (const f of fs.readdirSync(RAW).filter(x => x.endsWith('.json'))) {
  try { const r = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
    if (r.ok && r.oracleB && r.oracleB._quoteStatus === 200 && !r.offerOverride) targets.push({ t: r.pair.split('/')[1], pair: r.pair, capTs: r.ts }); } catch (e) {}
}
if (!targets.some(x => x.t === 'MSFT')) targets.push({ t: 'MSFT', pair: 'AMZN/MSFT(control5)', capTs: '(control)' });

// defect-#1 pairs (LTM gross profit missing) to cross-reference
let d1 = new Set();
try { d1 = new Set(require(FLAGS).filter(f => f.root === 'A-crossSurface' && /gross profit/.test(f.what)).map(f => f.pair)); } catch (e) {}

(async () => {
  const rows = [];
  for (const { t, pair, capTs } of targets) {
    const fetchTs = new Date().toISOString();               // stamp every live fetch (drift vs capture)
    const j = await get(`/api/pnl/${t}`);
    await sleep(400);
    if (!j) { rows.push({ pair, t, err: 'fetch failed' }); continue; }
    const L = j.ltm || {};
    const p = (L.audit && L.audit.periods) || {};
    const st = k => p[k] ? 'PRESENT' : 'NULL';
    const cls = (() => {
      if (L.trusted === true && p.annual && p.latestInterim && !p.priorInterim) return 'SILENT-ZEROED';   // the bug
      if (L.trusted === true && p.annual && p.latestInterim && p.priorInterim) return 'CLEAN-3LEG';
      if (L.trusted === false && L.fallback) return 'FALLBACK(' + L.fallback + ')';                        // deliberate
      return 'UNTRUSTED/other';
    })();
    rows.push({ pair, t, trusted: L.trusted, fallback: L.fallback || '', reason: (L.reason || '').slice(0, 46),
      annual: st('annual'), latest: st('latestInterim'), prior: st('priorInterim'),
      ni: L.netIncome, rev: L.revenue, cls, capTs, fetchTs, d1: d1.has(pair) });
  }
  fs.writeFileSync('/tmp/sweep_v2_item17.json', JSON.stringify(rows, null, 1));
  // report
  const silent = rows.filter(r => r.cls === 'SILENT-ZEROED');
  const silentNotD1 = silent.filter(r => !r.d1);
  console.log('targets fetched:', rows.length, '· fetch window', rows[0]?.fetchTs, '→', rows[rows.length - 1]?.fetchTs);
  console.log('\nclasses:', JSON.stringify(rows.reduce((a, r) => { a[r.cls] = (a[r.cls] || 0) + 1; return a; }, {})));
  console.log('\nSILENT-ZEROED (null prior leg, trusted 3-leg) — the bug #4/Pattern-B candidate:');
  console.log(silent.length ? silent.map(r => `  ${r.pair} (${r.t}): annual ${r.annual}/latest ${r.latest}/prior ${r.prior} · NI ${r.ni} · #1-also=${r.d1}`).join('\n') : '  NONE');
  console.log('\nSILENT-ZEROED excluding those also explained by defect #1:', silentNotD1.length);
  const msft = rows.find(r => r.t === 'MSFT');
  console.log('\nCONTROL 5 — MSFT:', JSON.stringify({ trusted: msft.trusted, fallback: msft.fallback, reason: msft.reason, annual: msft.annual, latest: msft.latest, prior: msft.prior, ni: msft.ni, cls: msft.cls }));
  console.log('\nFALLBACK / untrusted (deliberate — LTM==annual or no data), NOT flagged:');
  console.log(rows.filter(r => /FALLBACK|UNTRUSTED/.test(r.cls)).map(r => `  ${r.pair}: ${r.cls} · ${r.reason}`).join('\n'));
})();
