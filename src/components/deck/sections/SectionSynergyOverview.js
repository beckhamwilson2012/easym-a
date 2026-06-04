import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, GRAY_BORDER, ALT_ROW, fmtMoney, isBankDeal } from '../shared/deckTokens';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { composeSourceLine } from '../../../lib/composeSourceLine';

// All synergy values are user-entered transaction assumptions
const USED_FIELDS = ['revenue', 'synergiesY1', 'synergiesY2', 'synergiesY3', 'cashPercent'];

// Standard synergy split
const COST_PCT  = 0.55;
const REV_PCT   = 0.45;
const HEAD_PCT  = 0.35;
const FACIL_PCT = 0.10;
const PROC_PCT  = 0.10;

// Bank synergy split (all cost-side, NIE-based)
const BANK_BRANCH_PCT  = 0.40;
const BANK_TECH_PCT    = 0.25;
const BANK_HEAD_PCT    = 0.20;
const BANK_VENDOR_PCT  = 0.10;
const BANK_XSELL_PCT   = 0.05;

function SynRow({ label, y1, y2, y3, alt, bold, indent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      padding: '5px 10px', background: alt ? ALT_ROW : '#fff',
      borderBottom: `1px solid ${GRAY_BORDER}`,
      paddingLeft: indent ? 20 : 10,
    }}>
      <span style={{ flex: 2, fontSize: 11, fontWeight: bold ? 700 : 400, color: bold ? NAVY : '#374151' }}>{label}</span>
      {[y1, y2, y3].map((v, i) => (
        <span key={i} style={{ flex: 1, fontSize: 11, fontWeight: bold ? 700 : 500, color: bold ? NAVY : '#374151', textAlign: 'right' }}>
          {v}
        </span>
      ))}
    </div>
  );
}

