import { apiUrl } from '../../../api';
import React, { useState, useEffect } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { BasisNote } from '../shared/BasisNote';
import { accretionShareCountLabel } from '../../../lib/composeSourceLine';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { NAVY, SF_BLUE, GRAY_BORDER, ALT_ROW, fmtMoneyTable, fmtPerShare, fmtShares, fmtPct, fmtPctFloor, fmtAsOf } from '../shared/deckTokens';
import { netCashDebt, NET_DEBT_BASIS } from '../../../lib/netDebt';

// Spec §2 Slide 8 — Exchange Ratio & Deal Considerations. Two side-by-side tables, ALL values read
// from the C1 single source of truth (deckModel.derived / dealAssumptions) so they can never diverge
// from §9/§10/§13. Per spec §1.4: no leading '+'/'=' in any cell.
//
// FX/premium build: below the two tables, a premium/discount SENSITIVITY MATRIX (0–40%) — offer / equity /
// EV / forward multiples across the range — so the deck SHOWS the premium as a spectrum rather than asserting
// one figure ("whose assumption?"). Base columns (offer/equity/EV) come from price+shares+netDebt (props,
// always present); forward-multiple columns come from /api/pnl consensus forwards and degrade to "—" when a
// target has no forwards (e.g. NSRGY, no CIK). Values are the SAME USD figures as the rest of the deck
// (Stages 1-2b): target price is the USD ADR, netDebt is the spot-converted prop — no raw-CHF re-fetch.

