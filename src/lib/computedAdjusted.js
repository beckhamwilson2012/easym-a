import { TAX_RATE } from './taxRate.js';

// The ONE computed adjusted (non-GAAP) calculation (Fix 13). Used only where a company's own reconciliation has no figure
// for the period (src/lib/reportingBasis.js decides that; a company-reported figure always wins). Its inputs are filed
// facts, resolved server-side by server/services/adjustedComponents.js and carried in /api/nongaap's `computed`.
//
//   Adjusted net income = GAAP net income + stock-based compensation + amortization of acquired intangibles
//                         + one-time items (restructuring, impairment, acquisition/integration, litigation settlements)
//                         − tax effect of those add-backs
//   Adjusted EBITDA     = GAAP operating income + D&A (the deck's EBITDA) + stock-based compensation + the same one-time items
//   Adjusted EPS        = adjusted net income ÷ the diluted share count Year 1 already uses (passed in; never re-derived)
//
// Tax effect: the company's own non-GAAP tax rate if its release discloses one for the year; otherwise none when the 10-K tax
// note states a full valuation allowance; otherwise the app's TAX_RATE.
// Required: net income (operating income / EBITDA for EBITDA) and stock-based compensation. Either missing → null with the
// reason ("—"). An item that is not tagged is not added and is listed as not found. Nothing is ever 0 by default.

export const COMPUTED_BY = 'Computed by EasyM&A';
const fin = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const pct = (r) => `${+(r * 100).toFixed(1)}%`;
const m1 = (v) => {   // accounting style, as the deck prints money: $80.4M, ($528.3M)
  const t = `$${(Math.round(Math.abs(v) * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
  return v < 0 && Math.round(Math.abs(v) * 10) !== 0 ? `(${t})` : t;
};

// The rate the tax effect is computed at, and why.
export function taxBasisOf(c) {
  const t = (c && c.tax) || { basis: 'default' };
  if (t.basis === 'disclosed' && fin(t.rate) != null) return { rate: fin(t.rate), basis: 'disclosed', note: `the company’s own non-GAAP tax rate${t.accession ? ` (earnings release ${t.accession})` : ''}` };
  if (t.basis === 'valuation allowance') return { rate: 0, basis: 'valuation allowance', note: `no tax effect: full valuation allowance on deferred tax assets (10-K tax note${t.accession ? `, ${t.accession}` : ''})` };
  return { rate: TAX_RATE, basis: 'default', note: `the app’s ${pct(TAX_RATE)} tax rate (no company non-GAAP rate disclosed, no full valuation allowance)` };
}

// The label every slide shows beside a computed figure.
export function computedLabel(c) {
  const t = taxBasisOf(c);
  const why = t.basis === 'valuation allowance' ? ' (full valuation allowance)' : t.basis === 'disclosed' ? ' (company’s own non-GAAP rate)' : '';
  return `${COMPUTED_BY}: GAAP + stock comp + amortization + one-time items, tax at ${pct(t.rate)}${why}`;
}

// Pure. c: one period of /api/nongaap `computed` (fy or ltm). dilutedShares: the Year 1 diluted count (M).
export function computeAdjusted(c, { dilutedShares = null } = {}) {
  const none = (why) => ({ computed: true, period: c?.period || null, label: null, netIncome: null, netIncomeReason: why, ebitda: null, ebitdaReason: why, eps: null, epsReason: why, addBacks: [], notFound: [] });
  if (!c) return none('no filed inputs for a computed figure');
  const tax = taxBasisOf(c);
  const sbc = c.sbc && fin(c.sbc.value) != null ? c.sbc : null;
  const amort = c.amortization && fin(c.amortization.value) != null ? c.amortization : null;
  const oneTime = (c.oneTime || []).filter((x) => fin(x.value) != null);
  const notFound = [...(amort ? [] : ['amortization of acquired intangibles']), ...(c.oneTimeNotFound || [])];
  const addBacks = [...(sbc ? [sbc] : []), ...(amort ? [amort] : []), ...oneTime].map((x) => ({ key: x.key, label: x.label, value: fin(x.value), concept: x.concept }));
  const sbcReason = sbc ? null : (c.sbcReason || 'stock-based compensation is not tagged for the period');

  // Net income.
  const ni = fin(c.netIncome);
  let netIncome = null, netIncomeReason = null, taxEffect = null;
  if (ni == null) netIncomeReason = 'GAAP net income is not available for the period';
  else if (!sbc) netIncomeReason = sbcReason;
  else {
    const pre = addBacks.reduce((s, x) => s + x.value, 0);   // the found add-backs only; an untagged item is not in the list
    taxEffect = pre * tax.rate;
    netIncome = ni + pre - taxEffect;
  }

  // EBITDA (pre-tax; amortization is already inside D&A).
  const oi = fin(c.operatingIncome), eb = fin(c.ebitda);
  let ebitda = null, ebitdaReason = null;
  if (oi == null) ebitdaReason = 'GAAP operating income is not available for the period';
  else if (eb == null) ebitdaReason = c.ebitdaReason || 'GAAP EBITDA (operating income + D&A) is not available for the period';
  else if (!sbc) ebitdaReason = sbcReason;
  else ebitda = addBacks.filter((x) => x.key !== 'amortization').reduce((s, x) => s + x.value, eb);

  // EPS on the Year 1 share count.
  const sh = fin(dilutedShares);
  let eps = null, epsReason = null;
  if (netIncome == null) epsReason = netIncomeReason;
  else if (!(sh > 0)) epsReason = 'no Year 1 diluted share count';
  else eps = netIncome / sh;

  return {
    computed: true, period: c.period || null, label: computedLabel(c),
    taxRate: tax.rate, taxBasis: tax.basis, taxNote: tax.note, taxEffect,
    gaapNetIncome: ni, gaapEbitda: eb,
    netIncome, netIncomeReason, ebitda, ebitdaReason, eps, epsReason, dilutedShares: sh,
    addBacks, notFound,
  };
}

// One line naming what went in, for footnotes: "stock-based compensation $80.4M (ShareBasedCompensation); …; not found: …".
// { ebitda: true }: the EBITDA add-backs only (no amortization, which is inside D&A, and no tax effect: EBITDA is pre-tax).
export function computedComponentsText(r, { ebitda = false } = {}) {
  if (!r || !r.label) return null;
  const found = r.addBacks.filter((x) => !ebitda || x.key !== 'amortization').map((x) => `${x.label} ${m1(x.value)} (${x.concept})`).join('; ');
  const taxText = r.taxEffect === 0 ? '$0' : r.taxEffect > 0 ? `(${m1(r.taxEffect)})` : `+${m1(-r.taxEffect)}`;   // a deduction prints in parentheses
  const tax = !ebitda && r.taxEffect != null ? `; tax effect ${taxText}: ${r.taxNote}` : '';
  const notFound = r.notFound.filter((x) => !ebitda || x !== 'amortization of acquired intangibles');
  const base = ebitda ? (r.gaapEbitda != null ? `GAAP EBITDA ${m1(r.gaapEbitda)}; ` : '') : (r.gaapNetIncome != null ? `GAAP net income ${m1(r.gaapNetIncome)}; ` : '');
  return `${r.period?.label || ''}: ${base}${found}${tax}${notFound.length ? `; not tagged, not added: ${notFound.join(', ')}` : ''}`;
}
