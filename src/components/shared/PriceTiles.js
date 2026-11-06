import { useState } from 'react';
import { impliedPremiumPct, PRICE_BASIS_TODAY, PRICE_BASIS_BEFORE } from '../../lib/offerPremium';
import { fmtEastern, fmtCalendarDate } from '../../lib/easternTime';
import { fmtPerShare } from '../deck/shared/deckTokens';

const fmtPremium = (p) => (p == null ? '—' : `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`);

export const BEFORE_NEWS_INFO = 'Pick the last trading day before rumors or the announcement. After news breaks, the target\'s price moves toward the offer, so bankers measure the premium against the price before.';

function Tile({ label, value, sub, testId }) {
  return (
    <div data-testid={testId} style={{ flex: '1 1 0', minWidth: 96, background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, padding: '6px 8px' }}>
      <div style={{ fontSize: 10, color: '#6B7280', lineHeight: 1.25 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0F2244', margin: '2px 0' }}>{value}</div>
      <div style={{ fontSize: 10, color: '#6B7280', lineHeight: 1.3 }}>{sub}</div>
    </div>
  );
}

function BasisButton({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      style={{ flex: 1, padding: '6px 8px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid #0F2244',
        background: active ? '#0F2244' : '#fff', color: active ? '#fff' : '#0F2244' }}>
      {children}
    </button>
  );
}

// Spot, the reference price, and the premium against it. Every premium comes from the one helper, off the stored offer
// and the one reference price (App.js referencePrice). The toggle picks that reference; this component computes nothing.
export function PriceTiles({ spot, quoteAsOf, retrievedAt, offer, basis, onBasis, referenceDate, onReferenceDate, beforeClose, referencePrice }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const asOf = fmtEastern(quoteAsOf);
  const retrieved = fmtEastern(retrievedAt);
  const spotSub = spot == null ? 'no live price'
    : asOf ? `as of ${asOf}`
    : retrieved ? `retrieved ${retrieved}; the source gives no quote time`
    : 'as-of time unavailable';
  const before = basis === PRICE_BASIS_BEFORE;
  let beforeSub = null;
  if (before) {
    if (!referenceDate) beforeSub = 'pick a date below; the offer stays on today\'s price';
    else if (beforeClose.loading) beforeSub = 'fetching close…';
    else if (beforeClose.close != null) beforeSub = `close on ${fmtCalendarDate(beforeClose.date)}`;
    else beforeSub = `${beforeClose.reason || 'no historical price source'}; the offer stays on today's price`;
  }
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <Tile testId="tile-spot" label="Spot price" value={spot != null ? fmtPerShare(spot) : '—'} sub={spotSub} />
        {before ? (
          <>
            <Tile testId="tile-reference" label="Price on a date" value={beforeClose.close != null ? fmtPerShare(beforeClose.close) : '—'} sub={beforeSub} />
            <Tile testId="tile-premium" label="Premium vs price on a date" value={fmtPremium(impliedPremiumPct(offer, beforeClose.close))} sub={beforeClose.close != null ? 'offer ÷ close − 1' : beforeSub} />
          </>
        ) : (
          <Tile testId="tile-premium" label="Premium today vs spot" value={fmtPremium(impliedPremiumPct(offer, referencePrice))} sub={spot != null ? 'offer ÷ spot − 1' : 'no live price'} />
        )}
      </div>
      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>Premium measured against</div>
      <div role="group" aria-label="Premium measured against" style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', marginBottom: before ? 8 : 0 }}>
        <BasisButton active={!before} onClick={() => onBasis(PRICE_BASIS_TODAY)}>Today's price</BasisButton>
        <BasisButton active={before} onClick={() => onBasis(PRICE_BASIS_BEFORE)}>Price on a date</BasisButton>
      </div>
      {before && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <label htmlFor="referenceDate" style={{ fontSize: 12, color: '#6B7280' }}>Date</label>
            <button type="button" data-testid="reference-info-toggle" onClick={() => setInfoOpen(v => !v)} aria-expanded={infoOpen}
              style={{ background: 'none', border: 'none', color: '#0070D2', fontSize: 12, cursor: 'pointer', padding: 0 }}>ⓘ</button>
          </div>
          {infoOpen && (
            <div data-testid="reference-info" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6, padding: '6px 10px', marginBottom: 6, fontSize: 12, color: '#374151', lineHeight: 1.4 }}>
              {BEFORE_NEWS_INFO}
            </div>
          )}
          <input id="referenceDate" name="referenceDate" type="date" value={referenceDate} onChange={(e) => onReferenceDate(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 14, boxSizing: 'border-box', background: '#fff', color: referenceDate ? '#1a5fd0' : 'inherit' }} />
        </>
      )}
    </div>
  );
}
