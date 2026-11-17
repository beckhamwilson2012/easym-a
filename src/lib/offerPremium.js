import { acquisitionNewDebt, acquirerSharePrice, acquirerDilutedShares, epsAccretionPct, forwardYearInputs } from '../utils/dealCalc';
import { year1Test } from './dealVerdict';   // Fix 17 Task 6: the verdict's own Year 1 test

// Offer price and premium on the input page. The stored offer (inputs.offerPricePerShare) is the only source
// of truth. The premium is always derived from it, so the slider and the offer field cannot disagree.

export const DEFAULT_PREMIUM_PCT = 30;
export const PREMIUM_MIN = 0;
export const PREMIUM_MAX = 100;

const positive = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// The live spot price, or null when there is none. A 0 in inputs means "no price", never a $0 stock.
export const liveSpot = (v) => positive(v);

// The price the premium is measured against. Today's price by default; with "Price on a date" it is that
// day's close, but only once a close exists. Without one the reference stays on today's price, never a default.
export const PRICE_BASIS_TODAY = 'today';
export const PRICE_BASIS_BEFORE = 'before';
export function premiumReference({ basis, spot, beforeClose }) {
  const close = positive(beforeClose);
  if (basis === PRICE_BASIS_BEFORE && close != null) return { price: close, beforeNews: true };
  return { price: liveSpot(spot), beforeNews: false };
}

// offer = spot × (1 + premium). Null without a live price: an offer is never defaulted from anything else.
export function offerFromPremium(spot, premiumPct) {
  const s = positive(spot);
  const p = parseFloat(premiumPct);
  if (s == null || !Number.isFinite(p)) return null;
  return s * (1 + p / 100);
}

// premium = offer / spot − 1, in percent. Null unless both are real, so "absent" never reads as 0%.
export function impliedPremiumPct(offer, spot) {
  const o = positive(offer);
  const s = positive(spot);
  if (o == null || s == null) return null;
  return (o / s - 1) * 100;
}

// Where the thumb sits. Only the thumb is clamped: the stored offer and the premium readout keep the real value.
export function sliderThumb(premiumPct) {
  if (premiumPct == null) return PREMIUM_MIN;
  return Math.min(PREMIUM_MAX, Math.max(PREMIUM_MIN, Math.round(premiumPct)));
}

// What the offer field shows. Display only, so float noise (346.86600000000004) stays out of the box.
export function formatOfferInput(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n !== 0 ? String(Number(n.toFixed(4))) : '';
}

// Year 2 on slide 8 is the first forward year: that year's consensus EPS with Year 2 synergies (Fix 19 Task 2).
export const firstForwardColumn = (pnl) => (pnl && Array.isArray(pnl.columns)) ? (pnl.columns.filter(c => !c.actual)[0] ?? null) : null;

// The highest whole-percent premium on the slider that is still accretive in the verdict's year, solved by running the
// deal's own accretion function at every step. Returns { premium, offer, accretionPct, atLimit, year } or
// { premium: null, reason, year }. Never estimates: any missing input ends in a reason.
// Fix 17 Task 6: the year is the verdict's (src/lib/dealVerdict.js): Year 1 when Year 1's EPS test computes (year1Test, the
// verdict's step 1), otherwise the forecast year the caller picked with verdictForwardSlot (`forwardYear`, e.g. "Year 2",
// with that year's synergy). It used to be Year 2 always, while the verdict used Year 1.
export function highestAccretivePremium({ calcInputs, spot, synergyY1, acquirerFwd, targetFwd, forwardReason, pnlLoading, acquirerName, targetName, forwardYear = 'Year 2', forwardSynergy }) {
  const A = acquirerName || 'The acquirer';
  const T = targetName || 'The target';
  if (liveSpot(spot) == null) return { premium: null, reason: `There is no live price for ${T}.`, year: null };
  // Year 1, exactly when the verdict uses it.
  if (synergyY1 != null && year1Test(offerFromPremium(spot, DEFAULT_PREMIUM_PCT), synergyY1, calcInputs)) {
    return solveOn('Year 1', calcInputs, synergyY1);
  }
  const Y = forwardYear;
  const none = (reason) => ({ premium: null, reason, year: Y });
  if (pnlLoading) return none('Forward estimates are still loading.');
  if (forwardReason) return none(`${Y} is “—”: ${forwardReason}.`);
  const aEps = acquirerFwd?.eps ?? null;
  const tEps = targetFwd?.eps ?? null;
  if (aEps == null) return none(`There is no ${Y} consensus EPS for ${A}.`);
  if (tEps == null) return none(`There is no ${Y} consensus EPS for ${T}.`);
  if (!(aEps > 0)) return none(`${A}'s ${Y} consensus EPS is ${aEps < 0 ? '−' : ''}$${Math.abs(aEps).toFixed(2)}. Accretion can't be measured from an EPS that isn't positive.`);
  if (acquirerSharePrice(calcInputs) == null) return none(`There is no live price for ${A}, so the new shares can't be counted.`);
  if (!(acquirerDilutedShares(calcInputs).shares > 0)) return none(`${A}'s diluted share count is missing.`);
  if (!(parseFloat(calcInputs.companyBShares) > 0)) return none(`${T}'s share count is missing.`);
  const syn = forwardSynergy !== undefined ? forwardSynergy : synergyY1;
  if (syn == null) return none('There is no Year 1 synergy figure.');
  if (acquisitionNewDebt(calcInputs, spot).newDebt == null) return none(`${T}'s total debt is unavailable, so the new debt and its interest can't be calculated.`);
  return solveOn(Y, forwardYearInputs(calcInputs, aEps, tEps), syn);

  function solveOn(year, yInputs, synergy) {
    const accretionAt = (p) => epsAccretionPct(offerFromPremium(spot, p), synergy, yInputs);
    for (let p = PREMIUM_MAX; p >= PREMIUM_MIN; p--) {
      const pct = accretionAt(p);
      if (pct != null && pct > 0) {
        return { premium: p, offer: offerFromPremium(spot, p), accretionPct: pct, atLimit: p === PREMIUM_MAX, year };
      }
    }
    const atZero = accretionAt(PREMIUM_MIN);
    const mix = `${parseFloat(calcInputs.cashPercent)}% cash`;
    if (atZero == null) return { premium: null, year, reason: `At ${mix}, pro forma ${year} EPS is not positive at any premium on the slider.` };
    return { premium: null, year, reason: `At ${mix}, the deal is dilutive in ${year} even at a 0% premium (${atZero.toFixed(1)}%).` };
  }
}
