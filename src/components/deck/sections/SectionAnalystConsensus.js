import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import {
  NAVY,
  SF_BLUE,
  GRAY_BORDER,
  ALT_ROW,
  fmtPerShare,
  fmtPctSigned,
} from '../shared/deckTokens';
import { useVerifiedData } from '../../../hooks/useVerifiedData';

// Read a verified field's numeric value; tolerate {value,status} object or missing.
function readField(f) {
  return f && f.value != null ? parseFloat(f.value) : null;
}

// Compact stat box for the consensus block.
function Stat({ label, value, accent, bg }) {
  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      padding: '10px 12px',
      background: bg || '#FFFFFF',
      border: `1px solid ${GRAY_BORDER}`,
      borderRadius: 4,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: accent || NAVY }}>
        {value}
      </div>
    </div>
  );
}

export function SectionAnalystConsensus({ target, acquirer, deal, pageNum }) {
  const { data } = useVerifiedData(target?.ticker ?? null);
  const fields = data?.fields || {};

  const mean  = readField(fields.analystTargetMean);
  const high  = readField(fields.analystTargetHigh);
  const low   = readField(fields.analystTargetLow);
  const count = readField(fields.analystCount);
  const ratingBuy  = readField(fields.analystRatingBuy);
  const ratingHold = readField(fields.analystRatingHold);
  const ratingSell = readField(fields.analystRatingSell);
  const hasRatings = ratingBuy != null || ratingHold != null || ratingSell != null;

  // Verification provenance of the cross-checked mean target.
  const meanField  = fields.analystTargetMean || {};
  const meanStatus = meanField.status; // 'verified' | 'flagged' | 'single' | 'missing'
  const SRC_LABEL  = { nasdaq: 'Nasdaq', stockanalysis: 'StockAnalysis.com', yahoo: 'Yahoo Finance', cnbc: 'CNBC', finnhub: 'Finnhub' };
  const citedSrcs  = meanField.sourceMeta ? Object.keys(meanField.sourceMeta).map(s => SRC_LABEL[s] || s) : [];
  const meanAsOf   = meanField.sourceMeta?.[meanField.chosenSource]?.asOf || null;

  const sharePrice = parseFloat(target?.sharePrice);
  const currentPrice = isNaN(sharePrice) ? null : sharePrice;
  const offerPrice = parseFloat(deal?.offerPrice);
  const offer = isNaN(offerPrice) ? null : offerPrice;

  const premium = deal?.purchasePremium != null && !isNaN(parseFloat(deal.purchasePremium))
    ? parseFloat(deal.purchasePremium)
    : null;

  // Analyst data is "present" only if at least one consensus target is available.
  const hasAnalystData = mean != null || high != null || low != null;

  const tName = target?.name || 'the target';
  const tTicker = target?.ticker || target?.name || 'Target';

  // ── Build horizontal comparison bar markers ─────────────────────────────────
  const markers = [];
  if (low != null)          markers.push({ key: 'low',     label: 'Low',     value: low,          color: '#9CA3AF' });
  if (mean != null)         markers.push({ key: 'mean',    label: 'Mean',    value: mean,         color: SF_BLUE  });
  if (high != null)         markers.push({ key: 'high',    label: 'High',    value: high,         color: '#0B5CAB' });
  if (offer != null)        markers.push({ key: 'offer',   label: 'Offer',   value: offer,        color: '#166534' });
  if (currentPrice != null) markers.push({ key: 'current', label: 'Current', value: currentPrice, color: NAVY     });

  const values = markers.map(m => m.value);
  const minV = values.length ? Math.min(...values) : 0;
  const maxV = values.length ? Math.max(...values) : 1;
  const span = maxV - minV;
  // Pad the scale so endpoints aren't pinned to the edges.
  const pad = span > 0 ? span * 0.12 : (maxV > 0 ? maxV * 0.1 : 1);
  const scaleMin = minV - pad;
  const scaleMax = maxV + pad;
  const scaleSpan = scaleMax - scaleMin || 1;
  const pctOf = (v) => ((v - scaleMin) / scaleSpan) * 100;

  // ── Source line (honest about analyst data provenance + verification status) ─
  let sourceLine;
  if (!hasAnalystData) {
    sourceLine = `Analyst consensus price targets are an assumption input and are not available on the free data stack for ${tTicker}; no broker estimates are shown. Comparison limited to current price vs. offer price per the deal model.`;
  } else if (meanStatus === 'flagged') {
    const both = Object.entries(meanField.sources || {})
      .filter(([, v]) => v != null)
      .map(([s, v]) => `${SRC_LABEL[s] || s} ${fmtPerShare(v)}`).join(' vs. ');
    sourceLine = `Analyst mean target shows a cross-source spread (${both}${meanField.maxDev != null ? `, ${(meanField.maxDev * 100).toFixed(1)}% apart` : ''}) — different aggregators poll different broker panels; the ${SRC_LABEL[meanField.chosenSource] || meanField.chosenSource} value is used. High/low/coverage from Nasdaq. Point-in-time estimates${meanAsOf ? `, as of ${meanAsOf}` : ''}, not guarantees.`;
  } else if (meanStatus === 'single') {
    sourceLine = `Analyst mean target from a single source (${citedSrcs.join('')}), unconfirmed by a second aggregator. High/low/coverage from Nasdaq. Point-in-time estimates${meanAsOf ? `, as of ${meanAsOf}` : ''}, not guarantees.`;
  } else {
    sourceLine = `Analyst mean target verified across ${citedSrcs.join(' and ')}${count != null ? ` (Nasdaq coverage n = ${Math.round(count)})` : ''}; high/low from Nasdaq. Point-in-time sell-side estimates${meanAsOf ? `, as of ${meanAsOf}` : ''}, not guarantees. Current price and offer per the deal model.`;
  }

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit K">
      <PageHeader
        title="Analyst Consensus Overview"
        subtitle={`${tName}${target?.ticker ? ` (${target.ticker})` : ''} · Sell-side price targets vs. offer`}
      />

      <div style={{ padding: '16px 20px 36px' }}>
        {hasAnalystData ? (
          <>
            {/* ── Consensus stat block ──────────────────────────────────── */}
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Consensus Price Targets
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Stat label="Mean Target"  value={fmtPerShare(mean)} accent={SF_BLUE} bg={ALT_ROW} />
              <Stat label="High Target"  value={fmtPerShare(high)} />
              <Stat label="Low Target"   value={fmtPerShare(low)} />
              <Stat label="# Analysts"   value={count != null ? String(Math.round(count)) : '—'} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              <Stat label="Current Price" value={currentPrice != null ? fmtPerShare(currentPrice) : '—'} bg={ALT_ROW} />
              <Stat label="Offer Price"   value={offer != null ? fmtPerShare(offer) : '—'} accent="#166534" />
              <Stat
                label="Offer vs. Mean"
                value={(offer != null && mean) ? fmtPctSigned(((offer - mean) / mean) * 100) : '—'}
                accent={(offer != null && mean) ? (offer >= mean ? '#166534' : '#DC2626') : NAVY}
              />
              <Stat
                label="Premium to Current"
                value={premium != null ? fmtPctSigned(premium) : (offer != null && currentPrice ? fmtPctSigned(((offer - currentPrice) / currentPrice) * 100) : '—')}
                accent="#166534"
              />
            </div>

            {/* ── Analyst rating split ──────────────────────────────────── */}
            {hasRatings && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  Analyst Ratings <span style={{ fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>(Nasdaq panel{count != null ? `, n = ${Math.round(count)}` : ''})</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Stat label="Buy"  value={ratingBuy  != null ? String(Math.round(ratingBuy))  : '—'} accent="#166534" bg="#F0FDF4" />
                  <Stat label="Hold" value={ratingHold != null ? String(Math.round(ratingHold)) : '—'} accent="#B45309" bg="#FFFBEB" />
                  <Stat label="Sell" value={ratingSell != null ? String(Math.round(ratingSell)) : '—'} accent="#DC2626" bg="#FEF2F2" />
                </div>
              </div>
            )}

            {/* ── Horizontal comparison bar ─────────────────────────────── */}
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              Target Range vs. Offer &amp; Current
            </div>
            <div style={{
              position: 'relative',
              height: 96,
              margin: '0 28px',
              borderBottom: `1px solid ${GRAY_BORDER}`,
            }}>
              {/* Baseline track */}
              <div style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 6,
                background: '#EFF2F6',
                borderRadius: 3,
              }} />
              {/* Low → High shaded range */}
              {low != null && high != null && (
                <div style={{
                  position: 'absolute',
                  left: `${pctOf(low)}%`,
                  width: `${Math.max(pctOf(high) - pctOf(low), 0)}%`,
                  bottom: 0,
                  height: 6,
                  background: '#CFE2F3',
                  borderRadius: 3,
                }} />
              )}
              {/* Markers */}
              {markers.map((m, i) => {
                const left = pctOf(m.value);
                // Stagger labels vertically to reduce overlap.
                const top = (i % 2 === 0) ? 4 : 30;
                return (
                  <div key={m.key} style={{ position: 'absolute', left: `${left}%`, bottom: 0, transform: 'translateX(-50%)' }}>
                    {/* Vertical stem */}
                    <div style={{ position: 'absolute', bottom: 0, left: '50%', width: 2, height: 90 - top, background: m.color, transform: 'translateX(-50%)' }} />
                    {/* Dot at baseline */}
                    <div style={{ position: 'absolute', bottom: -4, left: '50%', width: 10, height: 10, borderRadius: '50%', background: m.color, transform: 'translateX(-50%)', border: '2px solid #FFFFFF', boxShadow: '0 0 0 1px ' + m.color }} />
                    {/* Label + value */}
                    <div style={{ position: 'absolute', bottom: 92 - top, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', textAlign: 'center' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: m.color, textTransform: 'uppercase', letterSpacing: 0.3 }}>{m.label}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: NAVY }}>{fmtPerShare(m.value)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            {/* ── Honest placeholder card ───────────────────────────────── */}
            <div style={{
              background: ALT_ROW,
              border: `1px solid ${GRAY_BORDER}`,
              borderLeft: `4px solid ${SF_BLUE}`,
              borderRadius: 4,
              padding: '14px 16px',
              marginBottom: 18,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: NAVY, marginBottom: 4 }}>
                Analyst consensus is not available on the free data stack
              </div>
              <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.5 }}>
                Sell-side price targets (mean / high / low) and analyst coverage counts for {tTicker} are
                not provided by the free data sources backing this model. No broker estimates are shown to
                avoid fabricating figures. The comparison below is limited to the current market price versus
                the proposed offer price.
              </div>
            </div>

            {/* ── Current vs. Offer with implied premium ────────────────── */}
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Current Price vs. Offer Price
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              <Stat label="Current Price" value={currentPrice != null ? fmtPerShare(currentPrice) : '—'} bg={ALT_ROW} />
              <Stat label="Offer Price"   value={offer != null ? fmtPerShare(offer) : '—'} accent="#166534" />
              <Stat
                label="Implied Premium"
                value={premium != null
                  ? fmtPctSigned(premium)
                  : (offer != null && currentPrice ? fmtPctSigned(((offer - currentPrice) / currentPrice) * 100) : '—')}
                accent={(() => {
                  const p = premium != null ? premium : (offer != null && currentPrice ? ((offer - currentPrice) / currentPrice) * 100 : null);
                  if (p == null) return NAVY;
                  return p >= 0 ? '#166534' : '#DC2626';
                })()}
              />
            </div>

            {/* ── Simple two-marker bar ─────────────────────────────────── */}
            {(currentPrice != null && offer != null) && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                  Offer vs. Current Market Price
                </div>
                <div style={{ position: 'relative', height: 70, margin: '0 28px', borderBottom: `1px solid ${GRAY_BORDER}` }}>
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 6, background: '#EFF2F6', borderRadius: 3 }} />
                  {[
                    { key: 'current', label: 'Current', value: currentPrice, color: NAVY },
                    { key: 'offer',   label: 'Offer',   value: offer,        color: '#166534' },
                  ].map((m) => {
                    const lo = Math.min(currentPrice, offer);
                    const hi = Math.max(currentPrice, offer);
                    const sp = hi - lo;
                    const p2 = sp > 0 ? sp * 0.25 : (hi > 0 ? hi * 0.15 : 1);
                    const sMin = lo - p2;
                    const sMax = hi + p2;
                    const left = ((m.value - sMin) / ((sMax - sMin) || 1)) * 100;
                    return (
                      <div key={m.key} style={{ position: 'absolute', left: `${left}%`, bottom: 0, transform: 'translateX(-50%)' }}>
                        <div style={{ position: 'absolute', bottom: 0, left: '50%', width: 2, height: 50, background: m.color, transform: 'translateX(-50%)' }} />
                        <div style={{ position: 'absolute', bottom: -4, left: '50%', width: 10, height: 10, borderRadius: '50%', background: m.color, transform: 'translateX(-50%)', border: '2px solid #FFFFFF', boxShadow: '0 0 0 1px ' + m.color }} />
                        <div style={{ position: 'absolute', bottom: 54, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', textAlign: 'center' }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: m.color, textTransform: 'uppercase', letterSpacing: 0.3 }}>{m.label}</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: NAVY }}>{fmtPerShare(m.value)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {(currentPrice == null || offer == null) && (
              <div style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic' }}>
                {currentPrice == null
                  ? 'Live current price is unavailable on the free data stack; premium-to-current cannot be charted.'
                  : 'Offer price is not set; comparison unavailable.'}
              </div>
            )}
          </>
        )}
      </div>

      {/* Source / footnote line */}
      <div style={{ padding: '0 20px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
        {sourceLine}
      </div>
    </PageFrame>
  );
}
