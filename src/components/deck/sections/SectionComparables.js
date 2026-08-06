import { apiUrl } from '../../../api';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, GRAY_BORDER, isBankDeal } from '../shared/deckTokens';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { composeSourceLine } from '../../../lib/composeSourceLine';
import { epsAccretionPct } from '../../../utils/dealCalc';
import { enterpriseValue, cashBucket, netCashDebt, NET_DEBT_BASIS } from '../../../lib/netDebt';
import { exhibitLabelOf, pageNumOf } from '../deckRegistry';

// Fields whose runtime source tags drive the footnote (EDGAR fundamentals + CNBC live price).
const USED_FIELDS = ['revenue', 'operatingIncome', 'freeCashFlow', 'sharesOutstanding', 'price'];

const TARGET_TINT = '#FEF9E7';   // shaded target column (like the reference deck)
const TARGET_BORDER = '#F59E0B';

// ── Formatters (reference screening style) ─────────────────────────────────────
const fmtIntParens = (v) => v == null ? '—' : (v < 0 ? `(${Math.abs(Math.round(v)).toLocaleString()})` : Math.round(v).toLocaleString());
const fmtPctWhole  = (v) => v == null ? '—' : `${v < 0 ? '(' : ''}${Math.abs(Math.round(v))}%${v < 0 ? ')' : ''}`;
const fmtEvRev     = (v) => v == null ? '—' : `${v.toFixed(1)}x`;
const fmtRatioX    = (v) => v == null ? '—' : `${v.toFixed(1)}x`;
const fmtPct1      = (v) => v == null ? '—' : `${v.toFixed(1)}%`;
const fmtPct1Signed= (v) => v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const fmtIntPlain  = (v) => v == null ? '—' : Math.round(v).toLocaleString('en-US');

// "Salesforce, Inc." → "Salesforce"; "ADOBE INC." → "Adobe"; "SAP SE" → "SAP".
function shortName(name, ticker) {
  if (!name) return ticker;
  let n = name.replace(/,?\s*(Incorporated|Inc\.?|Corporation|Corp\.?|Company|Co\.?|Limited|Ltd\.?|LLC|S\.?E\.?|N\.?V\.?|plc|Holdings?)\b\.?/gi, '').trim();
  n = n.replace(/[,.]+$/, '').trim();
  if (n.length >= 4 && n === n.toUpperCase()) n = n.charAt(0) + n.slice(1).toLowerCase();
  return n || ticker;
}

