import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER } from '../shared/deckTokens';
import { getMonthlyPrices } from '../../../services/priceHistory';

// ── §Exchange Ratio Analysis (7H) ────────────────────────────────────────────────────────────────────────
// The HISTORICAL implied exchange ratio: target price ÷ acquirer price over the same monthly window §12 uses,
// with the OFFER-implied ratio marked. §12's /api/prices series are INDEXED to 100 at t0, so dividing them
// yields relative performance, not the price ratio — we UN-INDEX with the live quote as anchor
// (raw_t = livePrice × idx_t / idx_last), which returns the true dollar ratio and makes the last point equal
// the at-market ratio by construction. The marked line is offer ÷ acquirer price (the FULL implied ratio if
// paid entirely in stock) — NOT §11/Exhibit I's exchangeRatio (0.2784), which is the stock-LEG issuance ratio
// of a cash-and-stock deal and would read as a spurious discount. The basis difference is footnoted (required).

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtMonth = (m) => { const p = (m || '').split('-'); return p.length === 2 ? `${MONTHS[(+p[1]) - 1]} '${p[0].slice(2)}` : m; };
const fmt4 = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(4));

export function SectionExchangeRatioAnalysis({ target, acquirer, model, pageNum }) {
  const d  = model?.derived || {};
  const da = model?.dealAssumptions || {};
  const aTk = acquirer?.ticker || 'Acquirer';
  const bTk = target?.ticker   || 'Target';
  const pTgt = d.currentPriceTarget;      // same live quote §11 shows (T.price)
  const pAcq = d.currentPriceAcquirer;    // (A.price)
  const offer = d.offerPrice;
  const struckStockLeg = d.exchangeRatio; // Exhibit I's stock-leg ratio — footnote only, NOT marked
  const cashPct  = da.cashPercent != null ? da.cashPercent : null;
  const stockPct = da.stockPercent != null ? da.stockPercent : (cashPct != null ? 100 - cashPct : null);

  const [tgtSeries, setTgtSeries] = useState(null);
  const [acqSeries, setAcqSeries] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancel = false;
    if (!target?.ticker || !acquirer?.ticker) { setLoaded(true); return; }
    Promise.all([getMonthlyPrices(target.ticker), getMonthlyPrices(acquirer.ticker)])
      .then(([t, a]) => { if (cancel) return; setTgtSeries(t && t.series ? t.series : []); setAcqSeries(a && a.series ? a.series : []); setLoaded(true); });
    return () => { cancel = true; };
  }, [target?.ticker, acquirer?.ticker]);

  // Un-index to raw dollars, then divide. idx_last ↔ live quote (last bucket = current month).
  const tLast = tgtSeries && tgtSeries.length ? tgtSeries[tgtSeries.length - 1].value : null;
  const aLast = acqSeries && acqSeries.length ? acqSeries[acqSeries.length - 1].value : null;
  const aMap  = Object.fromEntries((acqSeries || []).map(p => [p.month, p.value]));
  const ok = pTgt > 0 && pAcq > 0 && tLast > 0 && aLast > 0;
  const data = ok ? (tgtSeries || [])
    .filter(p => aMap[p.month] != null)
    .map(p => {
      const rawTgt = pTgt * p.value / tLast;
      const rawAcq = pAcq * aMap[p.month] / aLast;
      return { month: p.month, ratio: rawAcq > 0 ? rawTgt / rawAcq : null };
    })
    .filter(x => x.ratio != null) : [];

  const atMarket     = ok ? pTgt / pAcq : null;
  const offerImplied = (offer > 0 && pAcq > 0) ? offer / pAcq : null;
  const periodAvg    = data.length ? data.reduce((s, x) => s + x.ratio, 0) / data.length : null;
  const firstMonth   = data.length ? data[0].month : null;
  const lastMonth    = data.length ? data[data.length - 1].month : null;

  // y-domain built from the ratio series + at-market line. The offer-implied line is included ONLY when it
  // sits within ~1.5× the series range of an edge (a realistic premium); an EXTREME offer (e.g. a +640% test
  // premium) must not stretch the axis and flatten the series, so it is clamped to the edge and labeled
  // instead. No zero-clamp: a small-magnitude ratio (0.03) must fill the plot, not sit on the axis (1a/1b).
  const seriesVals = data.map(x => x.ratio).concat(atMarket != null ? [atMarket] : []);
  const sMin = seriesVals.length ? Math.min(...seriesVals) : 0;
  const sMax = seriesVals.length ? Math.max(...seriesVals) : 1;
  const band = ((sMax - sMin) || sMax * 0.5) * 1.5;   // how far past an edge the offer may reach and stay in-scale
  let dMin = sMin, dMax = sMax;
  if (offerImplied != null && offerImplied >= sMin - band && offerImplied <= sMax + band) {
    dMin = Math.min(dMin, offerImplied); dMax = Math.max(dMax, offerImplied);
  }
  const pad = (dMax - dMin) * 0.15 || dMax * 0.1 || 0.05;
  const domain = [+(dMin - pad).toFixed(4), +(dMax + pad).toFixed(4)];
  const tickFmt = (v) => ((domain[1] - domain[0]) < 0.15 ? v.toFixed(3) : v.toFixed(2));
  // Offer line: in-range (typical / included above) → drawn at value; extreme → clamped to the nearest edge
  // (dashed) + labeled with its TRUE value and an arrow, so it shows without wrecking the scale.
  const offerInRange = offerImplied != null && offerImplied >= domain[0] && offerImplied <= domain[1];
  const offerY = offerImplied == null ? null : Math.min(domain[1], Math.max(domain[0], offerImplied));

  const KEY = [
    { c: SF_BLUE,   dash: false, label: `Implied ratio (${bTk} ÷ ${aTk}), monthly`, val: null },
    { c: '#B45309', dash: false, label: 'Offer-implied ratio', val: offerImplied, note: [premiumNote(offerImplied, atMarket), offerInRange ? null : 'off-scale'].filter(Boolean).join(' · ') || null },
    { c: NAVY,      dash: true,  label: 'At-market ratio (current)', val: atMarket },
    { c: '#9CA3AF', dash: true,  label: 'Period average', val: periodAvg },
  ];

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit J">
      <PageHeader
        title="Exchange Ratio Analysis"
        subtitle={`${aTk} / ${bTk} · implied exchange ratio (${bTk} share price ÷ ${aTk} share price) over time`}
      />
      <div style={{ padding: '14px 20px 6px' }}>
        {!loaded ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', fontSize: 12, fontStyle: 'italic' }}>Loading price history…</div>
        ) : data.length < 2 ? (
          <div style={{ padding: '10px 12px', background: '#FFFBEB', border: '1px dashed #F59E0B', borderRadius: 6, fontSize: 11, color: '#92400E' }}>
            Monthly price history unavailable for {aTk}/{bTk} — no implied-ratio series is fabricated.
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={318}>
              <LineChart data={data} margin={{ top: 10, right: 28, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F5" />
                <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fontSize: 10, fill: '#6B7280' }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis domain={domain} tick={{ fontSize: 10, fill: '#6B7280' }} tickFormatter={tickFmt} width={44}
                  label={{ value: `${bTk} ÷ ${aTk}`, angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#6B7280', textAnchor: 'middle' } }} />
                <Tooltip formatter={(v) => [fmt4(v), 'Ratio']} labelFormatter={fmtMonth}
                  contentStyle={{ fontSize: 11, borderRadius: 6, border: `1px solid ${GRAY_BORDER}` }} />
                {periodAvg != null && <ReferenceLine y={periodAvg} stroke="#9CA3AF" strokeDasharray="2 4" strokeWidth={1} />}
                {atMarket != null && <ReferenceLine y={atMarket} stroke={NAVY} strokeDasharray="5 3" strokeWidth={1.5} />}
                {offerY != null && <ReferenceLine y={offerY} stroke="#B45309" strokeWidth={2} strokeDasharray={offerInRange ? undefined : '4 3'}
                  label={{ value: offerInRange ? `offer ${fmt4(offerImplied)}` : `offer ${fmt4(offerImplied)} ${offerImplied > domain[1] ? '▲' : '▼'}`, position: 'right', fill: '#B45309', fontSize: 9, fontWeight: 700 }} />}
                <Line type="monotone" dataKey="ratio" stroke={SF_BLUE} strokeWidth={2.5} dot={{ r: 2, fill: SF_BLUE }} activeDot={{ r: 4 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>

            {/* Key — each reference line labeled with its value (avoids on-chart label overlap). */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 6, fontSize: 10.5 }}>
              {KEY.map((k) => (
                <span key={k.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#374151' }}>
                  <span style={{ width: 20, height: 0, borderTop: `${k.dash ? '2px dashed' : '3px solid'} ${k.c}` }} />
                  {k.label}{k.val != null ? <strong style={{ color: k.c }}> {fmt4(k.val)}</strong> : null}{k.note ? <span style={{ color: '#9CA3AF' }}> ({k.note})</span> : null}
                </span>
              ))}
            </div>

            {/* Caption (2c) */}
            <div style={{ marginTop: 12, fontSize: 11, color: '#4B5563', lineHeight: 1.5 }}>
              The blue line is the ratio at which the market has valued <strong>{bTk}</strong> against <strong>{aTk}</strong> — {bTk}'s share price ÷ {aTk}'s — each month from <strong>{fmtMonth(firstMonth)}</strong> to <strong>{fmtMonth(lastMonth)}</strong>. The amber line is the ratio implied by the {offer != null ? `$${offer.toFixed(2)}` : ''} offer. Where it sits {offerImplied != null && atMarket != null && offerImplied < atMarket ? 'below' : 'above'} the current market ratio, the offer is at a {offerImplied != null && atMarket != null && offerImplied < atMarket ? 'discount' : 'premium'} to how the market currently prices the two companies against each other.
            </div>

            {/* Footnote (2d) — basis difference (required) + adjustment basis */}
            <div style={{ marginTop: 8, fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.45 }}>
              <strong style={{ color: NAVY }}>Basis: </strong>
              The <strong>offer-implied ratio</strong> ({fmt4(offerImplied)}) is what the {offer != null ? `$${offer.toFixed(2)}` : ''} offer implies <strong>if the whole consideration were paid in {aTk} stock</strong>. The shares actually issued in this {cashPct != null ? `${cashPct}% cash / ${stockPct}% stock` : 'cash-and-stock'} deal follow the <strong>stock-leg</strong> exchange ratio on <strong>Exhibit I</strong> — {fmt4(struckStockLeg)} {aTk} per {bTk} share — because only the {stockPct != null ? `${stockPct}%` : 'stock'} portion is exchanged for equity. Both are correct on different bases: this page is the full <em>price</em> ratio; Exhibit I is the actual <em>share issuance</em>.
              {' '}Series are provider end-of-day closes (FMP <code>price</code> for these tickers, Yahoo adjusted-close fallback), reconstructed to dollars from the deck's indexed monthly series anchored to the current quote ({fmtMonth(lastMonth)} — the last bucket coincides with the live quote, so no anchor gap). Neither company split during the window and dividends are immaterial to the ratio, so it is effectively split/dividend-neutral. Illustrative — not investment advice.
            </div>
          </>
        )}
      </div>
    </PageFrame>
  );
}

// "(−8.5% vs market)" style note comparing the offer-implied ratio to the at-market ratio.
function premiumNote(offerImplied, atMarket) {
  if (offerImplied == null || !(atMarket > 0)) return null;
  const pct = (offerImplied / atMarket - 1) * 100;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}% vs market`;
}
