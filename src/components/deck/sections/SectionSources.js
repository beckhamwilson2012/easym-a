import React from 'react';
import { PageFrame } from '../shared/PageFrame';
import { PageHeader } from '../shared/PageHeader';
import { NAVY, SF_BLUE, GRAY_BORDER } from '../shared/deckTokens';
import { useVerifiedData } from '../../../hooks/useVerifiedData';
import { HEADLINE_SOURCES, formatDeckDate, forwardNetIncomeLabel } from '../../../lib/composeSourceLine';
import { NONE_ENTERED, fmtSynergy, marginSentence } from '../../../lib/synergies';
import { isNonGaapDeal, DIFFERENT_BASES } from '../../../lib/reportingBasis';

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

export function SectionSources({ target, acquirer, deal, pageNum, exhibitLabel }) {
  const acqName = (acquirer && acquirer.name) || 'Acquirer';
  const tgtName = (target && target.name) || 'Target';
  const acqFY   = (acquirer && acquirer.fiscalYear) || '—';
  const tgtFY   = (target && target.fiscalYear) || '—';

  // ── Runtime source provenance (Fix 4): name only the feeds actually consulted ──────────────
  const { data: tv } = useVerifiedData(target?.ticker ?? null);
  const { data: av } = useVerifiedData(acquirer?.ticker ?? null);
  // Only name the reliable headline feeds (CNBC/Nasdaq/EDGAR/StockAnalysis). Yahoo/Finnhub/FMP
  // rate-limit or 403, so naming them surfaces a feed non-deterministically (it appeared in the
  // MSFT/ADBE build but not CRM/TEAM). They still feed the verified/flagged status, just unnamed.
  const collectSources = (fieldKey) => {
    const s = new Set();
    [tv, av].forEach(v => { const f = v?.fields?.[fieldKey]; if (f?.sourceMeta) Object.keys(f.sourceMeta).forEach(x => { if (HEADLINE_SOURCES.has(x)) s.add(x); }); });
    return s;
  };
  // Single deck-wide DATA_DATE = actual data-pull date (spec §1.3 / Defect #1). Same source the
  // title page and per-slide footnotes use, so all "as of" dates agree.
  const dataDate = formatDeckDate(deal?._dataDate || av?.asOf || tv?.asOf || null);
  const priceSrcSet   = collectSources('price');
  const priceSrcLabel = labelList(priceSrcSet) || 'keyless market-data feeds';

  // Programmatic attribution (Pass A): name ONLY sources actually consulted for THIS deck, from the same
  // per-figure sourceMeta §16/§2/§4/§5/§12 read. collectAll includes vendor sources (FMP) that collectSources'
  // HEADLINE filter drops — safe here because the fundamentals/analyst field registries don't list the
  // non-deterministic yahoo/finnhub feeds, so their sourceMeta keys are stable. Empty → a neutral generic
  // label, never a phantom source (foreign filers with no EDGAR resolve to "Financial Modeling Prep").
  const collectAll = (fieldKeys) => {
    const s = new Set();
    [tv, av].forEach(v => fieldKeys.forEach(k => { const f = v?.fields?.[k]; if (f?.sourceMeta) Object.keys(f.sourceMeta).forEach(x => s.add(x)); }));
    return s;
  };
  const FUND_FIELDS    = ['revenue', 'grossProfit', 'operatingIncome', 'netIncome', 'epsDiluted', 'cash', 'totalDebt', 'totalAssets', 'totalStockholdersEquity', 'freeCashFlow', 'sharesOutstanding'];
  const ANALYST_FIELDS = ['analystTargetMean', 'analystTargetHigh', 'analystTargetLow'];
  const fundSrcLabel    = labelList(collectAll(FUND_FIELDS))    || 'company filings';
  const analystSrcLabel = labelList(collectAll(ANALYST_FIELDS)) || 'sell-side analyst panels';
  // Faculty: role labels (Buyer/Target), not company/ticker names. The subtitle anchors the mapping once.
  const buyerRole  = 'the Buyer';
  const targetRole = 'the Target';

  // FX Stage 3 — accurate basis-of-presentation currency statement (replaces the Pass-A "NOT converted"
  // interim caveat; values ARE now converted per Stages 1-2b). Gate on fx.converted so an all-USD deal gets
  // the plain "as filed" form — USD filers carry avgWindow:null, so the .filter() below short-circuits BEFORE
  // any avgWindow indexing (null-safe). Handles BOTH sides foreign (possibly different currencies): name each.
  const rate4 = (r) => Number(r).toFixed(4);
  const fyOf  = (win) => (win && win[0] ? win[0].slice(0, 4) : '—'); // derive FY from window, never hardcoded
  const fxSides = [
    { name: tgtName, fx: tv?.fx },
    { name: acqName, fx: av?.fx },
  ].filter((s) => s.fx?.converted);
  let currencyStatement;
  if (fxSides.length === 0) {
    currencyStatement = 'All monetary figures are presented in US dollars, in millions ($M), as filed. $B is used only on market-cap, enterprise-value and deal-value summary lines.';
  } else if (fxSides.length === 1) {
    const s = fxSides[0];
    currencyStatement = `All monetary figures are presented in US dollars, in millions ($M). Domestic filers report in USD and are shown as filed. Where a company reports in another currency — here ${s.name}, reported in ${s.fx.reportedCurrency} — figures are converted to USD: income-statement and cash-flow items at the fiscal-year average rate (FY${fyOf(s.fx.avgWindow)} average ${s.fx.reportedCurrency}→USD ${rate4(s.fx.avgRate)}) and balance-sheet items at the spot rate on the data date (${rate4(s.fx.spotRate)}). Share counts, and any figure already in USD (e.g. an ADR market price), are not converted. $B is used only on market-cap, enterprise-value and deal-value summary lines.`;
  } else {
    // Both sides foreign — possibly DIFFERENT currencies; name each with its own rates rather than assume one.
    const clause = fxSides.map((s) => `${s.name} (${s.fx.reportedCurrency}, FY${fyOf(s.fx.avgWindow)} average ${rate4(s.fx.avgRate)}, spot ${rate4(s.fx.spotRate)})`).join(' and ');
    currencyStatement = `All monetary figures are presented in US dollars, in millions ($M). Domestic filers report in USD and are shown as filed. Companies reporting in another currency — here ${clause} — are converted to USD: income-statement and cash-flow items at the fiscal-year average rate and balance-sheet items at the spot rate on the data date. Share counts, and any figure already in USD (e.g. an ADR market price), are not converted. $B is used only on market-cap, enterprise-value and deal-value summary lines.`;
  }

  const blocks = [
    {
      label: 'Pricing & Market Data',
      bullets: [
        `Live share prices and 52-week trading ranges for ${buyerRole} and ${targetRole} are sourced from ${priceSrcLabel} (keyless, near-real-time), captured as of ${dataDate || 'the session date'} and cross-checked across feeds where two agree.`,
        'Equity value (market capitalization) shown as "current" reflects the live price multiplied by reported shares outstanding; where a live price is unavailable it is shown as "—" or "N/A".',
        'Intraday quotes and 52-week extremes depend on feed availability; where no source returns a range, an illustrative range built from monthly closes is labeled as such.',
      ],
    },
    {
      label: 'Company Fundamentals — Primary Filings',
      bullets: [
        `Company fundamentals — revenue, gross profit, net income, shares outstanding, cash, total debt, and free cash flow — are drawn from ${fundSrcLabel}: SEC EDGAR XBRL company facts (data.sec.gov) for domestic filers, with a period-matched Financial Modeling Prep value where a filer is a foreign private issuer or discontinues a concept. All are period-matched to each company’s fiscal year. EPS is the reported diluted EPS; net income ÷ weighted-average diluted shares is a labeled fallback only where a filer does not report diluted EPS.`,
        'Figures reflect each company’s most recent annual report (Form 10-K for domestic filers, Form 20-F for foreign private issuers) and are used as-is, without restatement adjustments.',
        'Where a filer discontinues or freezes an XBRL concept (e.g. a gross-profit or long-term-debt tag), a period-matched Financial Modeling Prep value is substituted as a labeled fallback rather than carrying a stale figure.',
      ],
    },
    {
      label: 'Analyst Estimates & Price Targets',
      bullets: [
        'Forward revenue and EPS consensus — the FY-ahead estimate columns and the pro forma projections — are from Financial Modeling Prep analyst estimates: single-source, point-in-time, not guidance.',
        'Per-firm price targets are from Financial Modeling Prep (price-target news and grades): the latest target per broker is kept, targets whose most recent call is over 18 months old are dropped, and statistical outliers (over 3× or under one-third of the panel median) are removed. Buy / hold / sell reflects the latest grade per firm.',
        `An independent consensus cross-check (mean / high / low) draws on ${analystSrcLabel} where available. Price targets are sell-side FORECASTS, not guarantees.`,
      ],
    },
    {
      label: 'Valuation Methodologies',
      bullets: [
        'The analyst price-target range and the 52-week trading range supply market reference points. Precedent-transaction multiples are omitted deck-wide — no sourceable comparable public-deal set is available on the current data stack.',
      ],
    },
    {
      label: 'Company & Descriptive Data',
      bullets: [
        'Company descriptions, CEO, headquarters, employee counts, IPO date, sector / industry classification, beta, average trading volume, and company logos are from the Financial Modeling Prep company profile.',
        'Segment, geography, and customer-mix figures, where shown, are illustrative and are not company-disclosed breakdowns.',
        'The pro-forma forward columns use sell-side ANALYST CONSENSUS estimates (via Financial Modeling Prep) for forward revenue and EPS — these are analyst forecasts, not the app’s own model. The accretion, synergy and combination MATH applied on top of those inputs IS the app’s model. Multi-year synergies are entered assumptions, not guidance; forward operating expense is shown as "—" rather than estimated.',
      ],
    },
    {
      label: 'Basis of Presentation',
      bullets: [
        currencyStatement,
        ...((acquirer?.basisLabel && target?.basisLabel) ? [`Company basis selected for this deck: ${acquirer.ticker || acqName} ${acquirer.basisLabel}; ${target.ticker || tgtName} ${target.basisLabel}. It drives the standalone commentary, Year-1 accretion, combined figures and relative contribution. Forward growth is always against fiscal-year figures, never LTM.${deal?.combination?.note ? ` Note: ${deal.combination.note}.` : ''}`] : []),
        'Period basis: the screening comparables (Public Company Screen) and the company-profile financial snapshot are computed on a last-twelve-months (LTM) basis — latest annual plus the most recent interim year-to-date, less the prior-year interim — the standard banker screening convention; the pro-forma and accretion model is built on latest-fiscal-year actuals plus forward analyst consensus (a normalized forward basis). This split is deliberate, not an inconsistency. Foreign private issuers without SEC interim (10-Q) filings, and any filer whose interim data does not tie out, are shown on a fiscal-year basis and labeled "FY".',
        'Calendarization: where the two companies have different fiscal year-ends, the LTM screening basis is used specifically because it aligns their measurement windows to within approximately one month — materially reducing the fiscal-year-end offset that a same-labeled "FY" comparison would carry. Full calendar-year restatement is deliberately NOT applied: it would require estimating unfiled interim quarters (interpolation of periods no filer reports), and the residual period difference on the LTM basis is immaterial (under ~2% of the affected figures). The pro-forma / accretion model, being built on latest-fiscal-year actuals + forward consensus, pairs each company’s own latest fiscal year (relative years, not a common calendar period) — stated on that slide.',
        'Enterprise value (EV) = equity value (market capitalization) + total debt − cash & marketable securities, taken from the same filing; figures for companies with active share-repurchase programs are approximate.',
        ...(isNonGaapDeal(deal) ? nonGaapSourceBullets(deal.reportingBasis, acquirer, target) : [
        'Profitability on the standalone P&L and comparative-profile slides — operating income, net income, diluted EPS, and operating/net margins — is shown on a Non-GAAP basis as reported in each company’s fiscal year-end earnings release (Form 8-K, Item 2.02), period-matched to the fiscal year shown and reconciled to GAAP; each line is labeled, and falls back to a GAAP-labeled figure where a reconciled non-GAAP value was unavailable. Gross profit, gross margin and operating expenses remain GAAP; EBITDA and its margins are computed (operating income + D&A); revenue and share counts are basis-neutral.',
        'The accretion, pro forma and relative-contribution views are built on each company’s reported GAAP figures and are labeled accordingly.',
        ]),
        ...(deal?.hasMarketData === false ? [] : [`Forward pro forma EPS: ${forwardNetIncomeLabel(deal?._inputs)}.`]),
        `Fiscal years follow each company’s own filing calendar: ${buyerRole} FY${acqFY}, ${targetRole} FY${tgtFY}.`,
        'Numbers are rounded for presentation; minor differences may arise from rounding.',
      ],
    },
    {
      label: 'Transaction Assumptions',
      bullets: [
        'Offer price, acquisition premium, and cash/stock consideration mix are user- or model-defined inputs.',
        'Year 1–Year 3 synergies are entered assumptions, not negotiated terms. An empty line assumes no synergy. Preset percentages on the input page are app defaults, editable, and are not market figures.',
        ...(deal?.synergies ? [
          `Cost synergies: ${deal.synergies.years.map((y) => `Year ${y.year} ${fmtSynergy(y.cost)}`).join(', ')}. They add to EBITDA dollar for dollar.`,
          `Revenue synergies: ${deal.synergies.years.map((y) => `Year ${y.year} ${fmtSynergy(y.revenue)}`).join(', ')}. They add to pro forma revenue${deal.synergies.anyRevenue ? (deal.synergies.revenueOnly ? `, and not to EBITDA. ${marginSentence(deal.synergies.margin)}` : `, and to EBITDA at the combined gross margin. ${marginSentence(deal.synergies.margin)}`) : ', and to EBITDA at the combined gross margin from filed figures.'}`,
          `Total synergies (EBITDA impact): ${deal.synergies.years.map((y) => `Year ${y.year} ${y.entered ? fmtSynergy(y.ebitda) : NONE_ENTERED}`).join(', ')}.`,
        ] : []),
        'A 21% marginal tax rate and a 5% interest rate on acquisition debt are applied as standing model assumptions.',
      ],
    },
    {
      label: 'Disclaimer',
      bullets: [
        `This document is an educational illustration generated by EasyM&A to model a hypothetical combination of ${buyerRole} and ${targetRole}.`,
        'It is NOT investment, financial, legal, or tax advice, NOT a recommendation or solicitation, and NOT an offer to buy or sell any security. It does not constitute a fairness opinion and MUST NOT be relied upon for any investment, purchase, sale, or other financial decision.',
        `All outputs are hypothetical and must be independently verified against primary sources (SEC filings and live market data) before any decision. Market data as of ${dataDate || 'the session date'}; subject to change.`,
      ],
    },
  ];

  const sourceLine =
    `Sources: ${fundSrcLabel} for company fundamentals; ${priceSrcLabel} for live pricing; ${analystSrcLabel} for the consensus price-target cross-check; ` +
    'Financial Modeling Prep for per-firm price targets, forward analyst estimates, and company profiles. ' +
    'Estimated and assumption-based figures are labeled throughout. Educational use only — not investment advice.';

  return (
    <PageFrame pageNum={pageNum} exhibitLabel={exhibitLabel}>
      <PageHeader
        title="Sources & Methodology"
        subtitle={`Data provenance and basis of presentation · Buyer: ${acqName} · Target: ${tgtName}`}
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

// Basis-of-presentation bullets on a Non-GAAP deal (src/lib/reportingBasis.js plan): which figures are company
// reported, from which 8-K, and which stay GAAP or computed. A GAAP deal keeps the bullets above unchanged.
function nonGaapSourceBullets(plan, acquirer, target) {
  const tk = (c, fb) => c?.ticker || c?.name || fb;
  const A = tk(acquirer, 'the acquirer'), B = tk(target, 'the target');
  const out = [];
  if (plan.eps.nonGaap) {
    out.push(`Reporting basis selected: Non-GAAP. Net income, diluted EPS, pro forma EPS, accretion and the verdict use company-reported non-GAAP figures for both companies: ${A} “${plan.eps.A.rowLabel}” (${plan.eps.A.label}); ${B} “${plan.eps.B.rowLabel}” (${plan.eps.B.label}). Each was read from the reconciliation table in the company’s fiscal-year earnings release and ties to GAAP there (GAAP + each filed adjustment = the non-GAAP total).`);
  } else {
    out.push(`Reporting basis selected: Non-GAAP. EPS, pro forma EPS, accretion and the verdict stay on GAAP for both companies: ${plan.eps.note}.`);
  }
  const eb = (e, t) => (e.nonGaap
    ? (e.value == null ? `${t}: ${e.name} — (non-GAAP available for fiscal year only)` : `${t}: ${e.name} (${e.label}), tied to GAAP net income in the filed reconciliation table`)
    : `${t}: computed (operating income + D&A; ${t} reports no adjusted EBITDA)`);
  out.push(`EBITDA by company — ${eb(plan.ebitda.A, A)}; ${eb(plan.ebitda.B, B)}. ${plan.ebitda.combinable ? `Combined EBITDA adds the two on one basis (${plan.ebitda.A.nonGaap ? 'non-GAAP' : 'computed'}).` : `Combined EBITDA and the leverage ratios on it are “—”: ${DIFFERENT_BASES}.`}`);
  out.push('Operating income, gross profit, operating expenses and their margins are GAAP. The comparables and screening views use GAAP and computed figures for every company, including these two, because the peers carry no company-reported figures in this deck.');
  out.push('Forward years are FMP analyst consensus. FMP does not designate a basis for it; it is not combined with Year-1 figures in one growth or accretion figure, and each forward row is labeled consensus.');
  return out;
}
