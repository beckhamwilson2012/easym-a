import { apiUrl } from '../../../api';
import React, { useState, useCallback } from 'react';
import { NAVY, SF_BLUE, GRAY_BORDER, ALT_ROW } from '../shared/deckTokens';
import { epsAccretionPct } from '../../../utils/dealCalc';
import { buildCompany } from './SectionComparables';

// ── Screening view (7G) ────────────────────────────────────────────────────────────────────────────────
// A NO-DEAL screen: an acquirer + a USER-SUPPLIED candidate list, ranked by accretion-if-acquired at ONE
// fixed premium. Candidates are user-supplied by design — /api/peers returns the acquirer's *comparables*
// (competitors), not acquisition candidates (GOOGL → MSFT/META/AMZN, unbuyable), so seeding is a category
// error (7G Phase 2). Reuses buildCompany (single source of truth for per-company metrics) + epsAccretionPct
// (the deck's accretion engine — NOT calculate()). It sets no `deal`/`results`: this is a separate path.
const SCREEN_PREMIUM  = 0.30;   // fixed control premium — one assumption across all candidates or ranking is meaningless
const SCREEN_CASH_PCT = 100;    // all-cash-equivalent structure (disclosed on the view)

// Stateless per-company fetch — mirrors SectionComparables.fetchOne's endpoint sequence exactly.
async function fetchCompanyData(ticker) {
  const quoteData = await fetch(apiUrl(`/quote?symbol=${ticker}`)).then(r => r.json()).catch(() => null);
  if (!quoteData) return null;
  let merged = quoteData;
  try {
    const pr = await fetch(apiUrl(`/api/price/${ticker}`)).then(r => r.json());
    merged = { ...merged, livePrice: pr && pr.price != null ? pr.price : null };
  } catch { merged = { ...merged, livePrice: null }; }
  if (quoteData.companyType === 'financial') {
    try {
      const bf = await fetch(apiUrl(`/api/bank-facts/${ticker}`)).then(r => r.json());
      if (bf) merged = { ...merged, ...bf, revenue: quoteData.revenue };
    } catch { /* ignore */ }
  }
  try {
    const [pnlR, profR] = await Promise.all([
      fetch(apiUrl(`/api/pnl/${ticker}`)).then(r => r.json()).catch(() => null),
      fetch(apiUrl(`/api/profile/${ticker}`)).then(r => r.json()).catch(() => null),
    ]);
    merged = { ...merged, pnl: pnlR && pnlR.ok ? pnlR : null, profile: profR && profR.ok ? profR : null };
  } catch { /* ignore */ }
  return merged;
}

// ── Formatters (screen table) — same "—" / n/m conventions as §2 ──
const fmtInt   = (v) => v == null || !Number.isFinite(v) ? '—' : (v < 0 ? `(${Math.abs(Math.round(v)).toLocaleString('en-US')})` : Math.round(v).toLocaleString('en-US'));
const fmtEvRev = (v) => v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}x`;
const fmtPct1  = (v) => v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`;
const fmtPctSg = (v) => v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const passthru = (s) => (s == null ? '—' : s);

// Column spec — LEAD columns (always resolve) first, then SECONDARY (blank-prone), per Phase 2 item 3.
const COLS = [
  { key: 'mktCap',        label: 'Equity Value',           unit: '$M',    get: r => r.co && r.co.mktCap,      fmt: fmtInt,   num: true },
  { key: 'netDebt',       label: 'Net Debt / (Cash)',      unit: '$M',    get: r => r.co && r.co.netDebt,     fmt: fmtInt,   num: true },
  { key: 'ev',            label: 'Enterprise Value',       unit: '$M',    get: r => r.co && r.co.ev,          fmt: fmtInt,   num: true },
  { key: 'cash',          label: 'Cash & Equiv.',          unit: '$M',    get: r => r.co && r.co.cash,        fmt: fmtInt,   num: true },
  { key: 'revenue',       label: 'Revenue',                unit: 'LTM',   get: r => r.co && r.co.revenue,     fmt: fmtInt,   num: true },
  { key: 'evRevLtm',      label: 'EV / Revenue',           unit: 'LTM',   get: r => r.co && r.co.evRevLtm,    fmt: fmtEvRev, num: true },
  { key: 'grossMargin',   label: 'Gross Margin',           unit: 'LTM',   get: r => r.co && r.co.grossMargin, fmt: fmtPct1,  num: true, nm: r => r.co && r.co.grossNm },
  { key: 'acc',           label: 'EPS Impact if Acquired', unit: `@ ${Math.round(SCREEN_PREMIUM * 100)}% prem.`, get: r => r.acc, fmt: fmtPctSg, num: true, impact: true },
  // Secondary — blank-prone (loss-makers → P/E n/m; D&A tagging → EV/EBITDA n/mᵇ; thin coverage → NTM "—").
  { key: 'peCell',        label: 'P / E',                  unit: 'LTM',   get: r => r.co && r.co.peCell,      fmt: passthru, num: false, secondary: true },
  { key: 'evEbitCell',    label: 'EV / EBITDA',            unit: 'LTM',   get: r => r.co && r.co.evEbitCell,  fmt: passthru, num: false, secondary: true },
  { key: 'revGrowthProj', label: 'Rev Growth',             unit: 'NTM',   get: r => r.co && r.co.revGrowthProj, fmt: fmtPctSg, num: true, secondary: true },
  { key: 'opMarginNG',    label: 'Op Margin',              unit: 'NTM',   get: r => r.co && r.co.opMarginNG,  fmt: fmtPct1,  num: true, secondary: true },
];

