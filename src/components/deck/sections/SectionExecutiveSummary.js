import React, { useState, useEffect } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER, LIGHT_BLUE, fmtMoney, fmtPct, fmtPctSigned, fmtPctFloor, fmtShares } from '../shared/deckTokens';
import { ISSUANCE_VOTE_THRESHOLD, ISSUANCE_MAJORITY_THRESHOLD } from '../../../lib/premiumThresholds';
import {
  issuancePct, acquirerVoteTest, majorityStockTest, hsrSizeOfTransactionTest,
  sameSicTest, financingTest, MET, UNKNOWN,
} from '../../../lib/closeCertainty';

// ─────────────────────────────────────────────────────────────────────────────
// Executive Summary — the deck's screen-only lead slide (registry showInPdf:false, like the
// Dashboard). It ASSEMBLES: every figure is read from the deckModel single source (C1 hard rule #4)
// or from deal._results, and nothing is re-derived locally, so this slide can never contradict the
// exhibit that owns a number. An unavailable input renders "—", never 0 and never "not triggered".
//
// Screen-only has one consequence worth stating: the PDF is captured from a SEPARATE hidden render
// tree (DeckShell's hiddenRef, which holds only showInPdf sections), so the analyst boxes below need
// no html2canvas round-trip today. If this slide is ever promoted into the PDF, their text must be
// lifted into state the hidden tree also reads, or it will export blank.
// ─────────────────────────────────────────────────────────────────────────────

const DASH = '—';
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
// Quantities for which ZERO is not a meaningful value, only an un-entered input: a per-share price
// and a shares-outstanding count. defaultInputs seeds these at 0, so without this guard a private
// deal (no per-share offer, no share count) renders "$0.00" and "0" — fabricated numbers of exactly
// the kind deckModel.js:79 refuses ("a null acquirer share count is unknown, not 0"). NOT applied to
// newShares, where 0 is a real answer (an all-cash deal issues no shares).
// Reuse the deck's formatters (one scaling convention everywhere) but return the null-honest dash
// instead of their 'N/A', which the surrounding slides use for a different, computable-but-n/m case.
const pos = (v) => { const n = num(v); return (n == null || n <= 0) ? null : n; };
const money = (v) => (num(v) == null ? DASH : fmtMoney(num(v)));
const pc    = (v, d = 1) => (num(v) == null ? DASH : fmtPct(num(v), d));
const pcS   = (v) => (num(v) == null ? DASH : fmtPctSigned(num(v)));
const pcF   = (v) => (num(v) == null ? DASH : fmtPctFloor(num(v)));
const sh    = (v) => (num(v) == null ? DASH : fmtShares(num(v)));
const ps    = (v) => (num(v) == null ? DASH : `$${num(v).toFixed(2)}`);

const STORAGE_PREFIX = 'execsum_';

// Per-viewer scratch text. Mirrors the custom-peer precedent (SectionComparables' peers_<ticker>):
// localStorage, keyed by the pair, every access wrapped — a private window or blocked site data
// throws on access, and the slide must still render.
function loadNotes(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
}
function saveNotes(key, notes) {
  try {
    const any = Object.values(notes).some(v => v && String(v).trim());
    if (any) localStorage.setItem(key, JSON.stringify(notes));
    else localStorage.removeItem(key);
  } catch { /* storage unavailable — the text simply does not persist */ }
}

