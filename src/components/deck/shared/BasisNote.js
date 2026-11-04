import React from 'react';
import { NAVY } from './deckTokens';
import { DIFFERENT_BASES } from '../../../lib/companyBasis';

// The basis line each slide with company historicals carries. It states what was selected, and for slides whose
// figures do not follow the card, passes `fixed` to say what they use instead. Private companies carry no label.
export function BasisNote({ acquirer, target, deal, only, fixed, style }) {
  const part = (co) => (co?.basisLabel ? `${co.ticker || co.name} ${co.basisLabel}` : null);
  const parts = (only ? [only] : [acquirer, target]).map(part).filter(Boolean);
  if (!parts.length && !fixed) return null;
  const note = only ? null : deal?.combination?.note;
  return (
    <div data-testid="basis-note" style={{ fontSize: 9, color: '#6B7280', lineHeight: 1.4, ...style }}>
      {parts.length > 0 && <><strong style={{ color: NAVY }}>Basis used: </strong>{parts.join('; ')}. </>}
      {fixed ? <>{fixed} </> : null}
      {note === DIFFERENT_BASES && <strong style={{ color: '#92400E' }}>Combined figures from these periods show "—": {DIFFERENT_BASES}.</strong>}
      {note && note !== DIFFERENT_BASES && <strong style={{ color: '#92400E' }}>Combined figures add the two as shown: {note}.</strong>}
    </div>
  );
}
