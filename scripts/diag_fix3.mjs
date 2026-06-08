// DIAGNOSTIC (Fix 3): prove §10 Relative Contribution consumes the net-income PROXY for Free Cash
// Flow even though a real fetched FCF is available from EDGAR, using REAL CRM/TEAM values.
//   §10 today: aFCF = acquirer.netIncome ; bFCF = target.netIncome   (SectionRelativeContribution.js l.35-36)
//   available: fields.freeCashFlow.value from /api/verified/:ticker
import http from 'http';
const g = (p) => new Promise((res, rej) => {
  http.get('http://localhost:3001' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', rej);
});

const f = (v) => v == null ? '—' : (Math.abs(v) >= 1000 ? '$' + (v / 1000).toFixed(2) + 'B' : '$' + Math.round(v) + 'M');

// §10's splitContribution guard (copied verbatim from SectionRelativeContribution.js l.14-22).
function split(a, b) {
  const aNum = parseFloat(a) || 0, bNum = parseFloat(b) || 0, total = aNum + bNum;
  if (total <= 0 || aNum < 0 || bNum < 0) return { aPct: null, bPct: null, nm: true };
  return { aPct: (aNum / total) * 100, bPct: (bNum / total) * 100, nm: false };
}

const acq = 'CRM', tgt = 'TEAM';
const va = await g('/api/verified/' + acq);
const vt = await g('/api/verified/' + tgt);
const aNI  = va?.fields?.netIncome?.value ?? null;
const bNI  = vt?.fields?.netIncome?.value ?? null;
const aFCF = va?.fields?.freeCashFlow?.value ?? null;
const bFCF = vt?.fields?.freeCashFlow?.value ?? null;

console.log(`acq=${acq}  netIncome(proxy)=${f(aNI)}   fetchedFCF=${f(aFCF)} [${va?.fields?.freeCashFlow?.status ?? 'ABSENT'}/${va?.fields?.freeCashFlow?.sot ?? '—'}]`);
console.log(`tgt=${tgt} netIncome(proxy)=${f(bNI)}   fetchedFCF=${f(bFCF)} [${vt?.fields?.freeCashFlow?.status ?? 'ABSENT'}/${vt?.fields?.freeCashFlow?.sot ?? '—'}]`);
console.log('');

const cur = split(aNI, bNI);   // what §10 consumes TODAY (net-income proxy)
const fix = split(aFCF, bFCF); // what §10 WOULD show with fetched FCF
const pct = (s) => s.nm ? 'n/m (split not meaningful)' : `${s.aPct.toFixed(1)}% / ${s.bPct.toFixed(1)}%`;
console.log(`§10 FCF row CONSUMED today (netIncome proxy): ${acq} / ${tgt} = ${pct(cur)}`);
console.log(`§10 FCF row WITH fetched FCF (proposed fix):   ${acq} / ${tgt} = ${pct(fix)}`);
console.log('');
console.log(`PROOF: target ${tgt} fetched FCF is ${f(bFCF)} (POSITIVE) but proxy netIncome is ${f(bNI)} ` +
            `(${bNI < 0 ? 'NEGATIVE → forces n/m' : 'differs'}). The proxy overrides real FCF.`);
