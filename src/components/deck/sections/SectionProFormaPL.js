import React, { useState, useEffect } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER, ALT_ROW, fmtPerShare, accretionVerdict } from '../shared/deckTokens';
import { calcProFormaEPS, epsAccretionPct, acquirerDilutedShares } from '../../../utils/dealCalc';
import { formatDeckDate } from '../../../lib/composeSourceLine';

// ── §6 — Pro Forma & Accretion (one logical exhibit, split across two pages) ─────────────────────────────
// §6a "Pro Forma Combined" (Exhibit E): the detailed per-forward-year tables (Revenue, growth %, Gross
// Profit, margins, OpEx, EBIT, Net Income) — UNCHANGED from the prior §6 (already ~796px, an accepted tall
// page). §6b "Pro Forma — Accretion" (Exhibit F, the old §7's slot): the Accretion/(Dilution) sub-table —
// Year 1 = deal.epsAccretion READ VERBATIM (the dealCalc headline, zero recompute), forward Y2/Y3 = the
// SAME engine (calcProFormaEPS/epsAccretionPct) fed forward net income. §7's redundant compact combined
// block is DROPPED (§6a shows it richer). Both parts share the /api/pnl (+ /api/estimates) fetch via a
// module-level promise cache → a single HTTP per endpoint. NO accretion math is re-derived here; the
// forward loop is a relocated CALLER of the shared engine, and Year 1 is a read, not a calc.
const COST_SYN_PCT = 0.55;
const REV_SYN_PCT  = 0.45;
const TAX_RATE     = 0.21;

const VERIFIED_BG = '#EEF2F8', VERIFIED_BORDER = SF_BLUE;
const FORWARD_BG  = '#FFFBEB', FORWARD_BORDER  = '#F59E0B';
const ACC_GREEN = '#047857', DIL_RED = '#DC2626', NEUTRAL_GRAY = '#6B7280';

const fmtM    = (v) => v == null ? '—' : (v < 0 ? `($${Math.abs(Math.round(v)).toLocaleString('en-US')})` : `$${Math.round(v).toLocaleString('en-US')}`);
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
function pnlFetch(ticker) {
  if (!_pnlCache[ticker]) {
    _pnlCache[ticker] = fetch(`http://localhost:3001/api/pnl/${encodeURIComponent(ticker)}`)
      .then(r => r.json()).then(j => (j && j.ok && Array.isArray(j.columns)) ? j : null).catch(() => null);
  }
  return _pnlCache[ticker];
}
function estFetch(ticker) {
  if (!_estCache[ticker]) {
    _estCache[ticker] = fetch(`http://localhost:3001/api/estimates/${encodeURIComponent(ticker)}`)
      .then(r => r.json()).then(d => Array.isArray(d.estimates) ? d.estimates : []).catch(() => []);
  }
  return _estCache[ticker];
}

const Cell = ({ v, kind, bold, color }) => (
  <span style={{ flex: 1, fontSize: 10, textAlign: 'right', fontWeight: bold ? 700 : 500, color: color || (typeof v === 'number' && v < 0 ? '#DC2626' : '#374151') }}>
    {kind === 'pct' ? fmtPct1(v) : kind === 'syn' ? fmtPlus(v) : kind === 'dash' ? '—' : fmtM(v)}
  </span>
);