function KVTable({ title, rows }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {title}
      </div>
      <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div
            key={r.k}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10,
              padding: '5px 12px', background: i % 2 === 1 ? ALT_ROW : '#fff',
              borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${GRAY_BORDER}`,
            }}
          >
            <span style={{ fontSize: 11, color: r.bold ? NAVY : '#374151', fontWeight: r.bold ? 700 : 400, lineHeight: 1.3 }}>
              {r.k}
            </span>
            <span style={{ fontSize: 11, fontWeight: r.bold ? 700 : 600, color: r.bold ? NAVY : '#1F2937', textAlign: 'right', whiteSpace: 'nowrap' }}>
              {r.v}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Premium sensitivity matrix — its own table (NAVY header, alt rows), full width below the KV tables.
const PREMS = [0, 0.10, 0.20, 0.30, 0.40];

export function SectionExchangeRatio({ target, acquirer, deal, model, pageNum, exhibitLabel }) {
  // Short "Name (TICKER)" form — consistent with §2's shortName ("Atlassian Corp" → "Atlassian"), so the
  // subtitle doesn't read the raw legal name while the tables use the ticker. The separator before a suffix
  // is a REQUIRED comma/space ([,\s]+, not ,?\s*) so "SE" inside "CHASE" isn't stripped as a German-SE suffix;
  // all-caps EDGAR names ("JPMORGAN CHASE & CO") are title-cased.
  const short = (n) => {
    if (!n) return '';
    let s = n.replace(/[,\s]+(Incorporated|Inc\.?|Corporation|Corp\.?|Company|Co\.?|Limited|Ltd\.?|LLC|Holdings?|plc|S\.?E\.?|N\.?V\.?)\b\.?/gi, '').replace(/[\s,.&]+$/, '').trim();
    if (s && s === s.toUpperCase()) s = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    return s || n;
  };
  const aName = acquirer?.name || 'Acquirer';
  const bName = target?.name || 'Target';
  const aTk = acquirer?.ticker || aName;
  const bTk = target?.ticker || bName;
  const aLabel = acquirer?.ticker ? `${short(aName)} (${aTk})` : short(aName);
  const bLabel = target?.ticker ? `${short(bName)} (${bTk})` : short(bName);

  const d = model?.derived || {};
  const da = model?.dealAssumptions || {};
  const cashPct  = da.cashPercent != null ? da.cashPercent : null;
  const stockPct = da.stockPercent != null ? da.stockPercent : (cashPct != null ? 100 - cashPct : null);

  const offer = d.offerPrice;
  const dash = (x, f) => (x == null || Number.isNaN(x) ? '—' : f(x));

  // ── Data for the sensitivity matrix (§8 was pure-props; now fetches like §3/§6/§7) ──────────────────
  const { data: verifiedData } = useVerifiedData(target?.ticker ?? null); // 52-wk high/low
  const [tgtPnl, setTgtPnl] = useState(null);                             // consensus forwards (rev/EBITDA/EPS)
  const [ltmRev, setLtmRev] = useState(null);                             // LTM revenue — the SAME /quote data.ltm.revenue §2/§3 divide by (trusted-gated)
  useEffect(() => {
    let cancel = false;
    const t = target?.ticker;
    if (!t) { setTgtPnl(null); return; }
    fetch(apiUrl(`/api/pnl/${encodeURIComponent(t)}`))
      .then(r => r.json())
      .then(j => { if (!cancel) setTgtPnl(j && j.ok && Array.isArray(j.columns) ? j : null); })
      .catch(() => { if (!cancel) setTgtPnl(null); });
    return () => { cancel = true; };
  }, [target?.ticker]);
  // LTM revenue for the LTM EV/Rev column — read from /quote's data.ltm (the identical source §2/§3 use), so
  // the 0%-premium LTM multiple reconciles to Exhibits A/B by construction. Trusted-gated → null (column "—")
  // when no reliable LTM exists, matching how §2/§3 degrade. NOT recomputed here.
  useEffect(() => {
    let cancel = false;
    const t = target?.ticker;
    if (!t) { setLtmRev(null); return; }
    fetch(apiUrl(`/quote?symbol=${encodeURIComponent(t)}`))
      .then(r => r.json())
      .then(j => { if (!cancel) setLtmRev(j?.ltm?.trusted && j.ltm.revenue != null ? j.ltm.revenue : null); })
      .catch(() => { if (!cancel) setLtmRev(null); });
    return () => { cancel = true; };
  }, [target?.ticker]);

  // Cash/stock split per target share (illustrative consideration mix).
  const cashPerShare  = offer != null && cashPct  != null ? offer * (cashPct / 100)  : null;
  const stockPerShare = offer != null && stockPct != null ? offer * (stockPct / 100) : null;
  const cashPortion   = d.totalConsideration != null && cashPct  != null ? d.totalConsideration * (cashPct / 100)  : null;
  const stockPortion  = d.totalConsideration != null && stockPct != null ? d.totalConsideration * (stockPct / 100) : null;

  // EPS-impact row: render the ONE accretion result with its explicit basis (no leading '+').
  const acc = d.accretion || {};
  const epsImpact = deal?._results?.basesDiffer ? 'n/m (companies on different bases)' : acc.pct == null
    ? 'n/m (acquirer or pro-forma EPS ≤ 0)'
    : `${Math.abs(acc.pct).toFixed(1)}% ${acc.isAccretive ? 'accretive' : 'dilutive'} · ${acc.basis || 'computed basis'}`;

  const dealRows = [
    { k: 'Structure', v: 'Cash-and-stock acquisition' },
    { k: 'Consideration mix', v: cashPct != null ? `${fmtPct(cashPct, 0)} cash / ${fmtPct(stockPct, 0)} stock` : '—' },
    { k: 'Offer price', v: dash(offer, v => `${fmtPerShare(v)} / share`) },
    { k: deal?._inputs?.premiumReferencePrice > 0 ? `Premium to ${fmtPerShare(deal._inputs.premiumReferencePrice)} close${deal._inputs.premiumReferenceDate ? ` on ${deal._inputs.premiumReferenceDate}` : ' on the chosen date'}` : 'Premium to current', v: dash(d.premiumPct, v => fmtPct(v, 1)) },
    { k: 'Total equity value', v: dash(d.totalConsideration, fmtMoneyTable) },
    // Cash + stock portions merged (they sum to the total consideration — natural pairing, saves a row).
    { k: 'Cash / stock split', v: (cashPortion != null && stockPortion != null) ? `${fmtMoneyTable(cashPortion)} (debt-fin.) / ${fmtMoneyTable(stockPortion)}` : '—' },
    { k: 'Financing rate', v: `${fmtPct((da.financingRate ?? 0.05) * 100, 0)} (assumption)` },
    { k: 'Marginal tax rate', v: `${fmtPct((da.taxRate ?? 0.21) * 100, 0)}` },
    { k: 'Pro forma ownership', v: (d.ownershipExistingPct != null) ? `${fmtPctFloor(d.ownershipExistingPct, 1)} ${aTk} / ${fmtPctFloor(d.ownershipNewPct, 1)} ${bTk}` : '—' },
    { k: 'EPS impact', v: epsImpact },
  ];

  // Exchange Ratio table — "Offer price per share" REMOVED (it duplicated dealRows "Offer price"; the
  // faculty "don't need twice" fix). Offer still appears once, in Deal Considerations above.
  const ratioRows = [
    { k: `${bName} current price`, v: dash(d.currentPriceTarget, fmtPerShare) },
    { k: `${aName} share price`, v: dash(d.currentPriceAcquirer, fmtPerShare) },
    { k: `Cash per ${bTk} share`, v: dash(cashPerShare, fmtPerShare) },
    { k: `Stock per ${bTk} share`, v: dash(stockPerShare, fmtPerShare) },
    { k: 'Exchange ratio', v: d.exchangeRatio != null ? `${d.exchangeRatio.toFixed(4)} ${aTk} per ${bTk} share` : '—', bold: true },
    { k: `${bName} shares outstanding`, v: dash(d.targetShares, fmtShares) },
    { k: `New ${aTk} shares issued`, v: dash(d.newShares, fmtShares) },
    { k: d.preDealSharesLabel ? `${aName} shares (pre-deal; ${d.preDealSharesLabel})` : `${aName} shares (pre-deal)`, v: dash(d.preDealShares, fmtShares) },
    { k: 'Pro forma total shares', v: dash(d.proFormaShares, fmtShares), bold: true },
  ];

  // ── Sensitivity matrix computation ──────────────────────────────────────────────────────────────────
  const price   = d.currentPriceTarget;                                            // USD (ADR for foreign)
  const shares  = d.targetShares;                                                   // millions
  const netDebt = netCashDebt(target?.debt, target?.cash, target?.sti); // $M, USD — shared helper, cash bucket = cash + short-term marketable (b)
  const struckPrem = d.premiumPct;                                                  // actual struck deal premium (%)

  // Forward years: the two LATEST consensus forward columns (skips the near/stub year → matches "2027/2028"
  // for a June-FY target like TEAM). Absent forwards (NSRGY no-CIK) → y1/y2 null → forward cols render "—".
  const fwdCols = (tgtPnl?.columns || []).filter(c => !c.actual).sort((a, b) => (a.fy || 0) - (b.fy || 0));
  const y1 = fwdCols.length >= 2 ? fwdCols[fwdCols.length - 2] : null; // earlier forward year ('27)
  const y2 = fwdCols.length >= 1 ? fwdCols[fwdCols.length - 1] : null; // later forward year   ('28)
  const yA = y1 ? `'${String(y1.fy).slice(-2)}` : 'FY+1';
  const yB = y2 ? `'${String(y2.fy).slice(-2)}` : 'FY+2';

  const bil  = (v) => (v == null ? '—' : `$${(v / 1000).toFixed(1)}B`);
  const mult = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}x`);
  const matrix = PREMS.map((prem) => {
    const o  = price != null ? price * (1 + prem) : null;
    const eq = (o != null && shares != null) ? o * shares : null;            // $M
    const ev = (eq != null && netDebt != null) ? eq + netDebt : null;        // $M
    return {
      prem, o, eq, ev,
      evRevLtm: (ev != null && ltmRev != null && ltmRev > 0) ? ev / ltmRev : null,  // same EV, ÷ LTM revenue → ties to §2/§3 at 0%
      evRevA: (ev != null && y1?.revenue) ? ev / y1.revenue : null,
      evRevB: (ev != null && y2?.revenue) ? ev / y2.revenue : null,
      evEbitB: (ev != null && y2?.ebitda > 0) ? ev / y2.ebitda : null,
      peA: (o != null && y1?.eps > 0) ? o / y1.eps : null,
      peB: (o != null && y2?.eps > 0) ? o / y2.eps : null,
    };
  });
  // Highlight the row NEAREST the actual struck premium (tracks a user-changed deal, not a hardcoded 30%).
  const highlightIdx = (struckPrem != null)
    ? PREMS.reduce((best, p, i) => (Math.abs(p * 100 - struckPrem) < Math.abs(PREMS[best] * 100 - struckPrem) ? i : best), 0)
    : 3;
  const struckIs30 = struckPrem != null && Math.abs(struckPrem - 30) < 0.5;

  const headers = ['Premium', 'Offer', 'Equity', 'EV', 'LTM EV/Rev', `${yA} EV/Rev`, `${yB} EV/Rev`, `${yB} EV/EBITDA`, `${yA} P/E`, `${yB} P/E`];
  const cellsOf = (r) => [
    `${Math.round(r.prem * 100)}%`, dash(r.o, fmtPerShare), bil(r.eq), bil(r.ev),
    mult(r.evRevLtm), mult(r.evRevA), mult(r.evRevB), mult(r.evEbitB), mult(r.peA), mult(r.peB),
  ];

  // Reference-price caption (the "$52 low" decode) — 52-wk range + high/low deltas vs the current price.
  const w52High = verifiedData?.fields?.week52High?.value != null ? parseFloat(verifiedData.fields.week52High.value) : null;
  const w52Low  = verifiedData?.fields?.week52Low?.value  != null ? parseFloat(verifiedData.fields.week52Low.value)  : null;
  const pctVs = (v) => (v != null && price) ? `${v - price >= 0 ? '+' : '−'}${Math.abs((v - price) / price * 100).toFixed(0)}%` : '—';

  return (
    <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
      <PageHeader
        title="Exchange Ratio & Deal Considerations"
        subtitle={`${aLabel} / ${bLabel} · illustrative transaction terms`}
      />
      <div style={{ display: 'flex', gap: 20, padding: '14px 20px 10px', alignItems: 'flex-start' }}>
        <KVTable title="Deal Considerations" rows={dealRows} />
        <KVTable title="Exchange Ratio" rows={ratioRows} />
      </div>

      {/* Premium / (discount) sensitivity matrix — the assumption as a SPECTRUM, not one asserted number. */}
      <div style={{ padding: '2px 20px 6px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 5, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Multiples Based on Consensus Estimates <span style={{ fontWeight: 400, textTransform: 'none', color: '#9CA3AF' }}>· premium / (discount) sensitivity</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={h} style={{
                  padding: '5px 6px', background: NAVY, color: '#fff', fontSize: 9, fontWeight: 700,
                  textAlign: i === 0 ? 'left' : 'right', whiteSpace: 'nowrap',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((r, ri) => {
              const hot = ri === highlightIdx;
              const bg = hot ? '#EAF3FC' : (ri % 2 === 1 ? ALT_ROW : '#fff');
              return (
                <tr key={r.prem}>
                  {cellsOf(r).map((c, ci) => (
                    <td key={ci} style={{
                      padding: '5px 6px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`,
                      textAlign: ci === 0 ? 'left' : 'right',
                      fontWeight: hot ? 700 : (ci === 0 ? 600 : 500),
                      color: hot ? SF_BLUE : (ci === 0 ? NAVY : '#1F2937'),
                      borderLeft: (hot && ci === 0) ? `3px solid ${SF_BLUE}` : '3px solid transparent',
                      whiteSpace: 'nowrap',
                    }}>
                      {c}{hot && ci === 0 ? '  ◄' : ''}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 9, color: '#6B7280', marginTop: 5, lineHeight: 1.4 }}>
          Highlighted row = the deck's struck deal{struckPrem != null ? ` (${struckPrem.toFixed(1)}% premium → ${dash(offer, fmtPerShare)}/share)` : ''}.{' '}
          Premium struck vs current {dash(price, fmtPerShare)} · 52-wk range {dash(w52Low, fmtPerShare)}–{dash(w52High, fmtPerShare)}
          {(w52High != null || w52Low != null) ? ` (high ${pctVs(w52High)} / low ${pctVs(w52Low)} vs current)` : ''}.
          {' '}Equity = offer × shares; EV = equity + net debt. LTM EV/Rev = EV ÷ latest-twelve-month revenue (the same LTM figure as Exhibits A/B, so the 0% row reconciles to those pages); forward EV/Rev, EV/EBITDA and P/E use consensus estimates{y2 ? '' : ' (unavailable for this target — shown as "—")'}. {NET_DEBT_BASIS}{fmtAsOf(target?.balanceSheetAsOf, target?.balanceSheetBasis) ? ` Net debt in EV is as of ${bName} ${fmtAsOf(target?.balanceSheetAsOf, target?.balanceSheetBasis)}.` : ''}
        </div>
      </div>

      <BasisNote acquirer={acquirer} target={target} deal={deal} fixed={['The LTM EV/Rev column uses LTM revenue whichever basis the card is on.', accretionShareCountLabel(deal?._inputs)].filter(Boolean).join(' ')} style={{ padding: '0 20px 6px' }} />
      <div style={{ padding: '0 20px 32px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
        The headline offer reflects {struckIs30
          ? 'an illustrative 30% control premium (industry median, user-adjustable)'
          : `an illustrative ${struckPrem != null ? struckPrem.toFixed(1) + '%' : ''} premium (user-adjustable)`}; the matrix above shows the full 0–40% range so the premium reads as a spectrum, not a single asserted figure. New shares = stock consideration ÷ {aTk} price; ownership and exchange ratio derived therefrom. Illustrative — not investment advice.
      </div>
    </PageFrame>
  );
}
