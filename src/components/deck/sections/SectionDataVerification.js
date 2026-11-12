import { apiUrl } from '../../../api';
import React, { useState, useEffect } from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, GRAY_BORDER, ALT_ROW } from '../shared/deckTokens';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { isRobustPanel } from '../../../hooks/useValuationSources';
import { HEADLINE_SOURCES, formatDeckDate } from '../../../lib/composeSourceLine';

const GLYPH = {
  verified: { symbol: '✓', color: '#16A34A' },
  flagged:  { symbol: '⚠', color: '#B45309' },
  single:   { symbol: '–', color: '#6B7280' },
  missing:  { symbol: '?', color: '#DC2626' },
  forecast: { symbol: '◇', color: '#0070D2' },
};

const SOURCE_COL_ORDER = ['edgar', 'cnbc', 'nasdaq', 'stockanalysis', 'yahoo', 'fmp', 'finnhub'];
const SOURCE_COL_LABELS = {
  edgar: 'EDGAR', cnbc: 'CNBC', nasdaq: 'Nasdaq', stockanalysis: 'StockAnalysis',
  yahoo: 'Yahoo', fmp: 'FMP', finnhub: 'Finnhub',
};
const SOURCE_DESC = {
  edgar:        'SEC EDGAR (data.sec.gov) — audited XBRL filings, free.',
  cnbc:         'CNBC — live market quotes (keyless feed).',
  nasdaq:       'Nasdaq (api.nasdaq.com) — live quotes and analyst targets.',
  stockanalysis:'StockAnalysis.com — analyst-estimate cross-check.',
  yahoo:        'Yahoo Finance — unofficial cross-check.',
  fmp:          'Financial Modeling Prep — market data (paid API).',
  finnhub:      'Finnhub — market data.',
};

const FIELD_LABELS = {
  price:             'Current Price',
  week52High:        '52-Week High',
  week52Low:         '52-Week Low',
  sharesOutstanding: 'Shares Outstanding',
  revenue:           'Revenue',
  grossProfit:       'Gross Profit',
  operatingIncome:   'Operating Income',
  netIncome:         'Net Income',
  epsDiluted:        'Diluted EPS',
  totalDebt:         'Total Debt',
  cash:              'Cash & Equivalents',
  totalAssets:       'Total Assets',
  totalStockholdersEquity: "Shareholders' Equity",
  freeCashFlow:      'Free Cash Flow (CFO − capex)',
  analystTargetMean: 'Analyst Target (Mean)',
  analystTargetHigh: 'Analyst Target (High)',
  analystTargetLow:  'Analyst Target (Low)',
};

// Page split (2-page pagination — §16 overflowed one PageFrame post-Pass-A). Group A = market/price +
// shares + income statement; Group B = balance sheet + cash flow + analyst targets (+ the bespoke ratings
// row). Both derive from the SAME useVerifiedData fetch (memCached → one HTTP), so the split is display-only.
const GROUP_A = ['price', 'week52High', 'week52Low', 'sharesOutstanding', 'revenue', 'grossProfit', 'operatingIncome', 'netIncome', 'epsDiluted'];
const GROUP_B = ['totalDebt', 'cash', 'totalAssets', 'totalStockholdersEquity', 'freeCashFlow', 'analystTargetMean', 'analystTargetHigh', 'analystTargetLow'];

const FORECAST_FIELDS = new Set(['analystTargetMean', 'analystTargetHigh', 'analystTargetLow']);
const isForecast = (key) => FORECAST_FIELDS.has(key);

