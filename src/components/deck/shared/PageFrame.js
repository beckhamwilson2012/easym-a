import React from 'react';
import { SF_BLUE } from './deckTokens';

export function PageFrame({ children, pageNum, exhibitLabel, variant }) {
  const isCover = variant === 'cover';

  return (
    <div style={{
      position: 'relative',
      width: 850,
      minHeight: 620,
      background: isCover ? SF_BLUE : '#FFFFFF',
      boxSizing: 'border-box',
      overflow: 'hidden',
      fontFamily: 'Arial, Helvetica, sans-serif',
      boxShadow: '0 2px 16px rgba(0,0,0,0.12)',
    }}>
      {/* Diagonal watermark */}
      {!isCover && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', zIndex: 0, overflow: 'hidden',
        }}>
          <div style={{
            transform: 'rotate(-35deg)',
            fontSize: 72, fontWeight: 900,
            color: 'rgba(0,0,0,0.035)',
            whiteSpace: 'nowrap', letterSpacing: 8, userSelect: 'none',
          }}>
            DRAFT AND CONFIDENTIAL
          </div>
        </div>
      )}

      {/* Top accent bar */}
      {!isCover && <div style={{ height: 4, background: SF_BLUE, width: '100%' }} />}

      {/* DRAFT AND CONFIDENTIAL stamp */}
      {!isCover && (
        <div style={{
          position: 'absolute', top: 12, right: 16, zIndex: 10,
          color: '#DC2626', fontSize: 8, fontWeight: 700,
          letterSpacing: 1.5, textTransform: 'uppercase',
          border: '1px solid #DC2626', padding: '2px 5px', borderRadius: 2,
        }}>
          DRAFT &amp; CONFIDENTIAL
        </div>
      )}

      {/* Exhibit label */}
      {exhibitLabel && !isCover && (
        <div style={{
          position: 'absolute', top: 13, left: 16, zIndex: 10,
          color: '#9CA3AF', fontSize: 8, letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}>
          {exhibitLabel}
        </div>
      )}

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {children}
      </div>

      {/* Bottom bar */}
      {!isCover && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: 28, background: '#F9FAFB', borderTop: '1px solid #E5E7EB',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', zIndex: 10,
        }}>
          <span style={{ color: '#9CA3AF', fontSize: 8 }}>
            {pageNum ? `Page ${pageNum}` : ''}
          </span>
          <span style={{ color: '#9CA3AF', fontSize: 8, fontWeight: 600 }}>
            Easy<span style={{ color: SF_BLUE }}>M&A</span>
          </span>
        </div>
      )}
    </div>
  );
}
