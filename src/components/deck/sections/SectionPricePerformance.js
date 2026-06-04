import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER } from '../shared/deckTokens';
import { getMonthlyPrices } from '../../../services/priceHistory';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { composeSourceLine } from '../../../lib/composeSourceLine';

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

export function SectionPricePerformance({ target, acquirer, pageNum }) {
  const { data: verifiedData } = useVerifiedData(target?.ticker ?? null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [illustrative, setIllustrative] = useState(false);
  const [hasAcquirer, setHasAcquirer] = useState(false);

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

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit E">
      <PageHeader
        title="Last Twelve Months Stock Performance"
        subtitle={`${target.ticker || target.name} · Indexed to 100 at start of period`}
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
                domain={['auto', 'auto']}
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
            </LineChart>
          </ResponsiveContainer>
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
