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

// Enterprise value = market cap + net debt (cap + debt − (cash + short-term marketable securities)).
export function enterpriseValue(mcap, debt, cash, sti) {
  if (mcap == null || debt == null || cash == null) return null;
  return mcap + netCashDebt(debt, cash, sti);
}

// Convention label — sourced wording, no adjectives. Rendered wherever net debt / EV appears.
export const NET_DEBT_BASIS = 'Net cash/(debt) = total debt less cash, cash equivalents and short-term marketable securities.';
