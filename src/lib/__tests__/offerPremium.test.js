import { offerFromPremium, impliedPremiumPct, sliderThumb, formatOfferInput, liveSpot } from '../offerPremium';

describe('offer and premium', () => {
  test('30% gives spot × 1.30 exactly', () => {
    expect(offerFromPremium(43.87, 30)).toBe(43.87 * 1.3);
    expect(offerFromPremium(220.52, 30)).toBe(220.52 * 1.3);
  });

  test('no live price gives no offer, never a default', () => {
    for (const spot of [null, undefined, 0, '', NaN, -5]) expect(offerFromPremium(spot, 30)).toBeNull();
    for (const spot of [null, 0, '']) expect(liveSpot(spot)).toBeNull();
  });

  test('premium is derived from the offer and round-trips', () => {
    for (let p = 0; p <= 100; p++) {
      const offer = offerFromPremium(43.87, p);
      expect(impliedPremiumPct(offer, 43.87)).toBeCloseTo(p, 9);
      expect(sliderThumb(impliedPremiumPct(offer, 43.87))).toBe(p);
    }
  });

  test('absent offer or spot is null, not 0%', () => {
    expect(impliedPremiumPct(0, 43.87)).toBeNull();
    expect(impliedPremiumPct(50, 0)).toBeNull();
    expect(impliedPremiumPct(null, null)).toBeNull();
  });

  test('only the thumb clamps; the premium keeps its real value', () => {
    expect(impliedPremiumPct(100, 40)).toBeCloseTo(150, 9);
    expect(sliderThumb(150)).toBe(100);
    expect(impliedPremiumPct(30, 40)).toBeCloseTo(-25, 9);
    expect(sliderThumb(-25)).toBe(0);
  });

  test('the offer field shows no float noise and leaves absent blank', () => {
    expect(formatOfferInput(346.86600000000004)).toBe('346.866');
    expect(formatOfferInput(0)).toBe('');
    expect(formatOfferInput(null)).toBe('');
  });
});

describe('premium reference price', () => {
  const { premiumReference, PRICE_BASIS_TODAY, PRICE_BASIS_BEFORE } = require('../offerPremium');
  test("today's price is the spot, whatever close is loaded", () => {
    expect(premiumReference({ basis: PRICE_BASIS_TODAY, spot: 42.02, beforeClose: 30 })).toEqual({ price: 42.02, beforeNews: false });
  });
  test('price on a date uses that close, and the offer is that close × (1 + premium) exactly', () => {
    const ref = premiumReference({ basis: PRICE_BASIS_BEFORE, spot: 42.02, beforeClose: 31.5 });
    expect(ref).toEqual({ price: 31.5, beforeNews: true });
    expect(offerFromPremium(ref.price, 30)).toBe(31.5 * 1.3);
  });
  test('no historical close: the reference stays on today, never a default', () => {
    expect(premiumReference({ basis: PRICE_BASIS_BEFORE, spot: 42.02, beforeClose: null })).toEqual({ price: 42.02, beforeNews: false });
    expect(premiumReference({ basis: PRICE_BASIS_BEFORE, spot: null, beforeClose: null })).toEqual({ price: null, beforeNews: false });
  });
});
