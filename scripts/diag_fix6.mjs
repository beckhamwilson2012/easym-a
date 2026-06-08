// DIAGNOSTIC (Fix 6): prove the deck shows TWO different standalone EPS for the SAME company because
// some slides print the reported `eps` field while others compute net income ÷ shares.
//   reported-basis slides: §3 TargetOverview, §4/§5/§6 StandalonePL, FinancialProfile  -> uses q.eps
//   NI÷shares-basis slides: Dashboard, §7 ProForma (dealCalc.acquirerStandaloneEPS)     -> q.netIncome/q.shares
import http from 'http';
const g = (p) => new Promise((res) => {
  http.get('http://localhost:3001' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', () => res(null));
});

for (const t of ['CRM', 'TEAM']) {
  const q = await g('/quote?symbol=' + t);
  const reported = parseFloat(q.eps);
  const computed = q.shares > 0 ? q.netIncome / q.shares : null;
  const delta = computed != null ? computed - reported : null;
  console.log(`${t}: reported EPS (§3/§4/§5/§6/FinProfile) = $${reported.toFixed(2)}  |  ` +
              `NI÷shares EPS (Dashboard/§7) = $${computed != null ? computed.toFixed(2) : '—'}  |  ` +
              `Δ = ${delta != null ? (delta >= 0 ? '+' : '') + delta.toFixed(2) : '—'}` +
              `${delta != null && Math.abs(delta) >= 0.01 ? '  <-- SAME COMPANY, TWO EPS' : '  (match)'}`);
}
