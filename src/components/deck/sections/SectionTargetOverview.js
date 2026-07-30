import React, { useState, useEffect } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER, ALT_ROW, DONUT_COLORS, fmtMoney } from '../shared/deckTokens';
import { getCompanyProfile } from '../../../lib/companyProfiles';
import { getCustomerMetrics } from '../../../lib/customerMetrics';

// Customer & net-retention metrics — CITED curated callouts for SaaS issuers that DISCLOSE them (10-K /
// 20-F / earnings letters, not XBRL). Each figure carries its OWN definition + as-of + source; the block
// is NOT a uniform comps row (that would imply a false cross-issuer comparability). Salesforce's ATTRITION
// is rendered as attrition (amber, "NOT retention"), never dressed as NRR. Non-disclosing / non-SaaS
// targets → the block is omitted (the metric doesn't apply). Data: src/lib/customerMetrics.js.
function CustomerRetentionBlock({ cm }) {
  if (!cm) return null;
  const CitedRow = ({ label, value, basis, asOf, source, warn }) => (
    <div style={{ padding: '5px 10px', borderBottom: `1px solid ${GRAY_BORDER}`, background: warn ? '#FFFBEB' : '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: warn ? '#92400E' : NAVY }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: warn ? '#92400E' : NAVY, whiteSpace: 'nowrap' }}>{value}</span>
      </div>
      <div style={{ fontSize: 8.5, color: '#6B7280', marginTop: 1, lineHeight: 1.35 }}>{basis}{asOf ? <> · <span style={{ fontStyle: 'italic' }}>as of {asOf}</span></> : null}</div>
      {source && <div style={{ fontSize: 8, color: '#9CA3AF', marginTop: 1 }}>Source: {source}</div>}
    </div>
  );
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 5, letterSpacing: 0.5, textTransform: 'uppercase' }}>Customer &amp; Retention Metrics — company-reported</div>
      <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
        {cm.customerCount
          ? <CitedRow label="Customers" value={cm.customerCount} basis={cm.customerCountBasis} asOf={cm.customerCountAsOf} source={cm.customerCountSource} />
          : <CitedRow label="Customer count" value="not disclosed" basis={`${cm.name} does not report a total customer count`} />}
        <CitedRow label={cm.retentionMetric} value={cm.retentionValue} basis={cm.retentionDefinition} asOf={cm.retentionAsOf} source={cm.retentionSource} warn={cm.isAttrition} />
      </div>
      <div style={{ fontSize: 8.5, color: '#9CA3AF', marginTop: 5, fontStyle: 'italic', lineHeight: 1.4 }}>
        Customer &amp; retention metrics are <strong>company-reported on differing definitions and periods — not directly comparable across issuers</strong>. Hand-curated from each company's cited filing; not auto-extracted.
      </div>
    </div>
  );
}

// Target Profile — a 1-page, DATA-DRIVEN deep-dive that works for ANY target (not just the 16 curated).
// Content is REAL fetched data with honest omission — NO fabrication. This replaces the shelved version,
// which defaulted to estimateSegmentMix / estimateGeographyMix / estimateEmployeeMix (fabricated). Those
// helpers are GONE from this file. Segments come from FMP (/api/segments-product, /api/segments-geo) — the
// EDGAR /api/segments route returns XBRL noise and is NOT used. When a target reports no segmentation
// (NSRGY foreign; RRGB has no geo), the block shows "not reported", never a guess. Overview is thin
// (curated-or-FMP-description, no generation) and points to §3; the trend is compact and points to §5.

const clip = (t, n) => { if (!t) return null; t = t.trim(); return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t; };
const j = (t) => fetch(`http://localhost:3001${t}`).then(r => r.json()).catch(() => null);

