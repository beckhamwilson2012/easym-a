// ─────────────────────────────────────────────────────────────────────────────
// Net debt / Enterprise value — ONE definition of the cash bucket for the whole deck.
//
// Convention (b): cash bucket = cash & equivalents + SHORT-TERM marketable securities.
// This reproduces GOOGL's own 10-K subtotal "cash, cash equivalents, and marketable securities"
// (30,708 + 96,135 = 126,843) and standard tech-comp practice. Cash-&-equivalents-only (the old
// convention) published "net debt $18.4B" against a filing that shows net CASH — a contradiction of
// the source, which is the defect this fixes.
//
// NON-MARKETABLE equity (EquitySecuritiesWithoutReadilyDeterminableFairValue — GOOGL's Anthropic-class
// stakes, AMZN's Rivian-class) is illiquid and is NEVER netted. Long-term marketable securities are also
// out (none of the current comp set reports a long-term marketable line, so (b) == (c)).
//
// `sti` absent/null → the company degrades to cash-only for that row; `stiUsed:false` flags it so a
// mixed row is inspectable, never silent (e.g. WMT has $0 short-term marketable; eBay tags only a
// TOTAL AvailableForSaleSecuritiesDebtSecurities with no clean current line → cash-only + flag).
//
// Every net-debt / EV site in the deck calls THIS module — do not reimplement `debt - cash` locally.
// ─────────────────────────────────────────────────────────────────────────────

// The cash bucket used everywhere: cash & equivalents + short-term marketable securities.
export function cashBucket(cash, sti) {
  if (cash == null) return { value: null, stiUsed: false };
  const s = (sti != null && !Number.isNaN(sti)) ? sti : 0;
  return { value: cash + s, stiUsed: (sti != null && !Number.isNaN(sti)) };
}

// Net cash/(debt): positive = net DEBT, negative = net CASH. Null-aware (a stale-rejected leg → null EV).
export function netCashDebt(debt, cash, sti) {
  if (debt == null || cash == null) return null;
  return debt - cashBucket(cash, sti).value;
}

// Claims ahead of common equity that enterprise value adds (Fix 10 Task 5): noncontrolling interest and preferred stock,
// each only when the filing tags it (/quote noncontrollingInterest / preferredStock). An untagged claim adds nothing and
// is never assumed to be 0: the EV footnote says it was not tagged (evClaimsNote).
export function evClaims(claims) {
  const n = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  const nci = n(claims?.nci), pref = n(claims?.preferred);
  return (nci ?? 0) + (pref ?? 0);   // each leg is either a filed figure or absent; absent legs are named in the footnote
}

// Enterprise value = equity value + net debt + tagged claims: cap + debt − (cash + short-term marketable securities)
// + noncontrolling interest + preferred stock. `equity` is the market cap (trading EV) or the purchase price
// (transaction EV): one formula for both.
export function enterpriseValue(equity, debt, cash, sti, claims) {
  if (equity == null || debt == null || cash == null) return null;
  return equity + netCashDebt(debt, cash, sti) + evClaims(claims);
}

// One sentence for the EV footnote: which claims were added, with the tag, or that none was tagged.
export function evClaimsNote(claims, who) {
  const w = who ? `${who}: ` : '';
  if (claims?.reason) return `${w}${claims.reason}.`;
  const fmt = (v) => `$${Math.round(Number(v)).toLocaleString('en-US')}M`;
  const parts = [];
  if (claims?.nci != null) parts.push(`noncontrolling interest ${fmt(claims.nci)} (${claims.nciTag || 'tagged'})`);
  if (claims?.preferred != null) parts.push(`preferred stock ${fmt(claims.preferred)} (${claims.preferredTag || 'tagged'})`);
  if (!parts.length) return `${w}no noncontrolling interest or preferred tagged.`;
  const missing = [claims?.nci == null && 'no noncontrolling interest tagged', claims?.preferred == null && 'no preferred tagged'].filter(Boolean);
  return `${w}EV adds ${parts.join(' and ')}${missing.length ? `; ${missing.join(', ')}` : ''}.`;
}

// The same sentence for several companies (Comparables): tickers with nothing tagged are grouped.
export function evClaimsFootnote(list) {
  const none = [], some = [];
  (list || []).forEach(({ ticker, claims }) => {
    if (claims && (claims.reason || claims.nci != null || claims.preferred != null)) some.push(evClaimsNote(claims, ticker));
    else none.push(ticker);
  });
  return [some.join(' '), none.length ? `Enterprise value: no noncontrolling interest or preferred tagged for ${none.join(', ')}.` : ''].filter(Boolean).join(' ');
}

// The claims of one company, from /quote fields or deal inputs (company<P>Nci …), for the helpers above.
export const claimsOf = (o) => (o ? { nci: o.noncontrollingInterest ?? null, nciTag: o.noncontrollingInterestTag ?? null,
  preferred: o.preferredStock ?? null, preferredTag: o.preferredStockTag ?? null, reason: o.evClaimsReason ?? null } : null);

// Convention label — sourced wording, no adjectives. Rendered wherever net debt / EV appears.
export const NET_DEBT_BASIS = 'Net cash/(debt) = total debt less cash, cash equivalents and short-term marketable securities.';
