import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import {
  NAVY, GRAY_BORDER, ALT_ROW,
  fmtMoney, fmtPct, fmtMult, fmtRatio, isBankDeal,
} from '../shared/deckTokens';
import { computeDealScore } from '../../../utils/dealCalc';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { composeSourceLine } from '../../../lib/composeSourceLine';

const USED_FIELDS = ['revenue', 'sharesOutstanding', 'price'];

// ── Row builders ───────────────────────────────────────────────────────────────

function buildSavedRow(saved) {
  const { nameB, inputs, results } = saved;
  const rev    = inputs?.companyBRevenue || 0;
  const ebitda = inputs?.companyBEBITDA  || 0;
  const margin = rev > 0 && ebitda > 0 ? (ebitda / rev * 100).toFixed(1) : null;
  const ev     = results
    ? parseFloat(results.totalPurchasePrice) + (inputs?.companyBDebt || 0) - (inputs?.companyBCash || 0)
    : null;
  const evRev  = ev !== null && rev > 0 ? ev / rev : null;
  const score  = results ? computeDealScore(results, []) : null;
  const bf     = saved.bankFactsB || null;
  const nie    = bf?.nonInterestExpense;
  const nii    = (bf?.netInterestIncome || 0) + (bf?.nonInterestIncome || 0);
  const effRatio = nie && nii > 0 ? (nie / nii * 100).toFixed(1) : null;
  const tbv      = bf?.tangibleBookValue || null;
  const mktCap   = results ? parseFloat(results.totalPurchasePrice) : null;
  return {
    type: 'saved',
    company: nameB || 'Unknown',
    ticker:  saved.tickerB || '—',
    revenue: rev, margin, ev, evRev, score,
    isAccretive:  results?.isAccretive ?? null,
    effRatio,
    totalAssets:  bf?.totalAssets  || null,
    ptbv:         mktCap && tbv ? mktCap / tbv : null,
    cet1:         bf?.cet1Ratio   || null,
  };
}

