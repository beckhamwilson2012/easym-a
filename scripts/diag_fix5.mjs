// DIAGNOSTIC (Fix 5): prove §11 Football Field's "52-Week Range" is SELF-REFERENTIAL — its high
// collapses to the current price — because it anchors the relative monthly series' START (=100) to
// the current price instead of anchoring the CURRENT month to it. Meanwhile CNBC's quote carries the
// REAL 52-week range (yrhiprice/yrloprice), which the verified layer marks "missing" and never uses.
import http from 'http';
import https from 'https';
const g = (host, p, headers = {}) => new Promise((res) => {
  (host.startsWith('https') ? https : http).get(host + p, { headers }, r => {
    let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } });
  }).on('error', () => res(null));
});
const f = v => v == null ? '—' : '$' + Number(v).toFixed(2);

const T = 'TEAM';
const prices = await g('http://localhost:3001', '/api/prices/' + T);
const verified = await g('http://localhost:3001', '/api/verified/' + T);
const live = verified?.fields?.price?.value ?? null;
const series = prices?.series || [];

// Replicate CURRENT §11 math (SectionFootballField.js l.252-256): anchor the START of the relative
// series to current price → vals = (s.value/100) * currentPrice. (currentPrice ≈ live, since the
// suggested offer is live×1.30 and premium is 30%, so offer/(1+prem) = live.)
const curVals = series.map(s => (s.value / 100) * (live ?? 0));
const curHigh = Math.max(...curVals), curLow = Math.min(...curVals);

// CNBC raw quote — the REAL 52-week range.
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36', 'Accept': 'application/json' };
const cnbc = await g('https://quote.cnbc.com', `/quote-html-webservice/restQuote/symbolType/symbol?symbols=${T}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=0&output=json`, HEADERS);
const q = cnbc?.FormattedQuoteResult?.FormattedQuote?.[0] || {};
const realHigh = parseFloat(q.yrhiprice), realLow = parseFloat(q.yrloprice);

console.log(`${T} live price: ${f(live)}`);
console.log(`prices feed source label: "${prices?.source}" (route mislabels Yahoo fallback as 'fmp')`);
console.log(`relative series: first=${series[0]?.value} max=${Math.max(...series.map(s=>s.value))} last=${series[series.length-1]?.value}`);
console.log('');
console.log('── CURRENT §11 "52-Week Range" (start-anchored) ──');
console.log(`  low=${f(curLow)}  high=${f(curHigh)}`);
console.log(`  >> SELF-REFERENTIAL: high (${f(curHigh)}) == current price (${f(live)})? ${Math.abs(curHigh - live) < 0.5 ? 'YES — bug' : 'no'}`);
console.log('');
console.log('── CNBC real 52-week range (UNUSED today) ──');
console.log(`  yrloprice=${f(realLow)}  yrhiprice=${f(realHigh)}`);
console.log(`  verified.week52High status: ${verified?.fields?.week52High?.status ?? 'ABSENT'} (chosen=${verified?.fields?.week52High?.chosenSource ?? '—'})`);
