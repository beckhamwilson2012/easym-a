// DIAGNOSTIC (Fix 1): prove the comps table computes EV via EPS×15, diverging from the live-price
// market cap used on §6/§9, using REAL values from the live server for TEAM's peer set.
import http from 'http';
const g = (p) => new Promise((res, rej) => {
  http.get('http://localhost:3001' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', rej);
});

const peersResp = await g('/api/peers/TEAM');
const peers = (peersResp && peersResp.peers) || [];
const tickers = ['TEAM', ...peers];
console.log('TEAM peer set:', JSON.stringify(tickers));
console.log('');
console.log('ticker | path      | eps   shares  | EPS×15 mktCap (CURRENT comps) | live px  livePx×sh (§6/§9)  | EV(eps15)  EV/Rev | EV(live)  EV/Rev');
for (const t of tickers) {
  const q = await g('/quote?symbol=' + t);
  const pr = await g('/api/price/' + t);
  if (!q) { console.log(`${t}: /quote failed`); continue; }
  const eps = q.eps || 0, shares = q.shares || 0, debt = q.debt || 0, cash = q.cash || 0, rev = q.revenue || 0;
  const live = pr && pr.price != null ? pr.price : null;
  const epsMkt = eps > 0 && shares > 0 ? eps * 15 * shares : null;     // CURRENT comps path (buildAutoRow l.50)
  const liveMkt = live != null && shares > 0 ? live * shares : null;    // §6/§9 path
  const evEps = epsMkt != null ? epsMkt + debt - cash : null;
  const evLive = liveMkt != null ? liveMkt + debt - cash : null;
  const f = (v) => v == null ? '—' : (v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'B' : '$' + Math.round(v) + 'M');
  const x = (ev) => ev != null && rev > 0 ? (ev / rev).toFixed(1) + 'x' : '—';
  console.log(
    `${t.padEnd(6)} | ${(epsMkt != null ? 'eps15' : 'no-eps').padEnd(9)} | ${String(eps).padEnd(5)} ${String(shares).padEnd(6)} | ${f(epsMkt).padEnd(28)} | ${String(live ?? '—').padEnd(8)} ${f(liveMkt).padEnd(18)} | ${f(evEps).padEnd(9)} ${x(evEps).padEnd(6)} | ${f(evLive).padEnd(8)} ${x(evLive)}`
  );
}
