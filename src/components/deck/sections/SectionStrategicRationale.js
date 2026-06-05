import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, GRAY_BORDER, fmtMoney, fmtPct, buildStrategicSection, isBankDeal, calcPTBV, fmtRatio } from '../shared/deckTokens';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { composeSourceLine } from '../../../lib/composeSourceLine';

// Revenue and deal fundamentals; synergies and offer are transaction assumptions.
const USED_FIELDS = ['revenue', 'netIncome', 'sharesOutstanding', 'offerPrice', 'purchasePremium', 'synergiesY1'];

function BulletCard({ title, items, accent, icon }) {
  return (
    <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ background: accent, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && <span style={{ fontSize: 12 }}>{icon}</span>}
        <span style={{ color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: 0.3 }}>{title}</span>
      </div>
      <div style={{ padding: '10px 14px', background: '#fff' }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, marginBottom: i < items.length - 1 ? 8 : 0 }}>
            <span style={{ color: accent, fontSize: 14, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>•</span>
            <span style={{ fontSize: 11, color: '#374151', lineHeight: 1.55 }}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SectionStrategicRationale({ target, acquirer, deal, pageNum }) {
  const { data: verifiedData } = useVerifiedData(target?.ticker ?? null);
  const sourceLine = composeSourceLine(USED_FIELDS, verifiedData?.fields, verifiedData?.asOf);
  const { rationale, risks } = buildStrategicSection(target, acquirer, deal);
  const a = acquirer.name || 'Acquirer';
  const b = target.name   || 'Target';
  const bankMode = isBankDeal(target, acquirer);
  const ptbv = bankMode ? calcPTBV(target) : null;

  const totalSyn = (parseFloat(deal.synergiesY1) || 0)
    + (parseFloat(deal.synergiesY2) || 0)
    + (parseFloat(deal.synergiesY3) || 0);

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit G">
      <PageHeader
        title={`Strategic Rationale — ${a} + ${b}`}
        subtitle="Transaction Overview and Strategic Fit Assessment"
      />

      <div style={{ display: 'flex', gap: 20, padding: '16px 20px 36px' }}>
        {/* Left: rationale + risks */}
        <div style={{ flex: 1 }}>
          <BulletCard
            title="Strategic Rationale"
            accent={NAVY}
            items={rationale}
          />
          <BulletCard
            title="Key Risk Considerations"
            accent="#B45309"
            items={risks}
          />
        </div>

        {/* Right: deal scorecard */}
        <div style={{ flex: '0 0 220px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Deal Scorecard
          </div>

          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: NAVY, padding: '5px 10px' }}>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Transaction Metrics</span>
            </div>
            {[
              { label: 'Verdict',      value: deal.isAccretive ? 'Accretive' : 'Dilutive', color: deal.isAccretive ? '#166534' : '#DC2626', bg: deal.isAccretive ? '#DCFCE7' : '#FEE2E2' },
              { label: 'EPS Impact',   value: `${parseFloat(deal.epsAccretion) >= 0 ? '+' : ''}${fmtPct(deal.epsAccretion)}`, color: parseFloat(deal.epsAccretion) >= 0 ? '#166534' : '#DC2626', bg: null },
              { label: 'Deal Size',    value: fmtMoney(deal.totalPrice), color: NAVY, bg: null },
              { label: 'Offer Price',  value: `$${parseFloat(deal.offerPrice || 0).toFixed(2)}`, color: NAVY, bg: null },
              { label: 'Premium',      value: fmtPct(deal.purchasePremium), color: NAVY, bg: null },
              { label: bankMode ? 'P / TBV' : 'EV/EBITDA', value: bankMode ? (ptbv != null ? fmtRatio(ptbv) : 'N/A') : (deal.evEBITDA !== 'N/A' ? `${deal.evEBITDA}x` : 'N/A'), color: NAVY, bg: null },
              { label: 'Synergies (3Y)', value: fmtMoney(totalSyn), color: '#166534', bg: null },
              { label: 'Cash / Stock', value: `${fmtPct(deal.cashPercent)} / ${fmtPct(100 - parseFloat(deal.cashPercent || 0))}`, color: NAVY, bg: null },
            ].map((row, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '5px 10px', background: row.bg || (i % 2 === 0 ? '#fff' : '#F9FAFB'),
                borderBottom: `1px solid ${GRAY_BORDER}`,
              }}>
                <span style={{ fontSize: 11, color: '#374151' }}>{row.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: row.color }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          <div style={{
            background: deal.isAccretive ? '#DCFCE7' : '#FEE2E2',
            border: `1px solid ${deal.isAccretive ? '#BBF7D0' : '#FECACA'}`,
            borderRadius: 6, padding: '10px 12px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 4 }}>Preliminary Assessment</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: deal.isAccretive ? '#166534' : '#DC2626' }}>
              {deal.isAccretive ? 'Proceed to Due Diligence' : 'Revisit Offer Structure'}
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
