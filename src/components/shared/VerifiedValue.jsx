import React, { useState } from 'react';

// Status glyph configuration
const GLYPH = {
  verified: { symbol: '✓', color: '#16A34A', bg: '#DCFCE7', label: 'Verified' },
  flagged:  { symbol: '⚠', color: '#B45309', bg: '#FEF3C7', label: 'Flagged'  },
  single:   { symbol: '–', color: '#6B7280', bg: '#F3F4F6', label: 'Single source' },
  missing:  { symbol: '?', color: '#DC2626', bg: '#FEE2E2', label: 'No data'   },
};

function formatValue(value, unit) {
  if (value == null) return '—';
  const n = parseFloat(value);
  if (isNaN(n)) return String(value);
  if (unit === '$/sh') return `$${n.toFixed(2)}`;
  if (unit === '$') return n >= 1000 ? `$${(n / 1000).toFixed(1)}B` : `$${n.toFixed(0)}M`;
  if (unit === 'sh') return `${n.toFixed(0)}M`;
  return String(value);
}

function SourceTooltip({ fieldResult }) {
  const { status, unit, sot, sourceMeta = {}, maxDev } = fieldResult;
  const g = GLYPH[status] || GLYPH.single;
  const entries = Object.entries(sourceMeta);

  return (
    <div style={{
      position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%',
      transform: 'translateX(-50%)',
      background: '#1F2937', color: '#fff', borderRadius: 8,
      padding: '10px 12px', minWidth: 240, fontSize: 11, lineHeight: 1.6,
      zIndex: 500, boxShadow: '0 6px 20px rgba(0,0,0,0.3)', pointerEvents: 'none',
    }}>
      {/* Status header */}
      <div style={{ fontWeight: 700, color: g.color, marginBottom: 6, fontSize: 12 }}>
        {g.label}
        {status === 'flagged' && maxDev != null && (
          <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.8 }}>
            ({(maxDev * 100).toFixed(2)}% gap)
          </span>
        )}
      </div>

      {/* Per-source rows */}
      {entries.length > 0 ? entries.map(([src, meta]) => (
        <div key={src} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 3 }}>
          <span style={{ opacity: 0.75 }}>
            {src.toUpperCase()}
            {src === sot && <span style={{ color: '#60A5FA', marginLeft: 4 }}>(SOT)</span>}
            {meta.period?.fy && (
              <span style={{ opacity: 0.55, marginLeft: 4 }}>FY{meta.period.fy}</span>
            )}
            {meta.period?.calendarYear && !meta.period?.fy && (
              <span style={{ opacity: 0.55, marginLeft: 4 }}>FY{meta.period.calendarYear}</span>
            )}
          </span>
          <span style={{ fontWeight: 600 }}>
            {meta.value != null ? formatValue(meta.value, unit) : '—'}
          </span>
        </div>
      )) : (
        <div style={{ opacity: 0.6 }}>No source data available</div>
      )}

      {/* As-of date from first available source */}
      {entries[0]?.[1]?.asOf && (
        <div style={{ marginTop: 6, opacity: 0.45, fontSize: 10 }}>
          as of {entries[0][1].asOf}
        </div>
      )}
    </div>
  );
}

/**
 * VerifiedValue — renders a number with a verification status glyph.
 *
 * Props:
 *   fieldResult  — the object from /api/verified/:ticker for this field
 *   displayValue — override the formatted display string (optional)
 *   compact      — smaller glyph, no background pill (for dense tables)
 *   pdfMode      — removes interactivity for PDF capture (just glyph inline)
 */
export function VerifiedValue({ fieldResult, displayValue, compact = false, pdfMode = false }) {
  const [show, setShow] = useState(false);

  if (!fieldResult) return <span>{displayValue ?? '—'}</span>;

  const { status, value, unit } = fieldResult;
  const g      = GLYPH[status] || GLYPH.single;
  const shown  = displayValue ?? formatValue(value, unit);

  const glyphEl = (
    <span style={{
      fontSize:   compact ? 9 : 10,
      color:      g.color,
      background: pdfMode || compact ? 'transparent' : g.bg,
      borderRadius: 3,
      padding: compact || pdfMode ? '0 1px' : '1px 5px',
      fontWeight: 700,
      lineHeight: 1,
      marginLeft: 2,
    }}>
      {g.symbol}
    </span>
  );

  if (pdfMode) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
        <span>{shown}</span>
        {glyphEl}
      </span>
    );
  }

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'help' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span>{shown}</span>
      {glyphEl}
      {show && <SourceTooltip fieldResult={fieldResult} />}
    </span>
  );
}

/**
 * StatusDot — tiny circle for dense summary views (e.g. a table row indicator).
 */
export function StatusDot({ status }) {
  const g = GLYPH[status] || GLYPH.single;
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: g.color, flexShrink: 0,
    }} title={g.label} />
  );
}
