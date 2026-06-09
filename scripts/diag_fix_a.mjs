// DIAGNOSTIC (Fix A): the SAME "Market Cap" reads as a real value on §9 but "missing/—" on §15.
// §9 Trading Profile shows a DERIVED market cap (live price × shares). §15 Data Verification tracks
// the VENDOR-fetched `marketCap` field (FMP-only), which 403s on the keyless stack → always missing.
// A reconciliation appendix (vendor columns) can never verify a derived field, so it shows "?"/"—".
import http from 'http';
const g = (p) => new Promise((res) => {
  http.get('http://localhost:3001' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', () => res(null));
});
const fM = (v) => v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'B' : '$' + Math.round(v) + 'M';

for (const t of ['TEAM', 'ADBE']) {
  const q = await g('/quote?symbol=' + t);
  const pr = await g('/api/price/' + t);
  const v = await g('/api/verified/' + t);
  const price = pr?.price, shares = q?.shares;
  const derivedMktCap = price != null && shares > 0 ? price * shares : null; // §9 path (price × shares)
  const mc = v?.fields?.marketCap;
  console.log(`${t}:`);
  console.log(`  §9 Trading Profile  -> Market Cap = ${derivedMktCap != null ? fM(derivedMktCap) : '—'}  (DERIVED: ${price} × ${shares}M shares)`);
  console.log(`  §15 Data Verification -> marketCap field: status=${mc?.status} value=${mc?.value} sources=[${Object.keys(mc?.sourceMeta || {}).join(',')}]  -> renders as "${mc?.status === 'missing' ? '? / —' : mc?.value}"`);
  console.log(`  CONTRADICTION: §9 shows ${derivedMktCap != null ? fM(derivedMktCap) : '—'} but §15 shows ${mc?.status === 'missing' ? 'missing/—' : mc?.value} for the same field.`);
  console.log('');
}
console.log('marketCap is a DERIVED value (price × shares), not a vendor-fetched/reconcilable field -> it does not belong in the vendor-source verification appendix.');
