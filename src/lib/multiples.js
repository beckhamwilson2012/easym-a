// One rule for every multiple the deck prints (Fix 10 Task 4). Comparables already applied it (P/E and EV/EBITDA
// above 100x → n/m); the Deal Summary tiles, Transaction Structure, Credit Stats, Exchange Ratio, Company Profiles and
// Target Profile each had their own, or none, and printed EV/EBITDA 17,336.7x and Debt/EBITDA 2,143.3x for NET/DDOG.
//
//   numerator or denominator unavailable → "—" (absent, never 0)
//   denominator zero or negative         → "n/m", with the reason
//   |multiple| above MULTIPLE_CAP        → "n/m", with the reason (a near-zero denominator)
//   otherwise                            → the multiple, one decimal, "x"
// A negative multiple with a positive denominator (net cash ÷ EBITDA) is a real figure and is printed.
// Interest coverage is not a valuation or leverage multiple and does not use this rule.

export const MULTIPLE_CAP = 100;
export const RULE_TEXT = `Every multiple is n/m when its denominator is zero or negative, or when it is above ${MULTIPLE_CAP}x (a near-zero denominator).`;

const toNum = (v) => { if (v == null || v === '' || v === 'N/A') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// num ÷ den under the rule. denName names the denominator in the reason ("Target EBITDA", "Target EPS", …).
export function multipleOf(num, den, { denName = 'the denominator', suffix = 'x' } = {}) {
  const n = toNum(num), d = toNum(den);
  if (n == null || d == null) return { value: null, nm: false, text: '—', reason: null };
  if (!(d > 0)) return { value: null, nm: true, text: 'n/m', reason: `${denName} is ${d === 0 ? 'zero' : 'negative'}` };
  return capped(n / d, { denName, suffix });
}

// A ratio someone else divided (FMP's evToEBITDA): only the cap and the sign of the result can be checked.
export function multipleFromRatio(v, { denName = 'the denominator', suffix = 'x', nonPositiveReason } = {}) {
  const x = toNum(v);
  if (x == null) return { value: null, nm: false, text: '—', reason: null };
  if (!(x > 0)) return { value: null, nm: true, text: 'n/m', reason: nonPositiveReason || `${denName} is zero or negative` };
  return capped(x, { denName, suffix });
}

function capped(x, { denName, suffix }) {
  if (Math.abs(x) > MULTIPLE_CAP) return { value: null, nm: true, text: 'n/m', reason: `above ${MULTIPLE_CAP}x (${denName} is near zero)`, raw: x };
  return { value: x, nm: false, text: `${x.toFixed(1)}${suffix}`, reason: null };
}
