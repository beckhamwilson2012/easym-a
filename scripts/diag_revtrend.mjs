// DIAGNOSTIC (Phase 2): the §6 chart is a single-year TWO-BAR chart (chartData = [{acq rev},{tgt rev}]).
// No multi-year series existed. /quote.revenueHistory now supplies last-4 annual actuals; this logs the
// actual arrays for both companies in each build + the projected forward estimates the new line chart
// will plot (actuals solid, FY+1..+3 dashed). Notes any missing years.
import http from 'http';
const g = (p) => new Promise((res) => {
  http.get('http://localhost:3001' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', () => res(null));
});
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function project(hist) {
  if (!hist || hist.length < 1) return [];
  const last = hist[hist.length - 1], prev = hist[hist.length - 2];
  let gr = prev && prev.revenue > 0 ? last.revenue / prev.revenue - 1 : 0.10;
  gr = clamp(gr, 0, 0.35);
  const out = []; let v = last.revenue, fy = last.fy;
  for (let k = 1; k <= 3; k++) { const fade = gr * Math.pow(0.85, k - 1); v = v * (1 + fade); out.push({ fy: fy + k, revenue: Math.round(v), est: true }); }
  return out;
}

const BUILDS = [['CRM', 'TEAM'], ['MSFT', 'ADBE'], ['GOOGL', 'HUBS']];
for (const [acq, tgt] of BUILDS) {
  console.log(`\n===== BUILD ${acq} / ${tgt} =====`);
  for (const t of [acq, tgt]) {
    const q = await g('/quote?symbol=' + t);
    const h = q?.revenueHistory || [];
    const years = h.map(e => e.fy);
    const gaps = years.length >= 2 ? Array.from({ length: years[years.length - 1] - years[0] + 1 }, (_, i) => years[0] + i).filter(y => !years.includes(y)) : [];
    const est = project(h);
    console.log(`  ${t.padEnd(6)} ACTUAL  ${h.map(e => `FY${String(e.fy).slice(2)}:${(e.revenue / 1000).toFixed(1)}B`).join(' ')}`);
    console.log(`  ${''.padEnd(6)} EST     ${est.map(e => `FY${String(e.fy).slice(2)}E:${(e.revenue / 1000).toFixed(1)}B`).join(' ')}`);
    if (gaps.length) console.log(`  ${''.padEnd(6)} ⚠ missing actual year(s): ${gaps.map(y => 'FY' + String(y).slice(2)).join(', ')} (concept changed across filings; line bridges)`);
  }
}
