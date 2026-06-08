import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Cell, Tooltip,
} from 'recharts';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER, fmtPerShare, fmtMoney, isFinancial } from '../shared/deckTokens';
import { getMonthlyPrices } from '../../../services/priceHistory';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { composeSourceLine } from '../../../lib/composeSourceLine';

const USED_FIELDS = ['price', 'week52High', 'week52Low', 'offerPrice', 'purchasePremium', 'dcfRange', 'precedentRange', 'footballRange'];

// ── Colors ────────────────────────────────────────────────────────────────────

const COLOR_TRADING  = SF_BLUE;       // comp / 52-wk
const COLOR_PRECEDENT = NAVY;          // precedent transactions
const COLOR_DCF      = '#9CA3AF';     // DCF illustrative

// ── Methodology builders ──────────────────────────────────────────────────────

function buildStandardMethodologies(target, deal, priceRange) {
  const ebitda = parseFloat(target.ebitda)    || 0;
  const rev    = parseFloat(target.revenue)   || 0;
  const eps    = parseFloat(target.eps)       || 0;
  const shares = parseFloat(target.shares)    || 0;
  const cash   = parseFloat(target.cash)      || 0;
  const debt   = parseFloat(target.debt)      || 0;
  const netDebt = debt - cash; // positive = net debt

  const rows = [];

  // 1. 52-week range
  if (priceRange) {
    rows.push({
      name: '52-Week Range',
      low: priceRange.low, high: priceRange.high,
      color: COLOR_TRADING, isDcf: false,
      note: priceRange.note || '52-week trading range',
    });
  }

  // 2. Trading comps EV/EBITDA — 8x–14x
  if (ebitda > 0 && shares > 0) {
    const toPrice = (mult) => Math.max(0, ((ebitda * mult) - netDebt) / shares);
    rows.push({
      name: 'Trading Comps (EV/EBITDA)',
      low: toPrice(8), high: toPrice(14),
      color: COLOR_TRADING, isDcf: false,
      note: 'Range: 8x–14x EBITDA',
    });
  }

  // 3. Trading comps P/E — 14x–22x
  if (eps > 0) {
    rows.push({
      name: 'Trading Comps (P/E)',
      low: eps * 14, high: eps * 22,
      color: COLOR_TRADING, isDcf: false,
      note: 'Range: 14x–22x EPS',
    });
  }

  // 4. Precedent transactions EV/Revenue — 2x–5x
  if (rev > 0 && shares > 0) {
    const toPrice = (mult) => Math.max(0, ((rev * mult) - netDebt) / shares);
    rows.push({
      name: 'Precedent Transactions (EV/Rev)',
      low: toPrice(2), high: toPrice(5),
      color: COLOR_PRECEDENT, isDcf: false,
      note: 'Range: 2x–5x Revenue',
    });
  }

  // 5. DCF illustrative — ±15% around midpoint of computed rows
  if (rows.length >= 2) {
    const midpoints = rows.map(r => (r.low + r.high) / 2);
    const avg = midpoints.reduce((a, b) => a + b, 0) / midpoints.length;
    rows.push({
      name: 'DCF (illustrative)',
      low: avg * 0.85, high: avg * 1.15,
      color: COLOR_DCF, isDcf: true,
      note: '±15% band around methodology midpoint',
    });
  }

  return rows;
}

