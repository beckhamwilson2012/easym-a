import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import {
  NAVY,
  GRAY_BORDER,
  ALT_ROW,
  DONUT_COLORS,
  fmtMoneyTable,
  fmtPerShare,
  fmtShares,
  fmtPct,
} from '../shared/deckTokens';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

// Reference §9 — Pro Forma Trading Profile & Ownership
export function SectionTradingProfile({ target, acquirer, deal, pageNum }) {
  const aName = acquirer.name || 'Acquirer';
  const bName = target.name || 'Target';

  // ── Share counts (millions) ──────────────────────────────────────────────
  const aShares  = parseFloat(acquirer.shares)        || 0;
  const bShares  = parseFloat(target.shares)          || 0;
  const newShares = parseFloat(deal.newSharesIssued)  || 0;
  const pfShares = aShares + newShares;

  // ── Market caps ($M) — live equity value where available ─────────────────
  // currentMarketCap = real live price × shares (may be null).
  const aMktCap = acquirer.currentMarketCap;
  const bMktCap = target.currentMarketCap;
  // Pro forma equity value ≈ acquirer live market cap + total consideration paid.
  const aMktCapNum = parseFloat(aMktCap);
  const totalPrice = parseFloat(deal.totalPrice);
  const pfEquityValue =
    !isNaN(aMktCapNum) && !isNaN(totalPrice) ? aMktCapNum + totalPrice : null;

  // Share price — live only; '—' when unavailable on the free data stack.
  const aPrice = acquirer.sharePrice;
  const bPrice = target.sharePrice;
  const fmtPriceOrDash = (p) => {
    const n = parseFloat(p);
    return p === null || p === undefined || isNaN(n) ? '—' : fmtPerShare(n);
  };
  const fmtCapOrDash = (m) => {
    const n = parseFloat(m);
    return m === null || m === undefined || isNaN(n) ? '—' : fmtMoneyTable(n);
  };

  // ── Ownership split (per shared spec) ────────────────────────────────────
  const acqPct    = pfShares > 0 ? (aShares / pfShares) * 100 : 0;
  const targetPct = pfShares > 0 ? (newShares / pfShares) * 100 : 0;

  const ownershipData = [
    { name: `Existing ${aName} holders`, value: acqPct },
    { name: `Former ${bName} holders`,   value: targetPct },
  ];

  // ── Trading profile table rows ───────────────────────────────────────────
  const rows = [
    {
      label: 'Share Price',
      a: fmtPriceOrDash(aPrice),
      b: fmtPriceOrDash(bPrice),
      pf: '—',
    },
    {
      label: 'Shares Outstanding (M)',
      a: aShares > 0 ? fmtShares(aShares) : '—',
      b: bShares > 0 ? fmtShares(bShares) : '—',
      pf: pfShares > 0 ? fmtShares(pfShares) : '—',
    },
    {
      label: 'Market Cap',
      a: fmtCapOrDash(aMktCap),
      b: fmtCapOrDash(bMktCap),
      pf: pfEquityValue !== null ? fmtMoneyTable(pfEquityValue) : '—',
      pfNote: true,
    },
    {
      label: '52-Week High',
      a: '—',
      b: '—',
      pf: '—',
    },
    {
      label: '52-Week Low',
      a: '—',
      b: '—',
      pf: '—',
    },
  ];

  const sourceLine =
    'Prices via market data feed; shares from SEC EDGAR. 52-week range unavailable on free data stack. ' +
    'Ownership per transaction assumptions.';

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit G">
      <PageHeader
        title="Pro Forma Trading Profile & Ownership"
        subtitle={`${aName} + ${bName} · Combined Capitalization`}
      />

      <div style={{ display: 'flex', gap: 20, padding: '16px 20px 36px' }}>
        {/* Left: trading profile table */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: NAVY,
              marginBottom: 6,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}
          >
            Trading Profile
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ background: NAVY, display: 'flex', padding: '6px 10px' }}>
              <span style={{ flex: 2, color: '#fff', fontSize: 10, fontWeight: 700 }}>Metric</span>
              <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>
                {acquirer.ticker || aName}
              </span>
              <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>
                {target.ticker || bName}
              </span>
              <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>
                Pro Forma
              </span>
            </div>

            {/* Body rows */}
            {rows.map((row, i) => (
              <div
                key={row.label}
                style={{
                  display: 'flex',
                  padding: '6px 10px',
                  background: i % 2 === 1 ? ALT_ROW : '#fff',
                  borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${GRAY_BORDER}`,
                  alignItems: 'baseline',
                }}
              >
                <span style={{ flex: 2, fontSize: 11, color: '#374151' }}>
                  {row.label}
                  {row.pfNote && (
                    <span style={{ fontSize: 9, color: '#9CA3AF', fontStyle: 'italic' }}>
                      {' '}
                      (PF = equity value)
                    </span>
                  )}
                </span>
                <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>{row.a}</span>
                <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>{row.b}</span>
                <span style={{ flex: 1, fontSize: 11, textAlign: 'right', fontWeight: 600, color: NAVY }}>
                  {row.pf}
                </span>
              </div>
            ))}
          </div>

          {/* Pro forma equity value callout */}
          <div
            style={{
              marginTop: 14,
              border: `1px solid ${GRAY_BORDER}`,
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <div style={{ background: NAVY, padding: '5px 10px' }}>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Pro Forma Equity Value Bridge</span>
            </div>
            <div style={{ padding: '8px 12px' }}>
              {[
                {
                  label: `${aName} market cap (live)`,
                  val: fmtCapOrDash(aMktCap),
                },
                {
                  label: 'Plus: total consideration',
                  val: !isNaN(totalPrice) ? fmtMoneyTable(totalPrice) : '—',
                  pos: true,
                },
                {
                  label: 'Pro forma equity value',
                  val: pfEquityValue !== null ? fmtMoneyTable(pfEquityValue) : '—',
                  bold: true,
                },
              ].map((item, idx) => (
                <div
                  key={item.label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '4px 0',
                    borderTop: item.bold ? `1px solid ${GRAY_BORDER}` : 'none',
                    marginTop: item.bold ? 2 : 0,
                  }}
                >
                  <span style={{ fontSize: 11, color: item.bold ? NAVY : '#374151', fontWeight: item.bold ? 700 : 400 }}>
                    {item.label}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: item.bold ? 700 : 600,
                      color: item.bold ? NAVY : item.pos ? '#166534' : '#374151',
                    }}
                  >
                    {item.pos && item.val !== '—' ? `+${item.val}` : item.val}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: ownership doughnut */}
        <div style={{ flex: '0 0 250px' }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: NAVY,
              marginBottom: 6,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}
          >
            Pro Forma Ownership
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '12px 12px 14px' }}>
            <div style={{ width: '100%', height: 175 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={ownershipData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={72}
                    paddingAngle={2}
                    startAngle={90}
                    endAngle={-270}
                    isAnimationActive={false}
                    stroke="#fff"
                    strokeWidth={2}
                  >
                    {ownershipData.map((entry, i) => (
                      <Cell key={entry.name} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Legend with percentages */}
            <div style={{ marginTop: 8 }}>
              {ownershipData.map((entry, i) => (
                <div
                  key={entry.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '5px 0',
                    borderTop: i === 0 ? 'none' : `1px solid ${GRAY_BORDER}`,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: DONUT_COLORS[i % DONUT_COLORS.length],
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 10.5, color: '#374151', lineHeight: 1.3 }}>{entry.name}</span>
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: NAVY, marginLeft: 8 }}>
                    {fmtPct(entry.value)}
                  </span>
                </div>
              ))}
            </div>

            {/* Share-count footnote for the split */}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${GRAY_BORDER}`, fontSize: 9.5, color: '#6B7280', lineHeight: 1.5 }}>
              Based on {aShares > 0 ? fmtShares(aShares) : '—'} existing {aName} shares and{' '}
              {newShares > 0 ? fmtShares(newShares) : '—'} new shares issued to {bName} holders
              ({pfShares > 0 ? fmtShares(pfShares) : '—'} pro forma).
            </div>
          </div>

          {/* 52-week footnote */}
          <div
            style={{
              marginTop: 12,
              border: `1px dashed ${GRAY_BORDER}`,
              borderRadius: 6,
              padding: '8px 10px',
              fontSize: 9.5,
              color: '#9CA3AF',
              fontStyle: 'italic',
              lineHeight: 1.5,
            }}
          >
            52-week high/low range is unavailable on the free data stack and is shown as "—".
          </div>
        </div>
      </div>

      {/* Source line */}
      <div style={{ padding: '0 20px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
        {sourceLine}
      </div>
    </PageFrame>
  );
}
