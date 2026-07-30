import React from 'react';
import { SF_BLUE } from './deckTokens';

export function PageHeader({ title, subtitle }) {
  return (
    <div style={{
      background: SF_BLUE,
      padding: '14px 24px 12px',
    }}>
      <div style={{ color: '#fff', fontSize: 17, fontWeight: 700, letterSpacing: 0.2 }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11, marginTop: 3 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