// $-magnitude bars (NOT % — FMP geo tiers can overlap, so a % mix would be distorted; magnitudes are honest).
function SegmentBars({ rows }) {
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div style={{ padding: '9px 12px' }}>
      {rows.slice(0, 5).map((r, i) => (
        <div key={r.label} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ fontSize: 9, color: '#374151' }} title={r.label}>{clip(r.label, 26)}</span>
            <span style={{ fontSize: 9, color: '#6B7280', fontWeight: 600 }}>{fmtMoney(Math.round(r.value / 1e6))}</span>
          </div>
          <div style={{ height: 6, background: '#E5E7EB', borderRadius: 3 }}>
            <div style={{ height: 6, borderRadius: 3, width: `${(r.value / max) * 100}%`, background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function NotReported({ label }) {
  return (
    <div style={{ padding: '16px 12px', textAlign: 'center', fontSize: 9.5, color: '#9CA3AF', fontStyle: 'italic' }}>
      {label} not reported for this filer.
    </div>
  );
}

function SegBox({ title, seg }) {
  return (
    <div style={{ flex: 1, border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ background: '#374151', padding: '5px 10px' }}>
        <span style={{ color: '#fff', fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>
          {title}{seg?.ok && seg.year ? ` (FY${seg.year})` : ''}
        </span>
      </div>
      {seg?.ok && seg.segments?.length ? <SegmentBars rows={seg.segments} /> : <NotReported label={title.includes('GEO') ? 'Geographic split' : 'Segment split'} />}
    </div>
  );
}

const pct = (v, dp = 1) => (v == null ? '—' : `${(v * 100).toFixed(dp)}%`);

export function SectionTargetOverview({ target, pageNum }) {
  const tk = target?.ticker;
  const [prod, setProd] = useState(null);
  const [geo, setGeo]   = useState(null);
  const [km, setKm]     = useState(null);
  const [pnl, setPnl]   = useState(null);
  const [fmp, setFmp]   = useState(null);
  useEffect(() => {
    let cancel = false;
    if (!tk) return;
    Promise.all([
      j(`/api/segments-product/${tk}`), j(`/api/segments-geo/${tk}`), j(`/api/key-metrics/${tk}`),
      j(`/api/pnl/${encodeURIComponent(tk)}`), j(`/api/profile/${encodeURIComponent(tk)}`),
    ]).then(([p, g, k, pn, pf]) => {
      if (cancel) return;
      setProd(p); setGeo(g); setKm(k);
      setPnl(pn && pn.ok && Array.isArray(pn.columns) ? pn : null);
      setFmp(pf && pf.ok ? pf : null);
    });
    return () => { cancel = true; };
  }, [tk]);

  // Thin overview — curated (16) OR the FMP description (fetched third-party). No generated prose.
  const profile = getCompanyProfile(tk, target?.name, target);
  const overview = profile.curated ? profile.business : (clip(fmp?.description, 300) || profile.business);

  // Compact trend + margins + CAGR from /api/pnl actuals (on hand; NOT the full §5 P&L).
  const actuals = pnl ? pnl.columns.filter(c => c.actual) : [];
  const latestAct = actuals.length ? actuals[actuals.length - 1] : null;
  const grossMargin = latestAct && latestAct.revenue ? (latestAct.grossProfit != null ? latestAct.grossProfit / latestAct.revenue : null) : null;
  const opMargin    = latestAct && latestAct.revenue && latestAct.operatingIncome != null ? latestAct.operatingIncome / latestAct.revenue : null;
  const revCAGR = (actuals.length >= 2 && actuals[0].revenue > 0)
    ? Math.pow(actuals[actuals.length - 1].revenue / actuals[0].revenue, 1 / (actuals.length - 1)) - 1 : null;
  const trendMax = Math.max(...actuals.map(c => c.revenue || 0), 1);

  // Key operating metrics (TTM ratios — currency-neutral). EV/EBITDA & negatives that read absurd → n/m.
  const evEbitda = (km?.evToEBITDA != null && km.evToEBITDA > 0 && km.evToEBITDA < 100) ? `${km.evToEBITDA.toFixed(1)}x` : (km?.ok ? 'n/m' : '—');
  const metrics = [
    { k: 'Return on equity',           v: pct(km?.returnOnEquity) },
    { k: 'Return on invested capital', v: pct(km?.returnOnInvestedCapital) },
    { k: 'Return on assets',           v: pct(km?.returnOnAssets) },
    { k: 'Free cash flow yield',       v: pct(km?.freeCashFlowYield) },
    { k: 'Gross margin (FY)',          v: pct(grossMargin) },
    { k: 'Operating margin (FY)',      v: pct(opMargin) },
    { k: `Revenue CAGR (${actuals.length}yr)`, v: pct(revCAGR) },
    { k: 'EV / EBITDA (TTM)',          v: evEbitda },
  ];

  const fyStr = target?.fiscalYear ? `FY${target.fiscalYear}` : 'most recent annual';

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit C">
      <PageHeader
        title={`Target Profile — ${target?.name || 'Target'}`}
        subtitle={`${tk ? tk + ' · ' : ''}${fyStr} · segment mix, operating metrics & revenue trend (real reported data)`}
      />

      <div style={{ padding: '14px 20px 6px' }}>
        {/* Thin business overview — points to §3 (no facts/description duplication) */}
        <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 5, letterSpacing: 0.5, textTransform: 'uppercase' }}>Business Overview</div>
        <div style={{ background: '#F9FAFB', border: `1px solid ${GRAY_BORDER}`, borderLeft: `4px solid ${SF_BLUE}`, borderRadius: 4, padding: '8px 12px', fontSize: 10.5, color: '#374151', lineHeight: 1.55, marginBottom: 12 }}>
          {overview || '—'}
          <span style={{ display: 'block', marginTop: 4, fontSize: 9, color: '#9CA3AF', fontStyle: 'italic' }}>Company facts (CEO / HQ / employees) &amp; the side-by-side profile: see Company Profiles (§3).</span>
        </div>

        {/* Segment mix — product (left) + geographic (right), real FMP or "not reported" */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
          <SegBox title="REVENUE BY PRODUCT / SEGMENT" seg={prod} />
          <SegBox title="REVENUE BY GEOGRAPHY" seg={geo} />
        </div>

        <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
          {/* Key operating metrics */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 5, letterSpacing: 0.5, textTransform: 'uppercase' }}>Key Operating Metrics</div>
            <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
              {metrics.map((m, i) => (
                <div key={m.k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 10px', background: i % 2 ? ALT_ROW : '#fff', borderBottom: i === metrics.length - 1 ? 'none' : `1px solid ${GRAY_BORDER}` }}>
                  <span style={{ fontSize: 10, color: '#374151' }}>{m.k}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: NAVY }}>{m.v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Compact revenue trend — points to §5 (not the full P&L) */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 5, letterSpacing: 0.5, textTransform: 'uppercase' }}>Revenue Trend ($M)</div>
            <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '10px 12px' }}>
              {actuals.length >= 2 ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 92 }}>
                    {actuals.map((c, i) => (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                        <span style={{ fontSize: 8, color: '#6B7280', marginBottom: 2 }}>{fmtMoney(c.revenue)}</span>
                        <div style={{ width: '70%', height: `${Math.max(4, (c.revenue / trendMax) * 74)}px`, background: SF_BLUE, borderRadius: '3px 3px 0 0' }} />
                        <span style={{ fontSize: 8, color: '#9CA3AF', marginTop: 3 }}>{c.label}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 9, color: '#6B7280', marginTop: 6 }}>Reported annual revenue. Full multi-year P&amp;L (margins, EPS): <strong style={{ color: SF_BLUE }}>see Standalone P&amp;L — Target (§5)</strong>.</div>
                </>
              ) : <NotReported label="Multi-year revenue" />}
            </div>
          </div>
        </div>

        {/* Customer & retention — CITED callouts for disclosing SaaS targets; omitted otherwise (non-SaaS / non-disclosers) */}
        {getCustomerMetrics(tk) && <CustomerRetentionBlock cm={getCustomerMetrics(tk)} />}
      </div>

      <div style={{ padding: '8px 20px 16px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.45 }}>
        Segment &amp; geographic revenue are the target's <strong>latest reported fiscal year</strong> (Financial Modeling Prep); foreign filers reporting in another currency are converted to USD at the fiscal-year average rate. Geographic tiers are shown as reported and may include overlapping regions/countries — figures are magnitudes, not a normalized 100% split. Operating metrics are <strong>trailing-twelve-month</strong> ratios (return / yield); margins &amp; revenue CAGR are from reported annual filings. Where a filer does not report a segmentation, the block reads "not reported" — never an estimate.
      </div>
    </PageFrame>
  );
}
