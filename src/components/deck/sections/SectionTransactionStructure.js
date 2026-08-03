import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER, ALT_ROW, fmtMoneyTable, isBankDeal, fmtAsOf } from '../shared/deckTokens';
import { cashBucket, netCashDebt, NET_DEBT_BASIS } from '../../../lib/netDebt';
import { epsAccretionPct } from '../../../utils/dealCalc';
import { exhibitLabelOf } from '../deckRegistry';

// Transaction Structure — Sources & Uses + pro-forma capitalization. The FUNDING / balance-sheet view of the
// deal. Stated inputs (offer / premium / mix / Min Cash of PF Co) sit up top per faculty's note. The
// sources-of-funds construction (Stage 2E) is SHARED with §8/§9/§11 via dealCalc — one drag, one source:
// new acquisition debt = cash consideration + target debt repaid − excess cash on hand (floored at zero), so
// combined cash funds part of the deal rather than the old 100%-debt assumption. Excess cash used and target
// debt repaid render as Sources/Uses; the min-cash and 100%-debt-repaid ASSUMPTIONS are footnoted, alongside
// the robustness line (the accretion conclusion is unchanged across the min-cash range). Banks (Guard 1): keep
// today's 100%-debt behavior unchanged and the leverage block is suppressed (regulatory-capital basis).

const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };
const dash = (v) => (v == null ? '—' : fmtMoneyTable(v));

// Side-by-side "Uses" / "Sources" panel.
function SUTable({ title, rows, total, totalLabel, accent }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ background: NAVY, padding: '5px 10px', fontSize: 9.5, fontWeight: 700, color: '#fff', borderRadius: '6px 6px 0 0' }}>{title}</div>
      <div style={{ border: `1px solid ${GRAY_BORDER}`, borderTop: 'none', borderRadius: '0 0 6px 6px', overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', background: i % 2 ? ALT_ROW : '#fff', borderBottom: `1px solid ${GRAY_BORDER}` }}>
            <span style={{ fontSize: 10, color: '#374151' }}>{r.k}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#1F2937', whiteSpace: 'nowrap' }}>{dash(r.v)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', background: '#EFF6FF', borderTop: `2px solid ${accent}` }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: NAVY }}>{totalLabel}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: accent, whiteSpace: 'nowrap' }}>{dash(total)}</span>
        </div>
      </div>
    </div>
  );
}

