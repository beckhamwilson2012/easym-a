// sourceCatalog maps internal source name → human label
const SOURCE_LABELS = {
  edgar:   'SEC EDGAR (10-K/10-Q filings)',
  cnbc:    'CNBC market data',
  yahoo:   'Yahoo Finance',
  nasdaq:  'Nasdaq',
  finnhub: 'Finnhub market data',
};

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

function formatDate(isoDate) {
  // "2026-06-03" → "June 3, 2026"
  const d = new Date(isoDate + 'T12:00:00Z'); // noon UTC to avoid tz-flip
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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

    // verified: cite every source that agreed
    if (f.status === 'verified') {
      Object.keys(f.sourceMeta || {}).forEach(s => citedSources.add(s));
    } else {
      // single or flagged: cite the chosen source of truth
      if (f.chosenSource) citedSources.add(f.chosenSource);
    }

    // Track newest as-of among market-data fields for the "as of" date clause
    const meta = f.sourceMeta?.[f.chosenSource];
    if (meta?.asOf && (!newestAsOf || meta.asOf > newestAsOf)) newestAsOf = meta.asOf;
  }

  // Stable citation order: EDGAR first (fundamental), then market-data sources.
  const ORDER = ['edgar', 'cnbc', 'yahoo', 'nasdaq', 'finnhub'];
  const MARKET_SOURCES = ['cnbc', 'yahoo', 'nasdaq', 'finnhub'];
  const labels = ORDER.filter(s => citedSources.has(s)).map(s => SOURCE_LABELS[s]);

  const parts = [];
  if (labels.length) parts.push('Source: ' + joinList(labels) + '.');
  if (hasAssumption)  parts.push('Deal terms and projections per transaction assumptions.');
  const asOf = newestAsOf || (asOfISO ? asOfISO.substring(0, 10) : null);
  if (asOf && MARKET_SOURCES.some(s => citedSources.has(s))) {
    parts.push('Market data as of ' + formatDate(asOf) + '.');
  }

  return parts.join(' ');
}