// ── Per-company column data ────────────────────────────────────────────────────
// Exported (pure) so the Screening view reuses the SAME per-company metric machinery — one source of truth.
export function buildCompany(ticker, data, isTarget, displayName) {
  const rev    = parseFloat(data.revenue) || 0;
  const live   = data.livePrice != null && data.livePrice > 0 ? data.livePrice : null;
  const shares = parseFloat(data.shares) || 0;
  const mktCap = live != null && shares > 0 ? live * shares : null;
  // EV via the shared helper — cash bucket = cash + short-term marketable securities (convention b).
  // Cash is null-aware: the helper short-circuits (net debt → null → EV → null → "—") when cash is null, so a
  // bank added as a peer — cash sits under CashAndDueFromBanks, not the standard concept, so data.cash is null —
  // renders "—" rather than a fabricated EV built from ~$300B of un-netted debt. Debt keeps ||0: a missing debt
  // tag means a near-debt-free filer (e.g. SHOP has no LongTermDebt), where treating it as $0 is honest.
  const stiVal = parseFloat(data.shortTermInvestments);
  const cashVal = Number.isFinite(parseFloat(data.cash)) ? parseFloat(data.cash) : null;
  const ev     = enterpriseValue(mktCap, parseFloat(data.debt) || 0, cashVal, stiVal);
  const stiUsed = cashBucket(0, stiVal).stiUsed;   // provenance: false → this column is cash-only (no ST-marketable line)
  const evRev  = ev != null && rev > 0 ? ev / rev : null;
  const opInc  = data.operatingIncome != null ? parseFloat(data.operatingIncome) : null;
  // Preserve the live-price EV fix: a market cap implausibly small vs revenue for a PROFITABLE company
  // signals broken shares-outstanding (e.g. WDAY 36M vs ~265M). Flag → don't print Market Cap / EV.
  const mktCapSane = mktCap != null && rev > 0 && !((mktCap / rev) < 0.8 && (opInc || 0) > 0);
  const fcf    = data.freeCashFlow != null ? parseFloat(data.freeCashFlow) : null;
  const fcfMargin = fcf != null && rev > 0 ? fcf / rev * 100 : null;

  // Bank-mode fields (present only when bank-facts merged in)
  const nii = (parseFloat(data.netInterestIncome) || 0) + (parseFloat(data.nonInterestIncome) || 0);
  const nie = data.nonInterestExpense != null ? parseFloat(data.nonInterestExpense) : null;
  const effRatio = nie != null && nii > 0 ? nie / nii * 100 : null;
  const tbv  = data.tangibleBookValue != null ? parseFloat(data.tangibleBookValue) : null;
  const ptbv = mktCap && tbv ? mktCap / tbv : null;

  // ── Target-screen additions (Stage 3) ──
  const grossProfit = data.grossProfit != null ? parseFloat(data.grossProfit) : null;
  const grossMargin = (grossProfit != null && rev > 0) ? (grossProfit / rev * 100) : null;
  // Forward (NTM) consensus from /api/pnl: revenue → growth proj + EV/Rev proj; opInc (ebitAvg, non-GAAP).
  const pnl = data.pnl && Array.isArray(data.pnl.columns) ? data.pnl.columns : null;
  const fwd = pnl ? pnl.find(c => !c.actual) : null;
  const latestAct = pnl ? [...pnl].reverse().find(c => c.actual) : null;
  const fwdRev = fwd && fwd.revenue != null ? fwd.revenue : null;
  const revGrowthProj = (fwdRev != null && latestAct && latestAct.revenue) ? ((fwdRev - latestAct.revenue) / latestAct.revenue * 100) : null;
  const opIncomeNG = fwd && fwd.operatingIncome != null ? fwd.operatingIncome : null;
  const opMarginNG = (opIncomeNG != null && fwdRev) ? (opIncomeNG / fwdRev * 100) : null;
  const evRevProj  = (ev != null && fwdRev) ? (ev / fwdRev) : null;
  const employees  = (data.profile && data.profile.employees != null) ? data.profile.employees : null;

  // ── LTM basis (Stage 3): the ACTUAL revenue / gross margin / EV-Rev switch to trailing-12mo when this
  // company's /quote carries a TRUSTED LTM (Stage-0 span-match gate); foreign/untrusted → stays FY,
  // flagged per-column. EV is point-in-time (mktcap + net debt) — NOT recomputed onto a period basis;
  // only the LTM denominator changes (standard comps: current EV ÷ trailing revenue).
  const ltmT   = (data.ltm && data.ltm.trusted === true) ? data.ltm : null;
  const revLtm = ltmT && ltmT.revenue != null ? parseFloat(ltmT.revenue) : null;
  const gpLtm  = ltmT && ltmT.grossProfit != null ? parseFloat(ltmT.grossProfit) : null;
  const revActual = revLtm != null ? revLtm : rev;                 // LTM if trusted, else FY annual
  const revBasis  = revLtm != null ? 'LTM' : 'FY';
  const grossMarginLtm = (gpLtm != null && revLtm > 0) ? (gpLtm / revLtm * 100) : grossMargin; // LTM margin, else the FY grossMargin computed above
  const evRevLtm  = (mktCapSane && ev != null && revActual > 0) ? ev / revActual : null; // trailing EV ÷ (LTM|FY) rev

  // ── P/E (LTM basis — same as revBasis): live price ÷ LTM diluted EPS. n/m when EPS ≤ 0 or out of a
  // meaningful range (> 100 → near-zero earnings, e.g. SHOP ~130x). GOOGL carries marker ᵃ: its LTM net income
  // far exceeds operating income (non-operating gains), so the P/E reads low — the same swing §6/§7 disclose.
  // Value from the LTM object, never hardcoded.
  const epsPE   = ltmT && ltmT.eps != null ? parseFloat(ltmT.eps) : (data.eps != null ? parseFloat(data.eps) : null);
  const peRaw   = (live != null && live > 0 && epsPE != null) ? live / epsPE : null;
  const niLtm   = ltmT && ltmT.netIncome != null ? parseFloat(ltmT.netIncome) : null;
  const oiLtm   = ltmT && ltmT.operatingIncome != null ? parseFloat(ltmT.operatingIncome) : null;
  const peNonOp = !!(niLtm != null && oiLtm > 0 && niLtm / oiLtm > 1.2);   // NI >> operating income → non-op inflated
  const peCell  = peRaw == null ? '—' : ((peRaw <= 0 || peRaw > 100) ? 'n/m' : `${peRaw.toFixed(1)}x${peNonOp ? 'ᵃ' : ''}`);

  // ── EV/EBITDA (LTM): REAL only when D&A resolved (LTM EBITDA > operating income). When EBITDA fell back to
  // operating income (D&A not tagged under a COMBINED concept — GOOGL, MSFT) → 'n/mᵇ', never an EBIT-based figure
  // and never a summed D&A (a combined tag ≠ the sum of components; AMZN's DDA exceeds its own by ~30%). A real
  // but absurd multiple (> 100 → SHOP's near-zero EBITDA) → 'n/m'. EV null → '—'.
  const ebitLtm  = ltmT && ltmT.ebitda != null ? parseFloat(ltmT.ebitda) : (data.ebitda != null ? parseFloat(data.ebitda) : null);
  const ebitReal = ebitLtm != null && oiLtm != null ? ebitLtm > oiLtm : (ebitLtm != null && opInc != null ? ebitLtm > opInc : false);
  const evEbitApprox = ebitLtm != null && !ebitReal;     // EBITDA == operating income → D&A not resolved
  const evEbitVal = (mktCapSane && ev != null && ebitReal && ebitLtm > 0) ? ev / ebitLtm : null;
  const evEbitCell = (!mktCapSane || ev == null) ? '—'
    : (evEbitApprox ? 'n/mᵇ'
    : (evEbitVal == null ? '—' : (evEbitVal > 100 ? 'n/m' : `${evEbitVal.toFixed(1)}x`)));

  // Net cash/(debt) for the equity value → EV bridge (shared helper). debt||0 (a missing debt tag = near-debt-
  // free filer at $0 — SHOP; consistent with the EV row and EV/Revenue), cash null-aware (a bank hides cash → "—").
  const netDebtLtm = netCashDebt(parseFloat(data.debt) || 0, cashVal, stiVal);

  return {
    ticker, name: displayName || shortName(data.name, ticker), isTarget,
    revenue: revActual, revBasis, ltmAsOf: ltmT ? ltmT.asOf : null, evRevLtm, stiUsed,
    bsAsOf: data.balanceSheetAsOf || null, bsBasis: data.balanceSheetBasis || null,
    cash: data.cash != null ? parseFloat(data.cash) : null,   // point-in-time (same balance-sheet cash as the EV calc)
    operatingIncome: opInc, fcfMargin,
    mktCap: mktCapSane ? mktCap : null, evRev: mktCapSane ? evRev : null, mktCapFlagged: !mktCapSane && mktCap != null,
    totalAssets: data.totalAssets != null ? parseFloat(data.totalAssets) : null,
    effRatio, ptbv, cet1: data.cet1Ratio != null ? parseFloat(data.cet1Ratio) : null,
    // screen fields
    grossMargin: grossMarginLtm, opMarginNG, opIncomeNG, revGrowthProj, evRevProj, employees,
    ev: mktCapSane ? ev : null,
    // valuation multiples + net-debt bridge (Stage 7A) — pre-formatted cells (n/m / footnote markers baked in)
    peCell, peNonOp, evEbitCell, evEbitApprox, netDebt: netDebtLtm,
    // raw inputs for the EPS-impact engine
    netIncome: data.netIncome != null ? parseFloat(data.netIncome) : null,
    shares, eps: data.eps != null ? parseFloat(data.eps) : null, livePrice: live,
  };
}