export function SectionTransactionStructure({ target, acquirer, deal, model, pageNum, exhibitLabel }) {
  const aTk = acquirer?.ticker || acquirer?.name || 'Acquirer';
  const bTk = target?.ticker || target?.name || 'Target';
  const d = model?.derived || {};
  const r = deal?._results || {};
  const inp = deal?._inputs || {};

  // ── Sources & Uses ($M) — MUST foot. SAME sources-of-funds construction as §8/§9/§11 (one drag) ──────
  const bankFin  = !!r.bankFinancing;                     // Guard 1: bank deal → legacy 100%-debt behavior
  const newDebt  = num(r.newDebt);                        // new acquisition debt (banks: = cash consideration)
  const newStock = num(r.stockPortion);                  // stock consideration — newly issued acquirer equity
  const equityPurchase   = num(deal?.totalPrice);        // purchase of target equity (cash + stock consideration)
  const fees             = num(deal?.transactionFees) || 0;
  const targetDebtRepaid = num(r.targetDebtRepaid);      // null for banks (not repaid on change of control)
  const excessCashUsed   = num(r.excessCashUsed);        // combined cash above the retained min, drawn to fund the deal
  const minCashRetained  = num(r.minCashRetained);
  const minCashPct       = num(r.minCashPct);

  const totalUses = (equityPurchase || 0) + (targetDebtRepaid || 0) + fees;
  // Fee cash = the balancing draw (≈ fees; absorbs sub-$M rounding), so Sources === Uses exactly.
  const feeCash   = totalUses - (newDebt || 0) - (newStock || 0) - (excessCashUsed || 0);
  const totalSources = (newDebt || 0) + (newStock || 0) + (excessCashUsed || 0) + feeCash;
  const foots = Math.abs(totalUses - totalSources) < 1;

  const usesRows = [
    { k: `Purchase of ${bTk} equity (offer × shares)`, v: equityPurchase },
    ...(targetDebtRepaid ? [{ k: `Repay ${bTk} debt (assumed 100%)`, v: targetDebtRepaid }] : []),
    { k: 'Transaction fees (one-time)', v: fees },
  ];
  const sourcesRows = [
    { k: 'New acquisition debt', v: newDebt },
    { k: `New ${aTk} equity issued (stock consideration)`, v: newStock },
    ...(excessCashUsed ? [{ k: 'Excess cash on hand used', v: excessCashUsed }] : []),
    { k: 'Cash on hand (funds fees)', v: feeCash },
  ];

  // ── Pro-forma capitalization / leverage ─────────────────────────────────────────────────────────────
  const aDebt = num(inp.companyADebt) || 0, bDebt = num(inp.companyBDebt) || 0;
  const aCash = num(inp.companyACash) || 0, bCash = num(inp.companyBCash) || 0;
  const aSti  = num(inp.companyASti),      bSti  = num(inp.companyBSti);
  const aBsAsOf = fmtAsOf(inp.companyABsAsOf, inp.companyABsBasis), bBsAsOf = fmtAsOf(inp.companyBBsAsOf, inp.companyBBsBasis);
  const preDebt      = aDebt + bDebt;
  // Non-bank: target debt is repaid (assumption) → pro-forma debt = acquirer debt + new acquisition debt.
  // Bank (Guard 1): target debt stays outstanding → legacy pre-deal debt + new debt.
  const proFormaDebt = bankFin ? preDebt + (newDebt || 0) : aDebt + (newDebt || 0);
  // ONE cash definition (convention b): cash & equivalents + short-term marketable securities, both companies.
  const preCash      = cashBucket(aCash, aSti).value + cashBucket(bCash, bSti).value;
  const pfCash       = preCash - (excessCashUsed || 0) - feeCash;   // cash drawn to fund the deal + fees
  const preNetDebt   = preDebt - preCash;
  const pfNetDebt    = proFormaDebt - pfCash;
  const combinedEBITDA = num(deal?.combinedEBITDA);          // SAME non-GAAP EBITDA as §6/§7 (incl. Y1 synergies)
  const bankDeal       = isBankDeal(target, acquirer);
  const lev  = (v) => (!bankDeal && combinedEBITDA > 0) ? `${(v / combinedEBITDA).toFixed(1)}x` : (bankDeal ? 'n/m' : '—');

  // Robustness (the real defense): the accretion conclusion is unchanged across the plausible min-cash range —
  // computed from the model at minCash = 0 vs the struck %. Only for non-bank deals (banks don't net cash).
  const offerP = num(d.offerPrice) ?? num(inp.offerPricePerShare);
  const prem     = num(d.premiumPct);
  const cashPct  = num(inp.cashPercent);
  const stockPct = cashPct != null ? 100 - cashPct : null;
  const synY1  = num(deal?.synergiesY1) ?? num(inp.synergiesY1) ?? 0;
  const accAtCurrent = num(deal?.epsAccretion);
  const accZeroRaw   = (!bankFin && offerP != null) ? epsAccretionPct(offerP, synY1, { ...inp, minCashPct: 0 }) : null;
  const accAtZero    = Number.isFinite(accZeroRaw) ? accZeroRaw : null;

  // ── Deal-size header (link, don't duplicate §8) ─────────────────────────────────────────────────────
  const txnEV = num(d.transactionEV) ?? (equityPurchase != null ? equityPurchase + netCashDebt(bDebt, bCash, bSti) : null);

  const capRows = [
    { k: 'Total debt',            pre: preDebt,     pf: proFormaDebt, impact: proFormaDebt - preDebt },
    { k: 'Cash, equiv. & ST marketable sec.', pre: preCash, pf: pfCash, impact: pfCash - preCash },
    { k: 'Net debt / (net cash)', pre: preNetDebt,  pf: pfNetDebt, impact: pfNetDebt - preNetDebt, bold: true },
    { k: 'Debt / EBITDA',         pre: lev(preDebt),    pf: lev(proFormaDebt),  raw: true },
    { k: 'Net debt / EBITDA',     pre: lev(preNetDebt), pf: lev(pfNetDebt),     raw: true },
  ];

  return (
    <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
      <PageHeader
        title="Transaction Structure — Sources & Uses"
        subtitle={`${aTk} / ${bTk} · deal funding & pro-forma capitalization · illustrative`}
      />

      <div style={{ padding: '14px 20px 6px' }}>
        {/* Stated inputs up top (faculty: Min Cash of PF Co, premium, consideration mix) + deal-size summary */}
        <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 12,
          padding: '8px 12px', background: '#F9FAFB', border: `1px solid ${GRAY_BORDER}`, borderLeft: `4px solid ${SF_BLUE}`, borderRadius: 4 }}>
          <span style={{ fontSize: 11 }}><span style={{ color: '#6B7280' }}>Offer </span><strong style={{ color: NAVY }}>{offerP != null ? `$${offerP.toFixed(2)}` : '—'}</strong></span>
          <span style={{ fontSize: 11 }}><span style={{ color: '#6B7280' }}>Premium </span><strong style={{ color: NAVY }}>{prem != null ? `${prem.toFixed(1)}%` : '—'}</strong></span>
          <span style={{ fontSize: 11 }}><span style={{ color: '#6B7280' }}>Consideration </span><strong style={{ color: NAVY }}>{cashPct != null ? `${cashPct}% cash / ${stockPct}% stock` : '—'}</strong></span>
          <span style={{ fontSize: 11 }}><span style={{ color: '#6B7280' }}>Min cash of PF co </span><strong style={{ color: NAVY }}>{minCashRetained != null ? dash(minCashRetained) : (bankFin ? 'n/a (bank)' : '—')}</strong>{minCashPct != null ? <span style={{ color: '#9CA3AF', fontSize: 9.5 }}> ({(minCashPct * 100).toFixed(1)}% PF LTM rev)</span> : null}</span>
          <span style={{ fontSize: 11 }}><span style={{ color: '#6B7280' }}>Equity value </span><strong style={{ color: NAVY }}>{dash(equityPurchase)}</strong></span>
          <span style={{ fontSize: 11 }}><span style={{ color: '#6B7280' }}>EV </span><strong style={{ color: NAVY }}>{dash(txnEV)}</strong></span>
          <span style={{ fontSize: 9, color: '#9CA3AF' }}>Exchange ratio &amp; sensitivity: <strong style={{ color: SF_BLUE }}>{exhibitLabelOf('exchange')}</strong>; historical implied ratio: <strong style={{ color: SF_BLUE }}>{exhibitLabelOf('exchangeratio')}</strong>.</span>
        </div>

        {/* Block 1 — Sources & Uses (must foot) */}
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
          <SUTable title="USES OF FUNDS ($M)" rows={usesRows} total={totalUses} totalLabel="Total uses" accent="#B45309" />
          <SUTable title="SOURCES OF FUNDS ($M)" rows={sourcesRows} total={totalSources} totalLabel="Total sources" accent="#166534" />
        </div>
        <div style={{ marginTop: 5, fontSize: 8.5, color: foots ? '#166534' : '#DC2626', fontWeight: 600 }}>
          {foots ? '✓ Sources = Uses' : '⚠ Sources ≠ Uses'} — {dash(totalSources)} funds {dash(totalUses)}.
        </div>

        {/* Block 2 — Pro-forma capitalization / leverage (impact: pre → pro-forma) */}
        <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginTop: 14, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Pro-Forma Capitalization &amp; Leverage
        </div>
        {bankDeal ? (
          <div style={{ padding: '10px 12px', background: '#FFFBEB', border: '1px dashed #F59E0B', borderRadius: 6, fontSize: 10.5, color: '#92400E' }}>
            Debt / EBITDA leverage is not a meaningful capitalization metric for banks — financial institutions are assessed on regulatory capital ratios (e.g. CET1), not EBITDA leverage. Pro-forma corporate-leverage lines are suppressed here.
          </div>
        ) : (
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ background: NAVY, display: 'flex', padding: '5px 10px' }}>
              <span style={{ flex: 2, color: '#fff', fontSize: 9.5, fontWeight: 700 }}>Capitalization</span>
              <span style={{ flex: 1.1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>Pre-deal</span>
              <span style={{ flex: 1.4, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>Transaction impact</span>
              <span style={{ flex: 1.1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>Pro-forma</span>
            </div>
            {capRows.map((row, i) => (
              <div key={row.k} style={{ display: 'flex', padding: '5px 10px', background: row.bold ? '#EFF6FF' : (i % 2 ? ALT_ROW : '#fff'), borderBottom: `1px solid ${GRAY_BORDER}` }}>
                <span style={{ flex: 2, fontSize: 10, color: row.bold ? NAVY : '#374151', fontWeight: row.bold ? 700 : 400 }}>{row.k}</span>
                <span style={{ flex: 1.1, fontSize: 10, textAlign: 'right', color: '#6B7280', fontWeight: row.bold ? 700 : 500 }}>{row.raw ? row.pre : dash(row.pre)}</span>
                <span style={{ flex: 1.4, fontSize: 10, textAlign: 'right', color: '#B45309', fontWeight: 600 }}>{row.raw || row.impact == null ? '' : `${row.impact >= 0 ? '+' : '−'}${fmtMoneyTable(Math.abs(row.impact))}`}</span>
                <span style={{ flex: 1.1, fontSize: 10, textAlign: 'right', color: NAVY, fontWeight: 700 }}>{row.raw ? row.pf : dash(row.pf)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '8px 20px 16px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.45 }}>
        <strong style={{ color: NAVY }}>Structure: </strong>
        {bankFin ? (
          <>Cash consideration is debt-financed (new acquisition debt); stock consideration is newly issued {aTk} equity; transaction fees are funded from balance-sheet cash, so <strong>Sources = Uses</strong>. This is a <strong>financial-institution deal</strong>: bank cash and deposits are not netted and {bTk}'s debt is not repaid on change of control, so the 100%-debt financing convention is retained (the cash-funded sources-of-funds construction applies to non-bank targets only). </>
        ) : (
          <>New acquisition debt <strong>= cash consideration, less total combined cash, plus min cash of the pro forma company, plus {bTk} debt repaid on change of control (assumed 100%), floored at zero</strong>. Equivalently — the collapsed form the Sources &amp; Uses "Excess cash on hand used" line ties to — this is cash consideration + {bTk} debt repaid − excess cash on hand, where excess cash on hand = combined cash less min cash. Combined cash above the retained minimum funds part of the deal, so the financing drag reflects net funding rather than a 100%-debt assumption. Stock consideration is newly issued {aTk} equity, and a small cash draw funds fees, so <strong>Sources = Uses</strong>. <strong style={{ color: '#374151' }}>Assumption:</strong> min cash of the pro forma company is set at <strong>{minCashPct != null ? (minCashPct * 100).toFixed(1) : '2.0'}% of pro-forma LTM revenue</strong>{minCashRetained != null ? ` (${fmtMoneyTable(minCashRetained)})` : ''} — a modeling assumption, not a sourced figure. <strong style={{ color: '#374151' }}>Assumption:</strong> 100% of {bTk}'s debt is assumed repaid on change of control — a stated assumption, not sourced. {accAtCurrent != null && accAtZero != null ? <><strong style={{ color: '#374151' }}>Robustness:</strong> the accretion/(dilution) conclusion does not depend on the min-cash assumption — at min cash = 0 the pro-forma EPS impact is <strong>{accAtZero >= 0 ? '+' : ''}{accAtZero.toFixed(1)}%</strong> and at the assumed {minCashPct != null ? (minCashPct * 100).toFixed(1) : '2.0'}% it is <strong>{accAtCurrent >= 0 ? '+' : ''}{accAtCurrent.toFixed(1)}%</strong>, {(accAtZero < 0) === (accAtCurrent < 0) ? `${accAtCurrent < 0 ? 'dilutive' : 'accretive'} across the full range` : 'the sign is stable across the range'}. </> : null}</>
        )}
        {!bankDeal && <>Leverage is <strong>net debt (and total debt) ÷ combined EBITDA</strong> — the same EBITDA basis used on the Pro Forma slides (includes Year-1 synergies). </>}{NET_DEBT_BASIS}{aBsAsOf && bBsAsOf ? ` Balance-sheet items (cash, debt, marketable securities) are as of ${aTk} ${aBsAsOf} and ${bTk} ${bBsAsOf}.` : ''} Figures are illustrative transaction assumptions — not negotiated terms.
      </div>
    </PageFrame>
  );
}
