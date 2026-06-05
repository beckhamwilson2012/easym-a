import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER, ALT_ROW, fmtMoneyTable, fmtPct } from '../shared/deckTokens';

// Lighter shade of SF_BLUE used for the target segment of each stacked bar.
const TARGET_BLUE = '#A8C4DC';

// Compute the two-sided contribution split for a single metric.
// Guards: if a + b <= 0 (e.g., both zero, or a negative value makes the base
// meaningless) we flag the metric as not-meaningful rather than show a
// nonsensical percentage. A single negative value also makes the split
// not-meaningful since a 100%-stacked share of a negative base is misleading.
function splitContribution(a, b) {
  const aNum = parseFloat(a) || 0;
  const bNum = parseFloat(b) || 0;
  const total = aNum + bNum;
  if (total <= 0 || aNum < 0 || bNum < 0) {
    return { aVal: aNum, bVal: bNum, aPct: null, bPct: null, nm: true };
  }
  return { aVal: aNum, bVal: bNum, aPct: (aNum / total) * 100, bPct: (bNum / total) * 100, nm: false };
}

export function SectionRelativeContribution({ target, acquirer, deal, pageNum }) {
  const aName = acquirer.name || acquirer.ticker || 'Acquirer';
  const bName = target.name || target.ticker || 'Target';

  // ── Standalone inputs (all $M) ──────────────────────────────────────────────
  const aRev = parseFloat(acquirer.revenue) || 0;
  const bRev = parseFloat(target.revenue) || 0;
  const aGP = aRev * 0.65; // est.
  const bGP = bRev * 0.65; // est.
  const aOI = parseFloat(acquirer.ebitda) || 0; // est. operating income ≈ EBITDA
  const bOI = parseFloat(target.ebitda) || 0;   // est.
  const aFCF = parseFloat(acquirer.netIncome) || 0; // est. FCF ≈ net income
  const bFCF = parseFloat(target.netIncome) || 0;   // est.

  // ── Pro-forma ownership split (shared convention) ───────────────────────────
  const acqShares = parseFloat(acquirer.shares) || 0;
  const newShares = parseFloat(deal.newSharesIssued) || 0;
  const totalShares = acqShares + newShares;
  const acqOwnPct = totalShares > 0 ? (acqShares / totalShares) * 100 : 0;
  const tgtOwnPct = totalShares > 0 ? (newShares / totalShares) * 100 : 0;
  const ownNm = totalShares <= 0;

  // ── Metric rows ─────────────────────────────────────────────────────────────
  const metrics = [
    { label: 'Revenue', isMoney: true, ...splitContribution(aRev, bRev) },
    { label: 'Gross Profit (est.)', isMoney: true, ...splitContribution(aGP, bGP) },
    { label: 'Operating Income (est. ≈ EBITDA)', isMoney: true, ...splitContribution(aOI, bOI) },
    { label: 'Free Cash Flow (est. ≈ Net Income)', isMoney: true, ...splitContribution(aFCF, bFCF) },
    {
      label: 'Pro-Forma Ownership',
      isMoney: false,
      aVal: acqShares,
      bVal: newShares,
      aPct: ownNm ? null : acqOwnPct,
      bPct: ownNm ? null : tgtOwnPct,
      nm: ownNm,
    },
  ];

  const sourceLine = 'Revenue from SEC EDGAR; gross profit, operating income and free cash flow are estimates (per transaction assumptions). Ownership per deal structure.';

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit H">
      <PageHeader
        title="Relative Contribution Analysis"
        subtitle={`${aName} and ${bName} — share of combined entity by metric`}
      />

      <div style={{ padding: '16px 20px 36px' }}>
        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, background: SF_BLUE, borderRadius: 2, display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: '#374151' }}>{aName} (Acquirer)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, background: TARGET_BLUE, borderRadius: 2, display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: '#374151' }}>{bName} (Target)</span>
          </div>
        </div>

        {/* ── 100% stacked bars per metric ────────────────────────────────────── */}
        <div style={{ marginBottom: 18 }}>
          {metrics.map((m, i) => (
            <div key={m.label} style={{ marginBottom: i === metrics.length - 1 ? 0 : 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {m.label}
                </span>
                {m.nm && (
                  <span style={{ fontSize: 9, fontStyle: 'italic', color: '#DC2626' }}>
                    n/m — split not meaningful (zero or negative base)
                  </span>
                )}
              </div>

              {m.nm ? (
                <div style={{
                  height: 26,
                  borderRadius: 4,
                  border: `1px dashed ${GRAY_BORDER}`,
                  background: ALT_ROW,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <span style={{ fontSize: 10, color: '#9CA3AF', fontStyle: 'italic' }}>n/m</span>
                </div>
              ) : (
                <div style={{ display: 'flex', height: 26, borderRadius: 4, overflow: 'hidden', border: `1px solid ${GRAY_BORDER}` }}>
                  <div style={{
                    width: `${m.aPct}%`,
                    background: SF_BLUE,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: m.aPct >= 12 ? 'center' : 'flex-start',
                    paddingLeft: m.aPct >= 12 ? 0 : 6,
                    minWidth: 0,
                  }}>
                    {m.aPct >= 8 && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>
                        {fmtPct(m.aPct, 0)}
                      </span>
                    )}
                  </div>
                  <div style={{
                    width: `${m.bPct}%`,
                    background: TARGET_BLUE,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: m.bPct >= 12 ? 'center' : 'flex-end',
                    paddingRight: m.bPct >= 12 ? 0 : 6,
                    minWidth: 0,
                  }}>
                    {m.bPct >= 8 && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: NAVY, whiteSpace: 'nowrap' }}>
                        {fmtPct(m.bPct, 0)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Underlying $ / share values table ───────────────────────────────── */}
        <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          Underlying Values
        </div>
        <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ background: NAVY, display: 'flex', padding: '5px 10px' }}>
            <span style={{ flex: 2.4, color: '#fff', fontSize: 10, fontWeight: 700 }}>Metric</span>
            <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>{aName}</span>
            <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>{bName}</span>
            <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>{aName} %</span>
            <span style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>{bName} %</span>
          </div>

          {metrics.map((m, i) => {
            const aDisp = m.isMoney ? fmtMoneyTable(m.aVal) : `${(parseFloat(m.aVal) || 0).toFixed(1)}M sh`;
            const bDisp = m.isMoney ? fmtMoneyTable(m.bVal) : `${(parseFloat(m.bVal) || 0).toFixed(1)}M sh`;
            const aPctDisp = m.nm ? 'n/m' : fmtPct(m.aPct, 1);
            const bPctDisp = m.nm ? 'n/m' : fmtPct(m.bPct, 1);
            return (
              <div key={m.label} style={{ display: 'flex', padding: '5px 10px', background: i % 2 === 1 ? ALT_ROW : '#fff', borderBottom: i === metrics.length - 1 ? 'none' : `1px solid ${GRAY_BORDER}` }}>
                <span style={{ flex: 2.4, fontSize: 11, color: '#374151' }}>{m.label}</span>
                <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>{aDisp}</span>
                <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>{bDisp}</span>
                <span style={{ flex: 1, fontSize: 11, textAlign: 'right', fontWeight: 600, color: m.nm ? '#DC2626' : SF_BLUE }}>{aPctDisp}</span>
                <span style={{ flex: 1, fontSize: 11, textAlign: 'right', fontWeight: 600, color: m.nm ? '#DC2626' : NAVY }}>{bPctDisp}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Source line */}
      <div style={{ padding: '0 20px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
        {sourceLine}
      </div>
    </PageFrame>
  );
}
