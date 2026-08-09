// Self-test: run the analyzer over the committed control captures and assert the 4 live defects still flag.
// Deterministic, no network. Exit 0 = all pass. Control 5 is documented as CORRECTLY CLEARS (see below).
//
//   node tools/sweep-analyzer/selftest.js
//
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const DIR = __dirname;
const CAP = path.join(DIR, '..', '..', 'docs', 'sweep-v2', 'captures');
const CONTROLS = ['RKLB_IRDM', 'AAPL_VZ', 'SAP_NOW', 'GOOGL_AMZN', 'DAL_ALK'];
const FLAGS = '/tmp/selftest_flags.json';

const files = CONTROLS.map(c => path.join(CAP, c + '.json'));
execSync(`${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(DIR, 'analyze.js'))} ${files.map(f => JSON.stringify(f)).join(' ')}`,
  { stdio: 'ignore', env: { ...process.env, OUT: '/tmp/selftest_findings.md', FLAGS, EXPECTED: '/tmp/selftest_exp.json' } });
const F = JSON.parse(fs.readFileSync(FLAGS, 'utf8'));
const has = fn => F.some(fn);

const checks = [
  ['1 · target debt dropped → EV/net-debt (RKLB/IRDM: /quote debt=null, §16 $1.8B)',
    has(f => /DEBT DROPPED/.test(f.what) && f.pair === 'RKLB/IRDM')],
  ['2 · gross profit on §2 but "—" on §6/§7/§8 (AAPL/VZ)',
    has(f => f.root === 'A-crossSurface' && f.pair === 'AAPL/VZ' && /gross/.test(f.what))],
  ['3 · combined gross margin understated 36.2% vs ~46.6% (AAPL/VZ)',
    has(f => f.root === 'B-nullInSum' && f.pair === 'AAPL/VZ')],
  ['4 · stale financials presented as current (SAP/NOW: FY2017)',
    has(f => f.root === 'STALE' && f.pair === 'SAP/NOW')],
];

let ok = true;
for (const [name, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL') + ' — control ' + name); if (!pass) ok = false; }

// Control 5 is NOT a defect — it CORRECTLY CLEARS. MSFT's $133,749 is its FY2026 annual net income; the LTM
// falls back to annual (trusted:false, reason "no interim period past the latest fiscal year-end — LTM == annual").
// The null-prior-leg hypothesis is DISPROVEN: 0 silently-zeroed legs across 43 targets. Verify live:
//   node tools/sweep-analyzer/item17.js   (needs the app running at :3001)
console.log('DOC  — control 5 (AMZN/MSFT $133,749) CORRECTLY CLEARS: item17.js shows MSFT FALLBACK(annual), all legs null, trusted:false — the FY2026 annual, NOT a null-prior-leg defect. Not asserted here (needs live /api/pnl).');

console.log(ok ? '\nSELFTEST PASS (4/4 live-defect controls flagged)' : '\nSELFTEST FAIL');
process.exit(ok ? 0 : 1);
