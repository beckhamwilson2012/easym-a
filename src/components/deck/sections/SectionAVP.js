import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, GRAY_BORDER, ALT_ROW, fmtMoney, fmtPerShare, fmtPct, fmtMult, generatePriceSeries } from '../shared/deckTokens';
import { ExplainButton } from '../../shared/ExplainButton';
import { explainEvEbitda, explainPeRatio } from '../../../lib/explanations';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { composeSourceLine } from '../../../lib/composeSourceLine';

const USED_FIELDS = ['revenue', 'netIncome', 'sharesOutstanding', 'offerPrice', 'purchasePremium', 'cashPercent'];

export function SectionAVP({ target, deal, pageNum }) {
  const { data: verifiedData } = useVerifiedData(target?.ticker ?? null);
  const sourceLine = composeSourceLine(USED_FIELDS, verifiedData?.fields, verifiedData?.asOf);
  const offerPrice  = parseFloat(deal.offerPrice) || 0;
  const priceSeries = generatePriceSeries(target, deal);

  // When the target's EBITDA is <= 0, an EV/EBITDA matrix is degenerate (EV→0, every multiple shows
  // the same nonsense price). Fall back to an EV/Revenue matrix (valid for unprofitable targets, as
  // the reference deck does for Atlassian). Same root cause as the FCF guard — negative denominator.
  const targetEbitda = parseFloat(target.ebitda) || 0;
  const useEvRev = targetEbitda <= 0;
  const evRevMults = [2, 3, 4, 5, 6];
  const evRevSeries = (() => {
    const revenue = parseFloat(target.revenue) || 0;
    const debt = parseFloat(target.debt) || 0;
    const cash = parseFloat(target.cash) || 0;
    const shares = parseFloat(target.shares) || 0;
    return evRevMults.map(mult => {
      const ev = revenue * mult;
      const price = shares > 0 ? (ev - debt + cash) / shares : 0;
      const diff = offerPrice > 0 && price > 0 ? ((offerPrice - price) / price) * 100 : null;
      return { multiple: mult, ev, price: Math.max(price, 0), diffPct: diff };
    });
  })();
  const matrixSeries = useEvRev ? evRevSeries : priceSeries;
  const matrixLabel  = useEvRev ? 'EV / Revenue' : 'EV / EBITDA';

  // Find closest row to actual offer
  const closestIdx = matrixSeries.reduce((bestI, row, i) => {
    const bestDiff = Math.abs(matrixSeries[bestI].price - offerPrice);
    return Math.abs(row.price - offerPrice) < bestDiff ? i : bestI;
  }, 0);

  // P/E series
  const eps    = parseFloat(target.eps)    || 0;
  const peMults = [15, 18, 22, 25, 30];
  const peSeries = peMults.map(m => ({
    multiple: m,
    price: eps * m,
    isClosest: false,
  }));
  const peClosestIdx = peSeries.reduce((best, row, i) =>
    Math.abs(row.price - offerPrice) < Math.abs(peSeries[best].price - offerPrice) ? i : best
  , 0);

  // Commentary
  const evMultiple = deal.evEBITDA !== 'N/A' ? parseFloat(deal.evEBITDA) : null;
  const peRatio    = deal.peRatio  !== 'N/A' ? parseFloat(deal.peRatio)  : null;

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Exhibit C">
      <PageHeader
        title={`Valuation Analysis — ${target.name || 'N/A'}`}
        subtitle={`Analysis at Various Prices (AVP) — ${matrixLabel}${useEvRev ? '' : ' and P/E'} Implied Values vs. Offer`}
      />

      <div style={{ display: 'flex', gap: 20, padding: '16px 20px 36px' }}>
        {/* Left: AVP tables */}
        <div style={{ flex: 1 }}>
          {/* EV/EBITDA table */}
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
            {matrixLabel} — Implied Price Per Share
            {!useEvRev && <ExplainButton explain={() => explainEvEbitda({ ev: deal.totalPrice + (target.debt || 0) - (target.cash || 0), ebitda: target.ebitda, multiple: deal.evEBITDA })} />}
            {useEvRev && <span style={{ fontSize: 9, fontWeight: 400, color: '#9CA3AF', textTransform: 'none' }}>(EV/EBITDA not meaningful — target EBITDA ≤ 0)</span>}
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: NAVY, display: 'flex', padding: '5px 10px' }}>
              {[matrixLabel, 'Implied EV', 'Impl. Price/Sh', 'vs. Offer'].map(h => (
                <span key={h} style={{ color: '#fff', fontSize: 10, fontWeight: 700, flex: 1, textAlign: h === matrixLabel ? 'left' : 'right' }}>
                  {h}
                </span>
              ))}
            </div>
            {matrixSeries.map((row, i) => {
              const isHighlighted = i === closestIdx;
              const bg = isHighlighted ? '#FEF3C7' : i % 2 === 0 ? '#fff' : ALT_ROW;
              const vs = offerPrice > 0 && row.price > 0
                ? fmtPct((offerPrice - row.price) / row.price * 100) : 'N/A';
              return (
                <div key={i} style={{ display: 'flex', padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}` }}>
                  <span style={{ flex: 1, fontSize: 11, fontWeight: isHighlighted ? 700 : 400, color: isHighlighted ? '#92400E' : '#374151' }}>
                    {row.multiple}x {isHighlighted && '◄'}
                  </span>
                  <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: '#374151' }}>
                    {fmtMoney(row.ev)}
                  </span>
                  <span style={{ flex: 1, fontSize: 11, textAlign: 'right', fontWeight: isHighlighted ? 700 : 500, color: isHighlighted ? '#92400E' : NAVY }}>
                    {fmtPerShare(row.price)}
                  </span>
                  <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: parseFloat(vs) > 0 ? '#16A34A' : '#DC2626' }}>
                    {vs !== 'N/A' && parseFloat(vs) > 0 ? '+' : ''}{vs}
                  </span>
                </div>
              );
            })}
            <div style={{ background: '#EFF6FF', padding: '5px 10px', display: 'flex', borderTop: `2px solid #0070D2` }}>
              <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: NAVY }}>Offer Price</span>
              <span style={{ flex: 1 }} />
              <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: NAVY, textAlign: 'right' }}>
                {fmtPerShare(offerPrice)}
              </span>
              <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: NAVY, textAlign: 'right' }}>
                {fmtPct(deal.purchasePremium)} prem.
              </span>
            </div>
          </div>

          {/* P/E table */}
          {eps > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
                P / E — Implied Price Per Share
                <ExplainButton explain={() => explainPeRatio({ offerPrice: deal.offerPrice, eps: target.eps, multiple: deal.peRatio })} />
              </div>
              <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ background: NAVY, display: 'flex', padding: '5px 10px' }}>
                  {['P/E Multiple', 'Impl. Price/Sh', 'vs. Offer'].map(h => (
                    <span key={h} style={{ color: '#fff', fontSize: 10, fontWeight: 700, flex: 1, textAlign: h === 'P/E Multiple' ? 'left' : 'right' }}>
                      {h}
                    </span>
                  ))}
                </div>
                {peSeries.map((row, i) => {
                  const isHighlighted = i === peClosestIdx;
                  const bg = isHighlighted ? '#FEF3C7' : i % 2 === 0 ? '#fff' : ALT_ROW;
                  const vs = offerPrice > 0 && row.price > 0
                    ? fmtPct((offerPrice - row.price) / row.price * 100) : 'N/A';
                  return (
                    <div key={i} style={{ display: 'flex', padding: '5px 10px', background: bg, borderBottom: `1px solid ${GRAY_BORDER}` }}>
                      <span style={{ flex: 1, fontSize: 11, fontWeight: isHighlighted ? 700 : 400, color: isHighlighted ? '#92400E' : '#374151' }}>
                        {row.multiple}x {isHighlighted && '◄'}
                      </span>
                      <span style={{ flex: 1, fontSize: 11, textAlign: 'right', fontWeight: isHighlighted ? 700 : 500, color: isHighlighted ? '#92400E' : NAVY }}>
                        {fmtPerShare(row.price)}
                      </span>
                      <span style={{ flex: 1, fontSize: 11, textAlign: 'right', color: parseFloat(vs) > 0 ? '#16A34A' : '#DC2626' }}>
                        {vs !== 'N/A' && parseFloat(vs) > 0 ? '+' : ''}{vs}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Right: commentary */}
        <div style={{ flex: '0 0 220px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Valuation Commentary
          </div>
          <div style={{ border: `1px solid ${GRAY_BORDER}`, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ background: NAVY, padding: '5px 10px' }}>
              <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>Key Observations</span>
            </div>
            <div style={{ padding: '10px 12px' }}>
              {[
                evMultiple !== null
                  ? `Entry EV/EBITDA of ${fmtMult(evMultiple)} implies a ${evMultiple > 12 ? 'full' : 'reasonable'} valuation versus historical M&A precedents.`
                  : 'EV/EBITDA not applicable for this company type.',
                peRatio !== null
                  ? `P/E of ${fmtMult(peRatio)} reflects ${peRatio > 25 ? 'a premium' : 'a reasonable'} earnings multiple.`
                  : 'P/E not applicable (negative EPS).',
                `Offer price of ${fmtPerShare(offerPrice)} represents a ${fmtPct(deal.purchasePremium)} premium to estimated intrinsic value.`,
                useEvRev
                  ? `EBITDA is negative, so valuation is shown on an EV/Revenue basis; the amber row is the multiple closest to the offer.`
                  : `Amber-highlighted row shows the EV/EBITDA multiple closest to the implied offer price.`,
              ].map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <span style={{ color: '#0070D2', fontSize: 14, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>•</span>
                  <span style={{ fontSize: 11, color: '#374151', lineHeight: 1.5 }}>{line}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>Offer Summary</div>
            <div style={{ fontSize: 11, color: '#78350F' }}>
              Offer Price: <strong>{fmtPerShare(offerPrice)}</strong><br />
              Premium: <strong>{fmtPct(deal.purchasePremium)}</strong><br />
              Total Value: <strong>{fmtMoney(deal.totalPrice)}</strong><br />
              EV/EBITDA: <strong>{fmtMult(evMultiple)}</strong>
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
