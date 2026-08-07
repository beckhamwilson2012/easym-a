import React from 'react';
import { NAVY, SF_BLUE, isBankDeal } from './shared/deckTokens';

export function DeckToolbar({ target, acquirer, onExport, exporting }) {
  const bankMode = isBankDeal(target, acquirer);

  return (
    <div style={{
      height: 56, background: NAVY,
      display: 'flex', alignItems: 'center',
      padding: '0 20px', gap: 16, flexShrink: 0,
      borderBottom: '1px solid rgba(255,255,255,0.1)',
      position: 'sticky', top: 0, zIndex: 20,
    }}>
      {/* Left: EasyM&A wordmark */}
      <a href="https://easy-ma.netlify.app" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
        <div style={{ fontSize: 17, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px', flexShrink: 0 }}>
          Easy<span style={{ color: '#4A9FD4' }}>M&A</span>
        </div>
      </a>

      {/* Bank M&A Mode badge */}
      {bankMode && (
        <div style={{
          background: '#1B4B8A', border: '1px solid #3B82F6',
          borderRadius: 4, padding: '3px 8px',
          fontSize: 11, fontWeight: 700, color: '#93C5FD',
          letterSpacing: 0.3, flexShrink: 0,
        }}>
          Bank M&A Mode
        </div>
      )}

      {/* Center: title */}
      <div style={{ flex: 1, textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        Target Company Profile
        {target.name && (
          <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}> · {target.name}</span>
        )}
      </div>

      {/* Right: Export button */}
      <button
        onClick={onExport}
        disabled={exporting}
        style={{
          background: exporting ? '#374151' : SF_BLUE, color: '#fff', border: 'none',
          borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600,
          cursor: exporting ? 'wait' : 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
          opacity: exporting ? 0.7 : 1,
        }}
      >
        {exporting ? '⟳ Generating PDF…' : '⬇ Export Full Deck as PDF'}
      </button>
    </div>
  );
}