function Row({ label, value, bold }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 12,
      padding: '5px 10px', borderBottom: `1px solid #F3F4F6`,
      background: bold ? LIGHT_BLUE : 'transparent',
    }}>
      <span style={{ fontSize: 11, color: bold ? NAVY : '#4B5563', fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{
        fontSize: 11, color: bold ? NAVY : '#111827', fontWeight: bold ? 700 : 600,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>{value}</span>
    </div>
  );
}

export function SectionExecutiveSummary({ target, acquirer, deal, model, pageNum, exhibitLabel }) {
  const d  = (model && model.derived) || {};
  const da = (model && model.dealAssumptions) || {};
  const A  = (model && model.verifiedData && model.verifiedData.acquirer) || {};
  const T  = (model && model.verifiedData && model.verifiedData.target) || {};
  const R  = (deal && deal._results) || {};

  const aTk = A.ticker || acquirer?.ticker || null;
  const bTk = T.ticker || target?.ticker || null;
  const notesKey = `${STORAGE_PREFIX}${aTk || 'A'}_${bTk || 'B'}`;

  const [notes, setNotes] = useState(() => loadNotes(notesKey));
  // Re-read when the pair changes so one deal's notes never bleed into another's.
  useEffect(() => { setNotes(loadNotes(notesKey)); }, [notesKey]);
  const setNote = (i, text) => {
    setNotes(prev => { const next = { ...prev, [i]: text }; saveNotes(notesKey, next); return next; });
  };

  // ── Snapshot — every value straight off the model / _results ──────────────
  // Combined EBITDA is read from _results (dealCalc's own figure), the same way the Credit Stats
  // exhibit reads it. deal.combinedEBITDA is NOT used: App.js builds it as
  // `results ? parseFloat(results.combinedEBITDA) : 0`, which yields 0 with no results and NaN when
  // the underlying value is null — both of which would print a fabricated number here.
  const combinedEBITDA = num(R.combinedEBITDA);
  const mix = (da.cashPercent != null && da.stockPercent != null)
    ? `${fmtPct(da.cashPercent, 0)} cash / ${fmtPct(da.stockPercent, 0)} stock` : DASH;

  // Accretion carries a THIRD state: dealCalc nulls epsChangePct whenever the EPS base is
  // non-positive (accretionMeaningful === false), so a null there means "not meaningful", not
  // "unknown". Distinguish them rather than printing one dash for both.
  const accPct = d.accretion ? d.accretion.pct : null;
  const accText = R.accretionMeaningful === false ? 'n/m — non-positive EPS base' : pcS(accPct);

  const snapshot = [
    { label: 'Acquirer', value: A.name ? `${A.name}${aTk ? ` (${aTk})` : ''}` : DASH },
    { label: 'Target',   value: T.name ? `${T.name}${bTk ? ` (${bTk})` : ''}` : DASH },
    { label: 'Offer price / share', value: ps(pos(d.offerPrice)) },
    { label: 'Premium to market',   value: pc(d.premiumPct) },
    { label: 'Equity value (offer × target shares)', value: money(d.totalConsideration), bold: true },
    { label: 'Enterprise value (acquisition basis)', value: money(d.transactionEV) },
    { label: 'Consideration mix', value: mix },
    { label: 'New acquirer shares issued', value: sh(d.newShares) },
    { label: 'Acquirer shares outstanding (pre-deal)', value: sh(pos(d.preDealShares)) },
    { label: 'Pro forma ownership — target holders', value: pcF(d.ownershipNewPct) },
    { label: 'Year-1 EPS accretion / (dilution)', value: accText, bold: true },
    { label: 'Combined revenue', value: money(d.combinedRevenue) },
    { label: 'Combined EBITDA (incl. Year-1 synergies)', value: money(combinedEBITDA) },
  ];

  // ── Rationale — a bullet ships ONLY when the data behind it exists ────────
  const pct = issuancePct({ newShares: d.newShares, preDealShares: d.preDealShares });
  const aSic = acquirer?.sic || null, bSic = target?.sic || null;
  const aSicDesc = acquirer?.sicDescription || null;
  const rationale = [];

  if (aSic && bSic) {
    rationale.push(String(aSic) === String(bSic)
      ? `Horizontal combination: both companies file under SIC ${aSic}${aSicDesc ? ` (${aSicDesc})` : ''}, the same industry classification.`
      : `Cross-sector combination: acquirer files under SIC ${aSic}${aSicDesc ? ` (${aSicDesc})` : ''}, target under SIC ${bSic}${target?.sicDescription ? ` (${target.sicDescription})` : ''}.`);
  }
  if (num(T.revenue) != null && num(d.combinedRevenue) != null && num(d.combinedRevenue) > 0) {
    rationale.push(`Scale: the target contributes ${fmtPct((num(T.revenue) / num(d.combinedRevenue)) * 100)} of ${money(d.combinedRevenue)} combined revenue (${money(T.revenue)} of its own) — per-metric splits on the Relative Contribution exhibit.`);
  }
  if (pct != null && da.stockPercent != null) {
    rationale.push(`Dilution: the ${fmtPct(da.stockPercent, 0)} stock component issues ${sh(d.newShares)} new shares, ${fmtPct(pct)} of the acquirer's ${sh(pos(d.preDealShares))} pre-deal shares.`);
  }
  if (num(d.premiumPct) != null && pos(d.currentPriceTarget) != null && pos(d.offerPrice) != null) {
    rationale.push(`Price: the ${ps(d.offerPrice)} offer is a ${pc(d.premiumPct)} premium to the target's ${ps(d.currentPriceTarget)} market price.`);
  }
  rationale.push(R.accretionMeaningful === false
    ? `Earnings: Year-1 accretion / (dilution) is not meaningful — the acquirer's or pro-forma EPS base is non-positive, so a percentage change carries no signal.`
    : `Earnings: Year-1 pro forma EPS moves ${pcS(accPct)} against the acquirer's standalone reported-diluted EPS.`);

  // ── Certainty of close — three-state, every item ──────────────────────────
  const checklist = [
    { label: `Acquirer shareholder vote (NYSE §312.03 / Nasdaq 5635, ${ISSUANCE_VOTE_THRESHOLD}%)`,
      t: acquirerVoteTest(pct, ISSUANCE_VOTE_THRESHOLD), metLabel: 'Required', notMetLabel: 'Not required' },
    { label: `Majority-stock structure (≥${ISSUANCE_MAJORITY_THRESHOLD}% of pre-deal shares)`,
      t: majorityStockTest(pct, ISSUANCE_MAJORITY_THRESHOLD), metLabel: 'Yes', notMetLabel: 'No' },
    { label: 'HSR size-of-transaction (on equity value)',
      t: hsrSizeOfTransactionTest(d.totalConsideration), metLabel: 'Test met', notMetLabel: 'Below threshold' },
    { label: 'Horizontal overlap — same SIC classification',
      t: sameSicTest(aSic, bSic), metLabel: 'Yes', notMetLabel: 'No' },
    { label: 'Acquisition financing required',
      t: financingTest(R.newDebt), metLabel: money(R.newDebt), notMetLabel: 'None' },
  ];

  return (
    <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
      <PageHeader
        title="Executive Summary"
        subtitle={aTk && bTk ? `${aTk} / ${bTk} · deal snapshot, rationale & certainty of close` : 'Deal snapshot, rationale & certainty of close'}
      />
      <div style={{ padding: '12px 22px 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>

          {/* ── Left: snapshot ── */}
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.8, color: SF_BLUE, textTransform: 'uppercase', marginBottom: 5 }}>
              Deal Snapshot
            </div>
            <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 4, overflow: 'hidden' }}>
              {snapshot.map((r, i) => <Row key={i} {...r} />)}
            </div>
            <div style={{ marginTop: 7, fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.45 }}>
              Equity value is the offer times target shares — the deck's deal value, and the basis the
              HSR size test uses. Enterprise value is the acquisition basis (equity value plus target
              net debt) and requires both target debt and cash; where either is unreported it reads
              “{DASH}”. Any unavailable input reads “{DASH}”, never zero.
            </div>
          </div>

          {/* ── Right: certainty of close ── */}
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.8, color: SF_BLUE, textTransform: 'uppercase', marginBottom: 5 }}>
              Certainty of Close
            </div>
            <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 4, overflow: 'hidden' }}>
              {checklist.map((c, i) => {
                const unknownState = c.t.state === UNKNOWN;
                const met = c.t.state === MET;
                const text = unknownState ? DASH : (met ? c.metLabel : c.notMetLabel);
                const color = unknownState ? '#9CA3AF' : (met ? '#B45309' : '#15803D');
                return (
                  <div key={i} style={{ padding: '6px 10px', borderBottom: '1px solid #F3F4F6', background: i % 2 ? '#FAFAFA' : '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span style={{ fontSize: 11, color: '#4B5563' }}>{c.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color, whiteSpace: 'nowrap' }}>{text}</span>
                    </div>
                    <div style={{ fontSize: 9, color: '#9CA3AF', marginTop: 1 }}>{c.t.reason}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 7, fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.45 }}>
              Each item is three-state: an item whose inputs are unavailable reads “{DASH}” with the
              reason, never “not triggered”. SIC is a filing-level industry classification, not a
              product-market definition — the overlap row reports the classification match only, not
              an antitrust conclusion. No item asserts a filing outcome or an approval timeline.
            </div>
          </div>
        </div>

        {/* ── Rationale + analyst boxes ── */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.8, color: SF_BLUE, textTransform: 'uppercase', marginBottom: 5 }}>
            Strategic Rationale — Supporting Data &amp; Analyst Commentary
          </div>
          {rationale.map((pt, i) => (
            <div key={i} style={{ display: 'flex', gap: 9, marginBottom: 7 }}>
              <span style={{ flexShrink: 0, width: 15, height: 15, borderRadius: '50%', background: LIGHT_BLUE, color: SF_BLUE, fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                {i + 1}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.5 }}>{pt}</div>
                <textarea
                  value={notes[i] || ''}
                  onChange={(e) => setNote(i, e.target.value)}
                  placeholder="Analyst commentary…"
                  rows={2}
                  style={{
                    width: '100%', marginTop: 3, padding: '4px 7px', boxSizing: 'border-box',
                    border: `1px dashed ${GRAY_BORDER}`, borderRadius: 3, resize: 'vertical',
                    fontFamily: 'inherit', fontSize: 10, color: '#374151', background: '#FCFCFD',
                  }}
                />
              </div>
            </div>
          ))}
          <div style={{ fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.45 }}>
            Each point above cites a figure carried on this deck; points whose underlying data is
            unavailable are omitted rather than asserted. Analyst commentary is yours — it is kept in
            this browser only, per deal pair, and is not part of the sourced model or the PDF export.
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
