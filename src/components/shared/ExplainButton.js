import { useRef, useEffect } from 'react';
import { useExplain } from '../../contexts/ExplainContext';

let nextId = 0;

const POPOVER_W = 'min(360px, calc(100vw - 32px))';
const MOBILE_BP = 768;

function isMobile() {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BP;
}

export function ExplainButton({ explain, value }) {
  const { openId, toggle, close } = useExplain();
  const id = useRef(null);
  if (!id.current) id.current = `eb-${nextId++}`;
  const isOpen = openId === id.current;

  const containerRef = useRef(null);

  // Close on click-outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, close]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  if (!explain) return null;

  const mobile = isMobile();
  const computed = typeof explain === 'function' ? explain() : explain;

  return (
    <span ref={containerRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        onClick={(e) => { e.stopPropagation(); toggle(id.current); }}
        aria-label={isOpen ? 'Close explanation' : 'Explain this calculation'}
        aria-expanded={isOpen}
        style={{
          width: 16, height: 16, borderRadius: '50%',
          border: `1px solid ${isOpen ? '#0070D2' : '#9CA3AF'}`,
          background: isOpen ? '#EFF6FF' : 'transparent',
          color: isOpen ? '#0070D2' : '#6B7280',
          fontSize: 9, fontWeight: 700,
          cursor: 'pointer', padding: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, lineHeight: 1,
          transition: 'border-color 0.15s, color 0.15s, background 0.15s',
        }}
      >ⓘ</button>

      {isOpen && computed && (
        mobile ? (
          // Mobile: full-screen modal overlay
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 1000,
              background: 'rgba(0,0,0,0.45)',
              display: 'flex', alignItems: 'flex-end',
            }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
          >
            <div style={{
              width: '100%', background: '#fff',
              borderRadius: '12px 12px 0 0',
              padding: '16px 16px 24px',
              maxHeight: '75vh', overflowY: 'auto',
            }}>
              <PopoverContent computed={computed} value={value} onClose={close} />
            </div>
          </div>
        ) : (
          // Desktop: popover below the button
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
            background: '#fff', border: '1px solid #E5E7EB',
            borderRadius: 8, padding: 12,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            width: POPOVER_W,
            fontFamily: 'Arial, sans-serif',
          }}>
            <PopoverContent computed={computed} value={value} onClose={close} />
          </div>
        )
      )}
    </span>
  );
}

function PopoverContent({ computed, value, onClose }) {
  return (
    <>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', letterSpacing: 0.5, textTransform: 'uppercase' }}>
          How this is calculated
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#9CA3AF', fontSize: 14, lineHeight: 1, padding: '0 2px',
          }}
        >×</button>
      </div>

      {/* Formula */}
      {computed.formula && (
        <div style={{ fontSize: 12, color: '#374151', marginBottom: 8, fontStyle: 'italic', lineHeight: 1.4 }}>
          {computed.formula}
        </div>
      )}

      {/* Inputs table */}
      {computed.inputs?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            Inputs
          </div>
          {computed.inputs.map((inp, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', gap: 8,
              fontSize: 11, padding: '3px 0',
              borderBottom: i < computed.inputs.length - 1 ? '1px solid #F9FAFB' : 'none',
            }}>
              <span style={{ color: '#6B7280' }}>{inp.label}</span>
              <span style={{ color: '#111827', fontWeight: 500, textAlign: 'right' }}>{inp.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Result */}
      {(computed.result != null || value != null) && (
        <div style={{
          fontSize: 13, fontWeight: 700, color: '#0F2244',
          padding: '5px 0',
          marginBottom: (computed.notes || computed.sources?.length) ? 6 : 0,
          borderTop: '1.5px solid #0F2244',
        }}>
          {computed.result ?? value}
        </div>
      )}

      {/* Notes */}
      {computed.notes && (
        <div style={{
          fontSize: 11, color: '#9CA3AF', fontStyle: 'italic',
          lineHeight: 1.5, marginBottom: computed.sources?.length ? 5 : 0,
        }}>
          {computed.notes}
        </div>
      )}

      {/* Sources */}
      {computed.sources?.length > 0 && (
        <div style={{ fontSize: 10, color: '#9CA3AF' }}>
          Source: {computed.sources.join(' · ')}
        </div>
      )}
    </>
  );
}