function fmtVal(value, unit) {
  if (value == null) return '—';
  const n = parseFloat(value);
  if (isNaN(n)) return '—';
  if (unit === 'sh') return `${n.toFixed(0)}M`;          // share count — keep plain sign (never negative in practice)
  if (unit !== '$' && unit !== '$/sh') return String(n);
  // Currency units ($ and $/sh): accounting convention — negatives in parentheses, matching
  // fmtMoney/fmtMoneyTable deck-wide (closes the logged §16-parens item). Build the positive body,
  // then wrap when negative; guard the zero-rounding case so a tiny loss never shows ($0M)/($0.00).
  const abs = Math.abs(n);
  const body = unit === '$/sh'
    ? `$${abs.toFixed(2)}`
    : (abs >= 1000 ? `$${(abs / 1000).toFixed(1)}B` : `$${abs.toFixed(0)}M`);
  const roundsToZero = body === '$0M' || body === '$0.00' || body === '$0.0B';
  return (n < 0 && !roundsToZero) ? `(${body})` : body;
}

// Consensus label from a buy/hold/sell distribution (plurality). Returns null for an empty distribution
// (no divide-by-zero) so a no-coverage source reads "—" rather than a fabricated rating.
function ratingLabel(buy, hold, sell) {
  const t = (buy || 0) + (hold || 0) + (sell || 0);
  if (t <= 0) return null;
  if (buy >= hold && buy >= sell) return 'Buy';
  if (sell >= buy && sell >= hold) return 'Sell';
  return 'Hold';
}

function StatusCell({ status, bg }) {
  const g = GLYPH[status] || GLYPH.single;
  return (
    <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'center', color: g.color, fontWeight: 700, fontSize: 12 }}>
      {g.symbol}
    </td>
  );
}

function SourceCell({ meta, unit, isSot, bg }) {
  if (!meta) return (
    <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, fontSize: 10, color: '#9CA3AF', textAlign: 'right' }}>—</td>
  );
  const fy = meta.period?.fy ?? meta.period?.calendarYear;
  return (
    <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, fontSize: 10, textAlign: 'right', color: isSot ? NAVY : '#374151', fontWeight: isSot ? 600 : 400 }}>
      {fmtVal(meta.value, unit)}
      {fy && <span style={{ color: '#9CA3AF', marginLeft: 4 }}>FY{fy}</span>}
      {isSot && <span style={{ color: '#4A9FD4', marginLeft: 3, fontSize: 9 }}>★</span>}
    </td>
  );
}

// This appendix cross-checks fiscal-year figures across feeds. A company on LTM has no second feed: its LTM figures
// come from EDGAR alone, so they are listed here as used and marked as not cross-checked.
function LtmUsed({ acquirer, target, showFigures }) {
  const cos = [acquirer, target].filter((c) => c?.basis === 'ltm');
  const parts = [acquirer, target].filter((c) => c?.basisLabel).map((c) => `${c.ticker} ${c.basisLabel}`);
  if (!parts.length) return null;
  const rows = [['Revenue', 'revenue', '$'], ['Gross Profit', 'grossProfit', '$'], ['Operating Income', 'operatingIncome', '$'], ['EBITDA', 'ebitda', '$'], ['Net Income', 'netIncome', '$'], ['Diluted EPS', 'eps', '$/sh'], ['Free Cash Flow (CFO − capex)', 'freeCashFlow', '$']];
  return (
    <div data-testid="ltm-used" style={{ marginTop: 12, fontSize: 10, color: '#374151', lineHeight: 1.5 }}>
      <strong style={{ color: NAVY }}>Basis used: </strong>{parts.join('; ')}. The table above cross-checks fiscal-year figures.
      {showFigures && cos.map((c) => (
        <div key={c.ticker} style={{ marginTop: 6 }}>
          <strong style={{ color: NAVY }}>{c.ticker} {c.basisLabel}, as used.</strong> SEC EDGAR 10-K + 10-Q only: not cross-checked against a second feed.
          <div>{rows.map(([label, key, unit]) => `${label} ${fmtVal(c[key], unit)}`).join(' · ')}</div>
        </div>
      ))}
    </div>
  );
}

