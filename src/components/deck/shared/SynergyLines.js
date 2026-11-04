import React from 'react';
import { NAVY, GRAY_BORDER, ALT_ROW } from './deckTokens';
import { NONE_ENTERED, REVENUE_ONLY_FLAG, fmtSynergy, marginSentence } from '../../../lib/synergies';

// Cost, revenue and total on separate lines, Year 1-3. Display only: deal.synergies is lib/synergies' schedule.
export function SynergyLines({ deal, title = 'Synergies ($M)', style }) {
  const s = deal?.synergies;
  if (!s) return null;
  const line = (label, get, bold) => ({ label, cells: s.years.map(get), bold });
  const rows = [
    line('Cost synergies', (y) => fmtSynergy(y.cost)),
    line('Revenue synergies', (y) => fmtSynergy(y.revenue)),
    line('Total synergies (EBITDA impact)', (y) => (y.entered ? fmtSynergy(y.ebitda) : NONE_ENTERED), true),
  ];
  return (
    <div data-testid="synergy-lines" style={style}>
      <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ display: 'flex', background: NAVY, padding: '4px 8px' }}>
          <span style={{ flex: 2.2, color: '#fff', fontSize: 9.5, fontWeight: 700 }}>{title}</span>
          {s.years.map((y) => <span key={y.year} style={{ flex: 1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>Year {y.year}</span>)}
        </div>
        {rows.map((r, i) => (
          <div key={r.label} style={{ display: 'flex', padding: '3px 8px', background: i % 2 ? ALT_ROW : '#fff', borderTop: `1px solid ${GRAY_BORDER}` }}>
            <span style={{ flex: 2.2, fontSize: 9.5, color: r.bold ? NAVY : '#374151', fontWeight: r.bold ? 700 : 400 }}>{r.label}</span>
            {r.cells.map((c, j) => <span key={j} style={{ flex: 1, fontSize: 9.5, textAlign: 'right', color: r.bold ? NAVY : '#374151', fontWeight: r.bold ? 700 : 500 }}>{c}</span>)}
          </div>
        ))}
      </div>
      {s.anyRevenue && (
        <div data-testid="synergy-margin-note" style={{ marginTop: 3, fontSize: 9, fontStyle: 'italic', lineHeight: 1.35, color: s.revenueOnly ? '#92400E' : '#6B7280' }}>
          {s.revenueOnly ? `⚠ ${REVENUE_ONLY_FLAG} ` : 'Revenue synergies reach EBITDA at the combined gross margin. '}{marginSentence(s.margin)}
        </div>
      )}
    </div>
  );
}
