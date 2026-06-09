// DIAGNOSTIC (Comparables redesign): for both builds, log the current auto-selected peer set, and for
// EACH candidate metric from the reference screening table, whether the data layer can verify-fetch it
// for every company in the (widened ~8) set. This defines the row set BEFORE any UI work. Also verify
// EV/Revenue consistency (live price × shares) and sanity (no NOW-at-1.7x class bug).
import http from 'http';
const g = (p) => new Promise((res) => {
  http.get('http://localhost:3001' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', () => res(null));
});

// Proposed widened peer sets (target + 7). Diagnostic confirms each ticker resolves + is fetchable.
const SETS = {
  TEAM: ['CRM', 'NOW', 'WDAY', 'ADBE', 'SAP', 'ORCL', 'INTU'],
  ADBE: ['CRM', 'NOW', 'WDAY', 'TEAM', 'SAP', 'ORCL', 'INTU'],
};
// Candidate metrics from the reference table → how the data layer would source them.
const METRICS = [
  ['Employees',           (f) => null,                         'not fetched'],
  ['Customers',           (f) => null,                         'not fetched'],
  ['Net Revenue Retention',(f) => null,                        'not fetched'],
  ['Revenue',             (f) => f.revenue?.value,             'edgar'],
  ['Revenue Growth',      (f) => null,                         'no prior-year field'],
  ['Gross Margin',        (f) => null,                         'no gross-profit field'],
  ['FCF Margin',          (f) => (f.freeCashFlow?.value != null && f.revenue?.value) ? f.freeCashFlow.value / f.revenue.value * 100 : null, 'edgar (FCF/Rev)'],
  ['Op Income',           (f) => f.operatingIncome?.value,     'edgar'],
  ['Market Cap',          (f) => (f.price?.value != null && f.sharesOutstanding?.value) ? f.price.value * f.sharesOutstanding.value : null, 'price×shares (cnbc×edgar)'],
  ['EV / Revenue',        (f) => { const mc = f.price?.value != null && f.sharesOutstanding?.value ? f.price.value * f.sharesOutstanding.value : null; if (mc == null || !f.revenue?.value) return null; const ev = mc + (f.totalDebt?.value || 0) - (f.cash?.value || 0); return ev / f.revenue.value; }, 'live EV / Rev'],
];

for (const target of Object.keys(SETS)) {
  const set = [target, ...SETS[target]];
  console.log(`\n========== BUILD target=${target} ==========`);
  const cur = await g('/api/peers/' + target);
  console.log(`CURRENT auto peer set: ${(cur?.peers || []).length} peers ${JSON.stringify(cur?.peers || [])}`);
  console.log(`PROPOSED widened set (${set.length} cols): ${JSON.stringify(set)}`);

  // fetch verified for each company
  const data = {};
  for (const t of set) data[t] = (await g('/api/verified/' + t))?.fields || null;

  console.log('\nPER-METRIC FETCHABILITY (✓=value present, ·=null):');
  const rowDecision = [];
  for (const [name, fn, src] of METRICS) {
    const cells = set.map(t => { const v = data[t] ? fn(data[t]) : null; return { t, ok: v != null }; });
    const okCount = cells.filter(c => c.ok).length;
    const fetchableForSet = okCount >= Math.ceil(set.length * 0.5); // target + majority
    rowDecision.push([name, fetchableForSet, okCount, set.length, src]);
    console.log(`  ${name.padEnd(22)} ${cells.map(c => c.ok ? '✓' : '·').join(' ')}  [${okCount}/${set.length}] ${src}`);
  }
  console.log('\nROW DECISION:');
  console.log('  RENDER:', rowDecision.filter(r => r[1]).map(r => r[0]).join(', '));
  console.log('  DROP:  ', rowDecision.filter(r => !r[1]).map(r => r[0]).join(', '));

  // EV/Revenue values + sanity
  console.log('\nEV/REVENUE (live basis) + sanity:');
  for (const t of set) {
    const f = data[t]; if (!f) { console.log(`  ${t.padEnd(5)} NO DATA`); continue; }
    const mc = f.price?.value != null && f.sharesOutstanding?.value ? f.price.value * f.sharesOutstanding.value : null;
    const ev = mc != null ? mc + (f.totalDebt?.value || 0) - (f.cash?.value || 0) : null;
    const evRev = ev != null && f.revenue?.value ? ev / f.revenue.value : null;
    const oi = f.operatingIncome?.value, rev = f.revenue?.value;
    const opMargin = oi != null && rev ? oi / rev * 100 : null;
    const implausible = evRev != null && opMargin != null && opMargin > 10 && evRev < 1;
    console.log(`  ${t.padEnd(5)} mktCap=${mc ? '$' + (mc / 1000).toFixed(1) + 'B' : '—'}  EV/Rev=${evRev != null ? evRev.toFixed(1) + 'x' : '—'}  ${implausible ? '<-- IMPLAUSIBLE (flag/exclude)' : ''}`);
  }
}
