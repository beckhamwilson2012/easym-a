import { impliedPremiumPct } from '../../lib/offerPremium';
import { fmtEastern, fmtCalendarDate } from '../../lib/easternTime';
import { fmtPerShare } from '../deck/shared/deckTokens';

const fmtPremium = (p) => (p == null ? '—' : `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`);

function Tile({ label, value, sub, testId }) {
  return (
    <div data-testid={testId} style={{ flex: '1 1 0', minWidth: 96, background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, padding: '6px 8px' }}>
      <div style={{ fontSize: 10, color: '#6B7280', lineHeight: 1.25 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0F2244', margin: '2px 0' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#6B7280', lineHeight: 1.3 }}>{sub}</div>
    </div>
  );
}

// Spot, premium to spot, premium to the unaffected close. Every premium comes from the one helper, off the stored offer.
export function PriceTiles({ spot, quoteAsOf, retrievedAt, offer, unaffected, unaffectedDate, onUnaffectedDate }) {
  const asOf = fmtEastern(quoteAsOf);
  const retrieved = fmtEastern(retrievedAt);
  const spotSub = spot == null ? 'no live price'
    : asOf ? `as of ${asOf}`
    : retrieved ? `retrieved ${retrieved}; the source gives no quote time`
    : 'as-of time unavailable';
  let unaffectedSub;
  if (!unaffectedDate) unaffectedSub = 'enter a date below';
  else if (unaffected.loading) unaffectedSub = 'fetching close…';
  else if (unaffected.close != null) unaffectedSub = `vs ${fmtPerShare(unaffected.close)} close, ${fmtCalendarDate(unaffected.date)}`;
  else unaffectedSub = unaffected.reason || 'no historical price source';
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <Tile testId="tile-spot" label="Spot price" value={spot != null ? fmtPerShare(spot) : '—'} sub={spotSub} />
        <Tile testId="tile-premium" label="Premium today vs spot" value={fmtPremium(impliedPremiumPct(offer, spot))} sub={spot != null ? 'offer ÷ spot − 1' : 'no live price'} />
        <Tile testId="tile-unaffected" label="Premium vs unaffected price" value={fmtPremium(impliedPremiumPct(offer, unaffected.close))} sub={unaffectedSub} />
      </div>
      <label htmlFor="unaffectedDate" style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>Unaffected price date (optional)</label>
      <input id="unaffectedDate" name="unaffectedDate" type="date" value={unaffectedDate} onChange={(e) => onUnaffectedDate(e.target.value)}
        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 14, boxSizing: 'border-box', background: '#fff', color: unaffectedDate ? '#1a5fd0' : 'inherit' }} />
    </div>
  );
}
