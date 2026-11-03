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
