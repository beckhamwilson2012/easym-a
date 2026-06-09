import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, GRAY_BORDER, isBankDeal } from '../shared/deckTokens';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { composeSourceLine } from '../../../lib/composeSourceLine';

// Fields whose runtime source tags drive the footnote (EDGAR fundamentals + CNBC live price).
const USED_FIELDS = ['revenue', 'operatingIncome', 'freeCashFlow', 'sharesOutstanding', 'price'];

const TARGET_TINT = '#FEF9E7';   // shaded target column (like the reference deck)
const TARGET_BORDER = '#F59E0B';

// ── Formatters (reference screening style) ─────────────────────────────────────
const fmtIntParens = (v) => v == null ? '—' : (v < 0 ? `(${Math.abs(Math.round(v)).toLocaleString()})` : Math.round(v).toLocaleString());
const fmtPctWhole  = (v) => v == null ? '—' : `${v < 0 ? '(' : ''}${Math.abs(Math.round(v))}%${v < 0 ? ')' : ''}`;
const fmtMktCap    = (v) => v == null ? '—' : `~$${Math.round(v / 1000).toLocaleString()}B`;
const fmtEvRev     = (v) => v == null ? '—' : `${v.toFixed(1)}x`;
const fmtRatioX    = (v) => v == null ? '—' : `${v.toFixed(1)}x`;
const fmtPct1      = (v) => v == null ? '—' : `${v.toFixed(1)}%`;

// "Salesforce, Inc." → "Salesforce"; "ADOBE INC." → "Adobe"; "SAP SE" → "SAP".
function shortName(name, ticker) {
  if (!name) return ticker;
  let n = name.replace(/,?\s*(Incorporated|Inc\.?|Corporation|Corp\.?|Company|Co\.?|Limited|Ltd\.?|LLC|S\.?E\.?|N\.?V\.?|plc|Holdings?)\b\.?/gi, '').trim();
  n = n.replace(/[,.]+$/, '').trim();
  if (n.length >= 4 && n === n.toUpperCase()) n = n.charAt(0) + n.slice(1).toLowerCase();
  return n || ticker;
}