// ── Edit Peers Modal ──────────────────────────────────────────────────────────
function EditPeersModal({ autoPeers, customPeers, onSave, onClose }) {
  const [tickers, setTickers] = useState(customPeers ?? autoPeers);
  const [inputVal, setInputVal] = useState('');
  const [error, setError] = useState('');
  const add = () => {
    const t = inputVal.trim().toUpperCase();
    if (!t) return;
    if (tickers.includes(t)) { setError(`${t} is already in the list`); return; }
    setTickers(prev => [...prev, t]); setInputVal(''); setError('');
  };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', background: '#fff', borderRadius: 10, padding: 24, width: 'min(400px, calc(100vw - 32px))', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', fontFamily: 'Arial, sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Edit Peer Set</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#6B7280', lineHeight: 1, padding: 0 }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>Auto-suggested peers are pre-filled. Add or remove tickers as needed.</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, minHeight: 32, padding: '6px 8px', border: `1px solid ${GRAY_BORDER}`, borderRadius: 6 }}>
          {tickers.map(t => (
            <div key={t} style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4, padding: '3px 8px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontWeight: 600, color: NAVY }}>{t}</span>
              <button onClick={() => setTickers(p => p.filter(x => x !== t))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
            </div>
          ))}
          {tickers.length === 0 && <span style={{ fontSize: 12, color: '#9CA3AF' }}>No peers selected</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input value={inputVal} onChange={e => { setInputVal(e.target.value.toUpperCase()); setError(''); }} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Add ticker (e.g. PANW)" style={{ flex: 1, padding: '7px 10px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 13 }} />
          <button onClick={add} style={{ padding: '7px 14px', background: NAVY, color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Add</button>
        </div>
        {error && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 4 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={() => { onSave(tickers); onClose(); }} style={{ flex: 1, padding: '9px 0', background: NAVY, color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Save</button>
          <button onClick={() => { onSave(null); onClose(); }} style={{ padding: '9px 14px', background: '#fff', color: '#6B7280', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Reset to Auto</button>
        </div>
      </div>
    </div>
  );
}

// ── Main component — transposed public-company screening table ──────────────────
export function SectionComparables({ target, acquirer, deal, pageNum, exhibitLabel }) {
  const bankMode      = isBankDeal(target, acquirer);
  const targetTicker  = target?.ticker;
  const acquirerTicker = acquirer?.ticker && acquirer.ticker !== targetTicker ? acquirer.ticker : null;
  const { data: verifiedData } = useVerifiedData(targetTicker ?? null);
  const sourceLine = composeSourceLine(USED_FIELDS, verifiedData?.fields, verifiedData?.asOf);

  const [autoPeers, setAutoPeers]     = useState([]);
  const [peerSource, setPeerSource]   = useState(null); // coverage tier from /api/peers (provenance only)
  const [peerTrust, setPeerTrust]     = useState(null); // 'trusted' | 'untrusted' — untrusted → suppress peer cols
  const [customPeers, setCustomPeers] = useState(() => {
    if (!targetTicker) return null;
    try { return JSON.parse(localStorage.getItem(`peers_${targetTicker}`)); } catch { return null; }
  });
  const [peerData, setPeerData]       = useState({});
  const [peersLoading, setPeersLoading] = useState(!!targetTicker);
  const [editOpen, setEditOpen]       = useState(false);
  const fetchingRef = useRef(new Set());

  const activePeers = customPeers ?? autoPeers;

  useEffect(() => {
    if (!targetTicker) { setPeersLoading(false); return; }
    setPeersLoading(true);
    fetch(apiUrl(`/api/peers/${targetTicker}`))
      .then(r => r.json())
      .then(d => { setAutoPeers(d.peers || []); setPeerSource(d.source || null); setPeerTrust(d.trust || null); })
      .catch(() => { setAutoPeers([]); setPeerSource(null); setPeerTrust(null); })
      .finally(() => setPeersLoading(false));
  }, [targetTicker]);

  // Fetch /quote (revenue, opInc, fcf, shares, cash, debt, name) + live price for a ticker.
  const fetchOne = useCallback((ticker) => {
    if (fetchingRef.current.has(ticker)) return;
    fetchingRef.current.add(ticker);
    setPeerData(prev => ({ ...prev, [ticker]: 'loading' }));
    fetch(apiUrl(`/quote?symbol=${ticker}`))
      .then(r => r.json())
      .then(async (quoteData) => {
        let merged = quoteData || {};
        try {
          const pr = await (await fetch(apiUrl(`/api/price/${ticker}`))).json();
          merged = { ...merged, livePrice: pr && pr.price != null ? pr.price : null };
        } catch { merged = { ...merged, livePrice: null }; }
        if (quoteData?.companyType === 'financial') {
          try {
            const bf = await (await fetch(apiUrl(`/api/bank-facts/${ticker}`))).json();
            if (bf) merged = { ...merged, ...bf, revenue: quoteData.revenue };
          } catch { /* ignore */ }
        }
        // Target-screen (Stage 3): forward consensus (/api/pnl → growth proj, EV/Rev proj, NTM non-GAAP
        // op income) + employees (/api/profile). Best-effort — null where a company lacks coverage → "—".
        try {
          const [pnlR, profR] = await Promise.all([
            fetch(apiUrl(`/api/pnl/${ticker}`)).then(r => r.json()).catch(() => null),
            fetch(apiUrl(`/api/profile/${ticker}`)).then(r => r.json()).catch(() => null),
          ]);
          merged = { ...merged, pnl: pnlR && pnlR.ok ? pnlR : null, profile: profR && profR.ok ? profR : null };
        } catch { /* ignore */ }
        setPeerData(prev => ({ ...prev, [ticker]: merged }));
      })
      .catch(() => setPeerData(prev => ({ ...prev, [ticker]: null })));
  }, []);

  // Fetch the acquirer, the target, AND every peer (acquirer + target are both columns; spec §2
  // pins acquirer first, target second, then peers).
  // Take 6 peers AFTER removing the acquirer/target from the peer list — the curated set can include the
  // acquirer (e.g. CRM is in TEAM's peer set), and slicing before dedup would drop a real peer (SNOW).
  // Safety floor: an UNTRUSTED auto-resolved peer set (broad-market mega-caps, or a 2-digit-group
  // cross-industry match like a space company → autos) is NOT a valid comp set — suppress the peer
  // columns and show an honest "no comparable public peers" note instead of presenting false comps.
  // Explicit user choice always wins: custom peers render regardless of trust.
  const peersSuppressed = !customPeers && peerTrust === 'untrusted';
  const screenPeers = peersSuppressed
    ? []
    : activePeers.filter(t => t && t !== acquirerTicker && t !== targetTicker).slice(0, 6);
  const companyTickers = [acquirerTicker, targetTicker, ...screenPeers].filter(Boolean);
  const fetchKey = [...new Set(companyTickers)].sort().join(',');
  useEffect(() => {
    for (const t of new Set(companyTickers)) fetchOne(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  const handleSavePeers = (newCustom) => {
    setCustomPeers(newCustom);
    if (!targetTicker) return;
    if (newCustom === null) localStorage.removeItem(`peers_${targetTicker}`);
    else { localStorage.setItem(`peers_${targetTicker}`, JSON.stringify(newCustom)); for (const t of newCustom) fetchOne(t); }
  };

  // ── Assemble columns: target first, then peers by revenue desc ───────────────
  // Bank deals: the SUBJECT companies' bank facts (TBV/CET1/NII/NIE/totalAssets) are already threaded
  // into target/acquirer deck state — the same source §4/§5/§I/§J use. /quote tags JPM/BAC 'standard',
  // so fetchOne above skipped /api/bank-facts for them, leaving the subject row blank. Merge the threaded
  // facts (one source of truth, no new fetch) so the subject reads as a bank like the peers. Peers are
  // untouched (they populate from the peer pipeline); non-bank deals are unaffected (subject stays null).
  const BANK_FACT_KEYS = ['tangibleBookValue', 'cet1Ratio', 'nonInterestExpense', 'netInterestIncome', 'nonInterestIncome', 'totalAssets'];
  const threadedBankFacts = (co) => {
    const out = {};
    for (const k of BANK_FACT_KEYS) if (co?.[k] != null) out[k] = co[k];
    return out;
  };
  const uniqueTickers = [...new Set(companyTickers)];
  const cols = uniqueTickers.map(t => {
    const d = peerData[t];
    const isTarget = t === targetTicker;
    const isAcquirer = t === acquirerTicker && !isTarget;
    const dispName = isTarget ? shortName(target?.name, t) : (isAcquirer ? shortName(acquirer?.name, t) : undefined);
    if (!d || d === 'loading') return { ticker: t, isTarget, isAcquirer, loading: true, name: dispName || t, revenue: 0 };
    // Fill ONLY the subject's bank-metric cells from the threaded facts (market cap/shares/revenue stay
    // from the peer pipeline, so P/TBV is the current-trading basis used for every other column).
    const subject = bankMode ? (isTarget ? target : isAcquirer ? acquirer : null) : null;
    const dForCol = subject ? { ...d, ...threadedBankFacts(subject) } : d;
    return { ...buildCompany(t, dForCol, isTarget, dispName), isAcquirer };
  });
  // Spec §2 order: acquirer first, target second, then remaining peers by revenue desc.
  const ordered = [
    ...cols.filter(c => c.isAcquirer),
    ...cols.filter(c => c.isTarget),
    ...cols.filter(c => !c.isTarget && !c.isAcquirer).sort((a, b) => (b.revenue || 0) - (a.revenue || 0)),
  ];

  // ── EPS Impact if Acquired — reuse the deck's accretion engine per company (Stage 3) ─────────────────
  // For each company, model THIS acquirer buying it at the SAME premium / cash-stock mix / financing as
  // the live deal (deal._inputs), synergies = 0 (target-specific, not transferable → a clean PRE-SYNERGY,
  // comparable basis across all columns). Identical epsAccretionPct used by §7/§8 — not a separate calc.
  const baseInputs = (deal && deal._inputs) || {};
  const dealPremium = (() => {
    const offer = parseFloat(deal?.offerPrice) || parseFloat(baseInputs.offerPricePerShare) || 0;
    const tgtPx = parseFloat(baseInputs.currentSharePriceB) || 0;
    return (offer > 0 && tgtPx > 0) ? (offer - tgtPx) / tgtPx : null;
  })();
  const epsImpactFor = (c) => {
    if (!c || c.loading || c.isAcquirer) return null;        // the acquirer doesn't acquire itself → "—"
    if (dealPremium == null || !(c.livePrice > 0) || c.netIncome == null || !(c.shares > 0)) return null;
    // applySourcesOfFunds:false — the peer screen carries no per-peer balance sheet, so it keeps the simple
    // 100%-debt convention (unchanged); the sources-of-funds construction applies to the main deal only.
    const peerInputs = { ...baseInputs, companyBShares: c.shares, companyBNetIncome: c.netIncome, companyBEPS: c.eps, currentSharePriceB: c.livePrice, applySourcesOfFunds: false };
    const peerOffer = c.livePrice * (1 + dealPremium);
    const pct = epsAccretionPct(peerOffer, 0, peerInputs); // 0 synergies → pre-synergy structural impact
    return Number.isFinite(pct) ? pct : null;
  };
  ordered.forEach(c => { c.epsImpact = epsImpactFor(c); });

  // ── Target-screen metric rows (Stage 3) — real where sourceable; NRR + Customers honest "—" ──────────
  const STD_METRICS = [
    { label: 'Revenue',              unit: '$M LTM',    get: c => c.revenue,       fmt: fmtIntParens },
    { label: 'Revenue Growth',       unit: 'next-FY est.', get: c => c.revGrowthProj, fmt: fmtPct1Signed },
    { label: 'Gross Margin',         unit: 'LTM %',     get: c => c.grossMargin,   fmt: fmtPct1 },
    { label: 'Op Margin',            unit: 'NTM',       get: c => c.opMarginNG,    fmt: fmtPct1 },
    { label: 'Op Income',            unit: '$M NTM',    get: c => c.opIncomeNG,    fmt: fmtIntParens },
    // Equity value → net debt → enterprise value bridge (reads top-to-bottom; foots per company).
    { label: 'Equity Value',         unit: '$M current',get: c => c.mktCap,        fmt: fmtIntParens, flagged: c => c.mktCapFlagged },
    { label: 'Net Debt / (Cash)',    unit: '$M as-of',  get: c => c.netDebt,       fmt: fmtIntParens },
    { label: 'Enterprise Value',     unit: '$M current',get: c => c.ev,            fmt: fmtIntParens, flagged: c => c.mktCapFlagged },
    { label: 'Cash & Equiv.',        unit: '$M as-of',  get: c => c.cash,          fmt: fmtIntParens },
    { label: 'Employees',            unit: '',          get: c => c.employees,     fmt: fmtIntPlain },
    { label: 'EV / Revenue',         unit: 'LTM',       get: c => c.evRevLtm,      fmt: fmtEvRev, flagged: c => c.mktCapFlagged },
    { label: 'EV / EBITDA',          unit: 'LTM',       get: c => c.evEbitCell,    fmt: v => (v == null ? '—' : v) },
    { label: 'P / E',                unit: 'LTM',       get: c => c.peCell,        fmt: v => (v == null ? '—' : v) },
    { label: 'EPS Impact if Acquired', unit: 'pre-syn.', get: c => c.epsImpact,     fmt: fmtPct1Signed, impact: true, alwaysShow: true },
  ];
  const BANK_METRICS = [
    { label: 'Total Revenue',    unit: '$M', get: c => c.revenue,     fmt: fmtIntParens },
    { label: 'Total Assets',     unit: '$M', get: c => c.totalAssets, fmt: fmtIntParens },
    { label: 'Efficiency Ratio', unit: '',   get: c => c.effRatio,    fmt: fmtPct1 },
    { label: 'P / TBV',          unit: '',   get: c => c.ptbv,        fmt: fmtRatioX },
    { label: 'CET1',             unit: '',   get: c => c.cet1 != null ? c.cet1 * 100 : null, fmt: fmtPct1 },
  ];
  const loadedCols = ordered.filter(c => !c.loading);
  const anyPeNonOp     = loadedCols.some(c => c.peNonOp);      // ᵃ footnote (GOOGL-class non-operating LTM EPS)
  const anyEvEbitApprox = loadedCols.some(c => c.evEbitApprox); // ᵇ footnote (D&A not under a combined concept)
  // Render a row if it's alwaysShow (NRR/Customers/EPS-impact — honest "—" matters) OR at least one
  // LOADED company can supply it (drops universally-empty rows for the optional fetched metrics).
  const metrics = (bankMode ? BANK_METRICS : STD_METRICS)
    .filter(m => m.alwaysShow || loadedCols.length === 0 || loadedCols.some(c => m.get(c) != null));

  const nCols = ordered.length;
  // Balance-sheet as-of range across the comp set (2B-2): columns anchor at DIFFERENT dates (each filer's
  // latest interim, or its FY-end when no interim LTM), so state the RANGE as one note rather than one date.
  const bsDates = ordered.map(c => c.bsAsOf).filter(Boolean).sort();
  const bsRange = bsDates.length ? (bsDates[0] === bsDates[bsDates.length - 1] ? bsDates[0] : `${bsDates[0]} – ${bsDates[bsDates.length - 1]}`) : null;
  const methodLabel = customPeers ? 'Custom set' : 'Auto-selected';
  // Honest, understated provenance of the auto peer set (from /api/peers `source`). Reads like a source
  // citation — confidence level, not a warning. Custom (user-edited) sets carry their own note instead.
  const PEER_SOURCE_LABEL = {
    curated: 'Peer set: curated',
    sic: 'Peers selected by industry classification (SIC)',
    'sector-default': 'Peers selected by sector (approximated)',
    'broad-default': 'Limited peer coverage — broad-market proxies shown',
  };
  const peerProvenance = customPeers
    ? 'Peer set: custom (user-edited)'
    : (peersSuppressed
        ? 'No comparable public peers identified — peer screen omitted (broad-market / cross-sector proxies withheld rather than shown as false comps); sector-median EV/Revenue likewise suppressed from valuation'
        : (peerSource ? PEER_SOURCE_LABEL[peerSource] : null));
  const subtitle = `Acquirer + target + peer screen · ${nCols} ${nCols === 1 ? 'company' : 'companies'} · ${methodLabel} · actuals on LTM basis (columns marked "· FY" lack interim data) · target shaded`;
  // Surface each subject's LTM period-end so the near-alignment is transparent (not hidden): the LTM basis
  // aligns the companies' measurement windows to within ~1 month, vs a multi-month fiscal-year-end offset.
  const asOfShort = (d) => { if (!d) return null; const t = new Date(d + 'T12:00:00Z'); return t.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) + " '" + String(t.getUTCFullYear()).slice(2); };
  const acqAsOf = asOfShort(ordered.find(c => c.isAcquirer)?.ltmAsOf);
  const tgtAsOf = asOfShort(ordered.find(c => c.isTarget)?.ltmAsOf);

  // Column width: metric label gets a fixed share; companies split the rest evenly.
  const labelW = 132;

  return (
    <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
      <PageHeader title="Public Company Screen" subtitle={subtitle} />

      <div style={{ padding: '6px 22px 0', display: 'flex', justifyContent: 'flex-end' }}>
        {targetTicker && (
          <button onClick={() => setEditOpen(true)} style={{ fontSize: 11, color: NAVY, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>
            Edit Peers
          </button>
        )}
      </div>

      {peersSuppressed && (
        <div style={{ margin: '4px 22px 0', padding: '10px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderLeft: '4px solid #B45309', borderRadius: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 2 }}>
            No comparable public peers identified — comparables omitted
          </div>
          <div style={{ fontSize: 10, color: '#78350F', lineHeight: 1.45 }}>
            The automatic screen resolved only broad-market / cross-sector proxies (no true same-industry public
            peers), which are not meaningful comparables. Rather than present them as comps, the peer columns are
            withheld; only {acquirerTicker ? 'the acquirer and target' : 'the target'} — real, deal-specific — are
            shown, and the sector-median EV/Revenue is likewise suppressed from the valuation. Use “Edit Peers” to
            set a custom comparable set, or see the target's latest 10-K for its stated peer group.
          </div>
        </div>
      )}

      <div style={{ padding: '8px 22px 30px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontVariantNumeric: 'tabular-nums' }}>
          <colgroup>
            <col style={{ width: labelW }} />
            {ordered.map(c => <col key={c.ticker} style={{ width: `calc((100% - ${labelW}px) / ${nCols})` }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={{ padding: '7px 8px', textAlign: 'left', background: NAVY, color: '#fff', fontSize: 10, fontWeight: 700, borderBottom: `2px solid ${GRAY_BORDER}` }}>
                Metric
              </th>
              {ordered.map(c => (
                <th key={c.ticker} style={{
                  padding: '6px 6px', textAlign: 'right', verticalAlign: 'bottom',
                  background: c.isTarget ? '#1B3A6B' : NAVY, color: '#fff',
                  borderBottom: `2px solid ${GRAY_BORDER}`,
                  borderLeft: c.isTarget ? `2px solid ${TARGET_BORDER}` : 'none',
                  borderRight: c.isTarget ? `2px solid ${TARGET_BORDER}` : 'none',
                }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                  <div style={{ fontSize: 8.5, fontWeight: 600, color: c.isTarget ? '#FCD34D' : '#9DB4D4', marginTop: 1 }}>
                    {c.ticker}{c.isTarget ? ' • TARGET' : c.isAcquirer ? ' • ACQUIRER' : ''}{!c.loading && c.revBasis === 'FY' ? ' · FY' : ''}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {peersLoading && loadedCols.length === 0 && (
              <tr><td colSpan={nCols + 1} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 12, borderBottom: `1px solid ${GRAY_BORDER}` }}>Loading company data…</td></tr>
            )}
            {metrics.map((m, ri) => (
              <tr key={m.label}>
                <td style={{ padding: '6px 8px', background: m.impact ? '#EEF4FB' : (ri % 2 ? '#F9FAFB' : '#fff'), borderTop: m.impact ? `2px solid ${NAVY}` : 'none', borderBottom: `1px solid ${GRAY_BORDER}`, fontSize: 10.5, fontWeight: m.impact ? 700 : 600, color: NAVY }}>
                  {m.label}{m.unit ? <span style={{ color: '#9CA3AF', fontWeight: 400 }}> ({m.unit})</span> : ''}
                </td>
                {ordered.map(c => {
                  const flagged = c.loading ? false : (m.flagged ? m.flagged(c) : false);
                  const raw = c.loading ? null : m.get(c);
                  const val = c.loading ? '…' : (flagged ? '⚠' : m.fmt(raw));
                  const negative = typeof raw === 'number' && raw < 0;
                  // EPS-impact row: accretive (+) green, dilutive (−) red, like the deck's verdict colors.
                  const impactColor = m.impact && typeof raw === 'number' ? (raw >= 0 ? '#166534' : '#DC2626') : null;
                  return (
                    <td key={c.ticker} style={{
                      padding: '6px 6px', textAlign: 'right', fontSize: 10.5,
                      background: c.isTarget ? TARGET_TINT : (m.impact ? '#F4F8FD' : (ri % 2 ? '#F9FAFB' : '#fff')),
                      borderTop: m.impact ? `2px solid ${NAVY}` : 'none',
                      borderBottom: `1px solid ${GRAY_BORDER}`,
                      borderLeft: c.isTarget ? `2px solid ${TARGET_BORDER}` : 'none',
                      borderRight: c.isTarget ? `2px solid ${TARGET_BORDER}` : 'none',
                      color: impactColor || (flagged ? '#B45309' : negative ? '#DC2626' : '#111827'),
                      fontWeight: (c.isTarget || m.impact) ? 700 : 500,
                    }}>
                      {val}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editOpen && (
        <EditPeersModal autoPeers={autoPeers} customPeers={customPeers} onSave={handleSavePeers} onClose={() => setEditOpen(false)} />
      )}
      {(sourceLine || peerProvenance) && (
        <div style={{ padding: '0 22px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
          {sourceLine && <>{sourceLine} Revenue &amp; gross margin are <strong>LTM (trailing 12 months)</strong> GAAP from SEC filings (latest annual + interim YTD − prior-year YTD); columns marked "· FY" keep the latest fiscal year where interim data isn't tagged (foreign filers). EV / Revenue = current EV (live price × reported shares + net debt) ÷ LTM revenue — a standard current-EV-over-trailing-revenue multiple. {NET_DEBT_BASIS} Non-marketable equity is excluded; a company without a short-term marketable-securities line is net of cash &amp; equivalents only.{bsRange ? <> <strong>Balance-sheet items (cash, debt, short-term marketable securities) are as of each filer's latest interim balance sheet ({bsRange})</strong> — so enterprise value and LTM revenue share one as-of date per company; a company shown at its fiscal year-end had no newer interim.</> : null} <strong>The LTM basis aligns each company's measurement window to within about one month</strong>{acqAsOf && tgtAsOf ? <> (here acquirer LTM to {acqAsOf}, target LTM to {tgtAsOf})</> : ''} — materially tighter than the underlying fiscal-year-end offset; each column's LTM ends at that filer's latest reported quarter. </>}
          Revenue growth and Op Margin/Income (NTM) are forward analyst consensus from FMP (a single provider series whose basis is not designated as GAAP or non-GAAP); equity value &amp; cash are point-in-time. Equity value + net debt = enterprise value (reads top-to-bottom). Customer &amp; net-retention metrics, where a company discloses them, are shown as cited callouts on the Target Profile ({exhibitLabelOf('targetprofile')}) — not here, as they are reported on non-comparable definitions. <strong>EPS Impact if Acquired</strong> reuses the deck's accretion engine (same premium / cash-stock mix / financing as the live deal; pre-synergy) modeling this acquirer buying each company — a real computation, not a fetch.{anyPeNonOp ? <> <strong>ᵃ</strong> P/E is live price ÷ LTM diluted EPS; where a filer's LTM net income includes material non-operating income (marked ᵃ) the multiple reads low on that basis — see the non-operating disclosure on the Standalone P&amp;L (§{pageNumOf('plAcquirer')}/§{pageNumOf('plTarget')}). P/E is n/m where earnings are near zero (ratio &gt; 100).</> : null}{anyEvEbitApprox ? <> <strong>ᵇ</strong> EV/EBITDA is n/mᵇ where D&amp;A is not reported under a combined concept, so LTM EBITDA cannot be computed on a basis comparable to peers — an operating-income proxy is not shown, and components are not summed (a combined tag is not the sum of its parts).</> : null} {peerProvenance && <span>{peerProvenance}.</span>}
        </div>
      )}
    </PageFrame>
  );
}