// Shared core — `part` selects which row group + which chrome renders. Both parts call useVerifiedData
// (memCached, single fetch); only part 'b' fetches /api/analyst-targets (reconcile + ratings).
// Phase 8 (§16) — uploaded-filing provenance table: every figure with its page cite, the line as printed
// in the filing (verbatim label), and its source (extracted / review / user override / user input).
function ProvenanceTable({ title, prov }) {
  if (!prov) return null;
  const fmt = v => v == null ? '—' : Number(v).toLocaleString('en-US');
  const srcColor = s => s === 'extracted' ? '#059669' : s === 'review' ? '#B45309' : '#6B7280';
  const th = { padding: '4px 6px', fontWeight: 600 };
  const td = { padding: '4px 6px', borderBottom: '1px solid #F3F4F6' };
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#0F2244', marginBottom: 6 }}>
        {title}{prov.docFacts ? <span style={{ fontWeight: 400, color: '#6B7280', fontSize: 11 }}> · in {prov.docFacts.scale} · {prov.docFacts.currency} · FY end {prov.docFacts.fiscalYearEnd}</span> : null}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr style={{ borderBottom: '1px solid #E5E7EB', color: '#6B7280', textAlign: 'left' }}>
          <th style={th}>Figure</th><th style={{ ...th, textAlign: 'right' }}>Value ($M)</th><th style={th}>Page</th><th style={th}>As printed in the filing</th><th style={th}>Source</th>
        </tr></thead>
        <tbody>
          {prov.rows.map((r, i) => (
            <tr key={i}>
              <td style={td}>{r.label}</td>
              <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.valueM)}</td>
              <td style={td}>{r.page != null ? `p.${r.page}` : '—'}</td>
              <td style={{ ...td, color: '#374151' }}>{r.verbatimLabel || '—'}</td>
              <td style={{ ...td, color: srcColor(r.source), fontWeight: r.source === 'user override' ? 600 : 400 }}>{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataVerificationCore({ target, acquirer, pageNum, part, exhibitLabel }) {
  const { data, loading } = useVerifiedData(target?.ticker ?? null);

  // Deck analyst headline + FMP ratings — ONLY needed on §16b (reconcile callout + ratings row).
  const [deckAnalyst, setDeckAnalyst] = useState(null);
  useEffect(() => {
    if (part !== 'b') return;                 // §16a needs no analyst-targets fetch
    const t = target?.ticker;
    if (!t) { setDeckAnalyst(null); return; }
    let cancel = false;
    fetch(apiUrl(`/api/analyst-targets/${t}`))
      .then(r => r.json()).then(d => { if (!cancel) setDeckAnalyst(d && d.ok ? d : null); })
      .catch(() => { if (!cancel) setDeckAnalyst(null); });
    return () => { cancel = true; };
  }, [target?.ticker, part]);

  const ticker = target?.ticker ?? '—';
  const fields = data?.fields ?? {};
  const asOf   = formatDeckDate(data?.asOf) || '—';
  const fx     = data?.fx ?? null; // FX Stage 3 provenance (foreign filer → converted:true)

  const allKeys  = Object.keys(FIELD_LABELS);
  const pageKeys = part === 'a' ? GROUP_A : GROUP_B;
  const allRows  = allKeys.map(key => ({ key, label: FIELD_LABELS[key], fd: fields[key] ?? null }));
  const rows     = pageKeys.map(key => ({ key, label: FIELD_LABELS[key], fd: fields[key] ?? null }));

  // Badges = whole-§16 status tally (rendered on §16a only, so it summarizes the full appendix once).
  const counts = allRows.reduce((acc, { key, fd }) => {
    if (!fd) return acc;
    if (isForecast(key)) { acc.forecast = (acc.forecast || 0) + 1; return acc; }
    acc[fd.status] = (acc[fd.status] || 0) + 1;
    return acc;
  }, {});

  // Present source columns for THIS page's rows (+ FMP persistent cross-check column).
  const presentSources = (() => {
    const seen = new Set();
    rows.forEach(({ fd }) => { if (fd?.sourceMeta) Object.keys(fd.sourceMeta).forEach(s => seen.add(s)); });
    const headline = SOURCE_COL_ORDER.filter(s => seen.has(s) && HEADLINE_SOURCES.has(s));
    return [...headline, 'fmp'];
  })();

  // ── Deck-headline reconcile (§16b) ─────────────────────────────────────────────────────────────────
  const deckMedian = deckAnalyst?.median ?? null;
  const nasdaqTgt  = fields.analystTargetMean?.sourceMeta?.nasdaq?.value
    ?? (fields.analystTargetMean?.sot === 'nasdaq' ? fields.analystTargetMean?.value : null);
  const headlineGapPct = (deckMedian != null && nasdaqTgt != null && parseFloat(nasdaqTgt) > 0)
    ? Math.abs(deckMedian - parseFloat(nasdaqTgt)) / parseFloat(nasdaqTgt) * 100 : null;
  const headlineReconciles = headlineGapPct != null ? headlineGapPct <= 5 : null;
  const deckCount   = deckAnalyst?.count ?? null;
  const robustPanel = isRobustPanel(deckAnalyst);

  // ── Analyst Ratings row (§16b, bespoke categorical) ────────────────────────────────────────────────
  // Nasdaq (SOT, from verifiedData) vs FMP (deckAnalyst.ratings). Counts differ by construction, so the
  // match test is on the CONSENSUS LABEL (plurality), not a numeric tolerance. Both already fetched.
  const nB = fields.analystRatingBuy?.value, nH = fields.analystRatingHold?.value, nSl = fields.analystRatingSell?.value;
  const nBuy = nB != null ? parseInt(nB, 10) : null, nHold = nH != null ? parseInt(nH, 10) : null, nSell = nSl != null ? parseInt(nSl, 10) : null;
  const nTotal = (nBuy || 0) + (nHold || 0) + (nSell || 0);
  const nasdaqHas = nTotal > 0;
  const fR = deckAnalyst?.ratings;
  const fBuy = fR?.buy ?? null, fHold = fR?.hold ?? null, fSell = fR?.sell ?? null;
  const fTotal = (fBuy || 0) + (fHold || 0) + (fSell || 0);
  const fmpHas = fTotal > 0;
  const nLabel = nasdaqHas ? ratingLabel(nBuy, nHold, nSell) : null;
  const fLabel = fmpHas ? ratingLabel(fBuy, fHold, fSell) : null;
  const nRobust = isRobustPanel({ ok: nasdaqHas, count: nTotal }); // inherit ≥3-firm bar (N4/N5)
  const fRobust = isRobustPanel({ ok: fmpHas, count: fTotal });

  let ratingStatus, ratingValueUsed = null, ratingPrimaryFmp = false;
  if (nasdaqHas) {
    ratingValueUsed = nLabel;
    if (fmpHas) {
      if (nLabel === fLabel) ratingStatus = 'verified';
      else if (nRobust && fRobust) ratingStatus = 'flagged';   // genuine divergence, both robust
      else ratingStatus = 'single';                            // a thin panel → NOT a hard flag (small-N)
    } else {
      ratingStatus = 'single';                                 // Nasdaq only
    }
  } else if (fmpHas) {
    ratingValueUsed = fLabel; ratingStatus = 'single'; ratingPrimaryFmp = true; // Nasdaq absent → FMP primary
  } else {
    ratingStatus = 'missing';
  }
  const triple = (buy, hold, sell) => `${buy != null ? buy : '—'} / ${hold != null ? hold : '—'} / ${sell != null ? sell : '—'}`;

  const statusLegend = [
    { symbol: '✓', color: '#16A34A', text: 'Verified (2+ sources agree)' },
    { symbol: '–', color: '#6B7280', text: 'Single source (unconfirmed)' },
    { symbol: '⚠', color: '#B45309', text: 'Flagged (sources disagree)' },
    { symbol: '◇', color: '#0070D2', text: 'Forecast (analyst opinion — dispersion normal, not flagged)' },
    { symbol: '?', color: '#DC2626', text: 'Missing (no source returned)' },
  ];

  const isA = part === 'a';

  // Phase 8 (§16) — uploaded/manual deck (no ticker → no EDGAR reconciliation to run). Show the extractor
  // provenance instead: every figure → page cite + verbatim label + source. This is the audit trail a
  // private-company deck needs, so no number is asserted without a way to check it.
  const hasProvenance = (target?.provenance?.hasUpload) || (acquirer?.provenance?.hasUpload);
  if (hasProvenance && !target?.ticker) {
    return (
      <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
        <PageHeader
          title={`Data Verification${isA ? '' : ' (continued)'}`}
          subtitle="Uploaded-filing provenance — every figure traces to the page and the line as printed; a figure marked “user override” was edited after extraction"
        />
        <div style={{ padding: '12px 20px 24px' }}>
          {isA
            ? <>
                <ProvenanceTable title={`${acquirer?.name || 'Acquirer'} — acquirer`} prov={acquirer?.provenance} />
                <ProvenanceTable title={`${target?.name || 'Target'} — target`} prov={target?.provenance} />
              </>
            : <div style={{ fontSize: 12, color: '#6B7280' }}>Figure-by-figure provenance is on page 1 of this exhibit.</div>}
        </div>
      </PageFrame>
    );
  }

  return (
    <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
      <PageHeader
        title={`Data Verification — ${ticker}${isA ? '' : ' (continued)'}`}
        subtitle={`Source reconciliation as of ${asOf} · ★ = source of truth · page ${isA ? '1' : '2'} of 2`}
      />

      <div style={{ padding: '12px 20px 24px' }}>
        {/* Summary badges — whole-§16 counts, §16a only */}
        {isA && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            {Object.entries(counts).map(([status, n]) => {
              const g = GLYPH[status];
              return (
                <span key={status} style={{ background: '#F9FAFB', border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '3px 10px', fontSize: 11, color: g?.color }}>
                  {g?.symbol} {n} {status}
                </span>
              );
            })}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: 32, color: '#9CA3AF', fontSize: 12 }}>
            Loading verification data…
          </div>
        )}

        {!loading && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                {['Field', 'Status', 'Value Used', ...presentSources.map(s => SOURCE_COL_LABELS[s])].map((h, i) => (
                  <th key={h} style={{
                    padding: '6px 10px', background: NAVY, color: '#fff', fontSize: 10,
                    textAlign: i <= 1 ? 'left' : 'right', fontWeight: 700,
                    borderBottom: `2px solid ${GRAY_BORDER}`, whiteSpace: 'nowrap',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, label, fd }, i) => {
                const bg = i % 2 === 1 ? ALT_ROW : '#fff';
                return (
                  <tr key={key}>
                    <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, fontWeight: 500, color: '#111827' }}>
                      {label}
                    </td>
                    {fd
                      ? <StatusCell status={isForecast(key) ? 'forecast' : fd.status} bg={bg} />
                      : <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'center', color: '#9CA3AF' }}>—</td>
                    }
                    <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'right', fontWeight: 600, color: NAVY }}>
                      {fd?.notMeaningful ? 'n/m' : fd ? fmtVal(fd.value, fd.unit) : '—'}
                    </td>
                    {presentSources.map(src => {
                      if (src === 'fmp' && fd?.chosenSource === 'fmp') {
                        return (
                          <td key="fmp" style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, fontSize: 9, textAlign: 'right', color: '#9CA3AF', fontStyle: 'italic' }}>
                            (primary)
                          </td>
                        );
                      }
                      return <SourceCell key={src} meta={fd?.sourceMeta?.[src]} unit={fd?.unit} isSot={fd?.sot === src} bg={bg} />;
                    })}
                  </tr>
                );
              })}

              {/* Analyst Ratings — bespoke categorical row (§16b): Nasdaq SOT vs FMP, consensus-label match. */}
              {!isA && (() => {
                const bg = rows.length % 2 === 1 ? ALT_ROW : '#fff';
                return (
                  <tr key="ratings">
                    <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, fontWeight: 500, color: '#111827' }}>
                      Analyst Ratings <span style={{ fontSize: 9, color: '#9CA3AF' }}>(Buy / Hold / Sell)</span>
                    </td>
                    <StatusCell status={ratingStatus} bg={bg} />
                    <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'right', fontWeight: 600, color: NAVY }}>
                      {ratingValueUsed || '—'}
                      {ratingValueUsed && nasdaqHas && !nRobust && <span style={{ color: '#9CA3AF', fontWeight: 400, fontSize: 9 }}> · thin</span>}
                    </td>
                    {presentSources.map(src => {
                      let content = '—', gray = true, italic = false;
                      if (src === 'nasdaq' && nasdaqHas) {
                        content = triple(nBuy, nHold, nSell) + (!nRobust ? ` · thin (N=${nTotal})` : ''); gray = false;
                      } else if (src === 'fmp' && fmpHas) {
                        content = triple(fBuy, fHold, fSell) + (ratingPrimaryFmp ? ' (primary)' : ''); gray = ratingPrimaryFmp; italic = ratingPrimaryFmp;
                      }
                      return (
                        <td key={src} style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, fontSize: 9.5, textAlign: 'right', color: gray ? '#9CA3AF' : '#374151', fontStyle: italic ? 'italic' : 'normal', whiteSpace: 'nowrap' }}>
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                );
              })()}
            </tbody>
          </table>
        )}

        {/* Deck-headline reconciliation (§16b) — median vs the independent Nasdaq SOT. */}
        {!isA && deckMedian != null && (
          <div style={{
            marginTop: 12, padding: '8px 12px', background: '#F9FAFB',
            border: `1px solid ${GRAY_BORDER}`, borderLeft: `4px solid ${robustPanel ? (headlineReconciles ? '#16A34A' : '#B45309') : '#9CA3AF'}`,
            borderRadius: 4, fontSize: 10, color: '#374151', lineHeight: 1.5,
          }}>
            <strong style={{ color: NAVY }}>Deck analyst headline (median): {fmtVal(deckMedian, '$/sh')}</strong>
            {' '}— the value §14 / §15 lead with{deckCount != null ? ` (${deckCount}-firm ${robustPanel ? 'deduped panel' : 'panel — thin coverage'})` : ''}.{' '}
            {nasdaqTgt != null ? (
              robustPanel ? (
                <>Reconciles with the independent <strong>Nasdaq source-of-truth {fmtVal(nasdaqTgt, '$/sh')}</strong>{' '}
                <span style={{ color: headlineReconciles ? '#16A34A' : '#B45309', fontWeight: 700 }}>
                  {headlineReconciles ? '✓' : '⚠'} {headlineGapPct.toFixed(1)}% gap
                </span>{headlineReconciles ? ' (within tolerance)' : ''}. Nasdaq remains the analyst source-of-truth — the deck headline is cross-checked against it, never self-verified.</>
              ) : (
                <>Compared with the independent <strong>Nasdaq source-of-truth {fmtVal(nasdaqTgt, '$/sh')}</strong>{' '}
                <span style={{ color: '#6B7280', fontWeight: 700 }}>
                  thin panel (N={deckCount}) — {headlineGapPct.toFixed(1)}% gap is expected small-N dispersion
                </span>, not a data disagreement (a {deckCount}-firm median is not a robust consensus). Nasdaq remains the analyst source-of-truth.</>
              )
            ) : 'Nasdaq target unavailable for cross-check.'}
          </div>
        )}

        <LtmUsed acquirer={acquirer} target={target} showFigures={isA} />

        {/* Currency conversion block (FX Stage 3, §16b) — foreign filer only (converted:true). */}
        {!isA && fx?.converted && (
          <div style={{
            marginTop: 12, padding: '8px 12px', background: '#F9FAFB',
            border: `1px solid ${GRAY_BORDER}`, borderLeft: '4px solid #16A34A',
            borderRadius: 4, fontSize: 10, color: '#374151', lineHeight: 1.5,
          }}>
            <strong style={{ color: NAVY }}>Currency conversion — {fx.reportedCurrency} → USD</strong>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, marginTop: 6 }}>
              <tbody>
                {[
                  ['Reported currency', fx.reportedCurrency],
                  ['Basis', 'spot (market & balance sheet) · period-average (income & cash flow)'],
                  ['Spot rate (data date)', `${Number(fx.spotRate).toFixed(4)}  ${fx.reportedCurrency}→USD`],
                  ['FY-average', `${Number(fx.avgRate).toFixed(4)}  ${fx.reportedCurrency}→USD${fx.avgWindow ? ` · window ${fx.avgWindow[0]} → ${fx.avgWindow[1]}` : ''}`],
                  ['Status', <span style={{ color: '#16A34A', fontWeight: 700 }}>✓ Converted to USD</span>],
                ].map(([k, v], i) => (
                  <tr key={i}>
                    <td style={{ padding: '2px 12px 2px 0', color: '#6B7280', whiteSpace: 'nowrap', verticalAlign: 'top', width: 156 }}>{k}</td>
                    <td style={{ padding: '2px 0', color: '#374151' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend — on BOTH pages so each is self-contained. */}
        <div style={{ display: 'flex', gap: 20, marginTop: 14, flexWrap: 'wrap' }}>
          {statusLegend.map(({ symbol, color, text }) => (
            <span key={text} style={{ fontSize: 10, color: '#6B7280' }}>
              <span style={{ color, fontWeight: 700 }}>{symbol}</span> {text}
            </span>
          ))}
        </div>

        {part === 'a' && fields.grossProfit?.notMeaningful && (
          <div style={{ marginTop: 6, fontSize: 9.5, color: '#6B7280', fontStyle: 'italic' }}>
            <strong>Gross Profit:</strong> n/m, {fields.grossProfit.notMeaningful}.
          </div>
        )}
        {/* Gross profit trace-back: the filing is the Value Used; FMP's figure stays visible beside it. */}
        {part === 'a' && fields.grossProfit?.sourceMeta?.edgar?.sourceLabel && fields.grossProfit.sourceMeta.edgar.basis === 'calculated' && (
          <p style={{ fontSize: 9, color: '#6B7280', marginTop: 10, lineHeight: 1.45 }}>
            <strong>Gross Profit:</strong> Value Used is from the filing, {fields.grossProfit.sourceMeta.edgar.sourceLabel}.
            {fields.grossProfit.sourceMeta.fmp?.value != null && fields.grossProfit.sourceMeta.fmp.value !== fields.grossProfit.value
              ? ` FMP reports ${fmtVal(fields.grossProfit.sourceMeta.fmp.value, fields.grossProfit.unit)} for the same period; the filing wins where they disagree.`
              : ''}
          </p>
        )}

        {/* Footnote — §16b only (the verification close). */}
        {!isA && (
          <p style={{ fontSize: 9, color: '#9CA3AF', marginTop: 10, lineHeight: 1.45 }}>
            Headline columns show only sources that returned data; <strong>FMP</strong> (paid) is a persistent
            cross-check — shown where it corroborates the SOT, “(primary)” where FMP itself supplied the Value
            Used, “—” on a miss.{' '}
            {presentSources.map(s => SOURCE_DESC[s]).join(' ')}{' '}
            Verified (✓) = two or more sources agree within tolerance; analyst targets (◇) are forecasts
            (dispersion normal). The Analyst Ratings row is categorical — “verified” means the Nasdaq and FMP
            consensus labels agree; a thin panel (&lt;3 firms) is shown, never hard-flagged.
          </p>
        )}
      </div>
    </PageFrame>
  );
}

export function SectionDataVerificationA(props) { return <DataVerificationCore {...props} part="a" />; }
export function SectionDataVerificationB(props) { return <DataVerificationCore {...props} part="b" />; }