function buildBankMethodologies(target, deal, priceRange) {
  const eps    = parseFloat(target.eps)    || 0;
  const shares = parseFloat(target.shares) || 0;
  const tbv    = target.tangibleBookValue  != null ? parseFloat(target.tangibleBookValue) : null;

  const rows = [];

  // 1. 52-week range
  if (priceRange) {
    rows.push({
      name: '52-Week Range',
      low: priceRange.low, high: priceRange.high,
      color: COLOR_TRADING, isDcf: false,
      note: priceRange.note || '52-week trading range',
    });
  }

  // 2. Trading comps P/TBV — 1.0x–2.0x
  if (tbv != null && tbv > 0 && shares > 0) {
    const tbvPerShare = tbv / shares;
    rows.push({
      name: 'Trading Comps (P/TBV)',
      low: tbvPerShare * 1.0, high: tbvPerShare * 2.0,
      color: COLOR_TRADING, isDcf: false,
      note: 'Range: 1.0x–2.0x peer median TBV',
    });
  }

  // 3. Trading comps P/E — 8x–14x
  if (eps > 0) {
    rows.push({
      name: 'Trading Comps (P/E)',
      low: eps * 8, high: eps * 14,
      color: COLOR_TRADING, isDcf: false,
      note: 'Range: 8x–14x EPS',
    });
  }

  // 4. Precedent bank transactions P/TBV — 1.4x–2.2x
  if (tbv != null && tbv > 0 && shares > 0) {
    const tbvPerShare = tbv / shares;
    rows.push({
      name: 'Precedent Bank Transactions (P/TBV)',
      low: tbvPerShare * 1.4, high: tbvPerShare * 2.2,
      color: COLOR_PRECEDENT, isDcf: false,
      note: '2010–2024 bank M&A median',
    });
  }

  // 5. DCF illustrative
  if (rows.length >= 2) {
    const midpoints = rows.map(r => (r.low + r.high) / 2);
    const avg = midpoints.reduce((a, b) => a + b, 0) / midpoints.length;
    rows.push({
      name: 'DCF (illustrative)',
      low: avg * 0.85, high: avg * 1.15,
      color: COLOR_DCF, isDcf: true,
      note: '±15% band around methodology midpoint',
    });
  }

  return rows;
}

// ── Chart data adapter ────────────────────────────────────────────────────────

function toChartData(rows, shares, showTotal) {
  return rows.map(row => {
    const scale = showTotal ? (shares || 1) : 1;
    const low   = row.low  * scale;
    const high  = row.high * scale;
    return {
      name:      row.name,
      gapToLow:  low,
      barWidth:  Math.max(0, high - low),
      low, high,
      color:     row.color,
      isDcf:     row.isDcf,
      note:      row.note,
    };
  });
}

// ── Custom bar shape — dashed border for DCF ─────────────────────────────────

function DcfBar(props) {
  const { x, y, width, height, fill } = props;
  if (!width || !height) return null;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={0.3} />
      <rect x={x} y={y} width={width} height={height} fill="none"
        stroke={COLOR_DCF} strokeWidth={1.5} strokeDasharray="4 2" />
    </g>
  );
}

function SolidBar(props) {
  const { x, y, width, height, fill } = props;
  if (!width || !height) return null;
  return (
    <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={0.4}
      stroke={fill} strokeWidth={1.5} />
  );
}

// ── Offer label at top of reference line ─────────────────────────────────────

