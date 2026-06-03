import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, GRAY_BORDER, ALT_ROW } from '../shared/deckTokens';
import { useVerifiedData } from '../../../hooks/useVerifiedData';

const GLYPH = {
  verified: { symbol: '✓', color: '#16A34A' },
  flagged:  { symbol: '⚠', color: '#B45309' },
  single:   { symbol: '–', color: '#6B7280' },
  missing:  { symbol: '?', color: '#DC2626' },
};

const FIELD_LABELS = {
  price:             'Current Price',
  marketCap:         'Market Cap',
  week52High:        '52-Week High',
  week52Low:         '52-Week Low',
  sharesOutstanding: 'Shares Outstanding',
  revenue:           'Revenue',
  operatingIncome:   'Operating Income',
  netIncome:         'Net Income',
  totalDebt:         'Total Debt',
  cash:              'Cash & Equivalents',
  freeCashFlow:      'Free Cash Flow',
  analystTargetMean: 'Analyst Target (Mean)',
  analystTargetHigh: 'Analyst Target (High)',
  analystTargetLow:  'Analyst Target (Low)',
};

function fmtVal(value, unit) {
  if (value == null) return '—';
  const n = parseFloat(value);
  if (isNaN(n)) return '—';
  if (unit === '$/sh') return `$${n.toFixed(2)}`;
  if (unit === '$') return n >= 1000 ? `$${(n / 1000).toFixed(1)}B` : `$${n.toFixed(0)}M`;
  if (unit === 'sh') return `${n.toFixed(0)}M`;
  return String(n);
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

export function SectionDataVerification({ target, pageNum }) {
  const { data, loading } = useVerifiedData(target?.ticker ?? null);

  const ticker = target?.ticker ?? '—';
  const fields = data?.fields ?? {};
  const asOf   = data?.asOf ? new Date(data.asOf).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  const rows = Object.entries(FIELD_LABELS).map(([key, label]) => ({
    key, label, fd: fields[key] ?? null,
  }));

  const counts = rows.reduce((acc, { fd }) => {
    if (!fd) return acc;
    acc[fd.status] = (acc[fd.status] || 0) + 1;
    return acc;
  }, {});

  const statusLegend = [
    { symbol: '✓', color: '#16A34A', text: 'Verified (2+ sources agree)' },
    { symbol: '–', color: '#6B7280', text: 'Single source (unconfirmed)' },
    { symbol: '⚠', color: '#B45309', text: 'Flagged (sources disagree)' },
    { symbol: '?', color: '#DC2626', text: 'Missing (no source returned)' },
  ];

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Appendix">
      <PageHeader
        title={`Data Verification — ${ticker}`}
        subtitle={`Source reconciliation as of ${asOf} · ★ = source of truth`}
      />

      <div style={{ padding: '12px 20px 32px' }}>
        {/* Summary badges */}
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

        {loading && (
          <div style={{ textAlign: 'center', padding: 32, color: '#9CA3AF', fontSize: 12 }}>
            Loading verification data…
          </div>
        )}

        {!loading && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                {['Field', 'Status', 'Value Used', 'EDGAR', 'FMP', 'Yahoo'].map((h, i) => (
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
                const alt = i % 2 === 1;
                const bg  = alt ? ALT_ROW : '#fff';
                return (
                  <tr key={key}>
                    <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, fontWeight: 500, color: '#111827' }}>
                      {label}
                    </td>
                    {fd
                      ? <StatusCell status={fd.status} bg={bg} />
                      : <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'center', color: '#9CA3AF' }}>—</td>
                    }
                    <td style={{ padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}`, textAlign: 'right', fontWeight: 600, color: NAVY }}>
                      {fd ? fmtVal(fd.value, fd.unit) : '—'}
                    </td>
                    <SourceCell meta={fd?.sourceMeta?.edgar} unit={fd?.unit} isSot={fd?.sot === 'edgar'} bg={bg} />
                    <SourceCell meta={fd?.sourceMeta?.fmp}   unit={fd?.unit} isSot={fd?.sot === 'fmp'}   bg={bg} />
                    <SourceCell meta={fd?.sourceMeta?.yahoo} unit={fd?.unit} isSot={fd?.sot === 'yahoo'} bg={bg} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Legend */}
        <div style={{ display: 'flex', gap: 20, marginTop: 14, flexWrap: 'wrap' }}>
          {statusLegend.map(({ symbol, color, text }) => (
            <span key={text} style={{ fontSize: 10, color: '#6B7280' }}>
              <span style={{ color, fontWeight: 700 }}>{symbol}</span> {text}
            </span>
          ))}
        </div>
        <p style={{ fontSize: 9, color: '#9CA3AF', marginTop: 10, lineHeight: 1.5 }}>
          Sources: SEC EDGAR (data.sec.gov) — audited XBRL filings, free.
          FMP (financialmodelingprep.com) — live market data, paid API.
          Yahoo Finance — unofficial cross-check, no guarantee of availability.
          FMP data display requires a separate Data Display and Licensing Agreement.
        </p>
      </div>
    </PageFrame>
  );
}
