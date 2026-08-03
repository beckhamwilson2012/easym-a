import React, { useState, useEffect } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import {
  NAVY,
  SF_BLUE,
  GRAY_BORDER,
  ALT_ROW,
  fmtMoney,
  fmtPerShare,
  fmtPctSigned,
} from '../shared/deckTokens';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { isRobustPanel } from '../../../hooks/useValuationSources';
import { formatDeckDate } from '../../../lib/composeSourceLine';

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

  // FMP forward consensus (the EDGAR gap) — additive, single-source, fetched separately from the
  // 3-source price-target cross-check (which lives in /api/verified). Graceful: null on any failure.
  const [est, setEst] = useState(null);
  useEffect(() => {
    const t = target?.ticker;
    if (!t) { setEst(null); return; }
    let cancel = false;
    fetch(`http://localhost:3001/api/estimates/${t}`)
      .then(r => r.json())
      .then(d => { if (!cancel) setEst(d); })
      .catch(() => { if (!cancel) setEst(null); });
    return () => { cancel = true; };
  }, [target?.ticker]);
  const fwd = est && Array.isArray(est.estimates) ? est.estimates : [];

  // Per-bank price targets (NEW — /api/analyst-targets, FMP). Deduped latest-per-firm + recency +
  // outlier filtered SERVER-SIDE; we just render. Graceful: null on any failure → consensus fallback.
  const [bank, setBank] = useState(null);
  useEffect(() => {
    const t = target?.ticker;
    if (!t) { setBank(null); return; }
    let cancel = false;
    fetch(`http://localhost:3001/api/analyst-targets/${t}`)
      .then(r => r.json())
      .then(d => { if (!cancel) setBank(d); })
      .catch(() => { if (!cancel) setBank(null); });
    return () => { cancel = true; };
  }, [target?.ticker]);
  const bankTargets = bank && Array.isArray(bank.targets)
    ? bank.targets.filter(t => t && t.target > 0).sort((a, b) => b.target - a.target)
    : [];
  // The shared robustness bar (≥3 firms) — the SAME predicate §12/§14/§16 use, so all four slides agree on
  // what "a real panel, not one stray broker" means. (bank.count === bankTargets.length: server already
  // filters target>0, so this is equivalent to the old `bankTargets.length >= 3`, now expressed once.)
  const hasBankData = isRobustPanel(bank);

  const mean  = readField(fields.analystTargetMean);
  const high  = readField(fields.analystTargetHigh);
  const low   = readField(fields.analystTargetLow);
  const count = readField(fields.analystCount);
  const ratingBuy  = readField(fields.analystRatingBuy);
  const ratingHold = readField(fields.analystRatingHold);
  const ratingSell = readField(fields.analystRatingSell);
  const hasRatings = ratingBuy != null || ratingHold != null || ratingSell != null;

  // Per-source provenance of the price target (used for the consensus/range frame, NOT a pass/fail badge).
  const meanField  = fields.analystTargetMean || {};
  const SRC_LABEL  = { nasdaq: 'Nasdaq', stockanalysis: 'StockAnalysis.com', fmp: 'Financial Modeling Prep', yahoo: 'Yahoo Finance', cnbc: 'CNBC', finnhub: 'Finnhub' };
  const citedSrcs  = meanField.sourceMeta ? Object.keys(meanField.sourceMeta).map(s => SRC_LABEL[s] || s) : [];
  // Use the single deck-wide build date (bundle asOf, tz-safe) so §12 matches every other slide (Fix B).
  const meanAsOf   = formatDeckDate(data?.asOf);

  // Price targets are FORECASTS, not facts — present a Street CONSENSUS + RANGE across the contributing
  // aggregators (dispersion is information, not a flaggable error). The verified/flagged badge stays on
  // the hard facts (price/market-cap/shares/financials) elsewhere with their tight tolerance; only this
  // forecast field is reframed. Consensus = mean of the per-source mean targets; range = their min–max.
  const srcTargetVals = meanField.sourceMeta
    ? Object.values(meanField.sourceMeta).map(m => parseFloat(m.value)).filter(v => !isNaN(v) && v > 0)
    : [];
  const srcCount  = srcTargetVals.length;
  const consensus = srcCount ? srcTargetVals.reduce((a, b) => a + b, 0) / srcCount : (mean != null ? mean : null);
  const srcLow    = srcCount ? Math.min(...srcTargetVals) : null;
  const srcHigh   = srcCount ? Math.max(...srcTargetVals) : null;

  // Thin-coverage framing for the <3-firm FALLBACK branch — reuse the deck's thin/single vocabulary instead
  // of calling a sub-panel a "Consensus". The shown figure stays the indicative aggregator mean; we RELABEL,
  // we do NOT force a median onto a panel too thin to have a robust one. (The ≥3 panel path is untouched.)
  const panelN = bankTargets.length;                                   // firm-panel size (RRGB 2, NSRGY 0)
  const fallbackKind = panelN === 2 ? 'thin2' : (srcCount <= 1 ? 'single' : 'thin');
  const fallbackHeader = fallbackKind === 'thin2'  ? 'Thin coverage — 2-firm panel'
                       : fallbackKind === 'single' ? 'Single analyst figure'
                       :                             'Thin coverage — indicative';
  const figNoun = fallbackKind === 'single' ? 'Single Figure' : 'Indicative';

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
  // Bar endpoints = the ANALYST high/low targets (the full sell-side panel); the mean marker is the
  // Street CONSENSUS (mean across sources). The text caption's "Range" is the narrower CROSS-SOURCE
  // span — labeled distinctly so the two dispersions don't get conflated.
  const markers = [];
  if (low != null)          markers.push({ key: 'low',     label: 'Low',       value: low,                  color: '#9CA3AF' });
  if (consensus != null)    markers.push({ key: 'mean',    label: 'Consensus', value: consensus,            color: SF_BLUE  });
  if (high != null)         markers.push({ key: 'high',    label: 'High',      value: high,                 color: '#0B5CAB' });
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

  // #7 collision-aware label staggering. The old `(i % 2)` parity alternated rows by marker INDEX, which
  // ignores horizontal proximity — so two markers that happen to sit close on the bar (e.g. CURRENT/LOW
  // bunched left, or CONSENSUS/OFFER stacked mid) could land on the SAME row and overlap. Instead: sort
  // markers by horizontal position and give each the lowest vertical "lane" that clears every already-
  // placed marker within MIN_GAP_PCT. Different lanes ⇒ different label heights ⇒ no overlap.
  const MIN_GAP_PCT = 12;            // a label is ~this wide in bar-percent; closer than this ⇒ offset it
  const LANE_TOP = [4, 30, 56, 82];  // stem-top px per lane (smaller = taller stem, higher label)
  const laneByKey = {};
  const placedLanes = [];
  markers
    .map(m => ({ key: m.key, left: pctOf(m.value) }))
    .sort((a, b) => a.left - b.left)
    .forEach(({ key, left }) => {
      let lane = 0;
      // eslint-disable-next-line no-loop-func
      while (placedLanes.some(p => p.lane === lane && Math.abs(p.left - left) < MIN_GAP_PCT)) lane++;
      laneByKey[key] = Math.min(lane, LANE_TOP.length - 1);
      placedLanes.push({ left, lane });
    });

  // ── Source line — price targets are FORECASTS, so we describe the consensus + dispersion, NOT a
  //    verified/flagged agreement check (that frame is reserved for hard facts). ─────────────────────
  let sourceLine;
  if (hasBankData) {
    sourceLine = `Per-firm price targets from Financial Modeling Prep (${bankTargets.length} brokers), taking the LATEST target per firm${bank?.droppedStale ? `; ${bank.droppedStale} firm${bank.droppedStale === 1 ? '' : 's'} whose latest call is >18 months old dropped` : ''}${bank?.droppedOutliers ? `; ${bank.droppedOutliers} statistical outlier${bank.droppedOutliers === 1 ? '' : 's'} (>3× or <⅓ the median) dropped` : ''}. Price targets are sell-side FORECASTS, point-in-time, not guarantees. Ratings are the latest grade per firm. Current price and offer per the deal model.`;
  } else if (!hasAnalystData) {
    sourceLine = `Analyst consensus price targets are an assumption input and are not available on the free data stack for ${tTicker}; no broker estimates are shown. Comparison limited to current price vs. offer price per the deal model.`;
  } else {
    const srcList = citedSrcs.length ? citedSrcs.join(', ') : 'a single aggregator';
    const rangeClause = srcCount > 1
      ? `, with a cross-source range of ${fmtPerShare(srcLow)}–${fmtPerShare(srcHigh)} reflecting normal sell-side panel dispersion (forecasts legitimately spread — not an error)`
      : ` — single source, unconfirmed by a second aggregator`;
    sourceLine = `Price targets are sell-side FORECASTS, shown as a Street consensus (mean of ${srcCount} source${srcCount === 1 ? '' : 's'}: ${srcList})${rangeClause}. Analyst high/low and coverage from Nasdaq. Point-in-time${meanAsOf ? `, as of ${meanAsOf}` : ''}, not guarantees. Current price and offer per the deal model.`;
  }
  // Forward block is FMP-sourced (single source — nothing else provides forward consensus). New data, no source lost.
  if (fwd.length) {
    sourceLine += ` Forward revenue/EPS consensus (FY${fwd.map(e => e.fy).join(' & FY')}) from Financial Modeling Prep analyst estimates — single-source, point-in-time, not guarantees.`;
  }

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit M">
      <PageHeader
        title="Analyst Consensus Overview"
        subtitle={`${tName}${target?.ticker ? ` (${target.ticker})` : ''} · Sell-side price targets vs. offer`}
      />

      <div style={{ padding: '16px 20px 36px' }}>
        {hasBankData ? (
          <>
            {/* ── Per-bank price-target chart (NEW — the deduped sell-side panel) ─────────── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Sell-Side Price Targets by Firm
                <span style={{ fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}> · latest per broker, deduped &amp; outlier-screened</span>
              </div>
              <div style={{ fontSize: 9, color: '#9CA3AF' }}>
                {bankTargets.length} firms
                {bank?.droppedStale ? ` · ${bank.droppedStale} stale dropped` : ''}
                {bank?.droppedOutliers ? ` · ${bank.droppedOutliers} outliers dropped` : ''}
              </div>
            </div>
            {(() => {
              // Scale spans the panel low→high plus offer/current so the reference lines sit in-frame.
              const refs = [bank.low, bank.high, offer, currentPrice].filter(v => v != null && !isNaN(v));
              const lo = Math.min(...bankTargets.map(t => t.target), ...refs);
              const hi = Math.max(...bankTargets.map(t => t.target), ...refs);
              const bpad = (hi - lo) * 0.06 || hi * 0.05;
              const bMin = lo - bpad, bMax = hi + bpad;
              const bx = (v) => ((v - bMin) / ((bMax - bMin) || 1)) * 100;
              const medianV = bank.median;
              return (
                <div style={{ position: 'relative', marginBottom: 16 }}>
                  {/* reference verticals: median (blue), offer (green), current (navy) */}
                  {[
                    { v: medianV, c: SF_BLUE, lbl: `Median ${fmtPerShare(medianV)}` },
                    { v: offer, c: '#166534', lbl: `Offer ${fmtPerShare(offer)}` },
                    { v: currentPrice, c: '#9CA3AF', lbl: `Current ${fmtPerShare(currentPrice)}` },
                  ].filter(r => r.v != null && !isNaN(r.v)).map((r, i) => (
                    <div key={i} style={{ position: 'absolute', left: `${bx(r.v)}%`, top: 0, bottom: 18, width: 0, borderLeft: `1.5px dashed ${r.c}`, zIndex: 1 }}>
                      <div style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 8, fontWeight: 700, color: r.c }}>{r.lbl}</div>
                    </div>
                  ))}
                  <div style={{ paddingTop: 14 }}>
                    {bankTargets.map((t) => {
                      const w = bx(t.target);
                      const above = offer != null && t.target >= offer;
                      return (
                        <div key={t.firm} style={{ display: 'flex', alignItems: 'center', height: 16, marginBottom: 2 }}>
                          <div style={{ width: 120, flexShrink: 0, fontSize: 8.5, color: '#374151', textAlign: 'right', paddingRight: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.firm}>
                            {t.firm}
                          </div>
                          <div style={{ flex: 1, position: 'relative', height: 12 }}>
                            <div style={{ position: 'absolute', left: 0, top: '50%', width: `${w}%`, height: 6, transform: 'translateY(-50%)', background: above ? '#B7D8F5' : '#DCE3EC', borderRadius: 3 }} />
                            <div style={{ position: 'absolute', left: `${w}%`, top: '50%', transform: 'translate(-50%,-50%)', width: 7, height: 7, borderRadius: '50%', background: above ? SF_BLUE : '#94A3B8', zIndex: 2 }} />
                            <div style={{ position: 'absolute', left: `calc(${w}% + 7px)`, top: '50%', transform: 'translateY(-50%)', fontSize: 8.5, fontWeight: 700, color: NAVY, whiteSpace: 'nowrap' }}>{fmtPerShare(t.target)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ── Consensus stat block (from the deduped per-bank panel) ─────────────────── */}
            {/* MEDIAN leads (the deck headline — robust to the right-skew from a few very high targets);
                mean/high/low remain as secondary stats. This matches §12/§14 and reconciles with §16's
                independent Nasdaq SOT. */}
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Consensus Statistics <span style={{ fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>(deduped {bankTargets.length}-firm panel · median headline)</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Stat label="Median" value={fmtPerShare(bank.median)} accent={SF_BLUE} bg={ALT_ROW} />
              <Stat label="Mean"   value={fmtPerShare(bank.mean)}   accent={SF_BLUE} />
              <Stat label="High"   value={fmtPerShare(bank.high)} />
              <Stat label="Low"    value={fmtPerShare(bank.low)} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Stat label="Current Price" value={currentPrice != null ? fmtPerShare(currentPrice) : '—'} bg={ALT_ROW} />
              <Stat label="Offer Price"   value={offer != null ? fmtPerShare(offer) : '—'} accent="#166534" />
              <Stat
                label="Offer vs. Median"
                value={(offer != null && bank.median) ? fmtPctSigned(((offer - bank.median) / bank.median) * 100) : '—'}
                accent={(offer != null && bank.median) ? (offer >= bank.median ? '#166534' : '#DC2626') : NAVY}
              />
              <Stat
                label="Premium to Current"
                value={premium != null ? fmtPctSigned(premium) : (offer != null && currentPrice ? fmtPctSigned(((offer - currentPrice) / currentPrice) * 100) : '—')}
                accent="#166534"
              />
            </div>

            {/* ── Rating split (Nasdaq or grade-derived) ──────────────────────────────── */}
            {(bank.ratings && (bank.ratings.buy || bank.ratings.hold || bank.ratings.sell)) && (
              <div style={{ marginTop: 10, marginBottom: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  Analyst Ratings <span style={{ fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>(latest grade per firm{bank.totalAnalysts ? `, n = ${bank.totalAnalysts}` : ''})</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Stat label="Buy"  value={String(bank.ratings.buy)}  accent="#166534" bg="#F0FDF4" />
                  <Stat label="Hold" value={String(bank.ratings.hold)} accent="#B45309" bg="#FFFBEB" />
                  <Stat label="Sell" value={String(bank.ratings.sell)} accent="#DC2626" bg="#FEF2F2" />
                </div>
              </div>
            )}
          </>
        ) : hasAnalystData ? (
          <>
            {/* ── Thin-coverage stat block (fallback: panel <3 firms) ───────────────── */}
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              {fallbackHeader}
            </div>
            {/* Forecast framing — indicative figure + cross-source dispersion + source count (no pass/fail badge). */}
            <div style={{ fontSize: 10, color: '#374151', marginBottom: 8 }}>
              {consensus != null
                ? <>{figNoun} <strong style={{ color: SF_BLUE }}>{fmtPerShare(consensus)}</strong>
                    {srcCount > 1 && <> · sources range <strong>{fmtPerShare(srcLow)}–{fmtPerShare(srcHigh)}</strong></>}
                    {' · '}{srcCount} source{srcCount === 1 ? '' : 's'}
                    {srcCount === 1 && <span style={{ color: '#9CA3AF' }}> (single-source, unconfirmed)</span>}</>
                : '—'}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Stat label={figNoun}      value={fmtPerShare(consensus)} accent={SF_BLUE} bg={ALT_ROW} />
              <Stat label="High Target"  value={fmtPerShare(high)} />
              <Stat label="Low Target"   value={fmtPerShare(low)} />
              <Stat label="# Analysts"   value={count != null ? String(Math.round(count)) : '—'} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              <Stat label="Current Price" value={currentPrice != null ? fmtPerShare(currentPrice) : '—'} bg={ALT_ROW} />
              <Stat label="Offer Price"   value={offer != null ? fmtPerShare(offer) : '—'} accent="#166534" />
              <Stat
                label={`Offer vs. ${figNoun}`}
                value={(offer != null && consensus) ? fmtPctSigned(((offer - consensus) / consensus) * 100) : '—'}
                accent={(offer != null && consensus) ? (offer >= consensus ? '#166534' : '#DC2626') : NAVY}
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
              Analyst Target Range (Low–Consensus–High) vs. Offer &amp; Current
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
              {markers.map((m) => {
                const left = pctOf(m.value);
                // Collision-aware vertical lane (computed above) — replaces the old index-parity stagger.
                const top = LANE_TOP[laneByKey[m.key]] ?? 4;
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

        {/* ── Forward consensus estimates (NEW — FMP, the EDGAR gap) ─────────────── */}
        {fwd.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Forward Consensus Estimates <span style={{ fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>(FMP analyst panel — forward, not filings)</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {fwd.map((e) => (
                <div key={e.fy} style={{ flex: 1, minWidth: 0, padding: '10px 12px', background: '#FFFFFF', border: `1px solid ${GRAY_BORDER}`, borderRadius: 4 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                    FY{e.fy}{e.numAnalysts != null ? ` · ${e.numAnalysts} analysts` : ''}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: '#6B7280' }}>Revenue</span>
                    <span style={{ fontWeight: 700, color: NAVY }}>{e.revenueAvg != null ? fmtMoney(e.revenueAvg) : 'n/a'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: '#6B7280' }}>EPS</span>
                    <span style={{ fontWeight: 700, color: SF_BLUE }}>{e.epsAvg != null ? fmtPerShare(e.epsAvg) : 'n/a'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {est && !fwd.length && (
          <div style={{ marginTop: 18, fontSize: 10, color: '#9CA3AF', fontStyle: 'italic' }}>
            Forward revenue/EPS consensus not available for {tTicker} on the FMP analyst panel.
          </div>
        )}
      </div>

      {/* Source / footnote line */}
      <div style={{ padding: '0 20px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
        {sourceLine}
      </div>
    </PageFrame>
  );
}
