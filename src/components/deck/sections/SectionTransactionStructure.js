import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER, ALT_ROW, fmtMoneyTable, isBankDeal, fmtAsOf } from '../shared/deckTokens';
import { cashBucket, netCashDebt, NET_DEBT_BASIS } from '../../../lib/netDebt';

// Transaction Structure — Sources & Uses + pro-forma capitalization. The FUNDING / balance-sheet view of
// the deal, DISTINCT from §8 (Exchange Ratio) which shows the per-share terms (offer / premium / mix /
// ratio / sensitivity matrix). Every value is an EXISTING dealCalc field surfaced from the deal object —
// nothing recomputed, no new modeling. We deliberately DO NOT re-list §8's terms (offer/premium/mix%/ratio);
// a header pointer sends the reader to §8. Refinance convention: dealCalc assumes target debt (it sits in EV),
// so it is NOT a use here — stated in the footnote. Banks: Debt/EBITDA is n/m → the leverage block is
// suppressed (banks are capitalized on regulatory ratios, same discipline as the bank-DCF suppression).

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

export function SectionTransactionStructure({ target, acquirer, deal, model, pageNum }) {
  const aTk = acquirer?.ticker || acquirer?.name || 'Acquirer';
  const bTk = target?.ticker || target?.name || 'Target';
  const d = model?.derived || {};
  const r = deal?._results || {};
  const inp = deal?._inputs || {};

  // ── Sources & Uses ($M) — MUST foot ─────────────────────────────────────────────────────────────────
  const equityPurchase = num(deal?.totalPrice);          // purchase of target equity (cash + stock consideration)
  const fees           = num(deal?.transactionFees) || 0; // one-time transaction fees (advisory/legal/financing)
  const newDebt        = num(r.cashPortion);             // cash consideration — debt-financed (§8: "debt-fin.")
  const newStock       = num(r.stockPortion);            // stock consideration — newly issued acquirer equity
  const totalUses    = equityPurchase != null ? equityPurchase + fees : null;
  // newDebt + newStock ≈ equityPurchase (dealCalc splits the equity purchase by cash%); the cash plug is the
  // EXACT balancing item = Uses − new debt − new stock. It equals the fees (funded from balance-sheet cash)
  // plus any sub-$M rounding between cashPortion+stockPortion and totalPrice, so Sources === Uses exactly.
  const cashPlug     = (totalUses != null && newDebt != null && newStock != null) ? totalUses - newDebt - newStock : fees;
  const totalSources = (newDebt != null && newStock != null) ? newDebt + newStock + cashPlug : null;
  const foots        = (totalUses != null && totalSources != null) && Math.abs(totalUses - totalSources) < 1;

  const usesRows = [
    { k: `Purchase of ${bTk} equity (offer × shares)`, v: equityPurchase },
    { k: 'Transaction fees (one-time)', v: fees },
  ];
  const sourcesRows = [
    { k: 'New acquisition debt (cash consideration)', v: newDebt },
    { k: `New ${aTk} equity issued (stock consideration)`, v: newStock },
    { k: 'Cash on hand (funds fees)', v: cashPlug },
  ];

  // ── Pro-forma capitalization / leverage ─────────────────────────────────────────────────────────────
  const aDebt = num(inp.companyADebt) || 0, bDebt = num(inp.companyBDebt) || 0;
  const aCash = num(inp.companyACash) || 0, bCash = num(inp.companyBCash) || 0;
  const aSti  = num(inp.companyASti),      bSti  = num(inp.companyBSti);
  const aBsAsOf = fmtAsOf(inp.companyABsAsOf, inp.companyABsBasis), bBsAsOf = fmtAsOf(inp.companyBBsAsOf, inp.companyBBsBasis);
  const preDebt        = aDebt + bDebt;
  const proFormaDebt   = preDebt + (newDebt || 0);           // + new acquisition debt (= dealCalc combinedDebt)
  // ONE cash definition across this exhibit (convention b): cash & equivalents + short-term marketable
  // securities, both companies. No split — net debt, leverage and combined cash all read this bucket.
  const preCash        = cashBucket(aCash, aSti).value + cashBucket(bCash, bSti).value;
  const pfCash         = preCash - cashPlug;                 // cash drawn to fund fees
  const preNetDebt     = preDebt - preCash;
  const pfNetDebt      = proFormaDebt - pfCash;
  const combinedEBITDA = num(deal?.combinedEBITDA);          // SAME non-GAAP EBITDA as §6/§7 (incl. Y1 synergies)
  const bankDeal       = isBankDeal(target, acquirer);
  const lev  = (v) => (!bankDeal && combinedEBITDA > 0) ? `${(v / combinedEBITDA).toFixed(1)}x` : (bankDeal ? 'n/m' : '—');

  // ── Deal-size header (link, don't duplicate §8) ─────────────────────────────────────────────────────
  const txnEV = num(d.transactionEV) ?? (equityPurchase != null ? equityPurchase + netCashDebt(bDebt, bCash, bSti) : null);

  const capRows = [
    { k: 'Total debt',            pre: preDebt,     pf: proFormaDebt },
    { k: 'Cash, equiv. & ST marketable sec.', pre: preCash, pf: pfCash },
    { k: 'Net debt / (net cash)', pre: preNetDebt,  pf: pfNetDebt, bold: true },
    { k: 'Debt / EBITDA',         pre: lev(preDebt),    pf: lev(proFormaDebt),  raw: true },
    { k: 'Net debt / EBITDA',     pre: lev(preNetDebt), pf: lev(pfNetDebt),     raw: true },
  ];

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit I">
      <PageHeader
        title="Transaction Structure — Sources & Uses"
        subtitle={`${aTk} / ${bTk} · deal funding & pro-forma capitalization · illustrative`}
      />

      <div style={{ padding: '14px 20px 6px' }}>
        {/* Deal-size header — one summary line + pointer to §8 (NO term duplication) */}
        <div style={{ display: 'flex', gap: 24, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 12,
          padding: '8px 12px', background: '#F9FAFB', border: `1px solid ${GRAY_BORDER}`, borderLeft: `4px solid ${SF_BLUE}`, borderRadius: 4 }}>
          <span style={{ fontSize: 11 }}><span style={{ color: '#6B7280' }}>Transaction equity value </span><strong style={{ color: NAVY }}>{dash(equityPurchase)}</strong></span>
          <span style={{ fontSize: 11 }}><span style={{ color: '#6B7280' }}>Enterprise value </span><strong style={{ color: NAVY }}>{dash(txnEV)}</strong></span>
          <span style={{ fontSize: 9.5, color: '#6B7280' }}>Offer price, premium, consideration mix &amp; exchange ratio: <strong style={{ color: SF_BLUE }}>see Exchange Ratio · Exhibit J</strong>.</span>
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
              <span style={{ flex: 1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>Pre-deal</span>
              <span style={{ flex: 1, color: '#fff', fontSize: 9.5, fontWeight: 700, textAlign: 'right' }}>Pro-forma</span>
            </div>
            {capRows.map((row, i) => (
              <div key={row.k} style={{ display: 'flex', padding: '5px 10px', background: row.bold ? '#EFF6FF' : (i % 2 ? ALT_ROW : '#fff'), borderBottom: `1px solid ${GRAY_BORDER}` }}>
                <span style={{ flex: 2, fontSize: 10, color: row.bold ? NAVY : '#374151', fontWeight: row.bold ? 700 : 400 }}>{row.k}</span>
                <span style={{ flex: 1, fontSize: 10, textAlign: 'right', color: '#6B7280', fontWeight: row.bold ? 700 : 500 }}>{row.raw ? row.pre : dash(row.pre)}</span>
                <span style={{ flex: 1, fontSize: 10, textAlign: 'right', color: NAVY, fontWeight: 700 }}>{row.raw ? row.pf : dash(row.pf)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '8px 20px 16px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.45 }}>
        <strong style={{ color: NAVY }}>Structure: </strong>
        Cash consideration is debt-financed (new acquisition debt); stock consideration is newly issued {aTk} equity; transaction fees are funded from balance-sheet cash, so <strong>Sources = Uses</strong>. <strong>{bTk}'s existing debt is assumed</strong> (it remains outstanding post-close and is carried in enterprise value) — it is NOT refinanced in this structure. {!bankDeal && <>Leverage is <strong>net debt (and total debt) ÷ combined non-GAAP EBITDA</strong> — the same EBITDA basis used on the Pro Forma slides (includes Year-1 synergies). </>}{NET_DEBT_BASIS}{aBsAsOf && bBsAsOf ? ` Balance-sheet items (cash, debt, marketable securities) are as of ${aTk} ${aBsAsOf} and ${bTk} ${bBsAsOf}.` : ''} Figures are illustrative transaction assumptions — not negotiated terms.
      </div>
    </PageFrame>
  );
}
