'use strict';
// Live proof for fmpEngine.js. Run: FMP_KEY=<key> node scripts/test_fmpEngine.js
const { getVerified, calendarizeAnnual } = require('../fmpEngine');

function showField(name, f) {
  const v = f.value == null ? 'null' : (typeof f.value === 'number' ? f.value.toLocaleString('en-US') : f.value);
  console.log(`  ${name.padEnd(18)} ${String(v).padStart(14)} | ${f.basis.padEnd(14)} ${f.provenance.padEnd(18)} | ${f.source}`);
  if (f.calendarYear) console.log(`  ${''.padEnd(18)} ${''.padStart(14)} | calendarYear=${f.calendarYear}${f.approximate ? ' (APPROX)' : ''}`);
  if (f.note) console.log(`  ${''.padEnd(18)} └─ note: ${f.note}`);
}

(async () => {
  console.log('═══ UNIT: calendarizeAnnual (proves the calendarization logic even when live statements are gated) ═══');
  for (const [d, lbl] of [['2026-01-31', 'CRM-style Jan FYE'], ['2025-06-30', 'TEAM-style Jun FYE'], ['2025-12-31', 'Dec FYE']]) {
    const c = calendarizeAnnual(d);
    console.log(`  ${lbl.padEnd(20)} end ${d} → ${c.calendarYear}${c.approximate ? ' (APPROXIMATION)' : ''}`);
    if (c.note) console.log(`      ${c.note}`);
  }

  for (const t of ['CRM', 'TEAM']) {
    console.log(`\n═══ LIVE: getVerified('${t}') ═══`);
    const r = await getVerified(t);
    console.log(`  ${t} · ${r.company?.name || '?'} · ${r.currency} · keyConfigured=${r.keyConfigured} · asOf ${r.asOf.slice(0, 19)}`);
    console.log(`  ${'FIELD'.padEnd(18)} ${'VALUE'.padStart(14)} | ${'BASIS'.padEnd(14)} ${'PROVENANCE'.padEnd(18)} | SOURCE`);
    for (const [k, f] of Object.entries(r.fields)) showField(k, f);
  }
})().catch((e) => { console.error('ENGINE CRASHED (should never happen):', e); process.exit(1); });
