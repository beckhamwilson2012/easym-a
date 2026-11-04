import { PREMIUM_MIN, PREMIUM_MAX, impliedPremiumPct, sliderThumb } from '../../lib/offerPremium';

// Premium slider. Holds no state: the premium comes from the stored offer and the live spot price. A range
// input with step 1 can only sit on whole percents, so the readout carries the exact implied premium.
export function PremiumSlider({ spot, offer, loadingPrice, onPremiumChange }) {
  const premium = impliedPremiumPct(offer, spot);
  const noSpot = spot == null;
  const thumb = sliderThumb(premium);
  const outside = premium != null && (premium < PREMIUM_MIN || premium > PREMIUM_MAX);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <label htmlFor="premiumSlider" style={{ fontSize: 12, color: noSpot ? '#9CA3AF' : '#6B7280' }}>Premium to spot</label>
        <span data-testid="premium-readout" style={{ fontSize: 13, fontWeight: 700, color: noSpot ? '#9CA3AF' : '#0F2244' }}>
          {premium != null ? `${premium.toFixed(1)}%` : '—'}
        </span>
      </div>
      <input id="premiumSlider" name="premiumSlider" type="range" min={PREMIUM_MIN} max={PREMIUM_MAX} step={1}
        value={thumb} disabled={noSpot}
        onChange={(e) => onPremiumChange(parseInt(e.target.value, 10))}
        style={{
          width: '100%', height: 6, borderRadius: 3, cursor: noSpot ? 'not-allowed' : 'pointer',
          background: noSpot ? '#E5E7EB' : `linear-gradient(to right, #1a5fd0 ${thumb}%, #E5E7EB ${thumb}%)`,
        }} />
      {noSpot && (
        <div data-testid="no-live-price" style={{ fontSize: 11, color: '#6B7280', marginTop: 2, fontStyle: 'italic' }}>
          {loadingPrice ? 'Fetching live price…' : 'no live price'}
        </div>
      )}
      {outside && (
        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2, fontStyle: 'italic' }}>
          The offer implies {premium.toFixed(1)}%, outside the slider's {PREMIUM_MIN}–{PREMIUM_MAX}% range. The offer price stands.
        </div>
      )}
    </div>
  );
}
