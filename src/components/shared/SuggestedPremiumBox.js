import { DEFAULT_PREMIUM_PCT, offerFromPremium } from '../../lib/offerPremium';
import { fmtPerShare } from '../deck/shared/deckTokens';

function Option({ label, offer, detail, onUse, testId }) {
  return (
    <div data-testid={testId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '5px 0' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0F2244' }}>{label}</div>
        <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.35 }}>
          {offer != null ? `${fmtPerShare(offer)}/share` : null}{offer != null && detail ? ' · ' : ''}{detail}
        </div>
      </div>
      {onUse && (
        <button onClick={onUse} style={{ background: '#0F2244', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer', flexShrink: 0 }}>
          Use this
        </button>
      )}
    </div>
  );
}

// Two starting points for the premium. The default is plain arithmetic on the spot price. The second is solved
// from this deal's own model, and shows "—" with the reason when it can't be.
export function SuggestedPremiumBox({ spot, solve, onUse }) {
  const defaultOffer = offerFromPremium(spot, DEFAULT_PREMIUM_PCT);
  const solved = solve.premium != null;
  return (
    <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, padding: '5px 10px', marginBottom: 10 }}>
      <Option testId="premium-default" label={`Default · ${DEFAULT_PREMIUM_PCT}%`} offer={defaultOffer}
        detail={defaultOffer == null ? 'no live price' : null}
        onUse={defaultOffer != null ? () => onUse(DEFAULT_PREMIUM_PCT) : null} />
      <div style={{ borderTop: '1px solid #BFDBFE' }} />
      <Option testId="premium-accretive" label={`Highest premium still accretive in Year 2 · ${solved ? `${solve.premium}%` : '—'}`}
        offer={solved ? solve.offer : null}
        detail={solved
          ? (solve.atLimit ? 'Still accretive at the slider\'s 100% limit, so the true limit may be higher.' : 'Solved from this deal\'s model, in whole percents.')
          : solve.reason}
        onUse={solved ? () => onUse(solve.premium) : null} />
    </div>
  );
}
