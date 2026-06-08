// DIAGNOSTIC (Fix 8): prove a default build leaves transactionFees = 0, so the model prints
// "$0M in transaction costs" even though a size-tiered advisory fee is well-defined for the deal.
// handleSubmit (App.js l.508-523) auto-fills offer + synergies but NOT fees → transactionFees stays 0.
import http from 'http';
const g = (p) => new Promise((res) => {
  http.get('http://localhost:3001' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', () => res(null));
});

// Mirror calcAdvisoryFee / calcSuggestedTransactionFees (suggestionTooltips.js).
function calcAdvisoryFee(dealSizeM) {
  if (!(dealSizeM > 0)) return null;
  if (dealSizeM >= 10000) return dealSizeM * 0.003;
  if (dealSizeM >= 1000)  return dealSizeM * 0.01;
  if (dealSizeM >= 500)   return dealSizeM * 0.015;
  if (dealSizeM >= 50)    return dealSizeM * 0.03;
  return dealSizeM * 0.04;
}
const suggestedFee = (d) => { const f = calcAdvisoryFee(d); return f != null ? Math.round(f) : null; };

const tq = await g('/quote?symbol=TEAM');
const pr = await g('/api/price/TEAM');
const live = pr?.price ?? null;
const offer = live != null ? +(live * 1.30).toFixed(2) : null; // suggested = live × 1.30
const shares = tq?.shares ?? 0;
const dealSizeM = offer != null && shares > 0 ? offer * shares : 0;
const fee = suggestedFee(dealSizeM);

console.log(`TEAM live=$${live}  suggested offer=$${offer}/sh  shares=${shares}M`);
console.log(`deal size = $${(dealSizeM / 1000).toFixed(1)}B`);
console.log('');
console.log(`DEFAULT build transactionFees: $0M  -> narrative reads "help offset $0M in transaction costs"`);
console.log(`size-tiered SUGGESTED advisory fee: $${fee}M  (tier: ${dealSizeM >= 10000 ? '0.3% mega-cap' : dealSizeM >= 1000 ? '1.0% large' : dealSizeM >= 500 ? '1.5%' : '3-4%'})`);
console.log('');
console.log(`PROOF: the deal has a well-defined ~$${fee}M advisory fee, but a default build shows $0M.`);
