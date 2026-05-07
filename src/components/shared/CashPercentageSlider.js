import { useState, useRef, useEffect } from 'react';
import { calcStockIssuancePct, triggers199Rule } from '../../lib/dealMath';
import { getCashBand, ISSUANCE_MAJORITY_THRESHOLD } from '../../lib/premiumThresholds';

const TICKS = [0, 19.9, 60, 80.1, 100];

export function CashPercentageSlider({
  value,
  onChange,
  tooltip,
  dealSize,
  acquirerSharePrice,
  acquirerSharesOutstanding,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const isTouch = typeof window !== 'undefined' && 'ontouchstart' in window;

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const pct = Number(value) || 0;
  const band = getCashBand(pct);

  const stockIssuancePct = calcStockIssuancePct({
    dealSize,
    cashPercent: pct,
    acquirerSharePrice,
    acquirerSharesOutstanding,
  });
  const hit199 = triggers199Rule(stockIssuancePct);
  const hitMajority = stockIssuancePct != null && stockIssuancePct >= ISSUANCE_MAJORITY_THRESHOLD;

  const warningColor = hitMajority ? '#DC2626' : hit199 ? '#D97706' : null;

  return (
    <div style={{ marginBottom: 8 }} ref={containerRef}>
      {/* Header row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
      }}>
        <span style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>
          Cash / Stock Mix
        </span>
        {tooltip && (
          <button
            onMouseEnter={() => !isTouch && setOpen(true)}
            onMouseLeave={() => !isTouch && setOpen(false)}
            onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
            aria-label="How cash percentage is determined"
            style={{
              width: 16, height: 16, borderRadius: '50%',
              border: '1px solid #9CA3AF', background: 'transparent',
              color: '#6B7280', fontSize: 9, fontWeight: 700,
              cursor: 'pointer', padding: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, lineHeight: 1,
            }}
          >ⓘ</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: band.color }}>
          {pct}% cash / {100 - pct}% stock
        </span>
      </div>

      {/* Slider track */}
      <div style={{ position: 'relative', marginBottom: 4 }}>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{
            width: '100%', appearance: 'none', height: 6,
            borderRadius: 3, outline: 'none', cursor: 'pointer',
            background: `linear-gradient(to right, ${band.color} 0%, ${band.color} ${pct}%, #E5E7EB ${pct}%, #E5E7EB 100%)`,
          }}
        />

        {/* Tick marks */}
        <div style={{ position: 'relative', height: 18 }}>
          {TICKS.map((tick) => {
            const is199 = tick === 19.9;
            return (
              <div
                key={tick}
                style={{
                  position: 'absolute',
                  left: `${tick}%`,
                  transform: 'translateX(-50%)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  pointerEvents: 'none',
                }}
              >
                <div style={{
                  width: 1, height: 4,
                  background: is199 ? '#DC2626' : '#9CA3AF',
                  marginBottom: 1,
                }} />
                <span style={{
                  fontSize: 9,
                  color: is199 ? '#DC2626' : '#9CA3AF',
                  fontWeight: is199 ? 700 : 400,
                  whiteSpace: 'nowrap',
                }}>
                  {is199 ? '19.9%' : `${tick}%`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Regulatory warning callout */}
      {warningColor && stockIssuancePct != null && (
        <div style={{
          marginTop: 6, padding: '8px 10px', borderRadius: 6,
          background: hitMajority ? '#FEE2E2' : '#FEF3C7',
          border: `1px solid ${hitMajority ? '#FECACA' : '#FDE68A'}`,
          fontSize: 12, color: hitMajority ? '#991B1B' : '#92400E',
          lineHeight: 1.5,
        }}>
          {hitMajority
            ? `⚠ Stock issuance of ${stockIssuancePct.toFixed(1)}% exceeds the 50% majority threshold, triggering heightened board scrutiny and potential regulatory review. Most large mergers avoid majority-stock structures due to dilution risk and shareholder approval requirements.`
            : `🟡 Stock issuance of ${stockIssuancePct.toFixed(1)}% exceeds the 19.9% threshold under NYSE Listed Company Manual §312.03 and Nasdaq Rule 5635. The acquirer must hold a shareholder vote before closing. Adds 2–4 months to the timeline; vote can fail.`
          }
        </div>
      )}

      {/* Tooltip popover */}
      {open && tooltip && (
        <div
          onMouseEnter={() => !isTouch && setOpen(true)}
          onMouseLeave={() => !isTouch && setOpen(false)}
          style={{
            position: 'absolute', zIndex: 100,
            background: '#fff', border: '1px solid #E5E7EB',
            borderRadius: 8, padding: 12,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            width: 'min(360px, calc(100vw - 32px))',
            fontFamily: 'Arial, sans-serif',
            marginTop: 4,
          }}
        >
          <div style={{
            fontSize: 10, fontWeight: 700, color: '#6B7280',
            letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase',
          }}>
            How this is determined
          </div>
          <div style={{ fontSize: 12, color: '#374151', marginBottom: 8, fontStyle: 'italic', lineHeight: 1.4 }}>
            {tooltip.formula}
          </div>
          {tooltip.inputs?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                Structure benchmarks
              </div>
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
              padding: '5px 0', marginBottom: (tooltip.notes || tooltip.sources?.length) ? 6 : 0,
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