export function SectionSynergyOverview({ target, acquirer, deal, pageNum }) {
  const { data: verifiedData } = useVerifiedData(target?.ticker ?? null);
  const sourceLine = composeSourceLine(USED_FIELDS, verifiedData?.fields, verifiedData?.asOf);
  const y1 = parseFloat(deal.synergiesY1) || 0;
  const y2 = parseFloat(deal.synergiesY2) || 0;
  const y3 = parseFloat(deal.synergiesY3) || 0;

  const bankMode = isBankDeal(target, acquirer);

  // Standard mode splits
  const costY1 = y1 * COST_PCT;
  const revY1  = y1 * REV_PCT;
  const headY1 = y1 * HEAD_PCT;
  const facilY1 = y1 * FACIL_PCT;
  const procY1  = y1 * PROC_PCT;
  const costY2 = y2 * COST_PCT, revY2  = y2 * REV_PCT;
  const costY3 = y3 * COST_PCT, revY3  = y3 * REV_PCT;

  const combinedRev = (parseFloat(target.revenue) || 0) + (parseFloat(acquirer.revenue) || 0);
  const synPct = combinedRev > 0 ? (y1 / combinedRev * 100).toFixed(1) : null;

  const combinedNIE = (target?.nonInterestExpense || 0) + (acquirer?.nonInterestExpense || 0);
  const niePct = combinedNIE > 0 ? (y1 / combinedNIE * 100).toFixed(1) : null;

  const maxBar = Math.max(y1, y2, y3, 1);

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit E">
      <PageHeader
        title="Synergy Overview — Combined Entity"
        subtitle={`${acquirer.name || 'Acquirer'} + ${target.name || 'Target'} — Year 1/2/3 Phased Savings`}
      />

      <div style={{ display: 'flex', gap: 20, padding: '16px 20px 36px' }}>
        {/* Left: synergy table */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Synergy Detail by Category ($M)
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: NAVY, display: 'flex', padding: '5px 10px' }}>
              <span style={{ flex: 2, color: '#fff', fontSize: 10, fontWeight: 700 }}>Category</span>
              {['Year 1', 'Year 2', 'Year 3'].map(y => (
                <span key={y} style={{ flex: 1, color: '#fff', fontSize: 10, fontWeight: 700, textAlign: 'right' }}>{y}</span>
              ))}
            </div>

            {bankMode ? (
              <>
                <div style={{ background: '#1D4A8A', padding: '4px 10px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: 600 }}>Cost Synergies (NIE-Based)</span>
                </div>
                <SynRow label="Branch / Office Consolidation" y1={fmtMoney(y1 * BANK_BRANCH_PCT)} y2={fmtMoney(y2 * BANK_BRANCH_PCT)} y3={fmtMoney(y3 * BANK_BRANCH_PCT)} indent />
                <SynRow label="Technology & Operations"        y1={fmtMoney(y1 * BANK_TECH_PCT)}   y2={fmtMoney(y2 * BANK_TECH_PCT)}   y3={fmtMoney(y3 * BANK_TECH_PCT)}   alt indent />
                <SynRow label="Corporate / Headcount"          y1={fmtMoney(y1 * BANK_HEAD_PCT)}   y2={fmtMoney(y2 * BANK_HEAD_PCT)}   y3={fmtMoney(y3 * BANK_HEAD_PCT)}   indent />
                <SynRow label="Vendor & Third-Party"           y1={fmtMoney(y1 * BANK_VENDOR_PCT)} y2={fmtMoney(y2 * BANK_VENDOR_PCT)} y3={fmtMoney(y3 * BANK_VENDOR_PCT)} alt indent />
                <SynRow label="Cross-Product Revenue Lift"     y1={fmtMoney(y1 * BANK_XSELL_PCT)}  y2={fmtMoney(y2 * BANK_XSELL_PCT)}  y3={fmtMoney(y3 * BANK_XSELL_PCT)}  indent />
              </>
            ) : (
              <>
                <div style={{ background: '#1D4A8A', padding: '4px 10px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: 600 }}>Cost Synergies</span>
                </div>
                <SynRow label="Headcount Reduction"    y1={fmtMoney(headY1)}  y2={fmtMoney(y2 * HEAD_PCT)}  y3={fmtMoney(y3 * HEAD_PCT)}  indent />
                <SynRow label="Facility Consolidation" y1={fmtMoney(facilY1)} y2={fmtMoney(y2 * FACIL_PCT)} y3={fmtMoney(y3 * FACIL_PCT)} alt indent />
                <SynRow label="Procurement Savings"    y1={fmtMoney(procY1)}  y2={fmtMoney(y2 * PROC_PCT)}  y3={fmtMoney(y3 * PROC_PCT)}  indent />
                <SynRow label="Total Cost Synergies"   y1={fmtMoney(costY1)}  y2={fmtMoney(costY2)}         y3={fmtMoney(costY3)}          alt bold />
                <div style={{ background: '#1D4A8A', padding: '4px 10px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: 600 }}>Revenue Synergies</span>
                </div>
                <SynRow label="Cross-Sell / Upsell"    y1={fmtMoney(revY1 * 0.6)} y2={fmtMoney(revY2 * 0.6)} y3={fmtMoney(revY3 * 0.6)} indent />
                <SynRow label="New Market Access"       y1={fmtMoney(revY1 * 0.4)} y2={fmtMoney(revY2 * 0.4)} y3={fmtMoney(revY3 * 0.4)} alt indent />
                <SynRow label="Total Revenue Synergies" y1={fmtMoney(revY1)}       y2={fmtMoney(revY2)}       y3={fmtMoney(revY3)}        bold />
              </>
            )}

            <div style={{ background: '#EFF6FF', display: 'flex', padding: '6px 10px', borderTop: '2px solid #0070D2' }}>
              <span style={{ flex: 2, fontSize: 12, fontWeight: 700, color: NAVY }}>Total Synergies</span>
              {[y1, y2, y3].map((v, i) => (
                <span key={i} style={{ flex: 1, fontSize: 12, fontWeight: 700, color: NAVY, textAlign: 'right' }}>{fmtMoney(v)}</span>
              ))}
            </div>
          </div>

          {/* Phasing bar chart */}
          {y1 > 0 && (
            <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 8, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                Synergy Ramp
              </div>
              {[['Year 1', y1], ['Year 2', y2], ['Year 3', y3]].map(([label, val]) => (
                <div key={label} style={{ marginBottom: 7 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: '#374151' }}>{label}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: NAVY }}>{fmtMoney(val)}</span>
                  </div>
                  <div style={{ height: 10, background: '#E5E7EB', borderRadius: 5 }}>
                    <div style={{ height: 10, borderRadius: 5, background: '#0070D2', width: `${(val / maxBar) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: commentary */}
        <div style={{ flex: '0 0 220px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Key Commentary
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: NAVY, padding: '5px 10px' }}>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Synergy Highlights</span>
            </div>
            <div style={{ padding: '10px 12px' }}>
              {(bankMode ? [
                `Total identified synergies of ${fmtMoney(y1)} in Year 1, ramping to ${fmtMoney(y3)} by Year 3.`,
                `Branch and office consolidation (${(BANK_BRANCH_PCT * 100).toFixed(0)}%) represents largest savings opportunity.`,
                `Technology and operations rationalization (${(BANK_TECH_PCT * 100).toFixed(0)}%) driven by core systems consolidation.`,
                niePct !== null
                  ? `Year 1 savings represent ${niePct}% of combined non-interest expense — within typical bank merger benchmarks.`
                  : 'Synergy assumptions to be validated during integration planning.',
                `Full synergy realization expected by Year 3 post-close.`,
              ] : [
                `Total identified synergies of ${fmtMoney(y1)} in Year 1, ramping to ${fmtMoney(y3)} by Year 3.`,
                `Cost synergies (${(COST_PCT * 100).toFixed(0)}% of total) driven by headcount rationalization, facility consolidation, and procurement.`,
                `Revenue synergies (${(REV_PCT * 100).toFixed(0)}% of total) driven by cross-sell and new market access.`,
                synPct !== null
                  ? `Year 1 synergies represent ${synPct}% of combined entity revenue — within typical M&A benchmarks.`
                  : 'Synergy assumptions to be validated during due diligence.',
                `Full synergy realization expected by Year 3 post-close.`,
              ]).map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: '#0070D2', fontSize: 14, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>•</span>
                  <span style={{ fontSize: 11, color: '#374151', lineHeight: 1.5 }}>{line}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: '#DCFCE7', border: '1px solid #BBF7D0', borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#166534', marginBottom: 4 }}>3-Year Summary</div>
            <div style={{ fontSize: 11, color: '#15803D' }}>
              Y1: <strong>{fmtMoney(y1)}</strong><br />
              Y2: <strong>{fmtMoney(y2)}</strong><br />
              Y3: <strong>{fmtMoney(y3)}</strong><br />
              Cumulative: <strong>{fmtMoney(y1 + y2 + y3)}</strong>
            </div>
          </div>
        </div>
      </div>
      {sourceLine && (
        <div style={{ padding: '0 20px 14px', fontSize: 9, color: '#9CA3AF', fontStyle: 'italic', lineHeight: 1.4 }}>
          {sourceLine}
        </div>
      )}
    </PageFrame>
  );
}
