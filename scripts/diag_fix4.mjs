// DIAGNOSTIC (Fix 4): prove the deck's source attribution is STALE/MISLEADING vs runtime tags.
//  (a) Data Verification appendix renders fixed columns EDGAR / FMP / Yahoo — but FMP & Yahoo
//      return nothing on the keyless stack, so those two columns are always empty dashes, while
//      the sources that actually provided data (CNBC, Nasdaq, StockAnalysis) get no column.
//  (b) §14 Sources hardcodes "Yahoo Finance and Finnhub" for live pricing — neither is the price
//      source at runtime (price = CNBC verified by Nasdaq).
import http from 'http';
import { readFileSync } from 'fs';
const g = (p) => new Promise((res, rej) => {
  http.get('http://localhost:3001' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', rej);
});

const APPENDIX_COLS = ['edgar', 'fmp', 'yahoo']; // SectionDataVerification.js current hardcoded columns
for (const t of ['CRM', 'TEAM']) {
  const v = await g('/api/verified/' + t);
  const f = v?.fields || {};
  const union = new Set();
  const colCounts = Object.fromEntries(APPENDIX_COLS.map(c => [c, 0]));
  for (const k in f) {
    Object.keys(f[k].sourceMeta || {}).forEach(s => { union.add(s); if (s in colCounts) colCounts[s]++; });
  }
  console.log(`=== ${t} ===`);
  console.log(`  sources ACTUALLY consulted (have data): ${[...union].sort().join(', ')}`);
  console.log(`  current appendix columns -> non-empty field count: ` +
    APPENDIX_COLS.map(c => `${c.toUpperCase()}=${colCounts[c]}`).join('  '));
  const dead = APPENDIX_COLS.filter(c => colCounts[c] === 0);
  const missingCols = [...union].filter(s => !APPENDIX_COLS.includes(s));
  console.log(`  DEAD columns (rendered, always empty): ${dead.map(c => c.toUpperCase()).join(', ') || 'none'}`);
  console.log(`  REAL sources with NO column: ${missingCols.join(', ') || 'none'}`);
  console.log('');
}

// (b) prove the §14 hardcoded pricing-source string is stale.
const src = readFileSync(new URL('../src/components/deck/sections/SectionSources.js', import.meta.url), 'utf8');
const staleHits = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /Yahoo Finance and Finnhub|FCF ≈ net income/.test(l));
console.log('§14 SectionSources stale hardcoded strings:');
staleHits.forEach(([n, l]) => console.log(`  L${n}: ${l.trim()}`));

// (c) prove the appendix FMP-licensing footnote is present (should be removed — FMP unused).
const dv = readFileSync(new URL('../src/components/deck/sections/SectionDataVerification.js', import.meta.url), 'utf8');
const fmpFoot = dv.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /FMP|Licensing Agreement/.test(l));
console.log('\nAppendix stale FMP footnote/columns:');
fmpFoot.forEach(([n, l]) => console.log(`  L${n}: ${l.trim()}`));
