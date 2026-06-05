import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import {
  NAVY, SF_BLUE, GRAY_BORDER, ALT_ROW,
  fmtMoneyTable, fmtPerShare, fmtMult,
} from '../shared/deckTokens';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { composeSourceLine } from '../../../lib/composeSourceLine';

const USED_FIELDS = ['revenue', 'netIncome', 'sharesOutstanding', 'cash', 'totalDebt', 'price'];

// Build an honest "FY{year}" label from server-supplied metadata; falls back gracefully.
function fyLabel(company) {
  const fy = company?.fiscalYear;
  const end = company?.fiscalYearEnd;
  if (!fy && !end) return 'latest FY';
  if (!end) return `FY${fy}`;
  const endDate = new Date(end + 'T12:00:00Z');
  if (isNaN(endDate.getTime())) return `FY${fy}`;
  const month = endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `FY${fy} (ended ${month})`;
}

// Derive a single company's financial column from props (all $ in millions).
function deriveColumn(c) {
  const revenue   = parseFloat(c?.revenue)   || 0;
  const ebitda    = parseFloat(c?.ebitda)    || 0;
  const netIncome = parseFloat(c?.netIncome) || 0;
  const eps       = parseFloat(c?.eps);
  const shares    = parseFloat(c?.shares)    || 0;
  const cash      = parseFloat(c?.cash)      || 0;
  const debt      = parseFloat(c?.debt)      || 0;

  // Market cap: prefer the live currentMarketCap, fall back to the stored marketCap.
  const liveCap   = c?.currentMarketCap != null ? parseFloat(c.currentMarketCap) : NaN;
  const storedCap = c?.marketCap != null ? parseFloat(c.marketCap) : NaN;
  const marketCap = !isNaN(liveCap) ? liveCap : (!isNaN(storedCap) ? storedCap : null);

  // Enterprise value = market cap + total debt - cash.
  const ev = marketCap != null ? (marketCap + debt - cash) : null;

  // EV / Revenue — guard non-positive denominators and a null EV.
  const evRev = (ev != null && revenue > 0) ? ev / revenue : null;

  return {
    revenue,
    grossProfitEst: revenue * 0.65, // est.
    ebitda,
    netIncome,
    eps,
    shares,
    cash,
    debt,
    marketCap,
    ev,
    evRev,
  };
}

function HeaderCell({ children, align = 'right', flex }) {
  return (
    <div style={{
      flex: flex || 1, padding: '6px 10px', textAlign: align,
      color: '#fff', fontSize: 10, fontWeight: 700,
    }}>
      {children}
    </div>
  );
}

function MetricRow({ label, acq, tgt, alt, bold, sub }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: alt ? ALT_ROW : '#fff',
      borderBottom: `1px solid ${GRAY_BORDER}`,
    }}>
      <div style={{
        flex: 1.4, padding: '5px 10px', fontSize: 11,
        color: bold ? NAVY : '#374151', fontWeight: bold ? 700 : 400,
      }}>
        {label}
      </div>
      <div style={{
        flex: 1, padding: '5px 10px', textAlign: 'right', fontSize: 11,
        color: sub ? SF_BLUE : (bold ? NAVY : '#374151'),
        fontWeight: bold || sub ? 700 : 500,
      }}>
        {acq}
      </div>
      <div style={{
        flex: 1, padding: '5px 10px', textAlign: 'right', fontSize: 11,
        color: sub ? SF_BLUE : (bold ? NAVY : '#374151'),
        fontWeight: bold || sub ? 700 : 500,
      }}>
        {tgt}
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{
      background: '#fff', border: `1px solid ${GRAY_BORDER}`, borderRadius: 6,
      padding: '6px 10px', fontSize: 11, color: NAVY, boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
    }}>
      <div style={{ fontWeight: 700 }}>{p.name}</div>
      <div style={{ color: '#374151' }}>{p.fyLabel}</div>
      <div style={{ color: SF_BLUE, fontWeight: 600 }}>{fmtMoneyTable(p.revenue)}</div>
    </div>
  );
}

