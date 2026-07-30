import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Cell, Tooltip,
} from 'recharts';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER, ALT_ROW, fmtMoney, fmtPerShare } from '../shared/deckTokens';
import { getMonthlyPrices } from '../../../services/priceHistory';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { useValuationSources, buildMethodologyRows, isRobustPanel } from '../../../hooks/useValuationSources';
import { composeSourceLine, formatDeckDate } from '../../../lib/composeSourceLine';

// MERGED valuation exhibit (was §12 Football Field + §14 Valuation Matrix). The two slides both rendered the
// SAME buildMethodologyRows Low/Mid/High TABLE — that duplicate table is dropped here; the football-field
// CHART already visualizes that data. All four UNIQUE blocks are preserved: (1) reference-price table +
// (2) chart from the old §12, (3) offer-vs-blend synthesis + (4) DCF assumptions panel from the old §14.
// buildMethodologyRows still runs unchanged (feeds the chart, the synthesis blend, and the ref rows), so
// every suppression/degrade rule (bank DCF/sector N6/N8, negative-equity DCF N1, thin analyst panel, FX
// USD conversion Stages 1-2b) flows in intact — this component only re-lays-out, it computes no new number.

const USED_FIELDS = ['price', 'week52High', 'week52Low', 'offerPrice', 'purchasePremium'];
const KIND_COLOR = { market: SF_BLUE, analyst: '#0B5CAB', dcf: NAVY, sector: '#4A9FD4' };

function toChartData(rows) {
  return rows.map(row => ({
    name: row.name,
    gapToLow: row.low,
    barWidth: Math.max(0, row.high - row.low),
    low: row.low, high: row.high, mid: row.mid,
    color: KIND_COLOR[row.kind] || SF_BLUE,
    isDcf: row.kind === 'dcf',
    note: row.note,
  }));
}

function DcfBar(props) {
  const { x, y, width, height, fill } = props;
  if (!width || !height) return null;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={0.25} />
      <rect x={x} y={y} width={width} height={height} fill="none" stroke={fill} strokeWidth={1.5} strokeDasharray="4 2" />
    </g>
  );
}
function SolidBar(props) {
  const { x, y, width, height, fill } = props;
  if (!width || !height) return null;
  return <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={0.4} stroke={fill} strokeWidth={1.5} />;
}
function OfferLabel({ viewBox, offerLabel }) {
  if (!viewBox) return null;
  return <text x={viewBox.x + 4} y={viewBox.y + 12} fill="#166534" fontSize={10} fontWeight={700}>{offerLabel}</text>;
}
function BlendLabel({ viewBox, label }) {
  if (!viewBox) return null;
  return <text x={viewBox.x + 4} y={viewBox.y + 24} fill={SF_BLUE} fontSize={10} fontWeight={700}>{label}</text>;
}
const FieldTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const row = payload.find(p => p.dataKey === 'barWidth');
  if (!row) return null;
  const d = row.payload;
  return (
    <div style={{ background: '#fff', border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
      <div style={{ fontWeight: 700, color: NAVY, marginBottom: 4 }}>{label}</div>
      <div>Low: {fmtPerShare(d.low)}</div>
      <div>Mid: {fmtPerShare(d.mid != null ? d.mid : (d.low + d.high) / 2)}</div>
      <div>High: {fmtPerShare(d.high)}</div>
    </div>
  );
};

// Reference-price row (from §12). `nm` = not-meaningful (degenerate negative-equity DCF): "n/m", no premium.
function RefRow({ label, value, offer, note, emphasize, nm }) {
  const prem = (!nm && value != null && value > 0 && offer > 0) ? ((offer - value) / value) * 100 : null;
  return (
    <tr>
      <td style={{ padding: '4px 10px', borderBottom: `1px solid ${GRAY_BORDER}`, color: '#374151', fontWeight: emphasize ? 700 : 400 }}>{label}</td>
      <td style={{ padding: '4px 10px', borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'right', fontWeight: 700, color: nm ? '#9CA3AF' : NAVY }}>
        {nm ? 'n/m' : (value != null ? fmtPerShare(value) : '—')}
      </td>
      <td style={{ padding: '4px 10px', borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'right', color: prem == null ? '#9CA3AF' : (prem >= 0 ? '#166534' : '#DC2626'), fontWeight: 600 }}>
        {prem == null ? '—' : `${prem >= 0 ? '+' : ''}${prem.toFixed(1)}%`}
      </td>
      <td style={{ padding: '4px 10px', borderBottom: `1px solid ${GRAY_BORDER}`, color: '#6B7280', fontSize: 9 }}>{note}</td>
    </tr>
  );
}

// Compact stat row for the DCF-assumptions panel (from §14).
function AssumptionRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '2px 0', borderBottom: `1px solid ${GRAY_BORDER}` }}>
      <span style={{ color: '#6B7280' }}>{label}</span>
      <span style={{ fontWeight: 700, color: NAVY }}>{value}</span>
    </div>
  );
}

