// DIAGNOSTIC (Fix B): the deck's "as of" dates come from THREE different fields formatted THREE
// different ways, so they can resolve to different dates (the visual pass saw body "June 9" vs §15
// "Jun 8"):
//   body  (composeSourceLine): formatDate(price.sourceMeta[chosen].asOf)  -> noon-UTC, date-string  (tz-SAFE)
//   §15   (SectionDataVerification): new Date(bundle.data.asOf).toLocaleDateString()  -> LOCAL tz on a full ISO timestamp (tz-SENSITIVE)
//   §12   (SectionAnalystConsensus): raw `meanField.asOf`  -> ISO string, no formatting
import http from 'http';
const g = (p) => new Promise((res) => {
  http.get('http://localhost:3001' + p, r => { let d = ''; r.on('data', c => d += c).on('end', () => { try { res(JSON.parse(d)); } catch { res(null); } }); }).on('error', () => res(null));
});
// the deck's body formatter (composeSourceLine.formatDate)
const formatDate = (isoDate) => new Date(isoDate + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
// the deck's §15 formatter
const fmt15 = (iso) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

const v = await g('/api/verified/TEAM');
const priceAsOf   = v?.fields?.price?.sourceMeta?.[v.fields.price.chosenSource]?.asOf;  // body source
const bundleAsOf  = v?.asOf;                                                            // §15 source
const analystAsOf = v?.fields?.analystTargetMean?.sourceMeta?.[v.fields.analystTargetMean.chosenSource]?.asOf; // §12 source

console.log('THREE date sources (TEAM):');
console.log(`  body  price.asOf   = ${priceAsOf}   -> renders "${formatDate(priceAsOf)}"`);
console.log(`  §15   bundle.asOf  = ${bundleAsOf}  -> renders "${fmt15(bundleAsOf)}"`);
console.log(`  §12   analyst.asOf = ${analystAsOf} -> renders "as of ${analystAsOf}" (raw ISO, unformatted)`);
console.log('');
console.log('SKEW DEMONSTRATION — same logical day, a near-midnight-UTC bundle timestamp:');
for (const ts of ['2026-06-09T01:30:00.000Z', '2026-06-08T23:45:00.000Z']) {
  console.log(`  bundle.asOf=${ts}  -> §15 toLocaleDateString="${fmt15(ts)}"  vs body formatDate(date-portion "${ts.slice(0,10)}")="${formatDate(ts.slice(0,10))}"  ${fmt15(ts) !== formatDate(ts.slice(0,10)).replace('June','Jun') ? '<-- DATES DISAGREE' : ''}`);
}
console.log('');
console.log('ROOT CAUSE: different source FIELDS (price vs bundle vs analyst) + a tz-sensitive formatter in §15 -> day-level skew. Fix: one build date, one tz-safe formatter, everywhere.');
