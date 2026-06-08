import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER } from '../shared/deckTokens';
import { useVerifiedData } from '../../../hooks/useVerifiedData';

// ── Sources & Methodology — the closing page (§14) ─────────────────────────────
// Methodology bullets are static, but the named data providers (pricing, analyst targets) are
// derived from the runtime source tags so the page never claims a feed it didn't actually use.

const SRC_LABEL = {
  edgar: 'SEC EDGAR', cnbc: 'CNBC', nasdaq: 'Nasdaq', stockanalysis: 'StockAnalysis.com',
  yahoo: 'Yahoo Finance', fmp: 'Financial Modeling Prep', finnhub: 'Finnhub',
};
const SRC_ORDER = ['edgar', 'cnbc', 'nasdaq', 'stockanalysis', 'yahoo', 'fmp', 'finnhub'];
function labelList(set) {
  const arr = SRC_ORDER.filter(s => set.has(s)).map(s => SRC_LABEL[s] || s);
  if (arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return arr[0] + ' and ' + arr[1];
  return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
}

function SourceBlock({ label, bullets }) {
  return (
    <div style={{ marginBottom: 14, breakInside: 'avoid' }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: NAVY,
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
        borderBottom: `1px solid ${GRAY_BORDER}`, paddingBottom: 4,
      }}>
        {label}
      </div>
      <ul style={{ margin: 0, paddingLeft: 16, listStyleType: 'none' }}>
        {bullets.map((b, i) => (
          <li key={i} style={{
            position: 'relative', fontSize: 11, color: '#374151',
            lineHeight: 1.45, marginBottom: 4, paddingLeft: 2,
          }}>
            <span style={{
              position: 'absolute', left: -12, top: 1,
              color: SF_BLUE, fontWeight: 700,
            }}>
              ·
            </span>
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SectionSources({ target, acquirer, deal, pageNum }) {
  const acqName = (acquirer && acquirer.name) || 'Acquirer';
  const tgtName = (target && target.name) || 'Target';
  const acqFY   = (acquirer && acquirer.fiscalYear) || '—';
  const tgtFY   = (target && target.fiscalYear) || '—';

  // ── Runtime source provenance (Fix 4): name only the feeds actually consulted ──────────────
  const { data: tv } = useVerifiedData(target?.ticker ?? null);
  const { data: av } = useVerifiedData(acquirer?.ticker ?? null);
  const collectSources = (fieldKey) => {
    const s = new Set();
    [tv, av].forEach(v => { const f = v?.fields?.[fieldKey]; if (f?.sourceMeta) Object.keys(f.sourceMeta).forEach(x => s.add(x)); });
    return s;
  };
  const priceSrcSet   = collectSources('price');
  const analystSrcSet = collectSources('analystTargetMean');
  const priceSrcLabel = labelList(priceSrcSet) || 'keyless market-data feeds';
  const hasAnalyst    = analystSrcSet.size > 0;
  const analystSrcLabel = labelList(analystSrcSet);

  const blocks = [
    {
      label: 'Pricing & Market Data',
      bullets: [
        `Live share prices for ${acqName} and ${tgtName} are sourced from ${priceSrcLabel} (keyless, near-real-time), captured as-of the session date and cross-checked across feeds where two agree.`,
        'Market capitalization shown as "current" reflects the live price multiplied by reported shares outstanding; where a live price is unavailable it is shown as "—" or "N/A".',
        '52-week ranges and intraday quotes depend on feed availability and may be delayed or shown as illustrative where no source returns a range.',
      ],
    },
    {
      label: 'Primary Filings',
      bullets: [
        'Company fundamentals — revenue, net income, shares outstanding, cash, and total debt — are drawn from SEC EDGAR XBRL company facts (data.sec.gov). EPS is computed as net income ÷ shares outstanding on a single consistent basis across the deck.',
        'Figures reflect each company’s most recent annual report (Form 10-K for domestic filers, Form 20-F for foreign private issuers).',
        'EDGAR XBRL data is audited and free; reported values are used as-is without restatement adjustments.',
      ],
    },
    {
      label: 'Analyst Basis',
      bullets: hasAnalyst
        ? [
            `Analyst price targets (mean, high, low) and buy/hold/sell counts are fetched from ${analystSrcLabel} and cross-checked between sources where both are available.`,
            'A target is marked verified when sources agree within tolerance, or flagged when they diverge; values reflect the consensus snapshot as-of the session date.',
          ]
        : [
            'Analyst price targets were not available from the keyless data stack for this pair and are omitted rather than estimated.',
            'No broker research or paid consensus service is used.',
          ],
    },
    {
      label: 'Third-Party / Estimated Data',
      bullets: [
        'Gross profit and operating income are ESTIMATES derived from reported figures (e.g., gross profit ≈ revenue × 65%). Free cash flow is taken from SEC EDGAR cash-flow statements where reported, falling back to a net-income proxy only when not filed.',
        'Segment, geography, and employee mixes are ESTIMATES used for illustration and are not company-disclosed breakdowns.',
        'Multi-year projections (synergy ramp, pro forma trajectories) are ESTIMATES generated by the model and are not guidance.',
      ],
    },
    {
      label: 'Basis of Presentation',
      bullets: [
        'All dollar figures are in millions (USD) unless otherwise noted.',
        `Fiscal years follow each company’s own filing calendar: ${acqName} FY${acqFY} and ${tgtName} FY${tgtFY}.`,
        'Numbers are rounded for presentation; minor differences may arise from rounding.',
      ],
    },
    {
      label: 'Transaction Assumptions',
      bullets: [
        'Offer price, acquisition premium, and cash/stock consideration mix are user- or model-defined inputs.',
        'Year 1–Year 3 synergies and transaction fees are user/model assumptions, not negotiated terms.',
        'A 21% marginal tax rate and a 5% interest rate on acquisition debt are applied as standing model assumptions.',
      ],
    },
    {
      label: 'Disclaimer',
      bullets: [
        `This document is an educational illustration generated by EasyM&A to model a hypothetical combination of ${acqName} and ${tgtName}.`,
        'It is not investment advice, a recommendation, or an offer, and does not constitute a fairness opinion.',
        'All outputs should be independently verified against primary sources (SEC filings and live market data) before any decision.',
      ],
    },
  ];

  const sourceLine =
    `Sources: SEC EDGAR XBRL company facts (data.sec.gov); ${priceSrcLabel} for live pricing` +
    `${hasAnalyst ? `; ${analystSrcLabel} for analyst targets` : ''}. ` +
    'Estimated and assumption-based figures are labeled throughout. Educational use only — not investment advice.';

  return (
    <PageFrame pageNum={pageNum} exhibitLabel="Appendix I">
      <PageHeader
        title="Sources & Methodology"
        subtitle={`Data provenance and basis of presentation — ${acqName} / ${tgtName}`}
      />

      <div style={{ padding: '16px 20px 36px' }}>
        <div style={{
          columnCount: 2,
          columnGap: 28,
        }}>
          {blocks.map((blk) => (
            <SourceBlock key={blk.label} label={blk.label} bullets={blk.bullets} />
          ))}
        </div>
      </div>

      {/* source line */}
      <div style={{
        padding: '0 20px 14px', fontSize: 9, color: '#9CA3AF',
        fontStyle: 'italic', lineHeight: 1.4,
      }}>
        {sourceLine}
      </div>
    </PageFrame>
  );
}
