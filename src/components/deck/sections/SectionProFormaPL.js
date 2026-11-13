import { apiUrl } from '../../../api';
import React, { useState, useEffect } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { BasisNote } from '../shared/BasisNote';
import { NAVY, SF_BLUE, GRAY_BORDER, ALT_ROW, fmtPerShare, accretionVerdict, isGrossNm, grossNmNote, fmtInterest } from '../shared/deckTokens';
import { calcProFormaEPS, epsAccretionPct, acquirerDilutedShares, forwardYearInputs, TAX_RATE } from '../../../utils/dealCalc';
import { NONE_ENTERED, REVENUE_ONLY_FLAG, marginSentence } from '../../../lib/synergies';
import { formatDeckDate, forwardNetIncomeLabel } from '../../../lib/composeSourceLine';
import { isNonGaapDeal } from '../../../lib/reportingBasis';

// ── §6 — Pro Forma & Accretion (one logical exhibit, split across two pages) ─────────────────────────────
// §6a "Pro Forma Combined" (Exhibit E): the detailed per-forward-year tables (Revenue, growth %, Gross
// Profit, margins, OpEx, EBIT, Net Income) — UNCHANGED from the prior §6 (already ~796px, an accepted tall
// page). §6b "Pro Forma — Accretion" (Exhibit F, the old §7's slot): the Accretion/(Dilution) sub-table —
// Year 1 = deal.epsAccretion READ VERBATIM (the dealCalc headline, zero recompute), forward Y2/Y3 = the
// SAME engine (calcProFormaEPS/epsAccretionPct) fed forward net income. §7's redundant compact combined
// block is DROPPED (§6a shows it richer). Both parts share the /api/pnl (+ /api/estimates) fetch via a
// module-level promise cache → a single HTTP per endpoint. NO accretion math is re-derived here; the
// forward loop is a relocated CALLER of the shared engine, and Year 1 is a read, not a calc.

const VERIFIED_BG = '#EEF2F8', VERIFIED_BORDER = SF_BLUE;
const FORWARD_BG  = '#FFFBEB', FORWARD_BORDER  = '#F59E0B';
const ACC_GREEN = '#047857', DIL_RED = '#DC2626', NEUTRAL_GRAY = '#6B7280';

const fmtM    = (v) => v == null ? '—' : (v < 0 ? `($${Math.abs(Math.round(v)).toLocaleString('en-US')})` : `$${Math.round(v).toLocaleString('en-US')}`);
// The financing line and its basis note go through the deck's one interest formatter (one decimal under $10M).
const fmtFin  = (v) => fmtInterest(v, { unit: '', whole: fmtM });
const fmtPlus = (v) => v == null ? '—' : (v === 0 ? '—' : `+$${Math.round(v).toLocaleString('en-US')}`);
const fmtPct1 = (v) => v == null ? '—' : `${v.toFixed(1)}%`;
const fmtAcc  = (pct) => {
  if (pct == null || !Number.isFinite(pct)) return 'n/m';
  const r = Math.abs(pct).toFixed(1);
  return r === '0.0' ? '0.0%' : `${pct >= 0 ? '+' : '−'}${r}%`;
};
const fmtD = (v) => v == null ? '—' : `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(2)}`;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const fyeMonth = (fye) => (typeof fye === 'string' && fye.length >= 7) ? (MONTHS[parseInt(fye.substring(5, 7), 10) - 1] || null) : null;

// Module-level PROMISE caches — dedupe §6a/§6b (and concurrent mounts) to a single fetch per endpoint.
const _pnlCache = {}, _estCache = {};
export function pnlFetch(ticker) {
  if (!_pnlCache[ticker]) {
    _pnlCache[ticker] = fetch(apiUrl(`/api/pnl/${encodeURIComponent(ticker)}`))
      .then(r => r.json()).then(j => (j && j.ok && Array.isArray(j.columns)) ? j : null).catch(() => null);
  }
  return _pnlCache[ticker];
}
function estFetch(ticker) {
  if (!_estCache[ticker]) {
    _estCache[ticker] = fetch(apiUrl(`/api/estimates/${encodeURIComponent(ticker)}`))
      .then(r => r.json()).then(d => Array.isArray(d.estimates) ? d.estimates : []).catch(() => []);
  }
  return _estCache[ticker];
}

