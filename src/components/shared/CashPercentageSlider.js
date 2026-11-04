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
  userEntered,
}) {
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

  const status = hitMajority
    ? { icon: '🔴', text: 'high dilution', color: '#DC2626' }
    : hit199
    ? { icon: '🟡', text: 'vote required', color: '#D97706' }
    : { icon: '🟢', text: 'no vote required', color: '#16A34A' };

  const [expanded, setExpanded] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const containerRef = useRef(null);
  const numInputRef = useRef(null);
  const wasAlreadyFocused = useRef(false);
  const mouseDownWasExpanded = useRef(false);
  const isTouch = typeof window !== 'undefined' && 'ontouchstart' in window;

  // Close expanded on click-outside
  useEffect(() => {
    if (!expanded) return;
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) setExpanded(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expanded]);

  // Close tooltip on click-outside
  useEffect(() => {
    if (!tooltipOpen) return;
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) setTooltipOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [tooltipOpen]);

  // Close both on Escape
  useEffect(() => {
    if (!expanded && !tooltipOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape') { setExpanded(false); setTooltipOpen(false); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [expanded, tooltipOpen]);

  // Sync number input when pct changes from slider (only when number input not focused)
  useEffect(() => {
    if (numInputRef.current && document.activeElement !== numInputRef.current) {
      numInputRef.current.value = String(pct);
    }
  }, [pct]);

  const handleNumBlur = (e) => {
    if (!containerRef.current?.contains(e.relatedTarget)) {
      setExpanded(false);
    }
  };

  const handleRangeBlur = (e) => {
    if (!containerRef.current?.contains(e.relatedTarget)) {
      setExpanded(false);
    }
  };

  return (
    <div style={{ marginBottom: 8, position: 'relative' }} ref={containerRef}>
      {/* Header row: title · ⓘ · [input % cash] · status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: expanded ? 6 : 0 }}>
        <span style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>
          Cash / Stock Mix
        </span>

        {tooltip && (
          <button
            onMouseEnter={() => !isTouch && setTooltipOpen(true)}
            onMouseLeave={() => !isTouch && setTooltipOpen(false)}
            onClick={(e) => { e.stopPropagation(); setTooltipOpen(v => !v); }}
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

        {/* Right cluster: number input + status */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <input
              ref={numInputRef}
              className="cash-pct-input"
              type="number"
              min={0}
              max={100}
              step={1}
              defaultValue={pct}
              onMouseDown={(e) => {
                wasAlreadyFocused.current = document.activeElement === e.currentTarget;
                mouseDownWasExpanded.current = expanded;
              }}
              onFocus={() => setExpanded(true)}
              onClick={() => {
                if (wasAlreadyFocused.current && mouseDownWasExpanded.current) {
                  setExpanded(false);
                }
              }}
              onBlur={handleNumBlur}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) onChange(Math.max(0, Math.min(100, v)));
              }}
              style={{
                width: 44, padding: '3px 6px', borderRadius: 4,
                border: `1px solid ${expanded ? '#0F2244' : '#D1D5DB'}`,
                fontSize: 12, textAlign: 'center', outline: 'none',
                fontWeight: 600, color: userEntered ? '#1a5fd0' : '#0F2244',
                transition: 'border-color 0.15s',
              }}
            />
            <span style={{ fontSize: 12, color: '#6B7280' }}>%</span>
          </div>
          <span style={{ fontSize: 11, color: status.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
            {status.icon} {status.text}
          </span>
        </div>
      </div>

      {/* Expandable slider section — 150ms ease animation */}
      <div style={{
        overflow: 'hidden',
        maxHeight: expanded ? '300px' : '0px',
        opacity: expanded ? 1 : 0,
        transition: 'max-height 150ms ease-in-out, opacity 150ms ease-in-out',
      }}>
        {/* Slider track */}
        <div style={{ position: 'relative', marginBottom: 4 }}>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={pct}
            className="cash-pct-slider"
            onChange={(e) => onChange(Number(e.target.value))}
            onBlur={handleRangeBlur}
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

        {/* Regulatory warning callout — only visible when expanded */}
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
      </div>

      {/* Tooltip popover (ⓘ) */}
      {tooltipOpen && tooltip && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => !isTouch && setTooltipOpen(true)}
          onMouseLeave={() => !isTouch && setTooltipOpen(false)}
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