export function SectionFinancialProfile({ target, acquirer, deal, pageNum }) {
  const { data: verifiedData } = useVerifiedData(target?.ticker ?? null);
  const sourceLine = composeSourceLine(USED_FIELDS, verifiedData?.fields, verifiedData?.asOf);

  const a = deriveColumn(acquirer);
  const t = deriveColumn(target);

  const acqName = acquirer?.name || 'Acquirer';
  const tgtName = target?.name || 'Target';

  const subtitle = `Side-by-side financials ($M) — Acquirer ${fyLabel(acquirer)} · Target ${fyLabel(target)}`;

  const fmtEps = (v) => (v != null && !isNaN(v)) ? fmtPerShare(v) : 'N/A';
  const fmtShr = (v) => v > 0 ? `${Math.round(v).toLocaleString('en-US')}M` : 'N/A';
  const fmtCap = (v) => v != null ? fmtMoneyTable(v) : 'N/A';

  const chartData = [
    { name: acqName, revenue: a.revenue, fyLabel: fyLabel(acquirer), color: NAVY },
    { name: tgtName, revenue: t.revenue, fyLabel: fyLabel(target),   color: SF_BLUE },
  ];
  const hasRevenue = a.revenue > 0 || t.revenue > 0;

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit C">
      <PageHeader title="Comparative Financial Profile" subtitle={subtitle} />

      <div style={{ padding: '16px 20px 36px' }}>
        {/* Financial comparison table */}
        <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Financial Comparison ($M, except per-share &amp; multiples)
        </div>
        <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', background: NAVY }}>
            <HeaderCell align="left" flex={1.4}>Metric</HeaderCell>
            <HeaderCell>{acqName}</HeaderCell>
            <HeaderCell>{tgtName}</HeaderCell>
          </div>

          <MetricRow label="Revenue"            acq={fmtMoneyTable(a.revenue)}        tgt={fmtMoneyTable(t.revenue)} />
          <MetricRow label="Gross Profit (est.)" acq={fmtMoneyTable(a.grossProfitEst)} tgt={fmtMoneyTable(t.grossProfitEst)} alt />
          <MetricRow label="EBITDA"             acq={fmtMoneyTable(a.ebitda)}         tgt={fmtMoneyTable(t.ebitda)} />
          <MetricRow label="Net Income"         acq={fmtMoneyTable(a.netIncome)}      tgt={fmtMoneyTable(t.netIncome)} alt />
          <MetricRow label="EPS"                acq={fmtEps(a.eps)}                   tgt={fmtEps(t.eps)} />
          <MetricRow label="Cash"               acq={fmtMoneyTable(a.cash)}           tgt={fmtMoneyTable(t.cash)} alt />
          <MetricRow label="Total Debt"         acq={fmtMoneyTable(a.debt)}           tgt={fmtMoneyTable(t.debt)} />
          <MetricRow label="Shares Out (M)"     acq={fmtShr(a.shares)}                tgt={fmtShr(t.shares)} alt />
          <MetricRow label="Market Cap"         acq={fmtCap(a.marketCap)}             tgt={fmtCap(t.marketCap)} bold />
          <MetricRow label="Enterprise Value"   acq={fmtCap(a.ev)}                    tgt={fmtCap(t.ev)} bold alt />
          <MetricRow label="EV / Revenue"       acq={fmtMult(a.evRev)}                tgt={fmtMult(t.evRev)} sub />
        </div>

        {/* Revenue comparison bar chart */}
        <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 2, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Latest fiscal-year revenue
        </div>
        <div style={{ fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', marginBottom: 6 }}>
          {acqName} {fyLabel(acquirer)} vs. {tgtName} {fyLabel(target)}
        </div>
        <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '12px 14px 6px' }}>
          {hasRevenue ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#374151' }}
                  axisLine={{ stroke: GRAY_BORDER }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  axisLine={{ stroke: GRAY_BORDER }}
                  tickLine={false}
                  tickFormatter={(v) => fmtMoneyTable(v)}
                  width={64}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,34,68,0.04)' }} />
                <Bar dataKey="revenue" name="Revenue" radius={[4, 4, 0, 0]} maxBarSize={140}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 11, color: '#9CA3AF' }}>
              Revenue data unavailable.
            </div>
          )}
        </div>
      </div>

      {sourceLine && (
        <div style={{ padding: '0 20px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
          {sourceLine} Gross profit estimated at 65% of revenue.
        </div>
      )}
    </PageFrame>
  );
}