export function SectionValuationSummary({ target, deal, pageNum }) {
  const { data: verifiedData } = useVerifiedData(target?.ticker ?? null);
  const sourceLine = composeSourceLine(USED_FIELDS, verifiedData?.fields, verifiedData?.asOf);
  const offerAsOf = formatDeckDate(deal?.offerPriceAsOf);
  const offerProvenance = (deal?.purchasePremium != null && offerAsOf)
    ? `Offer reflects a ${parseFloat(deal.purchasePremium).toFixed(0)}% premium to the target's live market price as of ${offerAsOf}.`
    : null;
  const offerPrice = parseFloat(deal?.offerPrice) || 0;

  const livePrice  = verifiedData?.fields?.price?.value      != null ? parseFloat(verifiedData.fields.price.value)      : null;
  const week52High = verifiedData?.fields?.week52High?.value != null ? parseFloat(verifiedData.fields.week52High.value) : null;
  const week52Low  = verifiedData?.fields?.week52Low?.value  != null ? parseFloat(verifiedData.fields.week52Low.value)  : null;
  const week52Src  = verifiedData?.fields?.week52High?.chosenSource;

  const [histRange, setHistRange]       = useState(null);
  const [priceLoading, setPriceLoading] = useState(!!target?.ticker);

  // Canonical diluted count (target.shares in millions → ×1e6 raw) so the DCF uses the deck-wide count.
  const canonShares = target?.shares != null && !isNaN(parseFloat(target.shares)) ? parseFloat(target.shares) * 1e6 : null;
  const { dcf, analyst, sector } = useValuationSources(target?.ticker ?? null, canonShares);

  // 52-week range fallback (only when the verified layer has none) — illustrative from monthly closes.
  useEffect(() => {
    if (!target?.ticker || (week52High != null && week52Low != null)) { setPriceLoading(false); return; }
    const anchor = livePrice != null && livePrice > 0
      ? livePrice
      : (offerPrice > 0 && (parseFloat(deal?.purchasePremium) || 0) > -90
          ? offerPrice / (1 + (parseFloat(deal?.purchasePremium) || 0) / 100) : null);
    if (anchor == null) { setPriceLoading(false); return; }
    setPriceLoading(true);
    getMonthlyPrices(target.ticker).then(result => {
      const series = result.series || [];
      const lastVal = series.length ? series[series.length - 1].value : 0;
      if (series.length >= 2 && lastVal > 0) {
        const scale = anchor / lastVal;
        const vals  = series.map(s => s.value * scale);
        setHistRange({ low: Math.min(...vals), high: Math.max(...vals), source: result.source });
      }
      setPriceLoading(false);
    }).catch(() => setPriceLoading(false));
  }, [target?.ticker, week52High, week52Low, livePrice, offerPrice, deal?.purchasePremium]);

  const SRC_LABEL = { cnbc: 'CNBC', yahoo: 'Yahoo Finance', finnhub: 'Finnhub', fmp: 'FMP' };
  const priceRange = (week52High != null && week52Low != null)
    ? { low: week52Low, high: week52High, note: `${SRC_LABEL[week52Src] || 'Market'} 52-week range` }
    : (histRange
        ? { low: histRange.low, high: histRange.high, note: `Illustrative — ${SRC_LABEL[histRange.source] || '12-mo'} monthly closes` }
        : null);

  // Methodology rows (52-Wk, Analyst, DCF, Sector) — UNCHANGED engine; feeds chart + blend + ref rows.
  const rows = buildMethodologyRows({ priceRange, analyst, dcf, sector });
  // Sector-median present but NOT in rows ⇒ buildMethodologyRows gated it as an outlier (like a negative-
  // equity DCF) → excluded from the blend; render its ref row as n/m + reason instead of the nonsense value.
  const sectorInBlend = rows.some((r) => r.key === 'sector');
  const sectorExcluded = !!(sector && sector.ok && !sectorInBlend);
  const chartData = toChartData(rows);
  const allLows  = chartData.map(d => d.gapToLow);
  const allHighs = chartData.map(d => d.gapToLow + d.barWidth);
  const insufficient = rows.length < 1;

  // Cross-methodology synthesis (from §14): blended midpoint + where the offer sits.
  const mids = rows.map(r => r.mid != null ? r.mid : (r.low + r.high) / 2).filter(v => v > 0);
  const blendedMid = mids.length ? mids.reduce((a, b) => a + b, 0) / mids.length : null;
  const offerVsBlend = (blendedMid != null && offerPrice > 0) ? ((offerPrice - blendedMid) / blendedMid) * 100 : null;
  const a = dcf?.ok ? dcf.assumptions : null;

  const xMin = Math.min(...allLows, offerPrice, blendedMid || Infinity) * 0.9;
  const xMax = Math.max(...allHighs, offerPrice, blendedMid || 0) * 1.1;
  const offerLabel = `Offer ${fmtPerShare(offerPrice)}`;

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit N">
      <PageHeader
        title={`Valuation Summary — ${target?.name || 'Target'}`}
        subtitle="Reference prices, methodology ranges & app-built DCF vs. offer  ·  Precedent transactions omitted (unsourceable)"
      />

      {/* ── Row 1: reference-price table (left) + DCF assumptions panel (right) ─────────────────── */}
      <div style={{ display: 'flex', gap: 18, padding: '12px 20px 4px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>
            Reference Prices <span style={{ fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>· offer premium / (discount) to each</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5 }}>
            <thead>
              <tr>
                {['Reference', 'Value / Share', 'Offer vs.', 'Basis'].map(h => (
                  <th key={h} style={{ padding: '5px 10px', background: NAVY, color: '#fff', fontSize: 9, fontWeight: 700,
                    textAlign: h === 'Reference' || h === 'Basis' ? 'left' : 'right', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <RefRow label="Current Price"         value={livePrice} offer={offerPrice} note="Live market price" emphasize />
              <RefRow label="52-Week High"          value={priceRange?.high} offer={offerPrice} note={priceRange?.note} />
              <RefRow label="52-Week Low"           value={priceRange?.low}  offer={offerPrice} note={priceRange?.note} />
              <RefRow label="Median Analyst Target" value={analyst?.ok ? analyst.median : null}  offer={offerPrice} note={analyst?.ok ? (isRobustPanel(analyst) ? `${analyst.count}-firm deduped panel · median` : `thin (N=${analyst.count}) · indicative`) : 'n/a'} />
              <RefRow label="DCF Fair Value"        value={dcf?.ok ? dcf.perShare : null}  nm={!!(dcf && !dcf.ok && dcf.note)}  offer={offerPrice} note={dcf?.ok ? `App-built · WACC ${dcf.assumptions.waccPct}%` : (dcf && dcf.note ? dcf.note : 'n/a')} />
              <RefRow label="Sector-Median EV/Rev"  value={(sector?.ok && !sectorExcluded) ? sector.impliedPerShare : null} nm={sectorExcluded} offer={offerPrice} note={sectorExcluded ? 'Not meaningful — implied value implausible vs other methods (peer multiple not representative for this issuer)' : (sector?.ok ? `${sector.medianEvToSales}x median` : 'n/a')} />
              {offerPrice > 0 && (
                <tr>
                  <td style={{ padding: '5px 10px', background: '#F0FDF4', fontWeight: 700, color: NAVY, borderTop: `2px solid #166534` }}>Offer Price</td>
                  <td style={{ padding: '5px 10px', background: '#F0FDF4', textAlign: 'right', fontWeight: 700, color: '#166534', borderTop: `2px solid #166534` }}>{fmtPerShare(offerPrice)}</td>
                  <td style={{ padding: '5px 10px', background: '#F0FDF4', textAlign: 'right', color: '#9CA3AF', borderTop: `2px solid #166534` }}>—</td>
                  <td style={{ padding: '5px 10px', background: '#F0FDF4', color: '#374151', fontSize: 9, fontWeight: 700, borderTop: `2px solid #166534` }}>
                    {deal?.purchasePremium != null ? `${parseFloat(deal.purchasePremium).toFixed(1)}% premium to live price` : 'Offer per share'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* DCF assumptions panel (from §14) */}
        <div style={{ flex: '0 0 226px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>
            DCF Assumptions <span style={{ fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>(app-built)</span>
          </div>
          {a ? (
            <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ background: NAVY, padding: '5px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Fair Value / Share</span>
                <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>{fmtPerShare(dcf.perShare)}</span>
              </div>
              <div style={{ padding: '7px 12px' }}>
                <div style={{ fontSize: 9, color: '#6B7280', marginBottom: 5 }}>
                  Sensitivity band <strong style={{ color: NAVY }}>{fmtPerShare(dcf.low)} – {fmtPerShare(dcf.high)}</strong> (WACC ±1%)
                </div>
                <AssumptionRow label="Trailing FCF" value={fmtMoney(a.fcf0 / 1e6)} />
                <AssumptionRow label="Near-term growth" value={`${a.nearTermGrowthPct}%`} />
                <AssumptionRow label="Terminal growth" value={`${a.terminalGrowthPct}%`} />
                <AssumptionRow label="Beta" value={a.beta} />
                <AssumptionRow label="WACC (rf + β·ERP)" value={`${a.waccPct}%`} />
                <AssumptionRow label="Forecast horizon" value={`${a.years} yrs`} />
                <AssumptionRow label="Net debt" value={a.netDebt != null ? fmtMoney(a.netDebt / 1e6) : '—'} />
                <AssumptionRow label="Diluted shares" value={a.shares != null ? `${(a.shares / 1e6).toFixed(0)}M` : '—'} />
              </div>
            </div>
          ) : (
            <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '12px', fontSize: 10, color: '#9CA3AF', fontStyle: 'italic' }}>
              {dcf?.note || 'App-built DCF unavailable — no positive trailing free cash flow, or inputs missing.'}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: football-field chart (full width) + offer & blended-midpoint markers ─────────── */}
      <div style={{ padding: '2px 20px 2px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
          Valuation Range by Methodology
          {priceLoading && <span style={{ fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}> · loading 52-week history…</span>}
        </div>
        {insufficient ? (
          <div style={{ padding: '34px', textAlign: 'center', fontSize: 12, color: '#9CA3AF' }}>
            No valuation methodologies available on the current data stack.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(150, rows.length * 42 + 34)}>
            <BarChart layout="vertical" data={chartData} margin={{ top: 22, right: 60, left: 8, bottom: 4 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis type="number" domain={[xMin, xMax]} tickFormatter={fmtPerShare} tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={{ stroke: GRAY_BORDER }} tickLine={false} />
              <YAxis type="category" dataKey="name" width={175} tick={{ fontSize: 10, fill: '#374151' }} axisLine={false} tickLine={false} />
              <Tooltip content={<FieldTooltip />} />
              <Bar dataKey="gapToLow" stackId="ff" fill="transparent" isAnimationActive={false}>
                {chartData.map((e, i) => <Cell key={i} fill="transparent" />)}
              </Bar>
              <Bar dataKey="barWidth" stackId="ff" isAnimationActive={false}
                shape={(props) => props.payload.isDcf ? <DcfBar {...props} fill={props.payload.color} /> : <SolidBar {...props} fill={props.payload.color} />}>
                {chartData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Bar>
              {blendedMid != null && (
                <ReferenceLine x={blendedMid} stroke={SF_BLUE} strokeWidth={1.5} strokeDasharray="5 3" label={<BlendLabel label={`Blend ${fmtPerShare(blendedMid)}`} />} />
              )}
              {offerPrice > 0 && (
                <ReferenceLine x={offerPrice} stroke="#166534" strokeWidth={2} label={<OfferLabel offerLabel={offerLabel} />} />
              )}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Synthesis strip (from §14) ─────────────────────────────────────────────────────────── */}
      {blendedMid != null && offerVsBlend != null && (
        <div style={{ margin: '2px 20px 0', fontSize: 10.5, color: '#374151', lineHeight: 1.5, background: ALT_ROW, border: `1px solid ${GRAY_BORDER}`, borderLeft: `4px solid ${SF_BLUE}`, borderRadius: 4, padding: '8px 12px' }}>
          Across {rows.length} independent methodolog{rows.length === 1 ? 'y' : 'ies'}, the blended midpoint fair value is
          {' '}<strong>{fmtPerShare(blendedMid)}</strong>. The <strong>{fmtPerShare(offerPrice)}</strong> offer sits
          {' '}<strong style={{ color: offerVsBlend >= 0 ? '#166534' : '#DC2626' }}>{offerVsBlend >= 0 ? '+' : ''}{offerVsBlend.toFixed(1)}%</strong>
          {' '}{offerVsBlend >= 0 ? 'above' : 'below'} that midpoint — a {offerVsBlend >= 0 ? 'premium' : 'discount'} to triangulated intrinsic value.
        </div>
      )}

      {(sourceLine || offerProvenance) && (
        <div style={{ padding: '6px 20px 12px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
          {offerProvenance}{offerProvenance && sourceLine ? ' ' : ''}{sourceLine} DCF is app-built from real trailing FCF, analyst revenue-CAGR growth, and a beta-derived WACC — every input shown above. Precedent-transaction multiples are omitted deck-wide (no sourceable comparable-deal set).
        </div>
      )}
    </PageFrame>
  );
}
