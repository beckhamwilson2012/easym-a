import { apiUrl } from '../../../api';
import React, { useState, useEffect } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, GRAY_BORDER, ALT_ROW, fmtMoneyTable, fmtMoneyAccounting, fmtPct, fmtPerShare, buildFinancialCommentary, isFinancial, isRestaurant, standaloneEPS, nonGaapFigures, fmtAsOf } from '../shared/deckTokens';
import { efficiencyRatioLabel, cet1Label } from '../../../lib/bankCommentaryThresholds';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { netCashDebt } from '../../../lib/netDebt';
import { composeSourceLine } from '../../../lib/composeSourceLine';

const USED_FIELDS = ['revenue', 'netIncome', 'sharesOutstanding', 'cash', 'totalDebt', 'freeCashFlow'];

// #8 unit consistency — every "$" header on this slide says "$ in millions" / "($M)", but the shared
// fmtMoneyTable auto-switches to "$X.XB" above $10B, which (a) contradicts the header and (b) mixes
// $B and $M within one column (e.g. Revenue "$26.9B" beside Net Income "$5,200M"). These slide-local
// formatters keep every monetary cell in $M so the labels are literally true and the column is uniform.
// Display-only; the underlying values are unchanged. (Bank-mode rows use their own fmtBank* and are
// left untouched.)
const fmtUSDm = (m) => {
  const v = parseFloat(m);
  if (isNaN(v) || m === null || m === undefined) return 'N/A';
  return `$${Math.round(v).toLocaleString('en-US')}M`;
};
const fmtUSDmAcct = (m) => {
  const v = parseFloat(m);
  if (isNaN(v) || m === null || m === undefined) return 'N/A';
  if (v < 0) return `($${Math.round(Math.abs(v)).toLocaleString('en-US')}M)`;
  return `$${Math.round(v).toLocaleString('en-US')}M`;
};

function buildBankCommentary(target, deal, { nii, nonIntInc, nonIntExp, bankTotalRev, bankNiMargin }) {
  const lines = [];
  if (deal.purchasePremium !== undefined)
    lines.push(`Acquisition premium of ${fmtPct(deal.purchasePremium)} versus estimated market value.`);

  const effRatio = (nonIntExp != null && bankTotalRev != null && bankTotalRev > 0)
    ? (nonIntExp / bankTotalRev * 100) : null;
  const effLabel = efficiencyRatioLabel(effRatio);
  if (effRatio != null && effLabel)
    lines.push(`Efficiency ratio of ${fmtPct(effRatio)} — ${effLabel}.`);

  const cet1Pct = target.cet1Ratio != null ? target.cet1Ratio * 100 : null;
  const cLabel  = cet1Label(cet1Pct);
  if (cet1Pct != null && cLabel)
    lines.push(`CET1 ratio of ${fmtPct(cet1Pct)} — ${cLabel}.`);

  lines.push(`Transaction financed ${fmtPct(deal.cashPercent)} cash / ${fmtPct(100 - parseFloat(deal.cashPercent || 0))} stock.`);
  return lines;
}

function PLRow({ label, value, alt, bold, indent }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '5px 10px', background: alt ? ALT_ROW : '#fff',
      borderBottom: `1px solid ${GRAY_BORDER}`,
      paddingLeft: indent ? 20 : 10,
    }}>
      <span style={{ fontSize: 11, color: bold ? NAVY : '#374151', fontWeight: bold ? 700 : 400 }}>
        {label}
      </span>
      <span style={{ fontSize: 11, fontWeight: bold ? 700 : 500, color: bold ? NAVY : '#374151' }}>
        {value}
      </span>
    </div>
  );
}

