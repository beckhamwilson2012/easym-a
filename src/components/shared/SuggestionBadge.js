import { useState, useRef, useEffect } from 'react';

export function SuggestionBadge({ icon = '💡', label, primary, caption, tooltip, onUse, onUseLabel = 'Use this' }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const isTouch = typeof window !== 'undefined' && 'ontouchstart' in window;

  const InfoBtn = () => tooltip ? (
    <button
      onMouseEnter={() => !isTouch && setOpen(true)}
      onMouseLeave={() => !isTouch && setOpen(false)}
      onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
      aria-label="How this is calculated"
      style={{
        width: 16, height: 16, borderRadius: '50%',
        border: '1px solid #9CA3AF', background: 'transparent',
        color: '#6B7280', fontSize: 9, fontWeight: 700,
        cursor: 'pointer', padding: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, lineHeight: 1,
      }}
    >ⓘ</button>
  ) : null;

  const UseBtn = () => onUse ? (
    <button onClick={onUse} style={{
      background: '#0F2244', color: '#fff', border: 'none',
      borderRadius: 4, padding: '3px 8px', fontSize: 11,
      cursor: 'pointer', marginLeft: 8, flexShrink: 0,
    }}>
      {onUseLabel}
    </button>
  ) : null;

  return (
    <div style={{ position: 'relative', marginBottom: 8 }} ref={containerRef}>
      <div style={{
        background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6,
        padding: '6px 10px', fontSize: 12,
      }}>
        {primary != null ? (
          /* New two-line format */
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
                <span role="img" aria-hidden="true">{icon}</span>
                <span style={{ color: '#9CA3AF', fontSize: 11, flexShrink: 0 }}>Suggested:</span>
                <span style={{ color: '#0F2244', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {primary}
                </span>
                <InfoBtn />
              </div>
              <UseBtn />
            </div>
            {caption && (
              <div style={{ fontSize: 11, color: '#6B7280', marginTop: 3, paddingLeft: 21 }}>
                {caption}
              </div>
            )}
          </>
        ) : (
          /* Legacy label format */
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
              <span role="img" aria-hidden="true">{icon}</span>
              <InfoBtn />
              <span style={{ color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
            </div>
            <UseBtn />
          </div>
        )}
      </div>

      {/* Tooltip popover */}
      {open && tooltip && (
        <div
          onMouseEnter={() => !isTouch && setOpen(true)}
          onMouseLeave={() => !isTouch && setOpen(false)}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 100,
            background: '#fff', border: '1px solid #E5E7EB',
            borderRadius: 8, padding: 12,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            width: 'min(360px, calc(100vw - 32px))',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#6B7280',
            letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase',
          }}>
            How this is calculated
          </div>
          <div style={{ fontSize: 12, color: '#374151', marginBottom: 8, fontStyle: 'italic', lineHeight: 1.4 }}>
            {tooltip.formula}
          </div>
          {tooltip.inputs?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{
                fontSize: 10, color: '#9CA3AF', marginBottom: 3,
                textTransform: 'uppercase', letterSpacing: 0.3,
              }}>Inputs</div>
              {tooltip.inputs.map((inp, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', gap: 8,
                  fontSize: 11, padding: '3px 0',
                  borderBottom: i < tooltip.inputs.length - 1 ? '1px solid #F9FAFB' : 'none',
                }}>
                  <span style={{ color: '#6B7280' }}>{inp.label}</span>
                  <span style={{ color: '#111827', fontWeight: 500, textAlign: 'right' }}>{inp.value}</span>
                </div>
              ))}
            </div>
          )}
          {tooltip.result && (
            <div style={{
              fontSize: 13, fontWeight: 700, color: '#0F2244',
              padding: '5px 0',
              marginBottom: (tooltip.notes || tooltip.sources?.length) ? 6 : 0,
              borderTop: '1.5px solid #0F2244',
            }}>
              {tooltip.result}
            </div>
          )}
          {tooltip.notes && (
            <div style={{
              fontSize: 11, color: '#9CA3AF', fontStyle: 'italic',
              marginBottom: tooltip.sources?.length ? 5 : 0, lineHeight: 1.5,
            }}>
              {tooltip.notes}
            </div>
          )}
          {tooltip.sources?.length > 0 && (
            <div style={{ fontSize: 10, color: '#9CA3AF' }}>
              Source: {tooltip.sources.join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
