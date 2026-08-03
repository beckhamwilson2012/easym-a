import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceDot, ResponsiveContainer,
} from 'recharts';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER } from '../shared/deckTokens';
import { getMonthlyPrices } from '../../../services/priceHistory';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { composeSourceLine } from '../../../lib/composeSourceLine';

const EVENT_RED = '#D62B2B';

// Per-ticker curated/editorial event lists are DISABLED. A prior hand-written TEAM narrative ("de-rating on
// AI-displacement concerns") was marked sourced and footnoted "from company filings" — a false attribution
// we removed. Annotations are now STRICTLY sourced: Tier 1 = a real earnings report date (FMP) that the move
// coincides with; Tier 3 = the honest magnitude-only move. NEVER an invented or guessed catalyst (see
// deriveEvents). News headlines were assessed (FMP /stable/news) and deliberately NOT shipped — correctly
// filtered but not reliably explanatory of a monthly move, so they'd risk fabrication-by-proxy.

// "2026-02" → "Feb 2026"
function labelMonth(mo) {
  const d = new Date(mo + '-15');
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// "2026-02-05" → "Feb 5, 2026" (earnings-date label)
function fmtEarnDate(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Tier 1 — earnings coincidence, assigned GLOBALLY so each earnings date annotates at most ONE move (and each
// move at most one earnings). For each report date: if a selected move exists in the report's OWN month, that
// move claims it (and we stop — never also tag a neighbor); otherwise a month-END report (last ~6 days, whose
// price reaction lands in the next monthly bucket — e.g. Apr 30 → May) is claimed by a move in the NEXT month.
// This avoids double-attribution (a late-May report would otherwise tag both the May and June moves). We note
// ONLY the temporal coincidence — never that earnings caused the move. Returns { 'YYYY-MM': earningsRecord }.
function assignEarnings(moveMonths, earnings) {
  const moveSet = new Set(moveMonths);
  const assigned = {};
  const claim = (mon, e) => { if (moveSet.has(mon) && (!assigned[mon] || e.date > assigned[mon].date)) assigned[mon] = e; };
  for (const e of earnings || []) {
    const [ey, em, ed] = (e.date || '').split('-').map(Number);
    if (!ey || !em) continue;
    const ownMonth = `${ey}-${String(em).padStart(2, '0')}`;
    if (moveSet.has(ownMonth)) { claim(ownMonth, e); continue; }      // report inside a move's own month → that move only
    const lastDay = new Date(Date.UTC(ey, em, 0)).getUTCDate();       // month-end report → next-month reaction
    if (ed >= lastDay - 6) {
      const nm = em === 12 ? `${ey + 1}-01` : `${ey}-${String(em + 1).padStart(2, '0')}`;
      claim(nm, e);
    }
  }
  return assigned;
}

// Up to 6 numbered events for the target line, derived from the 6 largest month-over-month moves in the real
// series. Each carries its honest magnitude (Tier 3); a move that coincides with a REAL earnings date is
// additionally annotated and sourced (Tier 1). No fabricated catalysts — earnings coincidence or nothing.
function deriveEvents(ticker, series, earnings) {
  if (!series || series.length < 2) return [];
  const moves = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value, cur = series[i].value;
    if (prev > 0) moves.push({ month: series[i].month, value: cur, pct: (cur / prev - 1) * 100 });
  }
  const top = moves
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 6)
    .sort((a, b) => a.month.localeCompare(b.month));
  const assigned = assignEarnings(top.map(m => m.month), earnings);
  return top.map((m, i) => {
    const earn = assigned[m.month] || null;
    return {
      month: m.month, value: m.value, n: i + 1,
      magnitude: `${m.pct >= 0 ? '▲ Rallied' : '▼ Declined'} ${Math.abs(m.pct).toFixed(0)}% month-over-month`,
      sourced: !!earn,
      catalyst: earn ? `coincides with quarterly earnings (reported ${fmtEarnDate(earn.date)})` : null,
      sourceTag: earn ? '(earnings date, FMP)' : null,
    };
  });
}

// Price history uses market sources (Finnhub/Yahoo via priceHistory service)
const USED_FIELDS = ['price'];

// Merge target, acquirer, and S&P series onto shared month keys
function mergeSeries(targetSeries, acquirerSeries, spySeries) {
  const monthSet = new Set([
    ...targetSeries.map(d => d.month),
    ...spySeries.map(d => d.month),
  ]);
  const months = [...monthSet].sort();

  const tMap = Object.fromEntries(targetSeries.map(d => [d.month, d.value]));
  const aMap = Object.fromEntries(acquirerSeries.map(d => [d.month, d.value]));
  const sMap = Object.fromEntries(spySeries.map(d => [d.month, d.value]));

  return months.map(mo => ({
    month: mo,
    target: tMap[mo] ?? null,
    acquirer: aMap[mo] ?? null,
    spy: sMap[mo] ?? null,
  }));
}

function shortMonth(mo) {
  // "2024-03" → "Mar"
  const d = new Date(mo + '-15');
  return d.toLocaleDateString('en-US', { month: 'short' });
}

// Simple illustrative series: starts at 100, adds noise
function generateIllustrative(seed, months) {
  let val = 100;
  return months.map((mo, i) => {
    const delta = ((seed * (i + 1) * 13) % 7) - 3;
    val = Math.max(50, val + delta);
    return { month: mo, value: parseFloat(val.toFixed(2)) };
  });
}

function buildIllustrativeMonths() {
  const months = [];
  const now = new Date();
  for (let i = 12; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

export function SectionPricePerformance({ target, acquirer, pageNum, exhibitLabel }) {
  const { data: verifiedData } = useVerifiedData(target?.ticker ?? null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [illustrative, setIllustrative] = useState(false);
  const [hasAcquirer, setHasAcquirer] = useState(false);
  const [earnings, setEarnings] = useState([]); // real reported earnings dates (FMP) — Tier 1 annotation source

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const fetchAll = async () => {
      const [targetResult, acquirerResult, spyResult] = await Promise.all([
        getMonthlyPrices(target.ticker),
        acquirer?.ticker ? getMonthlyPrices(acquirer.ticker) : Promise.resolve({ source: 'illustrative', series: [] }),
        getMonthlyPrices('SPY'),
      ]);

      if (cancelled) return;

      const illMonths = buildIllustrativeMonths();
      let targetSeries = targetResult.series;
      let illustrative = false;

      if (!targetSeries.length) {
        targetSeries = generateIllustrative(7, illMonths);
        illustrative = true;
      }

      let acquirerSeries = acquirerResult.series;
      const showAcquirer = !!(acquirer?.ticker && acquirerSeries.length);

      let spySeries = spyResult.series;
      if (!spySeries.length) {
        spySeries = generateIllustrative(3, illMonths);
      }

      const merged = mergeSeries(
        targetSeries,
        showAcquirer ? acquirerSeries : [],
        spySeries
      );

      setData(merged);
      setHasAcquirer(showAcquirer);
      setIllustrative(illustrative);
      setLoading(false);
    };

    fetchAll();
    return () => { cancelled = true; };
  }, [target.ticker, acquirer]);

  // Real reported earnings dates for the target (FMP, via the server so the key stays server-side). Used to
  // annotate moves that coincide with an earnings report (Tier 1). Empty on thin coverage → magnitude-only.
  useEffect(() => {
    if (!target?.ticker) { setEarnings([]); return undefined; }
    let cancelled = false;
    fetch(`http://localhost:3001/api/earnings/${target.ticker}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setEarnings(Array.isArray(d.earnings) ? d.earnings : []); })
      .catch(() => { if (!cancelled) setEarnings([]); });
    return () => { cancelled = true; };
  }, [target?.ticker]);

  // Numbered events on the target line: largest month-over-month moves, each annotated with a REAL earnings
  // coincidence where one exists (Tier 1) or honest magnitude-only (Tier 3). Never a fabricated catalyst.
  const events = deriveEvents(
    target.ticker,
    data.filter(d => d.target != null).map(d => ({ month: d.month, value: d.target })),
    earnings
  );

  // #9 dynamic y-max. With domain ['auto','auto'] a tall spike (e.g. an indexed peak ~145) lands a hair
  // under the top gridline and the event dot at that peak nearly clips. Take the max across every plotted
  // series, add 10% headroom, and round up to a clean multiple of 5 so the peak/dot always sit clear of
  // the frame. Falls back to 'auto' if there's no data yet.
  const yDomainMax = (() => {
    let mx = 0;
    data.forEach(d => ['target', 'acquirer', 'spy'].forEach(k => {
      const v = d[k];
      if (typeof v === 'number' && isFinite(v) && v > mx) mx = v;
    }));
    return mx > 0 ? Math.ceil((mx * 1.1) / 5) * 5 : 'auto';
  })();

  // #9 LOG y-axis: the series are indexed to 100 at t0, so a 4× outperformer (e.g. RKLB ~400) and a flat
  // series (SPY ~120) can't both read on a LINEAR axis — the flat ones get crushed. A log scale gives equal
  // % moves equal vertical distance, so all lines show legible slopes. Indexed values are always > 0 (a
  // price ratio), so log is safe. Domain min = a clean 10-multiple just below the series min (never ≤ 0, or
  // log breaks); top reuses yDomainMax. Explicit ticks at readable indexed levels — recharts' default log
  // ticks are sparse/uneven. (Render-only: /api/prices, its indexing, and §12's histRange are untouched.)
  const yDomainMin = (() => {
    let mn = Infinity;
    data.forEach(d => ['target', 'acquirer', 'spy'].forEach(k => {
      const v = d[k];
      if (typeof v === 'number' && isFinite(v) && v > 0 && v < mn) mn = v;
    }));
    return isFinite(mn) ? Math.max(10, Math.floor(mn / 10) * 10) : 50;
  })();
  const yTicks = (typeof yDomainMax === 'number')
    ? [10, 20, 30, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500].filter(t => t >= yDomainMin && t <= yDomainMax)
    : undefined;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: '#fff', border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '8px 12px', fontSize: 11 }}>
        <div style={{ fontWeight: 700, marginBottom: 4, color: NAVY }}>{shortMonth(label)}</div>
        {payload.map(p => (
          <div key={p.dataKey} style={{ color: p.color }}>
            {p.name}: {p.value !== null ? p.value.toFixed(1) : 'N/A'}
          </div>
        ))}
      </div>
    );
  };

  // Faculty (7D-2): the period is DATA-DRIVEN, not a hardcoded "LTM" — first/last month of the real merged
  // series (sorted ascending in mergeSeries). Renders in the subtitle and as an x-axis caption; falls back to
  // a generic label only before data loads. Purely a label off existing month keys — no computed value moves.
  const win = data.length ? { start: labelMonth(data[0].month), end: labelMonth(data[data.length - 1].month) } : null;
  const periodLabel = win ? `${win.start} – ${win.end}` : 'trailing twelve months';

  return (
    <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
      <PageHeader
        title="Stock Performance"
        subtitle={`${target.ticker || target.name} · ${periodLabel} · indexed to 100 at ${win ? win.start : 'start of period'}`}
      />

      <div style={{ padding: '20px 24px 16px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#9CA3AF', fontSize: 13 }}>
            Loading price data...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis
                dataKey="month"
                tickFormatter={shortMonth}
                tick={{ fontSize: 10, fill: '#6B7280' }}
                axisLine={{ stroke: GRAY_BORDER }}
                tickLine={false}
                interval={1}
              />
              <YAxis
                scale="log"
                domain={[yDomainMin, typeof yDomainMax === 'number' ? yDomainMax : 'auto']}
                ticks={yTicks}
                allowDataOverflow
                tick={{ fontSize: 10, fill: '#6B7280' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => v.toFixed(0)}
                width={36}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                formatter={val => <span style={{ color: '#374151' }}>{val}</span>}
              />
              <ReferenceLine y={100} stroke="#D1D5DB" strokeDasharray="4 2" />
              <Line
                type="monotone"
                dataKey="target"
                name={target.ticker || 'Target'}
                stroke={SF_BLUE}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              {hasAcquirer && (
                <Line
                  type="monotone"
                  dataKey="acquirer"
                  name={acquirer.ticker || 'Acquirer'}
                  stroke="#16325C"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              )}
              <Line
                type="monotone"
                dataKey="spy"
                name="S&P 500 (SPY)"
                stroke="#9CA3AF"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                dot={false}
                connectNulls
              />
              {/* Numbered red event markers on the target line */}
              {events.map(ev => (
                <ReferenceDot
                  key={ev.n}
                  x={ev.month}
                  y={ev.value}
                  r={9}
                  fill={EVENT_RED}
                  stroke="#fff"
                  strokeWidth={1.5}
                  isFront
                  label={{ value: String(ev.n), position: 'center', fill: '#fff', fontSize: 9, fontWeight: 700 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}

        {/* Faculty (7D-2): x-axis period caption — the month ticks show no year, so the window is stated here. */}
        {!loading && win && (
          <div style={{ textAlign: 'center', fontSize: 9, color: '#9CA3AF', marginTop: 2, fontStyle: 'italic' }}>
            Monthly · {periodLabel}
          </div>
        )}

        {/* Dated event log — keyed to the numbered markers above */}
        {!loading && events.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Key Events
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 18, rowGap: 4 }}>
              {events.map(ev => (
                <div key={ev.n} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                  <span style={{
                    flexShrink: 0, width: 15, height: 15, borderRadius: '50%', background: EVENT_RED,
                    color: '#fff', fontSize: 9, fontWeight: 700, display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', marginTop: 1,
                  }}>
                    {ev.n}
                  </span>
                  <span style={{ fontSize: 10, color: '#374151', lineHeight: 1.4 }}>
                    <b style={{ color: NAVY }}>{labelMonth(ev.month)}</b> — {ev.magnitude}
                    {ev.catalyst && (
                      <>
                        {' · '}
                        <span style={{ color: SF_BLUE, fontWeight: 600 }}>{ev.catalyst}</span>{' '}
                        <span style={{ color: '#9CA3AF', fontStyle: 'italic' }}>{ev.sourceTag}</span>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 8.5, color: '#9CA3AF', fontStyle: 'italic', marginTop: 6 }}>
              {events.some(e => e.sourced)
                ? 'Markers labeled “coincides with … earnings” are correlated to the company’s actual quarterly earnings report date (FMP) — a factual coincidence in timing with the price move, not an assertion that earnings caused it. All other markers show the largest month-over-month change only (magnitude, no attributed catalyst).'
                : 'Markers are the largest month-over-month moves in the indexed price series (magnitude only — not individually attributed to a named catalyst).'}
            </div>
          </div>
        )}

        <div style={{
          marginTop: 12, padding: '6px 10px',
          background: '#F9FAFB', border: `1px solid ${GRAY_BORDER}`,
          borderRadius: 4, fontSize: 10, color: '#6B7280', fontStyle: 'italic',
        }}>
          {illustrative
            ? 'Illustrative — modeled from EPS proxy. Real price data unavailable.'
            : composeSourceLine(USED_FIELDS, verifiedData?.fields, verifiedData?.asOf) || 'Source: market data · Indexed to 100 at start of period.'
          }
        </div>
      </div>
    </PageFrame>
  );
}