// ── Multi-year standalone P&L (slides 5/6) ──────────────────────────────────────────────────────────
// Renders /api/pnl: 3 actual EDGAR fiscal years (GAAP) + forward analyst-consensus years (undesignated basis),
// with a Margins & Growth block. Approach (A): basis labeled INLINE on each column header; estimate
// columns italic + tinted; forward OpEx "—" (basis gap unallocable); forward gross/shares are held
// "est." (ᵉ marker). Margins computed PER COLUMN on that column's own basis.
function MultiYearPL({ pnl, restaurantMode }) {
  const cols = pnl.columns || [];
  // $M with accounting parens for negatives; expenses passed as their own sign for parens.
  const fmtM   = (v) => v == null ? '—' : (v < 0 ? `($${Math.abs(Math.round(v)).toLocaleString('en-US')})` : `$${Math.round(v).toLocaleString('en-US')}`);
  const fmtExp = (v) => v == null ? '—' : `($${Math.abs(Math.round(v)).toLocaleString('en-US')})`;
  const fmtSh  = (v) => v == null ? '—' : Math.round(v).toLocaleString('en-US');
  const fmtEpsV= (v) => v == null ? '—' : (v < 0 ? `($${Math.abs(v).toFixed(2)})` : `$${v.toFixed(2)}`);
  const fmtPctV= (v) => v == null ? '—' : (v < 0 ? `(${Math.abs(v).toFixed(1)}%)` : `${v.toFixed(1)}%`);
  const marginOf = (num, c) => (num != null && c.revenue) ? (num / c.revenue * 100) : null;
  const growthOf = (i) => { if (i === 0) return null; const a = cols[i - 1]?.revenue, b = cols[i]?.revenue; return (a && b) ? ((b - a) / a * 100) : null; };

  const LINES = [
    { label: 'Total Revenue',      get: c => c.revenue,          fmt: fmtM,   bold: true },
    { label: 'Cost of Revenue',    get: c => c.costOfRevenue,    fmt: fmtExp, indent: true },
    { label: 'Gross Profit',       get: c => c.grossProfit,      fmt: fmtM,   bold: true, est: c => c.grossProfitEst },
    { label: 'Operating Expense',  get: c => c.operatingExpense, fmt: fmtExp, indent: true },
    { label: 'Operating Income',   get: c => c.operatingIncome,  fmt: fmtM,   bold: true },
    { label: 'Non-operating income/(expense)', get: c => c.nonOperatingIncome, fmt: fmtM, indent: true },
    { label: 'Net Income',         get: c => c.netIncome,        fmt: fmtM,   bold: true },
    { label: 'EBITDA',             get: c => c.ebitda,           fmt: fmtM },
    { label: 'Wtd. Avg. Diluted Shares (M)', get: c => c.dilutedShares, fmt: fmtSh,  est: c => c.dilutedSharesEst },
    { label: 'Diluted EPS',        get: c => c.eps,              fmt: fmtEpsV, bold: true },
  ];
  const MARGINS = [
    { label: 'Revenue Growth %',   val: (c) => c._growth },
    { label: 'Gross Margin %',     val: (c) => marginOf(c.grossProfit, c) },
    { label: 'Operating Margin %', val: (c) => marginOf(c.operatingIncome, c) },
    { label: 'EBITDA Margin %',    val: (c) => marginOf(c.ebitda, c) },
    { label: 'Net Margin %',       val: (c) => marginOf(c.netIncome, c) },
  ];
  // Restaurant SICs (5812/5813): the gross/COGS split (food-only COGS excludes labor & occupancy) is not
  // meaningful — omit the gross-relative rows and go Revenue → Operating Income directly (Fix B parity),
  // rather than rendering an all-"—" gross row. Non-restaurants unchanged.
  const GROSS_LINES = new Set(['Cost of Revenue', 'Gross Profit', 'Operating Expense']);
  const lines   = restaurantMode ? LINES.filter(l => !GROSS_LINES.has(l.label)) : LINES;
  const margins = restaurantMode ? MARGINS.filter(m => m.label !== 'Gross Margin %') : MARGINS;

  // ── LTM column (Stage 2, ADDITIVE) — trailing-12mo GAAP actual from payload.ltm, INSERTED at the
  // actual/forward boundary (it is the most-current ACTUAL, not a forward). Shown only when trusted
  // (Stage-0 span-match gate); foreign/untrusted → no LTM column (the deck stays on the FY/forward
  // series). The original FY + forward columns keep their ORIGINAL revenue-growth (precomputed on the
  // SOURCE index), so inserting LTM does NOT move any existing number — forwards still grow off the last
  // actual FY, not off LTM.
  const asOfShort = (d) => { if (!d) return ''; const dt = new Date(d + 'T12:00:00Z'); return dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) + " '" + String(dt.getUTCFullYear()).slice(2); };
  const L = pnl.ltm;
  const showLtm = !!(L && L.trusted && L.revenue != null);
  const actualsSrc = cols.filter(c => c.actual);
  const lastActual = actualsSrc[actualsSrc.length - 1];
  const ltmCol = showLtm ? {
    label: `LTM (${asOfShort(L.asOf)})`, actual: true, isLtm: true,
    revenue: L.revenue, costOfRevenue: null, grossProfit: L.grossProfit, grossProfitEst: false,
    // LTM OpEx = LTM gross − LTM operating income (reported GAAP identity, same as the FY actuals) — unflagged.
    operatingExpense: (L.grossProfit != null && L.operatingIncome != null) ? L.grossProfit - L.operatingIncome : null, operatingExpenseEst: false,
    operatingIncome: L.operatingIncome, nonOperatingIncome: L.nonOperatingIncome?.ltmM ?? null, netIncome: L.netIncome,
    ebitda: L.ebitda, ebitdaDaFound: L.ebitdaDaFound, dilutedShares: L.dilutedShares, dilutedSharesEst: false, eps: L.eps,
    _growth: (lastActual && lastActual.revenue && L.revenue != null) ? ((L.revenue - lastActual.revenue) / lastActual.revenue * 100) : null,
  } : null;

  // 2c — LTM non-operating disclosure (fallback ii): name ONLY the sourced NonoperatingIncomeExpense total
  // and its interim legs; attribute nothing beyond the concept (composition varies by filer). Per-company,
  // from real values; renders only if non-null. Period label derives from the actual span (H1@180, Q1@89,
  // 9M@272) — never hardcoded, so AMZN reads "Q1" and a future 9M filer reads "9M".
  const noiF = (showLtm && L.nonOperatingIncome && L.nonOperatingIncome.ltmM != null) ? L.nonOperatingIncome : null;
  const spanLbl = (span, end) => `${span <= 135 ? 'Q1' : span <= 225 ? 'H1' : span <= 315 ? '9M' : 'FY'}'${(end || '').slice(2, 4)}`;
  const noiText = noiF ? (() => {
    const pl = L.audit?.periods?.latestInterim, pp = L.audit?.periods?.priorInterim;
    const latLbl = pl ? spanLbl(pl.span, pl.end) : 'latest interim', prLbl = pp ? spanLbl(pp.span, pp.end) : 'prior-year';
    const inc = noiF.ltmM >= 0 ? 'income' : 'expense';
    const $ = (v) => `$${Math.abs(v).toLocaleString('en-US')}M`;
    return `LTM net income includes non-operating ${inc} of ${$(noiF.ltmM)} (${noiF.conceptName}; ${latLbl} ${$(noiF.latestYtdM)} vs ${prLbl} ${$(noiF.priorYtdM)})${pl?.filed ? `, per the 10-Q filed ${pl.filed}` : ''}. LTM margins are not comparable to operating margins.`;
  })() : null;

  // 2d — forward net-margin inversion: only where the consensus data shows it (GOOGL FY26E>FY27E; AMZN won't).
  const _fwd = cols.filter(c => !c.actual);
  const _nm = (c) => (c.netIncome != null && c.revenue) ? (c.netIncome / c.revenue * 100) : null;
  const fwd2d = (_fwd.length >= 2 && _nm(_fwd[0]) != null && _nm(_fwd[1]) != null && (_nm(_fwd[0]) - _nm(_fwd[1])) > 10)
    ? { y1: _fwd[0].label, m1: _nm(_fwd[0]), y2: _fwd[1].label, m2: _nm(_fwd[1]) } : null;

  const withGrowth = cols.map((c, i) => ({ ...c, _growth: growthOf(i) }));
  const dcols = ltmCol
    ? [...withGrowth.filter(c => c.actual), ltmCol, ...withGrowth.filter(c => !c.actual)]
    : withGrowth;
  const ltmDaMissing = showLtm && ltmCol.ebitdaDaFound === false && ltmCol.ebitda != null;

  const labelW = 158;
  const cellBg  = (c, ri) => c.isLtm
    ? (ri % 2 ? '#FCF3D9' : '#FEFBF0')                                   // amber pivot band — clearly not a blue forward
    : (c.actual ? (ri % 2 ? ALT_ROW : '#fff') : (ri % 2 ? '#E8F1FB' : '#F0F6FD'));
  const firstEstIdx = dcols.findIndex(c => !c.actual);
  const divider = (i) => (firstEstIdx > 0 && i === firstEstIdx);
  const nActual = dcols.filter(c => c.actual).length;                   // includes LTM (a trailing actual)
  const nEst    = dcols.length - nActual;

  return (
    <div style={{ padding: '12px 20px 4px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        Income Statement — {actualsSrc.length} Fiscal Years{showLtm ? ' + LTM' : ''} ($M)
      </div>
      <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontVariantNumeric: 'tabular-nums' }}>
          <colgroup>
            <col style={{ width: labelW }} />
            {dcols.map((c, i) => <col key={i} style={{ width: `calc((100% - ${labelW}px) / ${dcols.length})` }} />)}
          </colgroup>
          <thead>
            {/* Actual | Estimate boundary band — reinforces the reported-vs-projected divider. */}
            <tr>
              <th style={{ background: '#fff', border: 'none' }} />
              {nActual > 0 && (
                <th colSpan={nActual} style={{ padding: '2px 6px', textAlign: 'center', fontSize: 8, fontWeight: 700, letterSpacing: 1, color: '#6B7280', background: '#F3F4F6', textTransform: 'uppercase' }}>◂ Actual · Reported</th>
              )}
              {nEst > 0 && (
                <th colSpan={nEst} style={{ padding: '2px 6px', textAlign: 'center', fontSize: 8, fontWeight: 700, letterSpacing: 1, color: '#1E3A5F', background: '#E8F1FB', borderLeft: '2px solid #7FA8D9', textTransform: 'uppercase' }}>Estimate · Consensus ▸</th>
              )}
            </tr>
            <tr>
              <th style={{ padding: '6px 8px', textAlign: 'left', background: NAVY, color: '#fff', fontSize: 10, fontWeight: 700 }}>Line Item</th>
              {dcols.map((c, i) => (
                <th key={i} style={{
                  padding: '5px 6px', textAlign: 'right', verticalAlign: 'bottom',
                  background: c.isLtm ? '#0B5CAB' : (c.actual ? NAVY : '#23457A'), color: '#fff',
                  borderLeft: c.isLtm ? '2px solid #E0A93A' : (divider(i) ? '2px solid #7FA8D9' : 'none'),
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>{c.label}</div>
                  {/* Forward basis label: FMP supplies a single UNDESIGNATED consensus series — the app cannot
                      source a GAAP or non-GAAP claim for it, so the label asserts NEITHER. Do NOT key this off
                      nonGaap.allReconciled: that flag describes HISTORICAL 8-K extraction (a different basis
                      question), and the forward columns come from FMP analyst-estimates regardless of it. */}
                  <div style={{ fontSize: 7.5, fontWeight: 600, letterSpacing: 0.2, color: c.isLtm ? '#FBE3A6' : (c.actual ? '#9DB4D4' : '#FCD34D'), marginTop: 1, whiteSpace: 'nowrap' }}>
                    {c.isLtm ? 'GAAP · TTM' : (c.actual ? 'GAAP' : 'ANALYST CONSENSUS')}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((ln, ri) => (
              <tr key={ln.label}>
                <td style={{ padding: '4px 8px', paddingLeft: ln.indent ? 18 : 8, background: ri % 2 ? ALT_ROW : '#fff', borderBottom: `1px solid ${GRAY_BORDER}`, fontSize: 10.5, fontWeight: ln.bold ? 700 : 400, color: ln.bold ? NAVY : '#374151' }}>
                  {ln.label}
                </td>
                {dcols.map((c, i) => {
                  const v = ln.get(c);
                  const isEst = ln.est ? ln.est(c) : false;
                  const neg = typeof v === 'number' && v < 0;
                  const daMark = ln.label === 'EBITDA' && c.isLtm && c.ebitdaDaFound === false && v != null;
                  return (
                    <td key={i} style={{
                      padding: '4px 8px', textAlign: 'right', fontSize: 10.5,
                      background: cellBg(c, ri), borderBottom: `1px solid ${GRAY_BORDER}`,
                      borderLeft: c.isLtm ? '2px solid #E0A93A' : (divider(i) ? '2px solid #C7DBF2' : 'none'),
                      fontStyle: (c.actual || c.isLtm) ? 'normal' : 'italic',
                      fontWeight: ln.bold ? 700 : 500,
                      color: neg ? '#DC2626' : (c.actual ? '#111827' : '#1E3A5F'),
                    }}>
                      {v == null ? '—' : ln.fmt(v)}
                      {isEst && v != null ? <sup style={{ fontSize: 7, fontWeight: 400, color: '#6B7280' }}> e</sup> : null}
                      {daMark ? <sup style={{ fontSize: 7, fontWeight: 400, color: '#92400E' }}> d</sup> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* Margins & Growth — computed per column on that column's own basis */}
            <tr><td colSpan={dcols.length + 1} style={{ background: '#EEF2F7', padding: '3px 8px', fontSize: 8.5, fontWeight: 700, color: NAVY, letterSpacing: 0.5, textTransform: 'uppercase', borderBottom: `1px solid ${GRAY_BORDER}` }}>Margins &amp; Growth</td></tr>
            {margins.map((m, ri) => (
              <tr key={m.label}>
                <td style={{ padding: '3px 8px', paddingLeft: 18, background: ri % 2 ? ALT_ROW : '#fff', borderBottom: `1px solid ${GRAY_BORDER}`, fontSize: 10, color: '#374151' }}>{m.label}</td>
                {dcols.map((c, i) => {
                  const v = m.val(c, i);
                  const neg = typeof v === 'number' && v < 0;
                  return (
                    <td key={i} style={{
                      padding: '3px 8px', textAlign: 'right', fontSize: 10,
                      background: cellBg(c, ri), borderBottom: `1px solid ${GRAY_BORDER}`,
                      borderLeft: c.isLtm ? '2px solid #E0A93A' : (divider(i) ? '2px solid #C7DBF2' : 'none'),
                      fontStyle: (c.actual || c.isLtm) ? 'normal' : 'italic',
                      color: neg ? '#DC2626' : (c.actual ? '#374151' : '#1E3A5F'),
                    }}>
                      {fmtPctV(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {/* Forward-estimate coverage (7B-3): analyst counts for the ONLY two lines FMP counts — revenue &
                EPS (ebit/ebitda/net income/SG&A are consensus means with NO count). The row label carries the
                metrics so a cell "35 / 37" reads unambiguously — never a bare "35 analysts" (which would imply the
                whole column). Rendered only for forward columns that DISCLOSE a count; a missing count is
                omitted (never 0, never a dash that reads as "no analysts"); if no forward column has one, the
                whole row is omitted. */}
            {dcols.some(c => !c.actual && (c.analystsRevenue != null || c.analystsEps != null)) && (
              <tr>
                <td style={{ padding: '3px 8px', background: '#F8FAFC', borderTop: `2px solid ${GRAY_BORDER}`, borderBottom: `1px solid ${GRAY_BORDER}`, fontSize: 8.5, fontStyle: 'italic', color: '#6B7280' }}>
                  Analyst estimates (revenue / EPS)
                </td>
                {dcols.map((c, i) => {
                  let cell = '';
                  if (!c.actual) {
                    const parts = [];
                    if (c.analystsRevenue != null) parts.push(c.analystsEps != null ? String(c.analystsRevenue) : `${c.analystsRevenue} rev`);
                    if (c.analystsEps != null) parts.push(c.analystsRevenue != null ? String(c.analystsEps) : `${c.analystsEps} EPS`);
                    cell = parts.join(' / ');
                  }
                  return (
                    <td key={i} style={{
                      padding: '3px 8px', textAlign: 'right', fontSize: 8.5, fontStyle: 'italic', color: '#6B7280',
                      background: c.isLtm ? '#FEFBF0' : (c.actual ? '#fff' : '#F0F6FD'),
                      borderTop: `2px solid ${GRAY_BORDER}`, borderBottom: `1px solid ${GRAY_BORDER}`,
                      borderLeft: c.isLtm ? '2px solid #E0A93A' : (divider(i) ? '2px solid #C7DBF2' : 'none'),
                    }}>
                      {cell}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 9, color: '#6B7280', fontStyle: 'italic', lineHeight: 1.45, marginTop: 6 }}>
        <strong style={{ color: NAVY }}>Basis: </strong>
        Actual years (GAAP) from SEC EDGAR filings; forward years are Street <strong>analyst consensus</strong> (FMP analyst-estimates) — a single provider series whose reporting basis follows each company's street convention and is <strong>not designated as GAAP or non-GAAP by the provider</strong>. The step in Operating Income / Net Income / EPS at the actual→estimate boundary reflects the actual→consensus transition, not organic growth. Margins are computed on each column's own basis.
        {showLtm ? <> The <strong>LTM</strong> column is the trailing twelve months (latest annual + interim YTD − prior-year YTD), a GAAP actual as of {asOfShort(L.asOf)}.{ltmDaMissing ? <> <sup>d</sup> LTM EBITDA is shown on an operating-income basis — interim D&amp;A on the same basis as the annual EBITDA is not tagged for this filer (a differently-scoped cash-flow D&amp;A is not mixed in).</> : null}</> : null}
        {noiText ? <> <strong style={{ color: NAVY }}>Non-operating income/(expense)</strong> reconciles operating income to net income. {noiText}</> : null}
        {fwd2d ? <> Forward net income is FMP <strong>consensus (netIncomeAvg)</strong>; {fwd2d.y1} net margin ({fwd2d.m1.toFixed(1)}%) exceeds {fwd2d.y2} ({fwd2d.m2.toFixed(1)}%), reflecting analyst modeling of equity-security gains in the nearer year (values unchanged).</> : null}
        {restaurantMode
          ? <> <sup>e</sup> Gross profit / margin omitted — restaurant cost structure (food-only COGS excludes the dominant labor &amp; occupancy costs) makes the gross split not meaningful; shown Revenue → Operating Income. Forward fully diluted shares held flat (est.).</>
          : <> <sup>e</sup> Forward gross profit = most-recent actual gross margin held constant × consensus revenue (est.); forward fully diluted shares held flat (est.). Operating expense is shown for reported periods; it is not shown for forward years — consensus supplies operating income but not gross profit, so a derived figure would mix a held gross-margin assumption with consensus operating income.</>}
      </div>
    </div>
  );
}

// Thin wrappers so the deck can show a standalone P&L for EITHER side (reference §4 Acquirer,
// §5 Target). The acquirer instance hides deal-specific (premium / financing) commentary, which
// only makes sense for the target being acquired.
export function SectionStandalonePLTarget({ target, deal, pageNum, exhibitLabel }) {
  // Standalone P&Ls are pre-deal GAAP company views (spec §2 Slides 4/5); deal terms (premium,
  // financing, mix) belong on the Exchange Ratio & Deal Considerations slide, not here. So the
  // target standalone shows margin/scale commentary like the acquirer, not deal commentary.
  return <StandalonePLBody company={target} deal={deal} dealBasis={deal?.basis} pageNum={pageNum} role="Target" showDealCommentary={false} exhibitLabel={exhibitLabel} />;
}
export function SectionStandalonePLAcquirer({ acquirer, deal, pageNum, exhibitLabel }) {
  // deal is kept null for commentary (no premium/financing on the acquirer slide), but the deal-level
  // BASIS still drives display so the whole deck reads on one basis (see resolveAccretionBasis).
  return <StandalonePLBody company={acquirer} deal={null} dealBasis={deal?.basis} pageNum={pageNum} role="Acquirer" showDealCommentary={false} exhibitLabel={exhibitLabel} />;
}
// Back-compat alias (original single-target usage).
export function SectionStandalonePL({ target, deal, pageNum }) {
  return <StandalonePLBody company={target} deal={deal} dealBasis={deal?.basis} pageNum={pageNum} role="Target" showDealCommentary exhibitLabel="Exhibit F" />;
}

function StandalonePLBody({ company, deal, dealBasis, pageNum, role, showDealCommentary, exhibitLabel }) {
  const target = company; // body was written against `target`; keep the name internally
  const { data: verifiedData } = useVerifiedData(target?.ticker ?? null);
  const sourceLine = composeSourceLine(USED_FIELDS, verifiedData?.fields, verifiedData?.asOf);
  const bankMode = isFinancial(target); // OBJECT → SIC fallback fires for banks /quote tags 'standard'
  // Restaurant SICs (5812/5813): gross profit (revenue − food-only COGS) is meaningless — suppress the
  // gross rows and show revenue → operating income directly (Fix B). Single source: isRestaurant.
  const restaurantMode = isRestaurant(target);

  // Multi-year P&L (slides 5/6) — fetched lazily, non-bank only (banks keep the single-year bank branch).
  const [pnl, setPnl] = useState(null);
  useEffect(() => {
    let cancel = false;
    if (!target?.ticker || bankMode) { setPnl(null); return; }
    fetch(apiUrl(`/api/pnl/${encodeURIComponent(target.ticker)}`))
      .then(r => r.json())
      .then(j => { if (!cancel) setPnl(j && j.ok && Array.isArray(j.columns) && j.columns.length ? j : null); })
      .catch(() => { if (!cancel) setPnl(null); });
    return () => { cancel = true; };
  }, [target?.ticker, bankMode]);

  const rev    = parseFloat(target.revenue)   || 0;
  const ebitda = parseFloat(target.ebitda)    || 0;
  const ni     = parseFloat(target.netIncome) || 0;
  // null-PRESERVING (Fix A): a stale-rejected cash/debt tag arrives as null → render "N/A", never $0.
  const cash   = target.cash != null ? (parseFloat(target.cash) || 0) : null;
  const debt   = target.debt != null ? (parseFloat(target.debt) || 0) : null;
  const sti    = target.sti  != null ? (parseFloat(target.sti)  || 0) : null;
  const shares = parseFloat(target.shares)    || 0;
  // Single deck-wide EPS basis: net income ÷ shares (matches dashboard/§7 and the accretion math),
  // so this slide no longer diverges from the dashboard for profitable filers (Fix 6).
  const eps    = standaloneEPS(target) ?? 0;

  const ebitdaMargin = rev > 0 && ebitda > 0 ? (ebitda / rev * 100) : 0;
  const niMargin     = rev > 0 && ni     > 0 ? (ni     / rev * 100) : 0;

  // Gross profit — REAL from the filing; fall back to a clearly-labeled 65% estimate ONLY when the
  // filer doesn't tag it (never present the estimate as real).
  const realGP      = parseFloat(target.grossProfit);
  const gpIsEst     = !Number.isFinite(realGP);
  const grossProfit = gpIsEst ? rev * 0.65 : realGP;
  const grossMarginPct = rev > 0 ? (grossProfit / rev * 100) : 0;
  // Operating expenses = gross profit − operating income (TRUE opex, real operating income). Fall
  // back to the old plug only when gross profit itself is an estimate.
  const realOI    = parseFloat(target.operatingIncome);
  const opexReal  = (!gpIsEst && Number.isFinite(realOI)) ? (grossProfit - realOI) : null;
  const estOpex   = opexReal != null ? opexReal : (ebitda > 0 ? (grossProfit - ebitda) : rev * 0.40);
  const opexIsEst = opexReal == null;
  // D&A is a POSITIVE expense (subtracted in the P&L). The prior estimate (ebitda × 0.15) went
  // negative for loss-making firms with EBITDA ≤ 0, so -estDA rendered as a positive addition rather
  // than a subtraction (Fix 10d). Fall back to a revenue-based proxy when EBITDA ≤ 0 so it stays ≥ 0.
  const estDA   = ebitda > 0 && ni > 0 && ni < ebitda
    ? (ebitda - ni) * 0.5
    : ebitda > 0 ? ebitda * 0.15 : rev * 0.04;
  // Net debt needs BOTH components; if either was stale-rejected (null) it is unavailable → null → "N/A"
  // (never debt − 0 or 0 − 0, which would print a confident $0 or a doubled net-debt — Fix A blast-radius).
  const netDebt = netCashDebt(debt, cash, sti);   // convention (b): total debt − (cash + short-term marketable securities); sign-aware prose below

  // ── Non-GAAP display layer — gated by the SINGLE per-deal basis (resolveAccretionBasis → deal.basis) ──
  // The deck reads on ONE basis: non-GAAP only when the deal basis is 'Non-GAAP' (both companies
  // reconcile); otherwise the whole deck — display AND accretion — is GAAP, even for a company that
  // does report non-GAAP. selfNonGaap is the raw per-company figure (used only to word the footnote
  // honestly). We never derive/fake a non-GAAP figure — a null ⇒ honest GAAP fallback.
  const selfNonGaap  = nonGaapFigures(target);                       // raw per-company (may exist in a GAAP deal)
  const ng           = dealBasis === 'Non-GAAP' ? selfNonGaap : null; // gated by the one deal basis
  const opIncGaap    = Number.isFinite(realOI) ? realOI : null;
  const opIncVal     = ng?.operatingIncome ?? opIncGaap;
  const opIncNonGaap = ng?.operatingIncome != null;
  const niVal        = ng?.netIncome ?? (ni || null);
  const niNonGaap    = ng?.netIncome != null;
  const epsVal       = ng?.dilutedEPS ?? (eps || null);
  const epsNonGaap   = ng?.dilutedEPS != null;
  const opMarginPct  = (opIncVal != null && rev > 0) ? (opIncVal / rev * 100) : null;
  const niMarginVal  = (niVal   != null && rev > 0) ? (niVal   / rev * 100) : null;
  const basisTag = (isNonGaap) => isNonGaap ? 'Non-GAAP' : 'GAAP';

  // Bank-mode income statement values
  const nii       = target.netInterestIncome  != null ? parseFloat(target.netInterestIncome)  : null;
  const nonIntInc = target.nonInterestIncome  != null ? parseFloat(target.nonInterestIncome)  : null;
  const nonIntExp = target.nonInterestExpense != null ? parseFloat(target.nonInterestExpense) : null;
  const bankTotalRev = (nii != null && nonIntInc != null) ? nii + nonIntInc : (rev || null);
  const ppnr = (bankTotalRev != null && nonIntExp != null) ? bankTotalRev - nonIntExp : null;
  const provision = target.totalAssets != null ? parseFloat(target.totalAssets) * 0.003 : null;
  const bankNiMargin = bankTotalRev && bankTotalRev > 0 && ni > 0 ? (ni / bankTotalRev * 100) : niMargin;

  const fmtBankVal = (v) => v != null ? fmtMoneyTable(v) : 'N/A';
  const fmtBankNeg = (v) => v != null ? fmtMoneyAccounting(-v) : 'N/A';

  // Deal-dependent commentary (premium / financing) only belongs on the target side. The acquirer
  // standalone slide gets deal-free margin/scale commentary instead.
  const standaloneCommentary = (() => {
    const lines = [];
    if (rev > 0 && ebitda > 0) lines.push(`EBITDA margin of ${fmtPct(ebitda / rev * 100)} on ${fmtMoneyTable(rev)} of revenue.`);
    // Net income / EPS use the SAME basis-aware values the table renders (niVal/epsVal), so the commentary
    // never contradicts the table. On a GAAP/bank deal niVal/epsVal == the GAAP figures → wording unchanged.
    if (rev > 0 && niVal != null && niVal > 0) lines.push(`Net income of ${fmtMoneyTable(niVal)} — a ${fmtPct(niMarginVal)} net margin.`);
    if (rev > 0 && niVal != null && niVal < 0) lines.push(`Reported a net loss of ${fmtMoneyTable(Math.abs(niVal))} in the latest fiscal year — growth-stage profitability profile.`);
    if (shares > 0 && epsVal != null) lines.push(`${shares.toFixed(0)}M shares outstanding; ${epsNonGaap ? 'non-GAAP' : 'reported'} diluted EPS of ${fmtPerShare(epsVal)}.`);
    if (netDebt != null) lines.push(`Net ${netDebt < 0 ? 'cash' : 'debt'} position of ${fmtMoneyTable(Math.abs(netDebt))}.`);
    else lines.push(`Net cash / (debt) position: N/A — a balance-sheet figure was unavailable in the filing.`);
    return lines;
  })();
  const commentary = (showDealCommentary && deal) ? buildFinancialCommentary(target, deal) : standaloneCommentary;

  // Build an honest fiscal-year label from the server-supplied metadata.
  // CRM FY ends Jan → "FY2026 (ended Jan 2026)"; TEAM FY ends Jun → "FY2025 (ended Jun 2025)".
  const fyLabel = (() => {
    const fy  = target?.fiscalYear;
    const end = target?.fiscalYearEnd;
    if (!fy && !end) return 'Most Recent Annual Filing';
    if (!end) return `FY${fy}`;
    const endDate = new Date(end + 'T12:00:00Z');
    const month   = endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return `FY${fy} — Ended ${month}`;
  })();

  return (
    <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
      <PageHeader
        title={`Standalone P&L — ${role || 'Target'}: ${target.name || 'N/A'}`}
        subtitle={pnl
          ? `${pnl.columns.length} fiscal years${pnl.ltm?.trusted ? ' + LTM' : ''} · $M · actuals GAAP (SEC EDGAR), forward analyst consensus (FMP)`
          : `${fyLabel} · $ in millions · profitability Non-GAAP where labeled (see basis note)`}
      />

      {pnl && <MultiYearPL pnl={pnl} restaurantMode={restaurantMode} />}

      <div style={{ display: 'flex', gap: 20, padding: pnl ? '4px 20px 30px' : '16px 20px 36px' }}>
        {/* Left: P&L table (single-year). Hidden when the multi-year table above is shown. */}
        <div style={{ flex: pnl ? '0 0 340px' : '0 0 380px' }}>
          {!pnl && (<>
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Income Statement Summary ($M)
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: NAVY, padding: '5px 10px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Line Item</span>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Latest FY ($M)</span>
            </div>
            {bankMode ? (
              <>
                <PLRow label="Net Interest Income"         value={fmtBankVal(nii)} />
                <PLRow label="Non-Interest Income"         value={fmtBankVal(nonIntInc)} alt />
                <PLRow label="Total Revenue"               value={fmtBankVal(bankTotalRev)} bold />
                <PLRow label="Non-Interest Expense"        value={fmtBankNeg(nonIntExp)} alt />
                <PLRow label="Pre-Provision Net Revenue"   value={fmtBankVal(ppnr)} bold />
                <PLRow label="Provision for Credit Losses" value={fmtBankNeg(provision)} alt />
                <PLRow label="Net Income"                  value={fmtMoneyAccounting(ni)} bold />
                <PLRow label="Net Margin"                  value={fmtPct(bankNiMargin)} indent alt />
                <PLRow label="Diluted EPS"                 value={fmtPerShare(eps)} />
              </>
            ) : (
              <>
                <PLRow label="Revenue"                    value={fmtUSDm(rev)}            />
                {/* Restaurant SICs: omit gross profit/margin (food-only COGS) AND the gross-relative opex
                    line — go straight Revenue → Operating Income (Fix B). Non-restaurants unchanged. */}
                {!restaurantMode && <PLRow label={gpIsEst ? "Gross Profit (est.)" : "Gross Profit (GAAP)"}     value={fmtUSDm(grossProfit)} alt indent />}
                {!restaurantMode && <PLRow label={gpIsEst ? "Gross Margin (est.)" : "Gross Margin (GAAP)"}     value={fmtPct(grossMarginPct)}     indent />}
                {!restaurantMode && <PLRow label={opexIsEst ? "Operating Expenses (est.)" : "Operating Expenses (GAAP)"} value={fmtUSDmAcct(-estOpex)} alt indent />}
                <PLRow label={`Operating Income (${basisTag(opIncNonGaap)})`}  value={opIncVal != null ? fmtUSDmAcct(opIncVal) : 'N/A'} bold />
                <PLRow label={`Operating Margin (${basisTag(opIncNonGaap)})`}  value={opMarginPct != null ? fmtPct(opMarginPct) : 'N/A'} indent alt />
                <PLRow label="EBITDA (computed)"          value={fmtUSDmAcct(ebitda)}    bold />
                <PLRow label="EBITDA Margin (computed)"   value={fmtPct(ebitdaMargin)}          indent alt />
                <PLRow label="D&A (est.)"                 value={fmtUSDmAcct(-estDA)}    indent />
                <PLRow label={`Net Income (${basisTag(niNonGaap)})`}  value={niVal != null ? fmtUSDmAcct(niVal) : 'N/A'} bold />
                <PLRow label={`Net Margin (${basisTag(niNonGaap)})`}  value={niMarginVal != null ? fmtPct(niMarginVal) : 'N/A'} indent alt />
                <PLRow label={`Diluted EPS (${basisTag(epsNonGaap)})`} value={epsVal != null ? fmtPerShare(epsVal) : 'N/A'} />
              </>
            )}
          </div>
          </>)}

          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Balance Sheet Highlights ($M)
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ background: NAVY, padding: '5px 10px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Item</span>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>{fmtAsOf(target.balanceSheetAsOf, target.balanceSheetBasis) ? `As of ${fmtAsOf(target.balanceSheetAsOf, target.balanceSheetBasis)} ($M)` : 'Value ($M)'}</span>
            </div>
            {bankMode ? (
              <>
                <PLRow label="Total Assets"          value={fmtBankVal(target.totalAssets != null ? parseFloat(target.totalAssets) : null)} />
                <PLRow label="Total Loans"           value={fmtBankVal(target.totalLoans  != null ? parseFloat(target.totalLoans)  : null)} alt />
                <PLRow label="Total Deposits"        value={fmtBankVal(target.totalDeposits != null ? parseFloat(target.totalDeposits) : null)} />
                <PLRow label="Tangible Book Value"   value={fmtBankVal(target.tangibleBookValue != null ? parseFloat(target.tangibleBookValue) : null)} alt bold />
                <PLRow label="CET1 Ratio"            value={target.cet1Ratio != null ? fmtPct(target.cet1Ratio * 100) : 'N/A'} />
                <PLRow label="Shares Outstanding (M)" value={shares > 0 ? `${shares.toFixed(0)}M` : 'N/A'} alt />
              </>
            ) : (
              <>
                <PLRow label="Cash &amp; Equivalents" value={fmtUSDm(cash)} />
                <PLRow label="Total Debt"              value={fmtUSDm(debt)} alt />
                <PLRow label="Net Debt / (Cash)"       value={fmtUSDmAcct(netDebt)} bold />
                <PLRow label="Shares Outstanding (M)"  value={shares > 0 ? `${shares.toFixed(0)}M` : 'N/A'} alt />
              </>
            )}
          </div>
        </div>

        {/* Right: commentary */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Key Commentary
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: NAVY, padding: '5px 10px' }}>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Financial Highlights</span>
            </div>
            <div style={{ padding: '10px 12px' }}>
              {(bankMode && showDealCommentary && deal ? buildBankCommentary(target, deal, { nii, nonIntInc, nonIntExp, bankTotalRev, bankNiMargin }) : commentary).map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: '#0070D2', fontSize: 14, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>•</span>
                  <span style={{ fontSize: 11, color: '#374151', lineHeight: 1.5 }}>{line}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Metric Profile panel — single-year margins; hidden when the multi-year Margins & Growth block is shown. */}
          {!pnl && (bankMode ? (
            (() => {
              const effRatio = (nonIntExp != null && bankTotalRev != null && bankTotalRev > 0)
                ? (nonIntExp / bankTotalRev * 100) : null;
              const cet1Pct  = target.cet1Ratio != null ? target.cet1Ratio * 100 : null;
              const metrics  = [
                effRatio != null && { label: 'Efficiency Ratio', pct: effRatio, invertColor: true, note: 'lower is better' },
                bankNiMargin > 0 && { label: 'Net Margin', pct: bankNiMargin },
                cet1Pct != null && { label: 'CET1 Ratio', pct: cet1Pct, cap: 20 },
              ].filter(Boolean);
              if (!metrics.length) return null;
              return (
                <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '12px 14px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    Key Metrics
                  </div>
                  {metrics.map(m => {
                    const barPct = Math.min(Math.max(m.pct, 0), m.cap || 100);
                    const barColor = m.invertColor
                      ? (m.pct < 55 ? '#16A34A' : m.pct < 65 ? '#D97706' : '#DC2626')
                      : '#0070D2';
                    return (
                      <div key={m.label} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 10, color: '#374151' }}>{m.label}{m.note ? ` (${m.note})` : ''}</span>
                          <span style={{ fontSize: 10, fontWeight: 600, color: NAVY }}>{fmtPct(m.pct)}</span>
                        </div>
                        <div style={{ height: 8, background: '#E5E7EB', borderRadius: 4 }}>
                          <div style={{ height: 8, borderRadius: 4, background: barColor, width: `${barPct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          ) : (
            ebitdaMargin > 0 && (
              <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  Margin Profile
                </div>
                {[
                  !restaurantMode && { label: gpIsEst ? 'Gross Margin (est.)' : 'Gross Margin (GAAP)', pct: grossMarginPct },
                  opMarginPct != null && { label: `Operating Margin (${basisTag(opIncNonGaap)})`, pct: opMarginPct },
                  { label: 'EBITDA Margin (computed)', pct: ebitdaMargin },
                  niMarginVal != null && { label: `Net Margin (${basisTag(niNonGaap)})`, pct: niMarginVal },
                ].filter(Boolean).map(m => (
                  <div key={m.label} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 10, color: '#374151' }}>{m.label}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: NAVY }}>{fmtPct(m.pct)}</span>
                    </div>
                    <div style={{ height: 8, background: '#E5E7EB', borderRadius: 4 }}>
                      <div style={{ height: 8, borderRadius: 4, background: '#0070D2', width: `${Math.min(Math.max(m.pct, 0), 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )
          ))}
        </div>
      </div>
      {!bankMode && (
        <div style={{ padding: '0 20px 8px', fontSize: 9, color: '#6B7280', lineHeight: 1.45 }}>
          <strong style={{ color: NAVY }}>Basis of presentation: </strong>
          {ng
            ? `Operating income, net income, diluted EPS and their margins are Non-GAAP, as reported in ${target.name || 'the company'}’s fiscal year-end earnings release (Form 8-K, Item 2.02${ng.accession ? `, accession ${ng.accession}` : ''}), period-matched to ${fyLabel} and reconciled to GAAP. `
            : (selfNonGaap
                ? `This deal is presented on a GAAP basis — non-GAAP is applied only when both companies’ fiscal year-end non-GAAP reconciliations are available, so operating income, net income, EPS and their margins are GAAP here. `
                : (['extractor_unavailable', 'extractor_error', 'extractor_bad_output'].includes(target.nonGaap?.status)
                    // Stage 9G — SYSTEM failure (extractor unavailable / errored / unparseable output). Do NOT blame the filer.
                    ? `Non-GAAP extraction was unavailable for this deck; figures shown are GAAP. `
                    : `Non-GAAP figures were not available/reconciled for this filer from the fiscal year-end earnings 8-K, so operating income, net income, EPS and their margins are shown on a GAAP basis (labeled). `))}
          {restaurantMode
            ? 'Restaurant cost structure — gross profit not separately meaningful (food/beverage COGS excludes the dominant labor & occupancy costs); see operating margin. '
            : 'Gross profit, gross margin and operating expenses are GAAP. '}
          EBITDA and its margin are computed (operating income + D&amp;A). Revenue and share counts are basis-neutral.
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