function ProFormaCore({ target, acquirer, deal, pageNum, part }) {
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
  const synRamp = [parseFloat(deal?.synergiesY1) || 0, parseFloat(deal?.synergiesY2) || 0, parseFloat(deal?.synergiesY3) || 0];
  const sum = (x, y) => (x != null && y != null) ? x + y : (x ?? y ?? null);

  // Transaction adjustment (surfaced from dealCalc — NOT recomputed): the deal-level after-tax acquisition-
  // financing interest, constant across forward years. §6a previously OMITTED this from PF Net Income
  // (overstating it); we now subtract it so §6a foots to §6b's accretion basis, and §6b shows the full
  // bridge. Read from _results.newInterestAfterTax (dealCalc.js:99/136) — the same value the accretion uses.
  const finDrag = parseFloat(deal?._results?.newInterestAfterTax) || 0;
  const bridgeCombNI = (parseFloat(deal?._inputs?.companyANetIncome) || 0) + (parseFloat(deal?._inputs?.companyBNetIncome) || 0);
  const bridgeAtSyn  = parseFloat(deal?._results?.afterTaxSynergies) || 0;
  const bridgePfNI   = deal?._results?.proFormaNetIncome != null ? parseFloat(deal._results.proFormaNetIncome) : null;

  // ══════════════════════════ §6a — detailed per-year pro-forma tables (UNCHANGED) ══════════════════════
  const nYears = Math.min(aFwd.length, bFwd.length, synRamp.length);
  const years = [];
  if (isA) {
    for (let k = 0; k < nYears; k++) {
      const a = aFwd[k], b = bFwd[k];
      const aPrev = k === 0 ? aAct : aFwd[k - 1];
      const bPrev = k === 0 ? bAct : bFwd[k - 1];
      const syn = synRamp[k] || 0;
      const revSyn = syn * REV_SYN_PCT, costSyn = syn * COST_SYN_PCT, atSyn = syn * (1 - TAX_RATE);
      const margin = (num, rev) => (num != null && rev) ? num / rev * 100 : null;
      const growth = (cur, base) => (cur != null && base) ? (cur - base) / base * 100 : null;
      const cRev = sum(a.revenue, b.revenue), cGross = sum(a.grossProfit, b.grossProfit);
      const cEbit = sum(a.operatingIncome, b.operatingIncome), cNi = sum(a.netIncome, b.netIncome);
      years.push({
        label: a.label,
        rows: [
          { label: 'Revenue',          a: a.revenue,        b: b.revenue,        c: cRev,   syn: revSyn,  pf: cRev != null ? cRev + revSyn : null },
          { label: 'Revenue growth %',  a: growth(a.revenue, aPrev?.revenue), b: growth(b.revenue, bPrev?.revenue), c: growth(cRev, (aPrev?.revenue ?? 0) + (bPrev?.revenue ?? 0)), pct: true },
          // COGS breakout (faculty: compare across industries). Informational fundamental line — Combined
          // foots Revenue − Cost of Revenue = Gross Profit; synergies are shown on the Revenue/GP lines, so
          // COGS carries no Syn/PF cell ("—"). Forward years: costOfRevenue present in /api/pnl (else "—").
          { label: 'Cost of Revenue',   a: a.costOfRevenue,  b: b.costOfRevenue,  c: sum(a.costOfRevenue, b.costOfRevenue), syn: null, pf: null },
          { label: 'Gross Profit',      a: a.grossProfit,    b: b.grossProfit,    c: cGross, syn: costSyn, pf: cGross != null ? cGross + costSyn : null, est: true },
          { label: 'Gross margin %',    a: margin(a.grossProfit, a.revenue), b: margin(b.grossProfit, b.revenue), c: margin(cGross, cRev), pct: true },
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
          { label: 'Net Income',        a: a.netIncome,      b: b.netIncome,      c: cNi,    syn: atSyn,   pf: cNi != null ? cNi + atSyn - finDrag : null, bold: true },
          { label: 'Less: Acq. financing interest (after-tax)', a: null, b: null, c: null, syn: null, pf: cNi != null ? -finDrag : null, fin: true },
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
  const tgtDilSh = parseFloat(inputs.companyBDilutedShares) || parseFloat(inputs.companyBShares) || 0;
  const synY = [deal?.synergiesY1, deal?.synergiesY2, deal?.synergiesY3];

  const forwardRows = [];
  if (!isA) {
    const nFwd = loaded ? Math.min(aFwd.length, bFwd.length) : 0;
    for (let k = 0; k < nFwd; k++) {
      const a = aFwd[k], b = bFwd[k];                       // forward EPS from /api/pnl (== /api/estimates epsAvg)
      if (a?.eps == null || b?.eps == null || !(acqDilSh > 0)) continue;
      const fwdInputs = {
        ...inputs,
        companyANetIncome:     a.eps * acqDilSh,
        companyAEPS:           a.eps,
        companyADilutedShares: acqDilSh,
        companyBNetIncome:     b.eps * tgtDilSh,
      };
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
        analysts,
      });
    }
  }
  const accRows = [
    { label: 'Year 1', tag: 'Current actuals (verified)', basis: 'verified', standalone: standaloneY1, pf: pfEPSY1, pct: headlinePct },
    ...forwardRows.map(r => ({ label: `Year ${r.year}`, tag: `Forward consensus (FY${r.acqFY}e) + Yr${r.synYr} synergies`, basis: 'forward', standalone: r.standaloneEPS, pf: r.pfEPS, pct: r.pct, analysts: r.analysts })),
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
      ? `Forward years (${forwardRows.map(r => r.year).join(' & ')}) are sell-side analyst consensus (Financial Modeling Prep, mean EPS) — net income = consensus EPS × diluted shares — combined on the SAME engine as the headline with the deal's synergy ramp and the same acquisition-financing cost; ${calClause}. Consensus is a forecast, not verified.`
      : `Forward analyst estimates were unavailable — only the verified Year-1 anchor is shown (no forward curve is fabricated).`;
    return `Year 1 is the CURRENT-ACTUALS accretion — identical to the deck's headline (reconciled SEC actuals; the number every other slide leads with). ${fwdNote}${date ? ` Deal terms as of ${date}.` : ''}`;
  })();

  // ══════════════════════════ RENDER ════════════════════════════════════════════════════════════════════
  if (isA) {
    return (
      <PageFrame pageNum={pageNum} exhibitLabel="Exhibit G">
        <PageHeader
          title="Pro Forma Combined — Projected"
          subtitle={`${aTk} + ${bTk} · forward analyst consensus · Acquirer | Target | Combined | Synergies | PF Total`}
        />
        <div style={{ padding: '14px 20px 8px' }}>
          {!loaded ? (
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
                      <span style={{ flex: 1.7, color: '#fff', fontSize: 9, fontWeight: 700 }}>Line</span>
                      {['Acq.', 'Tgt.', 'Comb.', 'Syn.', 'PF Tot.'].map(h => (
                        <span key={h} style={{ flex: 1, color: '#fff', fontSize: 9, fontWeight: 700, textAlign: 'right' }}>{h}</span>
                      ))}
                    </div>
                    {yr.rows.map((r, ri) => {
                      const isPct = r.pct, isDash = r.dash;
                      return (
                        <div key={r.label} style={{ display: 'flex', padding: '4px 8px', background: r.bold ? '#EFF6FF' : (ri % 2 ? ALT_ROW : '#fff'), borderBottom: `1px solid ${GRAY_BORDER}` }}>
                          <span style={{ flex: 1.7, fontSize: 9.5, color: r.bold ? NAVY : (r.fin ? '#6B7280' : '#374151'), fontWeight: r.bold ? 700 : 400, fontStyle: r.fin ? 'italic' : 'normal', paddingLeft: r.fin ? 10 : 0 }}>
                            {r.label}{r.est ? <sup style={{ fontSize: 7, color: '#6B7280' }}> e</sup> : null}
                          </span>
                          <Cell v={r.a} kind={isPct ? 'pct' : isDash ? 'dash' : 'm'} bold={r.bold} />
                          <Cell v={r.b} kind={isPct ? 'pct' : isDash ? 'dash' : 'm'} bold={r.bold} />
                          <Cell v={r.c} kind={isPct ? 'pct' : isDash ? 'dash' : 'm'} bold={r.bold} color={r.bold ? NAVY : undefined} />
                          <Cell v={isPct || isDash ? null : r.syn} kind={isPct || isDash ? 'dash' : 'syn'} color="#166534" />
                          <Cell v={isPct ? r.c : (isDash ? null : r.pf)} kind={isPct ? 'pct' : isDash ? 'dash' : 'm'} bold={!r.fin} color={r.fin ? '#DC2626' : NAVY} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: '6px 20px 16px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.45 }}>
          <strong style={{ color: NAVY }}>Basis: </strong>
          Acquirer &amp; target forward legs are Street <strong>analyst consensus</strong> (FMP analyst-estimates) — a single provider series whose reporting basis follows each company's street convention and is <strong>not designated as GAAP or non-GAAP by the provider</strong>; the same source as the forward columns on the Standalone P&amp;L slides, so the figures tie per-value. Each combined year is paired position-wise and labeled by the acquirer's fiscal year (the two companies' fiscal calendars are offset). Combined = Acquirer + Target.
          <strong> Synergies are the deal's modeled assumption</strong> (a {Math.round(COST_SYN_PCT * 100)}% cost / {Math.round(REV_SYN_PCT * 100)}% revenue ramp — {synRamp.slice(0, nYears).map((s, k) => { const cr = (aFwd[k]?.revenue ?? 0) + (bFwd[k]?.revenue ?? 0); const pc = cr > 0 ? (s / cr * 100) : null; return `${fmtM(s)}${pc != null ? ` (${pc.toFixed(1)}% of comb. rev)` : ''} Yr ${k + 1}`; }).join(', ')}), NOT an analyst estimate. <strong>PF Net Income is net of the deal's after-tax acquisition-financing cost</strong> ({fmtM(finDrag)}/yr — shown as the <em>"Less: financing"</em> line so the net-income build foots on the page, and reconciled on the Accretion page); operating-line PF Total = Combined + Synergies. The pro forma EPS &amp; accretion are on the next page. <strong>This model is built on latest-FY actuals + forward consensus</strong>; the screening comps &amp; profile (Exhibits A / B) use an LTM basis — a deliberate split.
          <sup>e</sup> Gross profit forward = most-recent actual gross margin held × consensus revenue (est.). Forward Operating Expense is "—" — consensus supplies operating income but not gross profit, so a derived figure would mix a held gross-margin assumption with consensus operating income (same treatment as the Standalone P&amp;L slides).
        </div>
      </PageFrame>
    );
  }

  // §6b — Accretion
  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit H">
      <PageHeader
        title="Pro Forma — Accretion / (Dilution)"
        subtitle={`${aTk} + ${bTk} · Year 1 verified actuals → forward analyst-estimate upside · pro forma EPS vs. ${aTk} standalone`}
      />
      <div style={{ padding: '14px 20px 6px' }}>
        {!loaded ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#9CA3AF', fontSize: 12, fontStyle: 'italic' }}>Loading forward analyst estimates…</div>
        ) : (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              Accretion / (Dilution) Analysis — Pro Forma EPS vs. {aTk} Standalone
              <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#0070D2', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 3, padding: '1px 6px', textTransform: 'none', letterSpacing: 0 }}>Non-GAAP basis</span>
            </div>
            <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ background: NAVY, display: 'flex', padding: '5px 10px' }}>
                <span style={{ flex: 2.1, color: '#fff', fontSize: 9.5, fontWeight: 700 }}>Year (basis)</span>
                <span style={{ flex: 1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>Acq. EPS</span>
                <span style={{ flex: 1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>PF EPS</span>
                <span style={{ flex: 1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>EPS Δ$</span>
                <span style={{ flex: 1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>EPS Δ%</span>
                <span style={{ flex: 1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>Verdict</span>
              </div>
              {accRows.map((r) => {
                const fwd = r.basis === 'forward';
                const verdict = accretionVerdict(r.pct);
                const vColor = verdict === 'neutral' ? NEUTRAL_GRAY : verdict === 'accretive' ? ACC_GREEN : verdict === 'dilutive' ? DIL_RED : '#9CA3AF';
                const delta = (r.pf != null && r.standalone != null) ? (r.pf - r.standalone) : null;
                return (
                  <div key={r.label} style={{ display: 'flex', padding: '6px 10px', alignItems: 'center',
                    background: fwd ? FORWARD_BG : VERIFIED_BG, borderLeft: `3px solid ${fwd ? FORWARD_BORDER : VERIFIED_BORDER}`,
                    borderBottom: `1px solid ${GRAY_BORDER}` }}>
                    <span style={{ flex: 2.1, fontSize: 10 }}>
                      <span style={{ fontWeight: 700, color: NAVY }}>{r.label}</span>
                      <span style={{ fontSize: 8.5, color: fwd ? '#92400E' : '#475569', fontStyle: 'italic', marginLeft: 6 }}>{r.tag}</span>
                    </span>
                    <span style={{ flex: 1, fontSize: 10, textAlign: 'right', color: '#374151' }}>{r.standalone != null ? fmtPerShare(r.standalone) : '—'}</span>
                    <span style={{ flex: 1, fontSize: 10, textAlign: 'right', fontWeight: 600, color: NAVY }}>{r.pf != null ? fmtPerShare(r.pf) : '—'}</span>
                    <span style={{ flex: 1, fontSize: 10, textAlign: 'right', color: vColor }}>{fmtD(delta)}</span>
                    <span style={{ flex: 1, fontSize: 10, textAlign: 'right', fontWeight: 700, color: vColor }}>{r.pct == null ? 'n/m' : fmtAcc(r.pct)}</span>
                    <span style={{ flex: 1, fontSize: 10, textAlign: 'right', fontWeight: 700, color: vColor }}>{verdict == null ? '—' : verdict === 'neutral' ? 'Neutral' : verdict === 'accretive' ? 'Accretive' : 'Dilutive'}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 8.5, color: '#6B7280' }}>
              <span><span style={{ color: VERIFIED_BORDER, fontWeight: 700 }}>▌</span> Verified (current actuals — matches dashboard)</span>
              <span><span style={{ color: FORWARD_BORDER, fontWeight: 700 }}>▌</span> Forward (analyst consensus — FMP)</span>
            </div>

            {/* Year-1 pro-forma net-income bridge — surfaces the transaction adjustment (the after-tax
                acquisition-financing cost) that §6a's PF Net Income now also subtracts. Built from dealCalc's
                OWN components (_inputs NI + _results synergies/financing) so it foots EXACTLY to the verified
                pro-forma NI that drives the Year-1 accretion — this is the number §6a is corrected to tie to. */}
            {bridgePfNI != null && (
              <div style={{ marginTop: 12, border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden', maxWidth: 480 }}>
                <div style={{ background: NAVY, padding: '5px 10px', fontSize: 9.5, fontWeight: 700, color: '#fff' }}>
                  Year-1 Pro-Forma Net Income Bridge <span style={{ fontWeight: 400, color: '#BFD4F2' }}>— transaction adjustments ($M)</span>
                </div>
                {[
                  { l: 'Combined net income (Acquirer + Target, verified actuals)', v: bridgeCombNI, sign: null, bold: false },
                  { l: '+ After-tax cost synergies (Year 1)',                       v: bridgeAtSyn,  sign: '+',  bold: false },
                  { l: '− After-tax acquisition-financing interest',                v: -finDrag,     sign: '-',  bold: false },
                  { l: '= Pro-forma net income (drives Year-1 accretion)',          v: bridgePfNI,   sign: null, bold: true },
                ].map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 10px',
                    background: r.bold ? '#EFF6FF' : (i % 2 ? ALT_ROW : '#fff'),
                    borderTop: r.bold ? `2px solid ${SF_BLUE}` : 'none', borderBottom: `1px solid ${GRAY_BORDER}` }}>
                    <span style={{ fontSize: 10, color: r.bold ? NAVY : '#374151', fontWeight: r.bold ? 700 : 400 }}>{r.l}</span>
                    <span style={{ fontSize: 10, fontWeight: r.bold ? 700 : 600,
                      color: r.sign === '-' ? '#DC2626' : r.sign === '+' ? '#166534' : NAVY }}>{fmtM(r.v)}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 5, fontSize: 8.5, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
              Accretion is measured on <strong>non-GAAP standalone EPS</strong> ({standaloneY1 != null ? fmtPerShare(standaloneY1) : '—'} for {aTk}), consistent with the dashboard and deal model. This differs from the <strong>GAAP</strong> diluted EPS on the Standalone P&amp;L slide — a basis distinction, not a discrepancy. The combined pro-forma revenue / EBIT / net income underlying these years are on the previous page. <strong>The pro-forma &amp; accretion model is built on latest-fiscal-year actuals + forward consensus estimates</strong> — the screening comparables and company profile (Exhibits A / B) use a trailing-twelve-month (LTM) basis, a deliberate methodology split (bankers screen on LTM, model accretion on a normalized forward basis).
            </div>
          </>
        )}
      </div>
      <div style={{ padding: '6px 20px 16px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.45 }}>
        {accretionSource}
      </div>
    </PageFrame>
  );
}

export function SectionProFormaPLA(props) { return <ProFormaCore {...props} part="a" />; }
export function SectionProFormaPLB(props) { return <ProFormaCore {...props} part="b" />; }