export function SectionScreening({ onBack }) {
  const [acqTicker, setAcqTicker] = useState('');
  const [candInput, setCandInput] = useState('');
  const [acqCo, setAcqCo]         = useState(null);
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(false);
  const [ran, setRan]             = useState(false);
  const [sortKey, setSortKey]     = useState('acc');
  const [sortDir, setSortDir]     = useState('desc');

  const runScreen = useCallback(async () => {
    const acq = acqTicker.trim().toUpperCase();
    const cands = [...new Set(
      candInput.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
    )].filter(t => t !== acq);
    if (!acq || cands.length === 0) return;
    setLoading(true); setRan(true); setRows([]); setAcqCo(null);

    const aData = await fetchCompanyData(acq);
    const acquirer = aData ? buildCompany(acq, aData, false) : null;
    setAcqCo(acquirer);
    // Acquirer baseInputs for epsAccretionPct. companyADilutedShares is OMITTED on purpose so
    // acquirerDilutedShares() derives NI ÷ EPS — the reported-EPS-consistent diluted base — keeping the
    // pro-forma leg on the SAME basis as the standalone-EPS baseline (no cover-page-count bias).
    const baseInputs = acquirer ? {
      companyAEPS:        acquirer.eps,
      companyANetIncome:  acquirer.netIncome,
      companyAShares:     acquirer.shares,
      currentSharePriceA: acquirer.livePrice,
      cashPercent:        SCREEN_CASH_PCT,
    } : null;

    const out = [];
    for (const t of cands) {
      const d = await fetchCompanyData(t);
      if (!d) { out.push({ ticker: t, co: null, acc: null }); continue; }
      const co = buildCompany(t, d, false);
      let acc = null;
      if (baseInputs && co.livePrice > 0 && co.netIncome != null && co.shares > 0) {
        const peerInputs = {
          ...baseInputs,
          companyBShares: co.shares, companyBNetIncome: co.netIncome, companyBEPS: co.eps,
          currentSharePriceB: co.livePrice, premiumReferencePrice: null, applySourcesOfFunds: false,   // peer screen keeps the simple 100%-debt convention
        };
        const pct = epsAccretionPct(co.livePrice * (1 + SCREEN_PREMIUM), 0, peerInputs); // 0 synergies → pre-synergy
        acc = Number.isFinite(pct) ? pct : null;
      }
      out.push({ ticker: t, co, acc });
    }
    setRows(out);
    setLoading(false);
  }, [acqTicker, candInput]);

  const onSort = (key) => {
    if (key === sortKey) setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = [...rows].sort((a, b) => {
    const col = COLS.find(c => c.key === sortKey) || COLS[7];
    const av = col.get(a), bv = col.get(b);
    const na = av == null || (typeof av === 'number' && !Number.isFinite(av));
    const nb = bv == null || (typeof bv === 'number' && !Number.isFinite(bv));
    if (na && nb) return 0; if (na) return 1; if (nb) return -1;   // nulls always last
    if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'desc' ? bv - av : av - bv;
    return sortDir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
  });

  const th = { padding: '7px 8px', background: NAVY, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' };
  const td = { padding: '7px 8px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap', color: '#1F2937' };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', background: '#F4F6F9', minHeight: '100vh', padding: '32px 16px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ background: '#0F2244', borderRadius: 12, padding: '14px 24px', marginBottom: 24,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#fff', fontWeight: 'bold', fontSize: 18 }}>
            Screening <span style={{ color: '#4A9FD4', fontWeight: 400, fontSize: 14 }}>· acquisition candidate screen</span>
          </div>
          {onBack && (
            <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.3)', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              ← Back
            </button>
          )}
        </div>

        {/* Mini-form: acquirer + candidate tickers. No offer, no mix, no synergies. */}
        <div style={{ background: '#fff', border: `1px solid ${GRAY_BORDER}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '0 0 160px' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Acquirer ticker</label>
              <input value={acqTicker} onChange={e => setAcqTicker(e.target.value)} placeholder="GOOGL"
                onKeyDown={e => e.key === 'Enter' && runScreen()}
                style={{ width: '100%', padding: '9px 10px', border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, fontSize: 14, textTransform: 'uppercase', boxSizing: 'border-box' }} />
            </div>
            <div style={{ flex: '1 1 320px' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Candidate tickers <span style={{ color: '#9CA3AF', fontWeight: 400 }}>(comma or space separated)</span></label>
              <input value={candInput} onChange={e => setCandInput(e.target.value)} placeholder="SNAP, PINS, SHOP, EBAY, RRGB"
                onKeyDown={e => e.key === 'Enter' && runScreen()}
                style={{ width: '100%', padding: '9px 10px', border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, fontSize: 14, textTransform: 'uppercase', boxSizing: 'border-box' }} />
            </div>
            <button onClick={runScreen} disabled={loading || !acqTicker.trim() || !candInput.trim()}
              style={{ padding: '10px 28px', background: loading ? '#9CA3AF' : '#0F2244', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}>
              {loading ? 'Screening…' : 'Screen'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 10 }}>
            Candidates are user-supplied — the app does not seed a candidate list, because a peer/comparables lookup returns competitors, not acquisition targets.
          </div>
        </div>

        {ran && !loading && acqCo && (
          <>
            {/* Assumption disclosure — stated on the view, not a tooltip (§10 min-cash / debt-repaid standard). */}
            <div style={{ background: '#F9FAFB', border: `1px solid ${GRAY_BORDER}`, borderLeft: `4px solid ${SF_BLUE}`, borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, color: '#374151', lineHeight: 1.5 }}>
              <strong style={{ color: NAVY }}>Screening acquirer: {acqCo.name} ({acqCo.ticker})</strong>
              {acqCo.livePrice != null && <> · ${acqCo.livePrice.toFixed(2)}/sh</>} · {rows.length} candidate{rows.length === 1 ? '' : 's'}.
              <br />
              <strong style={{ color: '#374151' }}>Accretion assumption:</strong> EPS Impact if Acquired assumes a <strong>{Math.round(SCREEN_PREMIUM * 100)}% premium</strong> to each candidate's current price, an <strong>all-cash-equivalent structure</strong> per the standard accretion path, and <strong>zero synergies</strong> — one consistent assumption across every candidate so the ranking is comparable. It is a <strong>pre-synergy structural estimate</strong>, not a struck deal.
            </div>

            {/* Ranked table */}
            <div style={{ background: '#fff', border: `1px solid ${GRAY_BORDER}`, borderRadius: 10, overflow: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 980 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0 }} onClick={() => onSort('name')}>Candidate</th>
                    {COLS.map(c => (
                      <th key={c.key} style={{ ...th, textAlign: 'right', background: c.impact ? '#12345E' : (c.secondary ? '#334155' : NAVY) }} onClick={() => onSort(c.key)}>
                        {c.label}{sortKey === c.key ? (sortDir === 'desc' ? ' ▾' : ' ▴') : ''}
                        <div style={{ fontSize: 8.5, fontWeight: 400, color: '#B8C4D4' }}>{c.unit}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => (
                    <tr key={r.ticker} style={{ background: i % 2 ? ALT_ROW : '#fff', borderTop: `1px solid ${GRAY_BORDER}` }}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 700, color: NAVY, position: 'sticky', left: 0, background: i % 2 ? ALT_ROW : '#fff' }}>
                        {r.co ? r.co.name : r.ticker} <span style={{ fontWeight: 400, color: '#9CA3AF' }}>{r.ticker}</span>
                      </td>
                      {COLS.map(c => {
                        const v = c.get(r);
                        const cell = c.nm?.(r) ? 'n/m' : c.fmt(v);
                        const impactColor = c.impact && typeof v === 'number' && Number.isFinite(v) ? (v >= 0 ? '#047857' : '#DC2626') : null;
                        return (
                          <td key={c.key} style={{ ...td, fontWeight: c.impact ? 700 : 500, color: impactColor || (c.secondary ? '#6B7280' : '#1F2937') }}>
                            {r.co ? cell : (c.impact ? '—' : '—')}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Caption + source footnote */}
            <div style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.5, marginTop: 12 }}>
              Ranked by <strong>EPS Impact if Acquired</strong> (default). Click any column to re-sort. Equity value, net debt, EV, cash, revenue (LTM), EV/Revenue and gross margin resolve for every public company; <strong>P/E</strong> is n/m for loss-makers, <strong>EV/EBITDA</strong> is n/mᵇ where D&amp;A is not tagged under a combined concept, and the <strong>NTM</strong> columns are "—" where a company has no forward consensus. <strong>Enterprise value is "—" for banks</strong> (deposit-funded balance sheets are not netted like corporate cash) — no EV is fabricated. Fundamentals are LTM (trailing-twelve-month) from SEC EDGAR via the same pipeline the deck uses; prices are live market; forward (NTM) figures are analyst consensus (FMP). Multiples are unadjusted current EV ÷ trailing revenue. Illustrative screen — not investment advice.
            </div>
          </>
        )}

        {ran && !loading && !acqCo && (
          <div style={{ background: '#FFFBEB', border: '1px dashed #F59E0B', borderRadius: 8, padding: 16, fontSize: 13, color: '#92400E' }}>
            Could not resolve the acquirer ticker <strong>{acqTicker.toUpperCase()}</strong>. Check the symbol and try again.
          </div>
        )}
      </div>
    </div>
  );
}
