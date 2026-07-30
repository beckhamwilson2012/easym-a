import React from 'react';
import { SF_BLUE } from './shared/deckTokens';

export function DeckSidebar({ sections, activeIndex, onSelect, target }) {
  return (
    <div style={{
      width: 240, flexShrink: 0,
      background: '#fff', borderRight: '1px solid #E5E7EB',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {/* Section list */}
      <div style={{ flex: 1, padding: '8px 0' }}>
        {sections.map((section, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              key={section.id}
              onClick={() => onSelect(i)}
              style={{
                width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                padding: '9px 16px 9px 12px',
                background: isActive ? SF_BLUE : 'transparent',
                borderLeft: `3px solid ${isActive ? SF_BLUE : 'transparent'}`,
                display: 'flex', alignItems: 'center', gap: 10,
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#F3F4F6'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{
                flexShrink: 0, width: 18, height: 18, borderRadius: '50%',
                background: isActive ? 'rgba(255,255,255,0.25)' : '#E5E7EB',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700,
                color: isActive ? '#fff' : '#6B7280',
              }}>
                {i + 1}
              </span>
              <span style={{
                fontSize: 12, fontWeight: isActive ? 700 : 400,
                color: isActive ? '#fff' : '#374151',
                lineHeight: 1.3,
              }}>
                {section.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{
        padding: '12px 16px', borderTop: '1px solid #E5E7EB',
        background: '#F9FAFB',
      }}>
        <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 3 }}>
          {sections.length} sections
        </div>
        {target.ticker && (
          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: 0.5 }}>
            {target.ticker}
          </div>
        )}
        <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
          {target.name || 'Target Company'}
        </div>
      </div>
    </div>
  );
}
