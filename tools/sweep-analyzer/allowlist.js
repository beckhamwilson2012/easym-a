// ─────────────────────────────────────────────────────────────────────────────
// SUPPRESSION ALLOWLIST for the sweep analyzer.
//
// The cross-surface checks (items 18–21) flag "value on one surface, '—' on
// another" as a defect. But some of those asymmetries are BY DESIGN — a bank
// legitimately has no EBITDA, an airline no cost-of-revenue line, etc. A
// rendered asymmetry that MATCHES a rule below is recorded EXPECTED (absorbed),
// not flagged. Everything else flags.
//
// Keep this file readable — it is the audit trail for what the sweep chose NOT
// to flag. Order = priority (first match wins). `field` matches the check's
// field label (e.g. "gross profit (target)"); `when(ctx)` gates on the pair.
//
// NOTE: "—" (missing data) and "n/m" (a deliberate third state the app added to
// stop a false accretive/dilutive verdict on a negative base) are DIFFERENT and
// handled by the analyzer's stateOf(); n/m is never counted as missing.
// ─────────────────────────────────────────────────────────────────────────────

const RULES = [
  { id: 'bank-ebitda-ev',   field: /EBITDA|EV/i,                    when: c => c.isBank,
    reason: 'bank: EBITDA/EV suppressed by design (banks use P/TBV, CET1, efficiency ratio)' },
  { id: 'noda-ev-ebitda',   field: /EBITDA/i,                       when: c => c.noDA,
    reason: 'GOOGL/MSFT: EV/EBITDA n/m — no faked D&A (shipped intentionally)' },
  { id: 'airline-cogs',     field: /gross|cost of revenue/i,        when: c => c.isAirline,
    reason: 'airline: no COGS reported — cost-of-revenue blank by design' },
  { id: 'negbase-accretion',field: /accret/i,                       when: c => c.negBase,
    reason: 'negative/zero EPS base: accretion renders n/m by design' },
  { id: 'negequity-dcf',    field: /DCF/i,                          when: c => c.negEquity,
    reason: 'negative equity: DCF suppressed (not run on negative equity)' },
  { id: 'junefye-ltm',      field: /LTM/i,                          when: c => c.juneFYE,
    reason: 'June-FYE filer: LTM absent for one quarter each year (== annual until first post-FYE interim)' },
  { id: 'forward-opex',     field: /forward.*opex|operating expense.*forward/i, when: () => true,
    reason: 'forward OpEx removed as a basis-mixed residual (shipped intentionally)' },
];

// Compute the per-pair context the rules gate on.
function context(rec, A, B, body, negBase) {
  const tks = (rec.pair || '').split('+')[0].split('/');   // a variant pair id is "A/B+ltm-gaap" (capture.js)
  return {
    isBank:    /Bank M&A Mode|CET1|P ?\/ ?TBV/i.test(body) || tks.some(t => /^(JPM|BAC|WFC|C|GS|MS|SCHW|AXP)$/.test(t)),
    isAirline: tks.some(t => /^(DAL|ALK|UAL|AAL|LUV|JBLU)$/.test(t)) || /^451[23]$/.test(String(A.sic)) || /^451[23]$/.test(String(B.sic)),
    noDA:      tks.some(t => /^(GOOGL|GOOG|MSFT)$/.test(t)),
    negBase:   !!negBase,
    negEquity: /negative equity|DCF (is )?(suppressed|not shown|omitted)/i.test(body),
    juneFYE:   /LTM == annual|no interim period past the latest fiscal year-end/i.test(body),
  };
}

// Returns the reason string if `field` is an allowlisted suppression for this ctx, else null.
function allowlisted(field, ctx) {
  for (const r of RULES) { if (r.field.test(field) && r.when(ctx)) return r.reason; }
  return null;
}

module.exports = { RULES, context, allowlisted };