function OfferLabel({ viewBox, offerLabel }) {
  if (!viewBox) return null;
  return (
    <text x={viewBox.x + 4} y={viewBox.y + 12} fill="#D62B2B" fontSize={10} fontWeight={700}>
      {offerLabel}
    </text>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

const FieldTooltip = ({ active, payload, label, showTotal, shares }) => {
  if (!active || !payload?.length) return null;
  const row = payload.find(p => p.dataKey === 'barWidth');
  if (!row) return null;
  const d = row.payload;
  const fmt = (v) => showTotal ? fmtMoney(v) : fmtPerShare(v);
  return (
    <div style={{ background: '#fff', border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
      <div style={{ fontWeight: 700, color: NAVY, marginBottom: 4 }}>{label}</div>
      <div>Low: {fmt(d.low)}</div>
      <div>High: {fmt(d.high)}</div>
      <div>Mid: {fmt((d.low + d.high) / 2)}</div>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

export function SectionFootballField({ target, deal, pageNum }) {
  const { data: verifiedData } = useVerifiedData(target?.ticker ?? null);
  const sourceLine = composeSourceLine(USED_FIELDS, verifiedData?.fields, verifiedData?.asOf);
  const bankMode   = isFinancial(target?.companyType);
  const offerPrice = parseFloat(deal?.offerPrice) || 0;
  const shares     = parseFloat(target?.shares)   || 0;

  // Real trailing 52-week range from the verified-data layer (CNBC yrhiprice/yrloprice). Live price
  // anchors the monthly-history fallback below.
  const livePrice  = verifiedData?.fields?.price?.value      != null ? parseFloat(verifiedData.fields.price.value)      : null;
  const week52High = verifiedData?.fields?.week52High?.value != null ? parseFloat(verifiedData.fields.week52High.value) : null;
  const week52Low  = verifiedData?.fields?.week52Low?.value  != null ? parseFloat(verifiedData.fields.week52Low.value)  : null;
  const week52Src  = verifiedData?.fields?.week52High?.chosenSource;

  const [showTotal, setShowTotal]     = useState(false);
  const [histRange, setHistRange]     = useState(null);
  const [priceLoading, setPriceLoading] = useState(!!target?.ticker);

  // Fallback ONLY: when the verified layer has no real 52-week range, derive an illustrative range
  // from the relative monthly-close history, anchored so the MOST RECENT month equals the live price
  // (the prior code anchored the series START to current price, which made the high == current price).
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
        const scale = anchor / lastVal; // pin the current month to the live price
        const vals  = series.map(s => s.value * scale);
        setHistRange({ low: Math.min(...vals), high: Math.max(...vals), source: result.source });
      }
      setPriceLoading(false);
    }).catch(() => setPriceLoading(false));
  }, [target?.ticker, week52High, week52Low, livePrice, offerPrice, deal?.purchasePremium]);

  // Compose the 52-week range row: prefer the real CNBC range, else the anchored monthly fallback.
  const SRC_LABEL = { cnbc: 'CNBC', yahoo: 'Yahoo Finance', finnhub: 'Finnhub', fmp: 'FMP' };
  const priceRange = (week52High != null && week52Low != null)
    ? { low: week52Low, high: week52High, note: `${SRC_LABEL[week52Src] || 'Market'} 52-week range` }
    : (histRange
        ? { low: histRange.low, high: histRange.high,
            note: `Illustrative — ${SRC_LABEL[histRange.source] || '12-mo'} monthly closes (intraday extremes not captured)` }
        : null);

  // Build methodology rows
  const rows = bankMode
    ? buildBankMethodologies(target, deal, priceRange)
    : buildStandardMethodologies(target, deal, priceRange);

  const offerScaled = showTotal ? offerPrice * shares : offerPrice;
  const chartData   = toChartData(rows, shares, showTotal);

  // X-axis domain: span all bars + 10% headroom
  const allLows  = chartData.map(d => d.gapToLow);
  const allHighs = chartData.map(d => d.gapToLow + d.barWidth);
  const xMin = Math.min(...allLows, offerScaled) * 0.9;
  const xMax = Math.max(...allHighs, offerScaled) * 1.1;

  const fmt = (v) => showTotal ? fmtMoney(v) : fmtPerShare(v);
  const offerLabel = `Offer: ${fmt(offerScaled)}`;

  const insufficient = rows.length < 2;

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit J">
      <PageHeader
        title={`Valuation Football Field — ${target?.name || 'Target'}`}
        subtitle="Multiple Valuation Methodologies vs. Offer Price"
      />

      {/* Toggle */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 24px 0' }}>
        <div style={{ display: 'flex', border: `1px solid ${GRAY_BORDER}`, borderRadius: 4, overflow: 'hidden', fontSize: 11 }}>
          {['Per Share', 'Total ($M)'].map((label, idx) => {
            const active = showTotal === (idx === 1);
            return (
              <button key={label} onClick={() => setShowTotal(idx === 1)} style={{
                padding: '4px 10px', border: 'none', cursor: 'pointer', fontWeight: active ? 700 : 400,
                background: active ? NAVY : '#fff', color: active ? '#fff' : '#374151', fontSize: 11,
              }}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: '8px 20px 4px' }}>
        {insufficient ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '80px 40px', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#6B7280' }}>
              Insufficient data for valuation triangulation.
            </div>
            <div style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', maxWidth: 360 }}>
              Add target financials in Manual Entry mode to populate this exhibit.
            </div>
          </div>
        ) : (
          <>
            {priceLoading && (
              <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 6, textAlign: 'right' }}>
                Loading 52-week price history…
              </div>
            )}
            <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 52 + 40)}>
              <BarChart
                layout="vertical"
                data={chartData}
                margin={{ top: 20, right: 50, left: 8, bottom: 4 }}
              >
                <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis
                  type="number"
                  domain={[xMin, xMax]}
                  tickFormatter={fmt}
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  axisLine={{ stroke: GRAY_BORDER }}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={180}
                  tick={{ fontSize: 10, fill: '#374151' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<FieldTooltip showTotal={showTotal} shares={shares} />} />

                {/* Invisible spacer bar from 0 to low */}
                <Bar dataKey="gapToLow" stackId="ff" fill="transparent" isAnimationActive={false}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill="transparent" />
                  ))}
                </Bar>

                {/* Visible range bar */}
                <Bar dataKey="barWidth" stackId="ff" isAnimationActive={false}
                  shape={(props) => {
                    const row = props.payload;
                    return row.isDcf ? <DcfBar {...props} fill={row.color} /> : <SolidBar {...props} fill={row.color} />;
                  }}
                >
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>

                {/* Offer price vertical line */}
                {offerScaled > 0 && (
                  <ReferenceLine
                    x={offerScaled}
                    stroke="#D62B2B"
                    strokeWidth={2}
                    label={<OfferLabel offerLabel={offerLabel} />}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {/* Footer table */}
      {!insufficient && (
        <div style={{ padding: '0 20px 36px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                {['Methodology', 'Low', 'Mid', 'High', 'Note'].map(h => (
                  <th key={h} style={{
                    padding: '5px 10px', background: NAVY, color: '#fff', fontSize: 10,
                    fontWeight: 700, textAlign: h === 'Methodology' || h === 'Note' ? 'left' : 'right',
                    borderBottom: `2px solid ${GRAY_BORDER}`, whiteSpace: 'nowrap',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const mid = (row.low + row.high) / 2;
                const scale = showTotal ? shares : 1;
                const bg = i % 2 === 0 ? '#fff' : '#F9FAFB';
                const f = (v) => showTotal ? fmtMoney(v * scale) : fmtPerShare(v);
                return (
                  <tr key={row.name}>
                    <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, color: '#374151' }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: row.isDcf ? 0 : 2,
                        background: row.isDcf ? 'transparent' : row.color,
                        border: row.isDcf ? `1.5px dashed ${COLOR_DCF}` : 'none',
                        marginRight: 6, verticalAlign: 'middle' }} />
                      {row.name}
                    </td>
                    <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'right', color: '#374151' }}>{f(row.low)}</td>
                    <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'right', color: '#374151' }}>{f(mid)}</td>
                    <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'right', color: '#374151' }}>{f(row.high)}</td>
                    <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, color: '#6B7280', fontSize: 10 }}>{row.note}</td>
                  </tr>
                );
              })}
              {/* Offer row */}
              {offerPrice > 0 && (
                <tr>
                  <td style={{ padding: '5px 10px', background: '#FEF2F2', borderBottom: `1px solid ${GRAY_BORDER}`, fontWeight: 700, color: NAVY }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 1, background: '#D62B2B', marginRight: 6, verticalAlign: 'middle' }} />
                    Offer Price
                  </td>
                  <td style={{ padding: '5px 10px', background: '#FEF2F2', borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'right', fontWeight: 700, color: NAVY }}>
                    {showTotal ? fmtMoney(offerPrice * shares) : fmtPerShare(offerPrice)}
                  </td>
                  <td style={{ padding: '5px 10px', background: '#FEF2F2', borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'right', color: '#9CA3AF' }}>—</td>
                  <td style={{ padding: '5px 10px', background: '#FEF2F2', borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'right', color: '#9CA3AF' }}>—</td>
                  <td style={{ padding: '5px 10px', background: '#FEF2F2', borderBottom: `1px solid ${GRAY_BORDER}`, color: '#374151', fontWeight: 700, fontSize: 10 }}>
                    {deal?.purchasePremium != null ? `${parseFloat(deal.purchasePremium).toFixed(1)}% premium to current` : 'Offer price per share'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {sourceLine && (
        <div style={{ padding: '0 20px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
          {sourceLine}
        </div>
      )}
    </PageFrame>
  );
}
