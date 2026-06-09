// DIAGNOSTIC (visual-QA defect): the runtime-derived source PROSE names non-headline feeds
// (Yahoo/Finnhub) whenever they incidentally agree on a verified field. This is non-deterministic
// (Yahoo rate-limits, so it appears in one build and not another — exactly what the MSFT/ADBE §14
// render showed: "CNBC, Nasdaq and Yahoo Finance for live pricing") and violates the spec's
// "render CNBC/Nasdaq, not Yahoo/Finnhub/FMP". Prove composeSourceLine emits "Yahoo Finance" when a
// price field has a transient yahoo cross-check in sourceMeta.
import { composeSourceLine } from '../src/lib/composeSourceLine.js';

// A price field exactly as the verified layer returns it when Yahoo happens to respond and agree.
const fieldsWithYahoo = {
  price: {
    status: 'verified', chosenSource: 'cnbc',
    sourceMeta: {
      cnbc:   { value: 411.74, asOf: '2026-06-09', period: null },
      nasdaq: { value: 411.70, asOf: '2026-06-09', period: null },
      yahoo:  { value: 411.74, asOf: '2026-06-09', period: null },
    },
  },
};
// Same field when Yahoo is rate-limited (the other build) — only cnbc + nasdaq.
const fieldsNoYahoo = {
  price: { status: 'verified', chosenSource: 'cnbc', sourceMeta: {
    cnbc: { value: 411.74, asOf: '2026-06-09' }, nasdaq: { value: 411.70, asOf: '2026-06-09' } } },
};

const a = composeSourceLine(['price'], fieldsWithYahoo, '2026-06-09');
const b = composeSourceLine(['price'], fieldsNoYahoo, '2026-06-09');
console.log('price WITH transient yahoo agree -> ', a);
console.log('price WITHOUT yahoo (rate-limited)-> ', b);
console.log('');
console.log('NON-DETERMINISM:', a !== b ? 'YES — same deck names different sources run-to-run' : 'no');
console.log('"Yahoo Finance" leaks into prose:', /Yahoo Finance/.test(a) ? 'YES (defect)' : 'no');