function buildAutoRow(ticker, data) {
  const rev    = data.revenue || 0;
  const ebitda = data.ebitda  || 0;
  const margin = rev > 0 && ebitda > 0 ? (ebitda / rev * 100).toFixed(1) : null;

  // Market cap on the SAME basis as §6/§9: live price × shares. EPS×15 is only a last-resort
  // fallback when no live price is available (and the row is flagged, never shown as a clean number).
  const live = data.livePrice != null && data.livePrice > 0 ? data.livePrice : null;
  const liveMktCap = live != null && data.shares > 0 ? live * data.shares : null;
  const epsMktCap  = data.eps > 0 && data.shares > 0 ? data.eps * 15 * data.shares : null;
  const mktCap     = liveMktCap != null ? liveMktCap : epsMktCap;
  const mktCapSource = liveMktCap != null ? 'live' : (epsMktCap != null ? 'eps15-fallback' : 'none');
  const ev    = mktCap != null ? mktCap + (data.debt || 0) - (data.cash || 0) : null;
  const evRev = ev != null && rev > 0 ? ev / rev : null;

  // Sanity guard: a profitable SaaS name with EV/Rev < 1x is almost certainly a bad market cap
  // (e.g. the old EPS×15 proxy understating a high-multiple name). Don't print it — flag it.
  const evSane = !(mktCapSource === 'eps15-fallback'
    || (evRev != null && margin != null && parseFloat(margin) > 10 && evRev < 1));

  console.log(`[buildAutoRow] ${ticker} — eps=${data.eps} shares=${data.shares} livePx=${data.livePrice} | source=${mktCapSource} mktCap=${mktCap && Math.round(mktCap)} ev=${ev && Math.round(ev)} evRev=${evRev && evRev.toFixed(1)} sane=${evSane}`);

  // Bank fields — present when bank-facts were fetched and merged into data
  const nii      = (data.netInterestIncome || 0) + (data.nonInterestIncome || 0);
  const nie      = data.nonInterestExpense != null ? data.nonInterestExpense : null;
  const effRatio = nie != null && nii > 0 ? (nie / nii * 100).toFixed(1) : null;
  const tbv      = data.tangibleBookValue  != null ? data.tangibleBookValue  : null;
  const ptbv     = mktCap && tbv ? mktCap / tbv : null;

  return {
    type: 'auto',
    company: data.name || ticker,
    ticker,
    revenue: rev, margin,
    ev:    evSane ? ev : null,
    evRev: evSane ? evRev : null,
    evFlagged: !evSane && ev != null,
    score: null, isAccretive: null,
    effRatio,
    totalAssets: data.totalAssets != null ? data.totalAssets : null,
    ptbv,
    cet1: data.cet1Ratio != null ? data.cet1Ratio : null,
  };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ScoreBadge({ score }) {
  if (score === null) return <span style={{ color: '#9CA3AF' }}>—</span>;
  const color = score >= 7 ? '#16A34A' : score >= 4 ? '#D97706' : '#DC2626';
  const bg    = score >= 7 ? '#DCFCE7' : score >= 4 ? '#FEF3C7' : '#FEE2E2';
  return (
    <span style={{ background: bg, color, borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 700 }}>
      {score}/10
    </span>
  );
}

function RowTypeBadge({ type }) {
  const cfg = {
    target: { bg: '#FEF3C7', color: '#B45309', label: 'TARGET' },
    auto:   { bg: '#EFF6FF', color: '#1D4ED8', label: 'AUTO'   },
    saved:  { bg: '#F0FDF4', color: '#166534', label: 'SAVED'  },
  };
  const s = cfg[type] || cfg.auto;
  return (
    <span style={{
      marginLeft: 6, fontSize: 9, background: s.bg, color: s.color,
      borderRadius: 3, padding: '1px 5px', fontWeight: 700, letterSpacing: 0.3,
    }}>
      {s.label}
    </span>
  );
}

function SkeletonCell({ right = true }) {
  return (
    <td style={{ padding: '8px 12px', background: '#fff', borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: right ? 'right' : 'left' }}>
      <div className="skeleton-shimmer" style={{ height: 12, width: right ? '55%' : '75%', marginLeft: right ? 'auto' : 0 }} />
    </td>
  );
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
    setTickers(prev => [...prev, t]);
    setInputVal(''); setError('');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{
        position: 'relative', background: '#fff', borderRadius: 10, padding: 24,
        width: 'min(400px, calc(100vw - 32px))', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        fontFamily: 'Arial, sans-serif',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Edit Peer Set</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#6B7280', lineHeight: 1, padding: 0 }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
          Auto-suggested peers are pre-filled. Add or remove tickers as needed.
        </div>
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
          <input
            value={inputVal}
            onChange={e => { setInputVal(e.target.value.toUpperCase()); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="Add ticker (e.g. BAC)"
            style={{ flex: 1, padding: '7px 10px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 13 }}
          />
          <button onClick={add} style={{ padding: '7px 14px', background: NAVY, color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
            Add
          </button>
        </div>
        {error && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 4 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={() => { onSave(tickers); onClose(); }} style={{ flex: 1, padding: '9px 0', background: NAVY, color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
            Save
          </button>
          <button onClick={() => { onSave(null); onClose(); }} style={{ padding: '9px 14px', background: '#fff', color: '#6B7280', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
            Reset to Auto
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SectionComparables({ target, acquirer, comparables, pageNum }) {
  const bankMode     = isBankDeal(target, acquirer);
  const targetTicker = target?.ticker;
  const { data: verifiedData } = useVerifiedData(targetTicker ?? null);
  const sourceLine = composeSourceLine(USED_FIELDS, verifiedData?.fields, verifiedData?.asOf);
  console.log('[SectionComparables] render, target:', targetTicker, 'isBank:', bankMode);

  const [autoPeers, setAutoPeers]   = useState([]);
  const [customPeers, setCustomPeers] = useState(() => {
    if (!targetTicker) return null;
    try { return JSON.parse(localStorage.getItem(`peers_${targetTicker}`)); } catch { return null; }
  });
  const [peerData, setPeerData]     = useState({});
  const [peersLoading, setPeersLoading] = useState(!!targetTicker);
  const [editOpen, setEditOpen]     = useState(false);

  const fetchingRef = useRef(new Set());

  const activePeers = customPeers ?? autoPeers;

  // Fetch auto peer list
  useEffect(() => {
    console.log('[SectionComparables] useEffect fired for:', targetTicker);
    if (!targetTicker) {
      console.log('[SectionComparables] no ticker, bailing');
      setPeersLoading(false);
      return;
    }
    console.log(`[Comparables] fetching peer list for ${targetTicker}`);
    setPeersLoading(true);
    fetch(`http://localhost:3001/api/peers/${targetTicker}`)
      .then(r => {
        console.log('[SectionComparables] /api/peers responded:', r.status);
        return r.json();
      })
      .then(d => {
        console.log('[SectionComparables] /api/peers data:', JSON.stringify(d));
        console.log(`[Comparables] peer list response for ${targetTicker}:`, d);
        setAutoPeers(d.peers || []);
      })
      .catch(err => { console.error(`[Comparables] peer list error:`, err); setAutoPeers([]); })
      .finally(() => setPeersLoading(false));
  }, [targetTicker]);

  // Stable fetch helper — uses a ref to prevent duplicate requests.
  // For financial companies, chains a /api/bank-facts call so bank columns populate.
  const fetchOnePeer = useCallback((ticker) => {
    if (fetchingRef.current.has(ticker)) {
      console.log(`[fetchOnePeer] ${ticker} — SKIPPED (already in fetchingRef)`);
      return;
    }
    fetchingRef.current.add(ticker);
    console.log(`[fetchOnePeer] ${ticker} — starting fetch`);
    setPeerData(prev => ({ ...prev, [ticker]: 'loading' }));

    fetch(`http://localhost:3001/quote?symbol=${ticker}`)
      .then(r => r.json())
      .then(async (quoteData) => {
        console.log(`[fetchOnePeer] ${ticker} — /quote response keys:`, Object.keys(quoteData || {}), 'companyType:', quoteData?.companyType);
        let merged = quoteData;
        // Fetch the live price so the comps EV uses the SAME basis (live price × shares) as §6/§9,
        // instead of the old EPS×15 proxy. EDGAR /quote carries no price, so this is required.
        try {
          const prRes = await fetch(`http://localhost:3001/api/price/${ticker}`);
          const pr = await prRes.json();
          merged = { ...merged, livePrice: pr && pr.price != null ? pr.price : null };
        } catch (e) { merged = { ...merged, livePrice: null }; }
        if (quoteData?.companyType === 'financial') {
          try {
            const bfRes = await fetch(`http://localhost:3001/api/bank-facts/${ticker}`);
            const bf = await bfRes.json();
            console.log(`[fetchOnePeer] ${ticker} — bank-facts keys:`, Object.keys(bf || {}));
            if (bf) merged = { ...merged, ...bf, revenue: quoteData.revenue };
          } catch (e) { console.warn(`[fetchOnePeer] ${ticker} — bank-facts error:`, e.message); }
        }
        setPeerData(prev => ({ ...prev, [ticker]: merged }));
      })
      .catch(e => { console.error(`[fetchOnePeer] ${ticker} — /quote error:`, e.message); setPeerData(prev => ({ ...prev, [ticker]: null })); });
  }, []);

  // Kick off progressive fetches whenever activePeers changes
  useEffect(() => {
    for (const t of activePeers) fetchOnePeer(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [[...activePeers].sort().join(',')]);

  const handleSavePeers = (newCustom) => {
    setCustomPeers(newCustom);
    if (!targetTicker) return;
    if (newCustom === null) {
      localStorage.removeItem(`peers_${targetTicker}`);
    } else {
      localStorage.setItem(`peers_${targetTicker}`, JSON.stringify(newCustom));
      for (const t of newCustom) fetchOnePeer(t);
    }
  };

  // ── Build rows ─────────────────────────────────────────────────────────────

  const currentNIE   = target?.nonInterestExpense;
  const currentNII   = (target?.netInterestIncome || 0) + (target?.nonInterestIncome || 0);
  const currentEffRatio = currentNIE && currentNII > 0 ? (currentNIE / currentNII * 100).toFixed(1) : null;

  // Target EV on the SAME live-price basis as the peer rows (Fix 1): EV = live market cap + debt −
  // cash. Previously hardcoded null, so a profitable target (e.g. ADBE) showed N/A while appearing as
  // a peer with a real EV. EV is valid even when EBITDA ≤ 0 (only EV/EBITDA isn't).
  const tRev     = target?.revenue || 0;
  const tMargin  = (tRev > 0 && target?.ebitda > 0) ? (target.ebitda / tRev * 100).toFixed(1) : null;
  const tMktCap  = target?.currentMarketCap != null && parseFloat(target.currentMarketCap) > 0
    ? parseFloat(target.currentMarketCap) : null;
  const tEv      = tMktCap != null ? tMktCap + (parseFloat(target?.debt) || 0) - (parseFloat(target?.cash) || 0) : null;
  const tEvRev   = tEv != null && tRev > 0 ? tEv / tRev : null;
  const tEvSane  = !(tEvRev != null && tMargin != null && parseFloat(tMargin) > 10 && tEvRev < 1);

  const targetRow = {
    type: 'target',
    company: target?.name || 'Current Target',
    ticker:  targetTicker || '—',
    revenue: tRev,
    margin:  tMargin,
    ev:    tEvSane ? tEv : null,
    evRev: tEvSane ? tEvRev : null,
    evFlagged: !tEvSane && tEv != null,
    score: null, isAccretive: null,
    effRatio:   currentEffRatio,
    totalAssets: target?.totalAssets || null,
    ptbv:  null,
    cet1:  target?.cet1Ratio || null,
  };

  console.log('[Comparables] rendering peer row data:', activePeers.length, 'peers, first peer keys:', peerData[activePeers[0]] && typeof peerData[activePeers[0]] === 'object' ? Object.keys(peerData[activePeers[0]]) : String(peerData[activePeers[0]]));
  const autoRows = activePeers.map(ticker => {
    const d = peerData[ticker];
    if (!d || d === 'loading') return { type: 'auto', ticker, company: ticker, loading: true };
    return buildAutoRow(ticker, d);
  }).filter(Boolean);

  const savedRows = (comparables || [])
    .filter(s => s.inputs && s.results)
    .map(buildSavedRow);

  const sortKey = bankMode
    ? r => r.loading ? -1 : (r.totalAssets || 0)
    : r => r.loading ? -1 : (r.revenue || 0);

  const peerRows = [...autoRows, ...savedRows].sort((a, b) => sortKey(b) - sortKey(a));
  const allRows  = [targetRow, ...peerRows];

  // ── Table config ───────────────────────────────────────────────────────────

  const stdHeaders  = ['Company', 'Ticker', 'Revenue', 'EBITDA Margin', 'Enterprise Value', 'EV / Revenue', 'Deal Score', 'Verdict'];
  const bankHeaders = ['Company', 'Ticker', 'Total Revenue', 'Efficiency Ratio', 'Total Assets', 'P / TBV', 'CET1', 'Deal Score', 'Verdict'];
  const headers   = bankMode ? bankHeaders : stdHeaders;
  const colCount  = headers.length;

  const methodLabel = customPeers
    ? `Custom peer set · ${activePeers.length} peers`
    : autoPeers.length > 0
    ? `Auto-selected · ${activePeers.length} peers`
    : savedRows.length > 0 ? 'Saved analyses only' : 'Searching for peers…';

  const subtitle = `${bankMode ? 'Sorted by total assets' : 'Sorted by revenue'} · ${methodLabel}`;

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit A">
      <PageHeader title="Peer Comparison" subtitle={subtitle} />

      <div style={{ padding: '8px 24px 4px', display: 'flex', justifyContent: 'flex-end' }}>
        {targetTicker && (
          <button
            onClick={() => setEditOpen(true)}
            style={{ fontSize: 11, color: NAVY, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}
          >
            Edit Peers
          </button>
        )}
      </div>

      <div style={{ padding: '4px 24px 36px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              {headers.map(h => (
                <th key={h} style={{
                  padding: '8px 12px',
                  textAlign: h === 'Company' || h === 'Ticker' ? 'left' : 'right',
                  background: NAVY, color: '#fff', fontSize: 11, fontWeight: 700,
                  borderBottom: `2px solid ${GRAY_BORDER}`, whiteSpace: 'nowrap',
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Skeleton rows while peer list is loading */}
            {peersLoading && peerRows.length === 0 && (
              [0, 1, 2, 3].map(i => (
                <tr key={`sk-${i}`}>
                  {Array.from({ length: colCount }).map((_, j) => (
                    <SkeletonCell key={j} right={j > 1} />
                  ))}
                </tr>
              ))
            )}

            {allRows.map((row, i) => {
              const bg         = row.type === 'target' ? '#FEFCE8' : i % 2 === 0 ? '#fff' : ALT_ROW;
              const borderLeft = row.type === 'target' ? '3px solid #F59E0B'
                : row.type === 'auto'   ? '3px solid #BFDBFE'
                : '3px solid #BBF7D0';

              if (row.loading) {
                return (
                  <tr key={`loading-${row.ticker}`}>
                    <td style={{ padding: '8px 12px', background: '#fff', borderBottom: `1px solid ${GRAY_BORDER}`, borderLeft: '3px solid #BFDBFE' }}>
                      <div className="skeleton-shimmer" style={{ height: 12, width: '55%' }} />
                    </td>
                    {Array.from({ length: colCount - 1 }).map((_, j) => (
                      <SkeletonCell key={j} right={j > 0} />
                    ))}
                  </tr>
                );
              }

              const cell = (val, right = true) => (
                <td style={{ padding: '8px 12px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: right ? 'right' : 'left', color: '#111827' }}>
                  {val}
                </td>
              );

              return (
                <tr key={`${row.type}-${row.ticker}-${i}`}>
                  <td style={{ padding: '8px 12px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, borderLeft, fontWeight: row.type === 'target' ? 700 : 400, color: '#111827', whiteSpace: 'nowrap' }}>
                    {row.company}<RowTypeBadge type={row.type} />
                  </td>
                  <td style={{ padding: '8px 12px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, color: '#374151', fontWeight: 600 }}>
                    {row.ticker}
                  </td>
                  {bankMode ? (
                    <>
                      {cell(fmtMoney(row.revenue))}
                      {cell(row.effRatio !== null ? fmtPct(row.effRatio) : 'N/A')}
                      {cell(row.totalAssets !== null ? fmtMoney(row.totalAssets) : 'N/A')}
                      {cell(row.ptbv !== null ? fmtRatio(row.ptbv) : 'N/A')}
                      {cell(row.cet1 !== null ? `${(row.cet1 * 100).toFixed(1)}%` : 'N/A')}
                    </>
                  ) : (
                    <>
                      {cell(fmtMoney(row.revenue))}
                      {cell(row.margin !== null ? fmtPct(row.margin) : 'N/A')}
                      {cell(row.ev !== null ? fmtMoney(row.ev) : (row.evFlagged ? '⚠ review' : 'N/A'))}
                      {cell(row.evRev !== null ? fmtMult(row.evRev) : (row.evFlagged ? '⚠' : 'N/A'))}
                    </>
                  )}
                  <td style={{ padding: '8px 12px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'right' }}>
                    <ScoreBadge score={row.score} />
                  </td>
                  <td style={{ padding: '8px 12px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'right' }}>
                    {row.isAccretive === null
                      ? <span style={{ color: '#9CA3AF' }}>—</span>
                      : row.isAccretive
                      ? <span style={{ color: '#16A34A', fontWeight: 600 }}>Accretive</span>
                      : <span style={{ color: '#DC2626', fontWeight: 600 }}>Dilutive</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editOpen && (
        <EditPeersModal
          autoPeers={autoPeers}
          customPeers={customPeers}
          onSave={handleSavePeers}
          onClose={() => setEditOpen(false)}
        />
      )}
      {sourceLine && (
        <div style={{ padding: '0 24px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
          {sourceLine}
        </div>
      )}
    </PageFrame>
  );
}
