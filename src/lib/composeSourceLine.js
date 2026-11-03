// sourceCatalog maps internal source name → human label
const SOURCE_LABELS = {
  edgar:        'SEC EDGAR (10-K/10-Q filings)',
  cnbc:         'CNBC market data',
  yahoo:        'Yahoo Finance',
  nasdaq:       'Nasdaq',
  stockanalysis:'StockAnalysis.com',
  finnhub:      'Finnhub market data',
};

// Sources we NAME in prose/citations. CNBC (price SOT), Nasdaq (price + analyst), SEC EDGAR
// (fundamentals), and StockAnalysis (analyst cross-check) are the reliable keyless stack and are
// always either the chosen source or a deterministic cross-check. Yahoo / Finnhub / FMP rate-limit or
// 403, so they appear only opportunistically — naming them makes the same deck cite different sources
// run-to-run. They still participate in reconcile (verified/flagged status) but are not surfaced by
// name. Exported so SectionSources and the verification appendix apply the same allowlist.
export const HEADLINE_SOURCES = new Set(['edgar', 'cnbc', 'nasdaq', 'stockanalysis']);

// Fields the deck treats as always-assumption regardless of fetch status.
// These are user-entered deal inputs, never fetched from an external source.
export const ASSUMPTION_FIELDS = new Set([
  'offerPrice', 'premium', 'purchasePremium',
  'synergiesY1', 'synergiesY2', 'synergiesY3',
  'cashPercent', 'financingMix',
  'dcfRange', 'precedentRange', 'footballRange',
  'transactionFees',
]);

function joinList(arr) {
  if (arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return arr[0] + ' and ' + arr[1];
  return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
}

// Single tz-safe date formatter for the WHOLE deck. Accepts a full ISO timestamp or a date string;
// anchors to noon UTC on the DATE portion so the rendered day never flips with the viewer's timezone.
// Exported so §15 (verification appendix) and §12 (analyst) format the build date identically — one
// formatter, no day-level skew between slides (Fix B). "2026-06-03..." → "June 3, 2026".
export function formatDeckDate(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).substring(0, 10) + 'T12:00:00Z'); // date portion, noon UTC → no tz-flip
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
const formatDate = formatDeckDate;

// The one wording of how forward pro forma EPS gets the acquirer's net income (SectionProFormaPL's forward
// loop), shown on the slide and on Sources. The share count is today's, so the label names its period.
export function forwardNetIncomeLabel(inputs) {
  const p = inputs?.companyADilutedSharesPeriod;
  const date = formatDeckDate(p?.end);
  const period = date
    ? `${p.basis}, ${p.basis === 'cover page' ? 'as of' : 'fiscal year ended'} ${date}`
    : 'period not available';
  return `Acquirer net income = consensus EPS × current diluted shares (${period})`;
}

/**
 * Compose a slide source line from the list of fields that slide uses.
 *
 * @param {string[]} usedFieldKeys  - Fields the slide actually shows
 * @param {object}   fields         - The `fields` object from /api/verified/:ticker
 * @param {string}   [asOfISO]      - ISO date string (e.g. "2026-06-03") for the "as of" clause
 * @returns {string}
 */
export function composeSourceLine(usedFieldKeys, fields, asOfISO) {
  const citedSources = new Set();
  let hasAssumption  = false;
  let newestAsOf     = null;

  for (const key of usedFieldKeys) {
    // Deal inputs are always assumptions — never cite a data source for them
    if (ASSUMPTION_FIELDS.has(key)) { hasAssumption = true; continue; }

    const f = fields?.[key];

    // Missing on the free stack (e.g. analyst targets, marketCap) → counts as assumption
    if (!f || f.status === 'missing') { hasAssumption = true; continue; }

    // verified: cite every HEADLINE source that agreed (non-headline feeds like Yahoo/Finnhub still
    // count toward the verified status in reconcile, but are not named here — see HEADLINE_SOURCES).
    if (f.status === 'verified') {
      Object.keys(f.sourceMeta || {}).forEach(s => { if (HEADLINE_SOURCES.has(s)) citedSources.add(s); });
      if (f.chosenSource && HEADLINE_SOURCES.has(f.chosenSource)) citedSources.add(f.chosenSource);
    } else {
      // single or flagged: cite the chosen source of truth (always a headline source on this stack)
      if (f.chosenSource && HEADLINE_SOURCES.has(f.chosenSource)) citedSources.add(f.chosenSource);
    }

    // Track newest as-of among market-data fields for the "as of" date clause
    const meta = f.sourceMeta?.[f.chosenSource];
    if (meta?.asOf && (!newestAsOf || meta.asOf > newestAsOf)) newestAsOf = meta.asOf;
  }

  // Stable citation order: EDGAR first (fundamental), then market-data sources.
  const ORDER = ['edgar', 'cnbc', 'yahoo', 'nasdaq', 'stockanalysis', 'finnhub'];
  const MARKET_SOURCES = ['cnbc', 'yahoo', 'nasdaq', 'stockanalysis', 'finnhub'];
  const labels = ORDER.filter(s => citedSources.has(s)).map(s => SOURCE_LABELS[s]);

  const parts = [];
  if (labels.length) parts.push('Source: ' + joinList(labels) + '.');
  if (hasAssumption)  parts.push('Deal terms and projections per transaction assumptions.');
  // Use the build/bundle timestamp (asOfISO) as the canonical "as of" date so every slide — and §15 /
  // §12, which also key off the bundle asOf — render the SAME date. Fall back to the newest field asOf
  // only when no bundle timestamp was passed (Fix B).
  const asOf = (asOfISO ? asOfISO.substring(0, 10) : null) || newestAsOf;
  if (asOf && MARKET_SOURCES.some(s => citedSources.has(s))) {
    parts.push('Market data as of ' + formatDate(asOf) + '.');
  }

  return parts.join(' ');
}
