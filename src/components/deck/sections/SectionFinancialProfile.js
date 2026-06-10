import React, { useState, useEffect } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import {
  NAVY, SF_BLUE, GRAY_BORDER, ALT_ROW,
  fmtMoneyTable, fmtPerShare, fmtMult,
} from '../shared/deckTokens';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { composeSourceLine } from '../../../lib/composeSourceLine';

const USED_FIELDS = ['revenue', 'netIncome', 'sharesOutstanding', 'cash', 'totalDebt', 'price'];

// Forward-project revenue from the trailing annual growth (clamped + faded). Estimates are clearly
// marked dashed/"E" on the chart — model assumptions, not fetched (per the reference's "& estimates").
function projectRevenue(history, forwardYears = 3) {
  if (!history || history.length < 1) return [];
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  let gr = prev && prev.revenue > 0 ? last.revenue / prev.revenue - 1 : 0.10;
  gr = Math.max(0, Math.min(0.35, gr));
  const out = []; let v = last.revenue;
  for (let k = 1; k <= forwardYears; k++) { v = v * (1 + gr * Math.pow(0.85, k - 1)); out.push({ fy: last.fy + k, revenue: Math.round(v), est: true }); }
  return out;
}

// Build a shared calendar-year axis with actuals + estimates for both companies (recharts row-per-year).
// The estimate line repeats each company's last ACTUAL year so the dashed segment connects to the solid.
function buildTrajectory(acqHist, tgtHist) {
  const acqEst = projectRevenue(acqHist), tgtEst = projectRevenue(tgtHist);
  const acqActualYears = acqHist.map(e => e.fy);
  const tgtActualYears = tgtHist.map(e => e.fy);
  const allYears = [...new Set([...acqActualYears, ...acqEst.map(e => e.fy), ...tgtActualYears, ...tgtEst.map(e => e.fy)])].sort((a, b) => a - b);
  if (!allYears.length) return { rows: [], hasData: false };
  const acqLastActual = acqActualYears.length ? Math.max(...acqActualYears) : null;
  const tgtLastActual = tgtActualYears.length ? Math.max(...tgtActualYears) : null;
  const valAt = (hist, est, fy) => {
    const a = hist.find(e => e.fy === fy); if (a) return a.revenue / 1000;
    const e = est.find(x => x.fy === fy); return e ? e.revenue / 1000 : null;
  };
  // A column is an "E" (estimate) column only when NO company has an actual for that year — otherwise
  // a year where the acquirer reported (actual) but the target hasn't yet would be wrongly tagged "E".
  const lastAnyActual = Math.max(acqLastActual ?? -Infinity, tgtLastActual ?? -Infinity);
  const rows = allYears.map(fy => {
    const isAcqEst = acqLastActual != null && fy > acqLastActual;
    const isTgtEst = tgtLastActual != null && fy > tgtLastActual;
    const acqV = valAt(acqHist, acqEst, fy), tgtV = valAt(tgtHist, tgtEst, fy);
    return {
      label: `FY${String(fy).slice(2)}${fy > lastAnyActual ? 'E' : ''}`,
      // Solid (actual) carries the value through the last actual year (inclusive); dashed (est) starts
      // at the last actual year so the two segments join visually.
      acqActual: isAcqEst ? null : acqV,
      acqEst:    (fy >= acqLastActual) ? acqV : null,
      tgtActual: isTgtEst ? null : tgtV,
      tgtEst:    (fy >= tgtLastActual) ? tgtV : null,
    };
  });
  return { rows, hasData: true };
}

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
  const shares    = parseFloat(c?.shares)    || 0;
  // Single deck-wide EPS basis: net income ÷ shares (matches dashboard/§7); fall back to reported
  // eps only when shares are missing (Fix 6).
  const eps       = shares > 0 ? netIncome / shares : parseFloat(c?.eps);
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

  // Multi-year revenue history (last-4 EDGAR actuals) for the trajectory chart.
  const [acqHist, setAcqHist] = useState([]);
  const [tgtHist, setTgtHist] = useState([]);
  useEffect(() => {
    let cancel = false;
    const load = (ticker, set) => {
      if (!ticker) { set([]); return; }
      fetch(`http://localhost:3001/quote?symbol=${ticker}`)
        .then(r => r.json())
        .then(q => { if (!cancel) set(Array.isArray(q?.revenueHistory) ? q.revenueHistory : []); })
        .catch(() => { if (!cancel) set([]); });
    };
    load(acquirer?.ticker, setAcqHist);
    load(target?.ticker, setTgtHist);
    return () => { cancel = true; };
  }, [acquirer?.ticker, target?.ticker]);

  // Fall back to the single fetched latest-year revenue when history is unavailable.
  const acqHistory = acqHist.length ? acqHist : (a.revenue > 0 ? [{ fy: acquirer?.fiscalYear || new Date().getUTCFullYear(), revenue: a.revenue }] : []);
  const tgtHistory = tgtHist.length ? tgtHist : (t.revenue > 0 ? [{ fy: target?.fiscalYear || new Date().getUTCFullYear(), revenue: t.revenue }] : []);
  const { rows: trajRows, hasData: hasTraj } = buildTrajectory(acqHistory, tgtHistory);

  const subtitle = `Side-by-side financials ($M) — Acquirer ${fyLabel(acquirer)} · Target ${fyLabel(target)}`;

  const fmtEps = (v) => (v != null && !isNaN(v)) ? fmtPerShare(v) : 'N/A';
  const fmtShr = (v) => v > 0 ? `${Math.round(v).toLocaleString('en-US')}M` : 'N/A';
  const fmtCap = (v) => v != null ? fmtMoneyTable(v) : 'N/A';

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit E">
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

        {/* Revenue trajectory & estimates — multi-year line chart */}
        <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 2, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Revenue trajectory &amp; estimates ($B)
        </div>
        <div style={{ fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', marginBottom: 6 }}>
          {acqName} vs. {tgtName} — solid = actual (SEC filings); dashed = model estimate (forecast years)
        </div>
        <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '12px 14px 6px' }}>
          {hasTraj ? (
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={trajRows} margin={{ top: 8, right: 18, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#374151' }} axisLine={{ stroke: GRAY_BORDER }} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} axisLine={{ stroke: GRAY_BORDER }} tickLine={false} tickFormatter={(v) => `$${v >= 100 ? Math.round(v) : v.toFixed(0)}B`} width={48} />
                <Tooltip
                  formatter={(v, n) => v == null ? null : [`$${v.toFixed(1)}B`, n]}
                  contentStyle={{ fontSize: 11, borderRadius: 6, border: `1px solid ${GRAY_BORDER}` }}
                />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }} />
                <Line type="monotone" dataKey="acqActual" name={`${acqName} (actual)`} stroke={NAVY}    strokeWidth={2.2} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="acqEst"    name={`${acqName} (est.)`}    stroke={NAVY}    strokeWidth={2.2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} legendType="none" />
                <Line type="monotone" dataKey="tgtActual" name={`${tgtName} (actual)`} stroke={SF_BLUE} strokeWidth={2.2} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="tgtEst"    name={`${tgtName} (est.)`}    stroke={SF_BLUE} strokeWidth={2.2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} legendType="none" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 11, color: '#9CA3AF' }}>
              Revenue history unavailable.
            </div>
          )}
        </div>
      </div>

      {sourceLine && (
        <div style={{ padding: '0 20px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
          {sourceLine} Gross profit estimated at 65% of revenue. Revenue actuals from SEC filings; forecast years (dashed) are model estimates from trailing growth, not guidance.
        </div>
      )}
    </PageFrame>
  );
}
