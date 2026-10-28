// ─────────────────────────────────────────────────────────────────────────────
// Certainty-of-close tests for the Executive Summary.
//
// Every test returns one of THREE states — 'met' | 'not-met' | 'unknown' — never a boolean. A
// boolean cannot distinguish "the test does not trip" from "we do not have the inputs to evaluate
// it", and collapsing those two is the Pattern B defect the deck exists to avoid: a null share
// count must read "—", never "not triggered". Callers render `unknown` as "—" plus the reason.
// ─────────────────────────────────────────────────────────────────────────────

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

export const UNKNOWN = 'unknown';
export const MET     = 'met';
export const NOT_MET = 'not-met';

const unknown = (reason) => ({ state: UNKNOWN, reason });
const decide  = (cond, reason) => ({ state: cond ? MET : NOT_MET, reason });

// ── Stock-issuance thresholds (exchange listing rules) ───────────────────────
// Issuance % of acquirer PRE-DEAL shares. Thresholds live in premiumThresholds.js
// (ISSUANCE_VOTE_THRESHOLD 19.9 / ISSUANCE_MAJORITY_THRESHOLD 50) — not duplicated here.
//
// The percentage is built from the deck's OWN centralized share figures (deckModel's newShares and
// preDealShares) rather than re-derived from deal size ÷ price, so the Executive Summary can never
// disagree with the ownership split rendered elsewhere. newShares is deckModel's full-precision
// recompute; preDealShares is the EDGAR point-in-time count from the server share resolver (for CRM
// that is the 10-K's 929M — not the ~950M vendor figure and not the 956M weighted-average diluted
// count, which is the EPS basis only).
export function issuancePct({ newShares, preDealShares }) {
  const n = num(newShares), p = num(preDealShares);
  if (n == null || p == null || !(p > 0)) return null;   // null-honest: unknown, not zero
  return (n / p) * 100;
}

// Acquirer shareholder vote — NYSE Listed Company Manual §312.03 / Nasdaq Rule 5635.
export function acquirerVoteTest(pct, voteThreshold) {
  if (pct == null) return unknown('Acquirer share count or share price unavailable');
  return decide(pct >= voteThreshold, `Stock issuance ${pct.toFixed(1)}% of pre-deal shares`);
}

// Majority-stock structure — heightened board / rating-agency scrutiny.
export function majorityStockTest(pct, majorityThreshold) {
  if (pct == null) return unknown('Acquirer share count or share price unavailable');
  return decide(pct >= majorityThreshold, `Stock issuance ${pct.toFixed(1)}% of pre-deal shares`);
}

// ── HSR size-of-transaction ──────────────────────────────────────────────────
// DELIBERATELY UNSET. The Hart-Scott-Rodino size-of-transaction threshold is revised by the FTC
// every year (the revision is published in the Federal Register and takes effect ~30 days later),
// so any value committed here goes stale on a known schedule and a wrong one is worse than none.
// It is therefore NOT hardcoded from memory: set it from the FTC's current annual notice, together
// with the effective date it came from, and the test starts evaluating. Until then the test returns
// `unknown` and the slide renders "—" — never a guessed threshold and never an assumed outcome.
//
//   export const HSR_SIZE_OF_TRANSACTION_USD_M = 126.4;        // e.g.
//   export const HSR_THRESHOLD_EFFECTIVE       = '2025-02-21'; // cite the notice's effective date
export const HSR_SIZE_OF_TRANSACTION_USD_M = null;
export const HSR_THRESHOLD_EFFECTIVE       = null;

// The test is on the value of VOTING SECURITIES acquired — i.e. the deal's EQUITY value (offer ×
// target shares, which the deck carries as totalConsideration / totalPurchasePrice), NOT enterprise
// value. Passing EV here would overstate the tested amount by the target's net debt.
export function hsrSizeOfTransactionTest(equityValueUsdM, threshold = HSR_SIZE_OF_TRANSACTION_USD_M) {
  const v = num(equityValueUsdM), t = num(threshold);
  if (t == null) return unknown('HSR threshold not configured — set HSR_SIZE_OF_TRANSACTION_USD_M');
  if (v == null) return unknown('Deal equity value unavailable');
  return decide(v >= t, `Equity value vs $${t.toFixed(1)}M threshold`);
}

// ── Horizontal overlap ───────────────────────────────────────────────────────
// Same SIC code on both sides is the strongest overlap signal the deck actually fetches. It is a
// FLAG, not a conclusion: SIC is a filing-level industry classification, not a product-market
// definition, so this states the classification match and nothing about antitrust outcome.
export function sameSicTest(sicA, sicB) {
  if (!sicA || !sicB) return unknown('SIC code not available for both companies');
  return decide(String(sicA) === String(sicB), `SIC ${sicA} vs ${sicB}`);
}

// ── Acquisition financing ────────────────────────────────────────────────────
// New debt raised for the cash consideration (dealCalc's sources.newDebt). A financing requirement
// is a real certainty-of-close factor; zero new debt means the deal funds from cash and stock.
export function financingTest(newDebtUsdM) {
  const v = num(newDebtUsdM);
  if (v == null) return unknown('Acquisition financing not derivable');
  return decide(v > 0, v > 0 ? 'New acquisition debt required' : 'No new debt required');
}
