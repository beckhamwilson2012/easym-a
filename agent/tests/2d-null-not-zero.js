// agent/tests/2d-null-not-zero.js — queue item 2d, "unresolved companies emit nulls, not a zeroed stub".
//
// Exit codes are the harness contract (GATE_SPEC §12):
//   0 = PASS   the defect is absent
//   1 = FAIL   the defect is present
//   2 = ERROR  the test could not run (app unreachable, limiter, precondition unmet) — NOT a fail
//
// Every assertion below is the one run 20260817-163640 actually made, in
// agent/runs/20260817-163640/scratch/stub_shape_2d.js. Nothing else is asserted. What changed is the
// SUBJECT: that script built the payload itself and never imported server.js, so it was green on the
// unfixed tree and proved field()'s contract rather than /quote's use of it. The seven-field and marker
// assertions are therefore made against the LIVE WIRE, which is what the item is about; the real-zero
// assertion stays at module level, because no filer can be asked to report a genuine 0 on demand.
const path = require('path');
const { field, unwrapCompany } = require(path.join(__dirname, '..', '..', 'src', 'lib', 'financialSchema'));

const BASE   = process.env.BASE || 'http://127.0.0.1:3001';
const SYMBOL = 'BRK.B';
const FIELDS = ['revenue', 'ebitda', 'netIncome', 'shares', 'eps', 'cash', 'debt'];

const err = (msg) => { console.error(`ERROR: ${msg}`); process.exit(2); };

(async () => {
  let wire;
  try {
    const r = await fetch(`${BASE}/quote?symbol=${encodeURIComponent(SYMBOL)}`, { signal: AbortSignal.timeout(20000) });
    wire = await r.json();
  } catch (e) {
    err(`/quote?symbol=${SYMBOL} unreachable at ${BASE} — ${e.message}`);
  }
  // The app's own 500-per-15-min limiter. A rate limit is an environmental event, never a defect
  // (GATE_SPEC §5) — so it is ERROR, and the gate falls through to the count instead of reverting.
  if (wire && wire.error) err(`app returned {"error":${JSON.stringify(wire.error)}} — environmental, not a verdict`);

  // PRECONDITION, not an assertion. This item is about the NO-PROVIDER stub. If some provider resolved
  // BRK.B, the branch under test never executed, and the seven fields below would be real data that
  // trivially passes a "not zero" reading. An unmeasurable premise is ERROR, never PASS (GATE_SPEC §8).
  if (wire.dataSource !== 'none') {
    err(`precondition unmet — dataSource=${JSON.stringify(wire.dataSource)}, expected "none" (a provider resolved ${SYMBOL}, so the no-provider stub never ran)`);
  }
  // Vacuity guard: an emptied or renamed field list makes every loop below pass by having nothing to check.
  if (FIELDS.length !== 7) err(`field list altered — ${FIELDS.length} fields, expected 7`);

  const fail = [];

  // "all null: true" — the seven financial fields of an unresolved company are ABSENT, not zero.
  console.log(`wire (${BASE}/quote?symbol=${SYMBOL}, dataSource=${wire.dataSource}):`);
  for (const k of FIELDS) {
    console.log(`  ${k} = ${JSON.stringify(wire[k])}`);
    if (wire[k] !== null) fail.push(`${k} = ${JSON.stringify(wire[k])}, want null`);
  }

  // "markers intact: true" — the item requires any check for this defect to key on dataSource, and the
  // honest markers must survive the fix. name is the caller's own ticker echoed back as a label.
  if (wire.ltm && wire.ltm.reason !== 'no data source resolved') fail.push(`ltm.reason = ${JSON.stringify(wire.ltm.reason)}, want "no data source resolved"`);
  if (!wire.ltm) fail.push('ltm block absent, want {reason:"no data source resolved"}');
  if (wire.name !== SYMBOL) fail.push(`name = ${JSON.stringify(wire.name)}, want ${JSON.stringify(SYMBOL)}`);
  console.log(`  dataSource = ${JSON.stringify(wire.dataSource)} · ltm.reason = ${JSON.stringify(wire.ltm && wire.ltm.reason)} · name = ${JSON.stringify(wire.name)}`);

  // "REAL ZERO" — a genuine 0 must still survive the same boundary as 0. Null-honesty that also nulls a
  // real zero would trade one fabrication for another; this is the no-op half of the fix.
  const realZero = unwrapCompany({ revenue: field(0, { source: 'sec_edgar' }) }).revenue;
  console.log(`  unwrapCompany(field(0)).revenue = ${JSON.stringify(realZero)}`);
  if (realZero !== 0) fail.push(`unwrapCompany(field(0)).revenue = ${JSON.stringify(realZero)}, want 0`);

  if (fail.length) {
    console.error(`FAIL (${fail.length}):`);
    for (const f of fail) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`PASS: ${FIELDS.length}/7 unresolved fields null · markers intact · a real 0 survives as 0`);
})();
