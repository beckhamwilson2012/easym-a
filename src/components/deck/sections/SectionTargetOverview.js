import React, { useState, useEffect } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import {
  NAVY, GRAY_BORDER, ALT_ROW, DONUT_COLORS,
  fmtMoney, fmtPerShare, standaloneEPS,
  estimateSegmentMix, estimateGeographyMix, estimateEmployeeMix,
} from '../shared/deckTokens';
import { getSegmentRevenue } from '../../../services/edgarSegments';
import { ExplainButton } from '../../shared/ExplainButton';
import { explainEV, explainEvEbitda, explainPeRatio } from '../../../lib/explanations';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { composeSourceLine } from '../../../lib/composeSourceLine';

const USED_FIELDS = ['revenue', 'netIncome', 'sharesOutstanding', 'cash', 'totalDebt', 'offerPrice', 'purchasePremium'];

function MiniBarChart({ data, colors }) {
  const max = Math.max(...data.map(d => d.value));
  return (
    <div>
      {data.map((d, i) => (
        <div key={d.name} style={{ marginBottom: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ fontSize: 9, color: '#374151' }}>{d.name}</span>
            <span style={{ fontSize: 9, color: '#6B7280', fontWeight: 600 }}>{d.value}%</span>
          </div>
          <div style={{ height: 6, background: '#E5E7EB', borderRadius: 3 }}>
            <div style={{
              height: 6, borderRadius: 3,
              width: `${(d.value / max) * 100}%`,
              background: colors[i % colors.length],
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricRow({ label, value, alt, explain }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '5px 10px', background: alt ? ALT_ROW : '#fff',
      borderBottom: `1px solid ${GRAY_BORDER}`,
    }}>
      <span style={{ fontSize: 11, color: '#374151', display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}
        {explain && <ExplainButton explain={explain} />}
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, color: NAVY }}>{value}</span>
    </div>
  );
}

export function SectionTargetOverview({ target, deal, pageNum }) {
  const { data: verifiedData } = useVerifiedData(target?.ticker ?? null);
  const sourceLine = composeSourceLine(USED_FIELDS, verifiedData?.fields, verifiedData?.asOf);
  const ebitdaMargin = (target.revenue > 0 && target.ebitda > 0)
    ? (target.ebitda / target.revenue * 100).toFixed(1) : null;
  const estMarketCap = target.eps > 0 && target.shares > 0
    ? target.eps * 15 * target.shares : null;
  const totalEV = deal.totalPrice > 0
    ? (deal.totalPrice + (target.debt || 0) - (target.cash || 0)) : null;

  const [segmentData, setSegmentData] = useState({ source: 'estimated', year: null, segments: estimateSegmentMix(target) });

  useEffect(() => {
    if (!target.ticker) return;
    getSegmentRevenue(target.ticker).then(result => {
      if (result.segments && result.segments.length >= 2) {
        setSegmentData(result);
      }
    });
  }, [target.ticker]);

  const segments  = segmentData.segments;
  const segmentTitle = segmentData.source === 'reported'
    ? `SEGMENT MIX (REPORTED FY${segmentData.year || ''})`
    : 'SEGMENT MIX (EST.)';
  const geography = estimateGeographyMix();
  const employees = estimateEmployeeMix();

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit A">
      <PageHeader
        title={`Target Overview — ${target.name || 'N/A'}`}
        subtitle={(() => {
          const fy  = target?.fiscalYear;
          const end = target?.fiscalYearEnd;
          const fyStr = fy ? (end
            ? `FY${fy} · ended ${new Date(end + 'T12:00:00Z').toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'})}`
            : `FY${fy}`)
            : 'Most Recent Annual';
          return target.ticker ? `${target.ticker} · ${fyStr}` : fyStr;
        })()}
      />

      <div style={{ display: 'flex', gap: 0, padding: '16px 20px 36px', minHeight: 520 }}>
        {/* Left: key stats */}
        <div style={{ flex: '0 0 260px', marginRight: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Key Statistics
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: NAVY, padding: '5px 10px' }}>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Income &amp; Profitability</span>
            </div>
            <MetricRow label="Revenue (LTM)"      value={fmtMoney(target.revenue)}    />
            <MetricRow label="EBITDA"              value={fmtMoney(target.ebitda)}     alt />
            <MetricRow label="EBITDA Margin"       value={ebitdaMargin !== null ? `${ebitdaMargin}%` : 'N/A'} />
            <MetricRow label="Net Income"          value={fmtMoney(target.netIncome)}  alt />
            <MetricRow label="EPS (NI ÷ shares)"   value={fmtPerShare(standaloneEPS(target))} />
            <div style={{ background: NAVY, padding: '5px 10px', marginTop: 0 }}>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Balance Sheet</span>
            </div>
            <MetricRow label="Cash &amp; Equivalents" value={fmtMoney(target.cash)}   />
            <MetricRow label="Total Debt"          value={fmtMoney(target.debt)}       alt />
            <MetricRow label="Shares Outstanding"  value={target.shares > 0 ? `${parseFloat(target.shares).toFixed(0)}M` : 'N/A'} />
            <div style={{ background: NAVY, padding: '5px 10px' }}>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Valuation</span>
            </div>
            <MetricRow label="Est. Market Cap"     value={estMarketCap !== null ? fmtMoney(estMarketCap) : 'N/A'} />
            <MetricRow label="Transaction EV"      value={totalEV !== null ? fmtMoney(totalEV) : 'N/A'} alt
              explain={() => explainEV({ totalPurchasePrice: deal.totalPrice, debt: target.debt, cash: target.cash, targetName: target.name })} />
            <MetricRow label="EV / EBITDA"         value={deal.evEBITDA !== 'N/A' ? `${deal.evEBITDA}x` : 'N/A'}
              explain={() => explainEvEbitda({ ev: totalEV, ebitda: target.ebitda, multiple: deal.evEBITDA })} />
            <MetricRow label="P / E Ratio"         value={deal.peRatio !== 'N/A' ? `${deal.peRatio}x` : 'N/A'} alt
              explain={() => explainPeRatio({ offerPrice: deal.offerPrice, eps: target.eps, multiple: deal.peRatio })} />
          </div>
        </div>

        {/* Right: mix charts */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              Business Overview
            </div>
            <div style={{
              background: '#F9FAFB', border: `1px solid ${GRAY_BORDER}`, borderRadius: 6,
              padding: '10px 12px', fontSize: 11, color: '#374151', lineHeight: 1.6,
            }}>
              {target.name || 'Target company'} operates across multiple business lines generating{' '}
              {fmtMoney(target.revenue)} in annual revenue. The company maintains{' '}
              {ebitdaMargin !== null ? `a ${ebitdaMargin}% EBITDA margin` : 'operations'} with{' '}
              {fmtMoney(target.cash)} in cash and {fmtMoney(target.debt)} in total debt.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14 }}>
            <div style={{ flex: 1, border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ background: '#374151', padding: '5px 10px' }}>
                <span style={{ color: '#fff', fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>
                  {segmentTitle}
                </span>
              </div>
              <div style={{ padding: '10px 12px' }}>
                <MiniBarChart data={segments} colors={DONUT_COLORS} />
              </div>
            </div>
            <div style={{ flex: 1, border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ background: '#374151', padding: '5px 10px' }}>
                <span style={{ color: '#fff', fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>
                  GEOGRAPHY MIX (EST.)
                </span>
              </div>
              <div style={{ padding: '10px 12px' }}>
                <MiniBarChart data={geography} colors={DONUT_COLORS} />
              </div>
            </div>
            <div style={{ flex: 1, border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ background: '#374151', padding: '5px 10px' }}>
                <span style={{ color: '#fff', fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>
                  WORKFORCE MIX (EST.)
                </span>
              </div>
              <div style={{ padding: '10px 12px' }}>
                <MiniBarChart data={employees} colors={DONUT_COLORS} />
              </div>
            </div>
          </div>

          <div style={{
            background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6,
            padding: '8px 12px', fontSize: 10, color: '#1E3A5F',
          }}>
            All estimated segment, geography, and workforce breakdowns are approximations for illustrative purposes only and are labeled accordingly.
          </div>
        </div>
      </div>
      {sourceLine && (
        <div style={{ padding: '0 20px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
          {sourceLine}
        </div>
      )}
    </PageFrame>
  );
}