const Cell = ({ v, kind, bold, color, nm, text }) => (
  <span style={{ flex: 1, fontSize: text ? 9 : 10, textAlign: 'right', fontWeight: bold ? 700 : 500, color: color || (typeof v === 'number' && v < 0 ? '#DC2626' : '#374151') }}>
    {text ? text : nm ? 'n/m' : kind === 'pct' ? fmtPct1(v) : kind === 'syn' ? fmtPlus(v) : kind === 'dash' ? '—' : kind === 'int' ? fmtFin(v) : fmtM(v)}
  </span>
);

function ProFormaCore({ target, acquirer, deal, pageNum, part, exhibitLabel }) {
  const aTk = acquirer?.ticker || acquirer?.name || 'Acquirer';
  const bTk = target?.ticker || target?.name || 'Target';
  const isA = part === 'a';

  const [aPnl, setAPnl] = useState(null);
  const [bPnl, setBPnl] = useState(null);
  const [aEst, setAEst] = useState(null);
  const [bEst, setBEst] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancel = false;
    if (!acquirer?.ticker || !target?.ticker) { setLoaded(true); return; }
    const jobs = [pnlFetch(acquirer.ticker), pnlFetch(target.ticker)];
    if (!isA) jobs.push(estFetch(acquirer.ticker), estFetch(target.ticker)); // estimates only for §6b's analyst-count note
    Promise.all(jobs).then((res) => {
      if (cancel) return;
      setAPnl(res[0]); setBPnl(res[1]);
      if (!isA) { setAEst(res[2] || []); setBEst(res[3] || []); }
      setLoaded(true);
    });
    return () => { cancel = true; };
  }, [acquirer?.ticker, target?.ticker, isA]);

  // Shared /api/pnl-derived columns (both parts).
  const aFwd = aPnl ? aPnl.columns.filter(c => !c.actual) : [];
  const bFwd = bPnl ? bPnl.columns.filter(c => !c.actual) : [];
  const aAct = aPnl ? [...aPnl.columns].reverse().find(c => c.actual) : null;
  const bAct = bPnl ? [...bPnl.columns].reverse().find(c => c.actual) : null;
  const synergyYears = deal?.synergies?.years || [];
  const synergyMargin = deal?.synergies?.margin || null;
  // Combined = BOTH legs, or null ("—"). Returning the one live leg (the old `x ?? y` fallback) labelled a
  // single company's figure "Combined" and — worse — fed it into margin(cGross, cRev) against a two-leg
  // revenue: AAPL/VZ FY2026E rendered GM 223,949 / (477,451 + 140,906) = 36.2% with VZ GP null (Pattern B).
  const sum = (x, y) => (x != null && y != null) ? x + y : null;

  // Transaction adjustment (surfaced from dealCalc — NOT recomputed): the deal-level after-tax acquisition-
  // financing interest, constant across forward years. §6a previously OMITTED this from PF Net Income
  // (overstating it); we now subtract it so §6a foots to §6b's accretion basis, and §6b shows the full
  // bridge. Read from _results.newInterestAfterTax (dealCalc.js:99/136) — the same value the accretion uses.
  // null = drag unknown (target debt unavailable → new debt unknown); PF Net Income goes '—', never drag-free.
  const finDrag = deal?._results?.newInterestAfterTax != null ? parseFloat(deal._results.newInterestAfterTax) : null;
  const _niA = deal?._inputs?.companyANetIncome, _niB = deal?._inputs?.companyBNetIncome;   // null-safe (dead: not rendered since the 7E §9-fold, but no ||0 coercion left behind)
  const bridgeCombNI = (_niA != null && _niB != null) ? parseFloat(_niA) + parseFloat(_niB) : null;
  const bridgeAtSyn  = parseFloat(deal?._results?.afterTaxSynergies) || 0;
  const bridgePfNI   = deal?._results?.proFormaNetIncome != null ? parseFloat(deal._results.proFormaNetIncome) : null;

  // ══════════════════════════ §6a — detailed per-year pro-forma tables (UNCHANGED) ══════════════════════
  const nYears = Math.min(aFwd.length, bFwd.length, synergyYears.length);
  const years = [];
  if (isA) {
    for (let k = 0; k < nYears; k++) {
      const a = aFwd[k], b = bFwd[k];
      const aPrev = k === 0 ? aAct : aFwd[k - 1];
      const bPrev = k === 0 ? bAct : bFwd[k - 1];
      const yr = synergyYears[k];
      const syn = yr.ebitda, atSyn = syn * (1 - TAX_RATE);
      const none = (v) => (v == null ? NONE_ENTERED : null);
      const margin = (num, rev) => (num != null && rev) ? num / rev * 100 : null;
      const growth = (cur, base) => (cur != null && base) ? (cur - base) / base * 100 : null;
      const cRev = sum(a.revenue, b.revenue), cGross = sum(a.grossProfit, b.grossProfit);
      const cEbit = sum(a.operatingIncome, b.operatingIncome), cNi = sum(a.netIncome, b.netIncome);
      // Utility or insurer on either side: n/m in its own column and in Combined and PF, which it would otherwise be part of.
      const grossNm = { nmA: isGrossNm(acquirer), nmB: isGrossNm(target), nmC: isGrossNm(acquirer) || isGrossNm(target) };
      years.push({
        label: a.label,
        rows: [
          { label: 'Revenue',          a: a.revenue,        b: b.revenue,        c: cRev,   syn: yr.revenue, pf: cRev != null ? cRev + (yr.revenue ?? 0) : null },
          { label: `Revenue growth % (vs ${aPrev?.label ?? 'prior year'})`,  a: growth(a.revenue, aPrev?.revenue), b: growth(b.revenue, bPrev?.revenue), c: growth(cRev, sum(aPrev?.revenue, bPrev?.revenue)), pct: true },
          // COGS breakout (faculty: compare across industries). Informational fundamental line — Combined
          // foots Revenue − Cost of Revenue = Gross Profit; synergies are shown on the Revenue/GP lines, so
          // COGS carries no Syn/PF cell ("—"). Forward years: costOfRevenue present in /api/pnl (else "—").
          { label: 'Cost of Revenue',   a: a.costOfRevenue,  b: b.costOfRevenue,  c: sum(a.costOfRevenue, b.costOfRevenue), syn: null, pf: null, noConsensus: true },
          // Gross Profit renders COMBINED with NO synergy add (7C-2): the deck cannot source whether a synergy
          // sits in cost of revenue, so PF gross profit = Combined and agrees with the gross-margin row below.
          { label: 'Gross Profit',      a: a.grossProfit,    b: b.grossProfit,    c: cGross, syn: null,    pf: cGross, noConsensus: !grossNm.nmC, ...grossNm },
          { label: 'Gross margin %',    a: margin(a.grossProfit, a.revenue), b: margin(b.grossProfit, b.revenue), c: margin(cGross, cRev), pct: true, noConsensus: !grossNm.nmC, ...grossNm },
          // Cost, revenue and total synergies, on their own lines in the Synergy column only: Acq/Tgt/Comb have
          // no base figure. The total is what EBIT carries, so nothing double-counts.
          { label: 'Cost synergies', syn: yr.cost, synText: none(yr.cost), pf: null },
          { label: synergyMargin?.pct != null ? `Revenue synergies at ${synergyMargin.pct.toFixed(1)}% margin` : 'Revenue synergies (revenue only)', syn: yr.revenueEbitda,
            synText: yr.revenue == null ? NONE_ENTERED : (yr.revenueEbitda == null ? 'not in EBITDA' : null), pf: null },
          { label: 'Total synergies (EBITDA impact)', syn: yr.ebitda, synText: yr.entered ? null : NONE_ENTERED, pf: null },
          { label: 'Operating Expense', a: null,             b: null,             c: null,   syn: null,    pf: null, dash: true },
          { label: 'EBIT (Op Income)',  a: a.operatingIncome,b: b.operatingIncome,c: cEbit,  syn: syn,     pf: cEbit != null ? cEbit + syn : null, bold: true },
          { label: 'Operating margin %',a: margin(a.operatingIncome, a.revenue), b: margin(b.operatingIncome, b.revenue), c: margin(cEbit, cRev), pct: true },
          // PF Net Income subtracts the after-tax financing drag (finDrag) — the transaction adjustment §6a
          // previously netted SILENTLY (Comb + Syn ≠ PF Tot with no visible reason — faculty caught it). It
          // is now surfaced as its OWN "Less: financing" line (immediately below) so the page foots visibly:
          // Combined + Synergies − Financing = PF Net Income. The PF Tot VALUE is unchanged — only the
          // subtraction is made visible. finDrag = deal._results.newInterestAfterTax, the SAME value the §6b
          // accretion bridge shows (surfaced, not recomputed). Deal-level → "—" in Acq/Tgt/Comb/Syn; the
          // value shows only in PF Total, as a banker-parens negative.
          { label: 'Net Income',        a: a.netIncome,      b: b.netIncome,      c: cNi,    syn: atSyn,   pf: (cNi != null && finDrag != null) ? cNi + atSyn - finDrag : null, bold: true },
          { label: 'Less: Acq. financing interest (after-tax)', a: null, b: null, c: null, syn: null, pf: (cNi != null && finDrag != null) ? -finDrag : null, fin: true },
        ],
      });
    }
  }

  // ══════════════════════════ §6b — accretion (Year 1 anchor READ + forward loop RELOCATED) ═════════════
  // Year 1 = the EXACT dashboard headline (verified anchor) — read directly, NEVER recomputed.
  const headlinePct  = deal?.epsAccretion != null ? parseFloat(deal.epsAccretion) : null;
  const standaloneY1 = parseFloat(deal?._results?.companyAEPS) || parseFloat(deal?._inputs?.companyAEPS) || null;
  const pfEPSY1      = deal?.proFormaEPS != null ? parseFloat(deal.proFormaEPS) : null;

  const inputs   = deal?._inputs || {};
  const offer    = parseFloat(deal?.offerPrice) || parseFloat(inputs.offerPricePerShare) || 0;
  const acqDilSh = acquirerDilutedShares(inputs).shares;
  const synY = [deal?.synergiesY1, deal?.synergiesY2, deal?.synergiesY3];

  const forwardRows = [];
  { // 7E: computed for §8 too (§9 folded on) — the accretion strip lives on §8 now.
    const nFwd = loaded ? Math.min(aFwd.length, bFwd.length) : 0;
    for (let k = 0; k < nFwd; k++) {
      const a = aFwd[k], b = bFwd[k];                       // forward EPS from /api/pnl (== /api/estimates epsAvg)
      if (a?.eps == null || b?.eps == null || !(acqDilSh > 0)) continue;
      const fwdInputs = forwardYearInputs(inputs, a.eps, b.eps);
      // Synergy re-index (matches §6a's synRamp[k]): first forward year = synergiesY1. NO off-by-one.
      const synYr = k + 1;
      const syn   = parseFloat(synY[k]) || 0;
      const ea = (aEst || []).find(e => e && e.fy === a.fy);
      const eb = (bEst || []).find(e => e && e.fy === b.fy);
      const analysts = (ea?.numAnalysts != null && eb?.numAnalysts != null) ? Math.min(ea.numAnalysts, eb.numAnalysts) : null;
      forwardRows.push({
        year: k + 2, synYr, acqFY: a.fy, tgtFY: b.fy,
        standaloneEPS: a.eps,
        pfEPS: calcProFormaEPS(offer, syn, fwdInputs),
        pct: epsAccretionPct(offer, syn, fwdInputs),
        // 7E: ex-synergy PF EPS / accretion — SAME dealCalc calls with synergies = 0 (no new path).
        pfEPSExSyn: calcProFormaEPS(offer, 0, fwdInputs),
        pctExSyn:   epsAccretionPct(offer, 0, fwdInputs),
        analysts,
      });
    }
  }
  // Year-1 ex-synergy accretion — same dealCalc calls with synergies = 0 (7E); Year 1 uses the deal inputs.
  const pfEPSY1ExSyn = offer > 0 ? calcProFormaEPS(offer, 0, inputs) : null;
  const pctY1ExSyn   = offer > 0 ? epsAccretionPct(offer, 0, inputs) : null;
  // GAAP | Non-GAAP plan (src/lib/reportingBasis.js): null on a GAAP deal, which keeps the Year 1 tag as it was.
  const ngPlan = isNonGaapDeal(deal) ? deal.reportingBasis : null;
  const y1Fy = ngPlan ? (ngPlan.eps.nonGaap ? 'Current actuals (non-GAAP, company reported)' : 'Current actuals (GAAP)') : 'Current actuals (verified)';
  const accRows = [
    { label: 'Year 1', tag: (acquirer?.basis === 'ltm' || target?.basis === 'ltm') ? (deal?._results?.basesDiffer ? 'Companies on different bases' : 'LTM actuals') : y1Fy, basis: 'verified', standalone: standaloneY1, pf: pfEPSY1, pfExSyn: pfEPSY1ExSyn, pct: headlinePct, pctExSyn: pctY1ExSyn },
    ...forwardRows.map(r => ({ label: `Year ${r.year}`, tag: `Forward consensus (FY${r.acqFY}e) + Yr${r.synYr} synergies`, basis: 'forward', standalone: r.standaloneEPS, pf: r.pfEPS, pfExSyn: r.pfEPSExSyn, pct: r.pct, pctExSyn: r.pctExSyn, analysts: r.analysts })),
  ];

  const accretionSource = (() => {
    const date = formatDeckDate(deal?.offerPriceAsOf) || formatDeckDate(deal?._dataDate);
    const aMonth = fyeMonth(acquirer?.fiscalYearEnd), bMonth = fyeMonth(target?.fiscalYearEnd);
    const calClause = (aMonth && bMonth)
      ? (aMonth === bMonth
          ? `${aTk} and ${bTk} fiscal calendars align (both end ${aMonth}), so the forward years map to the same calendar period`
          : `fiscal calendars differ (${aTk} ends ${aMonth}, ${bTk} ends ${bMonth}), so they are relative years, not the same calendar period`)
      : `fiscal calendars may differ between ${aTk} and ${bTk}, so the forward years are relative — not necessarily the same calendar period`;
    const fwdNote = forwardRows.length
      ? `Forward years (${forwardRows.map(r => r.year).join(' & ')}) are sell-side analyst consensus (Financial Modeling Prep, mean EPS) — net income = consensus EPS × diluted shares — combined on the SAME engine as the headline with the deal's entered synergies and the same acquisition-financing cost; ${calClause}. Consensus is a forecast, not verified.`
      : `Forward analyst estimates were unavailable — only the verified Year-1 anchor is shown (no forward curve is fabricated).`;
    return `Year 1 is the CURRENT-ACTUALS accretion — identical to the deck's headline (reconciled SEC actuals; the number every other slide leads with). ${fwdNote}${date ? ` Deal terms as of ${date}.` : ''}`;
  })();

  // ══════════════════════════ RENDER ════════════════════════════════════════════════════════════════════
  if (isA) {
    return (
      <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
        <PageHeader
          title="Pro Forma Combined — Projected"
          subtitle={`${aTk} + ${bTk} · forward analyst consensus · Acquirer | Target | Combined | Synergies | PF Total`}
        />
        <div style={{ padding: '14px 20px 8px' }}>
          {deal?.hasMarketData === false ? (
            <div style={{ padding: '10px 12px', background: '#F9FAFB', border: '1px dashed #D1D5DB', borderRadius: 6, fontSize: 11.5, color: '#6B7280', lineHeight: 1.5 }}>
              Pro-forma EPS accretion / (dilution) and the trading profile are <strong>omitted for a private deal</strong> — a private company has no share count, EPS, or market price, so pro-forma EPS is not defined. Combined revenue, EBITDA and net income are on the Standalone P&amp;L and Transaction Structure exhibits; the leverage-based view is on the <strong>Pro-Forma Credit Statistics</strong> exhibit.
            </div>
          ) : !loaded ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#9CA3AF', fontSize: 12, fontStyle: 'italic' }}>Loading forward analyst estimates…</div>
          ) : nYears === 0 ? (
            <div style={{ padding: '10px 12px', background: '#FFFBEB', border: '1px dashed #F59E0B', borderRadius: 6, fontSize: 11, color: '#92400E' }}>
              Forward analyst estimates unavailable for {aTk}/{bTk} — no projected pro forma is fabricated.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {years.map((yr, yi) => (
                <div key={yi}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    {yr.label} <span style={{ color: '#9CA3AF', fontWeight: 400 }}>($M, analyst consensus)</span>
                  </div>
                  <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ background: NAVY, display: 'flex', padding: '5px 8px' }}>
                      <span style={{ flex: 1.7, color: '#fff', fontSize: 9.5, fontWeight: 700 }}>Line</span>
                      {['Acq.', 'Tgt.', 'Comb.', 'Syn.', 'PF Tot.'].map(h => (
                        <span key={h} style={{ flex: 1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>{h}</span>
                      ))}
                    </div>
                    {yr.rows.map((r, ri) => {
                      const isPct = r.pct, isDash = r.dash;
                      return (
                        <div key={r.label} style={{ display: 'flex', padding: '4px 8px', background: r.bold ? '#EFF6FF' : (ri % 2 ? ALT_ROW : '#fff'), borderBottom: `1px solid ${GRAY_BORDER}` }}>
                          <span style={{ flex: 1.7, fontSize: 9.5, color: r.bold ? NAVY : (r.fin ? '#6B7280' : '#374151'), fontWeight: r.bold ? 700 : 400, fontStyle: r.fin ? 'italic' : 'normal', paddingLeft: r.fin ? 10 : 0 }}>
                            {r.label}{r.noConsensus && r.c == null ? <sup style={{ fontSize: 9.5, color: '#6B7280' }}> n</sup> : null}
                          </span>
                          <Cell v={r.a} nm={r.nmA} kind={isPct ? 'pct' : isDash ? 'dash' : 'm'} bold={r.bold} />
                          <Cell v={r.b} nm={r.nmB} kind={isPct ? 'pct' : isDash ? 'dash' : 'm'} bold={r.bold} />
                          <Cell v={r.c} nm={r.nmC} kind={isPct ? 'pct' : isDash ? 'dash' : 'm'} bold={r.bold} color={r.bold ? NAVY : undefined} />
                          <Cell v={isPct || isDash ? null : r.syn} text={r.synText} kind={isPct || isDash ? 'dash' : 'syn'} color="#166534" />
                          <Cell v={isPct ? r.c : (isDash ? null : r.pf)} nm={r.nmC} kind={isPct ? 'pct' : isDash ? 'dash' : r.fin ? 'int' : 'm'} bold={!r.fin} color={r.fin ? '#DC2626' : NAVY} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {/* Accretion strip (7E — §9 folded onto §8): standalone vs PF EPS, WITH and WITHOUT synergies, per
                  year, + verdict. Ex-synergy = the SAME dealCalc calls with synergies=0 (no new path). The P&L
                  tables above already show the with/without-synergy build (Combined vs PF columns); the deal.basis
                  badge (7C-3) is retained; §9's Year-1 NI bridge is NOT carried (Net Income + Less-financing rows
                  above already show that build for all three years). */}
              {deal?.hasMarketData === false ? (
                <div style={{ padding: '10px 12px', background: '#F9FAFB', border: '1px dashed #D1D5DB', borderRadius: 6, fontSize: 11, color: '#6B7280' }}>
                  EPS accretion / (dilution) and the pro-forma trading profile are omitted — a private company has no share count, EPS, or market price, so pro-forma EPS is not defined. The leverage-based view is on the Pro-Forma Credit Stats exhibit.
                </div>
              ) : (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  Accretion / (Dilution) — Pro Forma EPS vs. {aTk} Standalone
                  {deal?.basis === 'Non-GAAP' && (
                    <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: '#0070D2', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 3, padding: '1px 6px', textTransform: 'none', letterSpacing: 0 }}>Non-GAAP basis</span>
                  )}
                </div>
                {ngPlan && (
                  <div data-testid="pf-eps-basis-note" style={{ fontSize: 9.5, color: '#6B7280', fontStyle: 'italic', marginBottom: 4, lineHeight: 1.35 }}>
                    {ngPlan.eps.nonGaap
                      ? 'Year 1: non-GAAP EPS, company reported by both companies (fiscal-year earnings releases). Forward years: FMP consensus, a basis the provider does not designate; Year 1 and forward years are not presented as one series.'
                      : `Year 1: ${ngPlan.eps.note}. Forward years: FMP consensus, a basis the provider does not designate, so Year 1 (GAAP) and the forward years are not on one basis.`}
                  </div>
                )}
                <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ background: NAVY, display: 'flex', padding: '4px 8px' }}>
                    <span style={{ flex: 2, color: '#fff', fontSize: 9.5, fontWeight: 700 }}>Year (basis)</span>
                    <span style={{ flex: 1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>Acq. EPS</span>
                    <span style={{ flex: 1.15, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>PF EPS ex-syn.</span>
                    <span style={{ flex: 1.15, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>PF EPS w/ syn.</span>
                    <span style={{ flex: 1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>Δ% ex-syn.</span>
                    <span style={{ flex: 1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>Δ% w/ syn.</span>
                    <span style={{ flex: 1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>Verdict</span>
                  </div>
                  {accRows.map((r) => {
                    const fwd = r.basis === 'forward';
                    const verdict = accretionVerdict(r.pct);
                    const vColor = verdict === 'neutral' ? NEUTRAL_GRAY : verdict === 'accretive' ? ACC_GREEN : verdict === 'dilutive' ? DIL_RED : '#9CA3AF';
                    return (
                      <div key={r.label} style={{ display: 'flex', alignItems: 'center', padding: '3px 8px', background: fwd ? FORWARD_BG : VERIFIED_BG, borderLeft: `3px solid ${fwd ? FORWARD_BORDER : VERIFIED_BORDER}`, borderBottom: `1px solid ${GRAY_BORDER}` }}>
                        <span style={{ flex: 2, fontSize: 9.5 }}><span style={{ fontWeight: 700, color: NAVY }}>{r.label}</span> <span style={{ fontSize: 9.5, color: fwd ? '#92400E' : '#475569', fontStyle: 'italic' }}>{r.tag}</span></span>
                        <span style={{ flex: 1, fontSize: 9.5, textAlign: 'right', color: '#374151' }}>{r.standalone != null ? fmtPerShare(r.standalone) : '—'}</span>
                        <span style={{ flex: 1.15, fontSize: 9.5, textAlign: 'right', color: '#374151' }}>{r.pfExSyn != null ? fmtPerShare(r.pfExSyn) : '—'}</span>
                        <span style={{ flex: 1.15, fontSize: 9.5, textAlign: 'right', fontWeight: 600, color: NAVY }}>{r.pf != null ? fmtPerShare(r.pf) : '—'}</span>
                        <span style={{ flex: 1, fontSize: 9.5, textAlign: 'right', color: '#6B7280' }}>{r.pctExSyn == null ? 'n/m' : fmtAcc(r.pctExSyn)}</span>
                        <span style={{ flex: 1, fontSize: 9.5, textAlign: 'right', fontWeight: 700, color: vColor }}>{r.pct == null ? 'n/m' : fmtAcc(r.pct)}</span>
                        <span style={{ flex: 1, fontSize: 9.5, textAlign: 'right', fontWeight: 700, color: vColor }}>{verdict == null ? '—' : verdict === 'neutral' ? 'Neutral' : verdict === 'accretive' ? 'Accretive' : 'Dilutive'}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 3, fontSize: 9.5, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.3 }}>
                  Ex-syn./w-syn. exclude/include the deal's entered synergies (same split as Combined vs PF above); Year&nbsp;1 verified, Years&nbsp;2–4 consensus. Measured on the {deal?.basis === 'Non-GAAP' ? 'non-GAAP' : 'GAAP'} standalone EPS (deck headline).
                  {forwardRows.length > 0 && <> {forwardNetIncomeLabel(inputs)}.</>}
                </div>
              </div>
              )}
            </div>
          )}
        </div>
        <BasisNote acquirer={acquirer} target={target} deal={deal} fixed="Forward years are consensus for both companies, so their combined columns stay on one basis." style={{ padding: '6px 20px 0' }} />
        <div style={{ padding: '6px 20px 32px', fontSize: 9.5, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.45 }}>
          <strong style={{ color: NAVY }}>Basis: </strong>
          {grossNmNote(acquirer, target) ? <>{grossNmNote(acquirer, target)} </> : null}
          Acquirer &amp; target forward legs are Street <strong>analyst consensus</strong> (FMP analyst-estimates) — a single provider series whose reporting basis follows each company's street convention and is <strong>not designated as GAAP or non-GAAP by the provider</strong>; the same source as the forward columns on the Standalone P&amp;L slides, so the figures tie per-value. Each combined year is paired position-wise and labeled by the acquirer's fiscal year (the two companies' fiscal calendars are offset). Combined = Acquirer + Target.
          <strong> Synergies are the deal's entered assumptions</strong> (total EBITDA impact {synergyYears.slice(0, nYears).map((y, k) => { const cr = sum(aFwd[k]?.revenue, bFwd[k]?.revenue); const pc = cr > 0 ? (y.ebitda / cr * 100) : null; return y.entered ? `${fmtM(y.ebitda)}${pc != null ? ` (${pc.toFixed(1)}% of comb. rev)` : ''} Yr ${k + 1}` : `${NONE_ENTERED} Yr ${k + 1}`; }).join(', ')}), NOT an analyst estimate. Cost synergies add to EBIT dollar for dollar — <strong>without asserting whether they arise in cost of revenue or operating expense</strong>. Revenue synergies add to PF revenue{deal?.synergies?.anyRevenue ? <> and {synergyMargin?.pct != null ? 'reach EBIT at the combined gross margin' : 'do not reach EBIT'}: {marginSentence(synergyMargin)}{deal.synergies.revenueOnly ? <> <strong style={{ color: '#92400E' }}>⚠ {REVENUE_ONLY_FLAG}</strong></> : null}</> : '.'} <strong>PF Net Income is net of the deal's after-tax acquisition-financing cost</strong> ({fmtFin(finDrag)}/yr — shown as the <em>"Less: financing"</em> line so the net-income build foots on the page); operating-line PF Total = Combined + Synergies. The pro forma EPS &amp; accretion — with and without synergies — are in the strip below. <strong>This model is built on {(acquirer?.basis === 'ltm' && target?.basis === 'ltm') ? 'the LTM actuals selected for Year 1' : 'latest-FY actuals'} + forward consensus</strong>; forward growth is always measured against fiscal-year figures, never LTM; the screening comps &amp; profile (Exhibits A / B) use an LTM basis — a deliberate split.
          <sup style={{ fontSize: 9.5 }}>n</sup> No consensus available: FMP publishes no forward gross profit, so forward cost of revenue, gross profit and gross margin are "—". Forward Operating Expense is "—" — consensus supplies operating income but not gross profit (same treatment as the Standalone P&amp;L slides).
        </div>
      </PageFrame>
    );
  }

  return null; // §9 (part='b') folded onto §8 — accretion strip is on §8 now (7E)
}

export function SectionProFormaPLA(props) { return <ProFormaCore {...props} part="a" />; }