// ── Per-company column data ────────────────────────────────────────────────────
function buildCompany(ticker, data, isTarget, displayName) {
  const rev    = parseFloat(data.revenue) || 0;
  const live   = data.livePrice != null && data.livePrice > 0 ? data.livePrice : null;
  const shares = parseFloat(data.shares) || 0;
  const mktCap = live != null && shares > 0 ? live * shares : null;
  const ev     = mktCap != null ? mktCap + (parseFloat(data.debt) || 0) - (parseFloat(data.cash) || 0) : null;
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

  return {
    ticker, name: displayName || shortName(data.name, ticker), isTarget,
    revenue: rev, operatingIncome: opInc, fcfMargin,
    mktCap: mktCapSane ? mktCap : null, evRev: mktCapSane ? evRev : null, mktCapFlagged: !mktCapSane && mktCap != null,
    totalAssets: data.totalAssets != null ? parseFloat(data.totalAssets) : null,
    effRatio, ptbv, cet1: data.cet1Ratio != null ? parseFloat(data.cet1Ratio) : null,
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
export function SectionComparables({ target, acquirer, pageNum }) {
  const bankMode     = isBankDeal(target, acquirer);
  const targetTicker = target?.ticker;
  const { data: verifiedData } = useVerifiedData(targetTicker ?? null);
  const sourceLine = composeSourceLine(USED_FIELDS, verifiedData?.fields, verifiedData?.asOf);

  const [autoPeers, setAutoPeers]     = useState([]);
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
    fetch(`http://localhost:3001/api/peers/${targetTicker}`)
      .then(r => r.json())
      .then(d => setAutoPeers(d.peers || []))
      .catch(() => setAutoPeers([]))
      .finally(() => setPeersLoading(false));
  }, [targetTicker]);

  // Fetch /quote (revenue, opInc, fcf, shares, cash, debt, name) + live price for a ticker.
  const fetchOne = useCallback((ticker) => {
    if (fetchingRef.current.has(ticker)) return;
    fetchingRef.current.add(ticker);
    setPeerData(prev => ({ ...prev, [ticker]: 'loading' }));
    fetch(`http://localhost:3001/quote?symbol=${ticker}`)
      .then(r => r.json())
      .then(async (quoteData) => {
        let merged = quoteData || {};
        try {
          const pr = await (await fetch(`http://localhost:3001/api/price/${ticker}`)).json();
          merged = { ...merged, livePrice: pr && pr.price != null ? pr.price : null };
        } catch { merged = { ...merged, livePrice: null }; }
        if (quoteData?.companyType === 'financial') {
          try {
            const bf = await (await fetch(`http://localhost:3001/api/bank-facts/${ticker}`)).json();
            if (bf) merged = { ...merged, ...bf, revenue: quoteData.revenue };
          } catch { /* ignore */ }
        }
        setPeerData(prev => ({ ...prev, [ticker]: merged }));
      })
      .catch(() => setPeerData(prev => ({ ...prev, [ticker]: null })));
  }, []);

  // Fetch the target AND every peer (the target is a column too).
  const companyTickers = [targetTicker, ...activePeers].filter(Boolean);
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
  const uniqueTickers = [...new Set(companyTickers)];
  const cols = uniqueTickers.map(t => {
    const d = peerData[t];
    const isTarget = t === targetTicker;
    const dispName = isTarget ? shortName(target?.name, t) : undefined;
    if (!d || d === 'loading') return { ticker: t, isTarget, loading: true, name: dispName || t, revenue: 0 };
    return buildCompany(t, d, isTarget, dispName);
  });
  const ordered = [
    ...cols.filter(c => c.isTarget),
    ...cols.filter(c => !c.isTarget).sort((a, b) => (b.revenue || 0) - (a.revenue || 0)),
  ];

  // ── Metric rows (only fetchable; no n/d filler rows) ─────────────────────────
  const STD_METRICS = [
    { label: 'Revenue',     unit: '$M', get: c => c.revenue,         fmt: fmtIntParens },
    { label: 'FCF Margin',  unit: '%',  get: c => c.fcfMargin,       fmt: fmtPctWhole },
    { label: 'Op Income',   unit: '$M', get: c => c.operatingIncome, fmt: fmtIntParens },
    { label: 'Market Cap',  unit: '',   get: c => c.mktCap,          fmt: fmtMktCap,  flagged: c => c.mktCapFlagged },
    { label: 'EV / Revenue',unit: '',   get: c => c.evRev,           fmt: fmtEvRev,   flagged: c => c.mktCapFlagged },
  ];
  const BANK_METRICS = [
    { label: 'Total Revenue',    unit: '$M', get: c => c.revenue,     fmt: fmtIntParens },
    { label: 'Total Assets',     unit: '$M', get: c => c.totalAssets, fmt: fmtIntParens },
    { label: 'Efficiency Ratio', unit: '',   get: c => c.effRatio,    fmt: fmtPct1 },
    { label: 'P / TBV',          unit: '',   get: c => c.ptbv,        fmt: fmtRatioX },
    { label: 'CET1',             unit: '',   get: c => c.cet1 != null ? c.cet1 * 100 : null, fmt: fmtPct1 },
  ];
  const loadedCols = ordered.filter(c => !c.loading);
  // Only render a metric row if at least one LOADED company can supply it (drops universally-empty rows).
  const metrics = (bankMode ? BANK_METRICS : STD_METRICS)
    .filter(m => loadedCols.length === 0 || loadedCols.some(c => m.get(c) != null));

  const nCols = ordered.length;
  const methodLabel = customPeers ? 'Custom set' : 'Auto-selected';
  const subtitle = `Operating & valuation screen · ${nCols} ${nCols === 1 ? 'company' : 'companies'} · ${methodLabel} · target shaded`;

  // Column width: metric label gets a fixed share; companies split the rest evenly.
  const labelW = 132;

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit A">
      <PageHeader title="Comparable Public Companies" subtitle={subtitle} />

      <div style={{ padding: '6px 22px 0', display: 'flex', justifyContent: 'flex-end' }}>
        {targetTicker && (
          <button onClick={() => setEditOpen(true)} style={{ fontSize: 11, color: NAVY, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>
            Edit Peers
          </button>
        )}
      </div>

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
                    {c.ticker}{c.isTarget ? ' • TARGET' : ''}
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
                <td style={{ padding: '6px 8px', background: ri % 2 ? '#F9FAFB' : '#fff', borderBottom: `1px solid ${GRAY_BORDER}`, fontSize: 10.5, fontWeight: 600, color: NAVY }}>
                  {m.label}{m.unit ? <span style={{ color: '#9CA3AF', fontWeight: 400 }}> ({m.unit})</span> : ''}
                </td>
                {ordered.map(c => {
                  const flagged = c.loading ? false : (m.flagged ? m.flagged(c) : false);
                  const val = c.loading ? '…' : (flagged ? '⚠' : m.fmt(m.get(c)));
                  const negative = !c.loading && typeof m.get(c) === 'number' && m.get(c) < 0;
                  return (
                    <td key={c.ticker} style={{
                      padding: '6px 6px', textAlign: 'right', fontSize: 10.5,
                      background: c.isTarget ? TARGET_TINT : (ri % 2 ? '#F9FAFB' : '#fff'),
                      borderBottom: `1px solid ${GRAY_BORDER}`,
                      borderLeft: c.isTarget ? `2px solid ${TARGET_BORDER}` : 'none',
                      borderRight: c.isTarget ? `2px solid ${TARGET_BORDER}` : 'none',
                      color: flagged ? '#B45309' : negative ? '#DC2626' : '#111827',
                      fontWeight: c.isTarget ? 700 : 500,
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
      {sourceLine && (
        <div style={{ padding: '0 22px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
          {sourceLine} Operating figures are GAAP from SEC filings; market cap and EV use live price × reported shares.
        </div>
      )}
    </PageFrame>
  );
}
