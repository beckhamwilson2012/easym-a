'use strict';
// server/services/debtConcepts.js — the ONE place total debt is resolved, so the deal EV (/quote),
// the comps peers, and the §16 verification (edgarClient) all resolve identically. Fixes the finding
// that `LongTermDebt` is tagged inconsistently across filers (some report it noncurrent-only, e.g. MCD,
// dropping current maturities; COST/KO don't tag it at all and fell to a noncurrent-only concept).
//
// DEFINITION: debt-only, INCLUDING current maturities. Sum the explicit noncurrent + current long-term-
// debt tags; the aggregate `LongTermDebt` is used only as a fallback (it is unreliable as the primary).
//
// COMMERCIAL PAPER / SHORT-TERM BORROWINGS ARE NOT INCLUDED. This resolver touches only the
// LongTermDebt family + finance-lease-inclusive borrowing concepts. `CommercialPaper`,
// `ShortTermBorrowings`, `OtherShortTermBorrowings`, `NotesPayableCurrent` are deliberately OUT of
// scope — this change does NOT make total debt mean "all money owed". Do not read the new summation as
// including CP; adding it is a separate, explicit decision.
//
// `pick(conceptArray)` is supplied by the caller and returns the period-matched USD value (or null) for
// the FIRST present concept in the array — edgarClient wraps pickAtEnd; /quote passes bsPick. Both feed
// the SAME logic, so a company shows one debt figure everywhere.

// Prefer the SUM of explicit noncurrent + current portions:
//   noncurrent = LongTermDebtNoncurrent ?? LongTermDebtAndCapitalLeaseObligations
//   current    = LongTermDebtCurrent    ?? LongTermDebtAndCapitalLeaseObligationsCurrent
//   totalDebt  = noncurrent + current           when a current sibling exists
//              = LongTermDebt                    when it does not (PEP: current commingled in DebtCurrent)
// Returns { value, review, basis, components }. `review` is true only for the HD-class non-reconciling case.
function resolveTotalDebt(pick) {
  const ltdNC    = pick(['LongTermDebtNoncurrent']);
  const ltdCur   = pick(['LongTermDebtCurrent']);
  const leaseNC  = pick(['LongTermDebtAndCapitalLeaseObligations']);
  const leaseCur = pick(['LongTermDebtAndCapitalLeaseObligationsCurrent']);
  const ltd      = pick(['LongTermDebt']);

  const noncurrent = ltdNC ?? leaseNC;
  const current    = ltdCur ?? leaseCur;
  const components = { ltdNC, ltdCur, leaseNC, leaseCur, ltd };

  // HD-class REVIEW: the noncurrent portion is available ONLY under the finance-lease-inclusive concept
  // (no debt-only LongTermDebtNoncurrent) AND a debt-only aggregate `LongTermDebt` also exists AND the
  // two disagree — i.e. the lease concept bundles finance leases that LongTermDebt excludes, and the
  // tags do not reconcile (HD: lease NC+Cur 51,308 vs LongTermDebt 49,397, gap 1,911 ≠ finance leases
  // 2,963). Do NOT silently publish the lease-inclusive sum on a different basis than debt-only peers.
  // Use the debt-only LongTermDebt as the best estimate and flag it for review.
  if (ltdNC == null && leaseNC != null && ltd != null && Math.abs((leaseNC + (leaseCur || 0)) - ltd) > 1) {
    return { value: ltd, review: true, basis: 'lease-nonreconciling: LongTermDebt (debt-only) used; lease concept bundles finance leases', components };
  }

  if (noncurrent != null && current != null) {
    return { value: noncurrent + current, review: false, basis: ltdNC != null ? 'LongTermDebtNoncurrent + LongTermDebtCurrent' : 'lease NC + lease Cur', components };
  }
  if (ltd != null) {
    // current sibling untagged (PEP): the aggregate LongTermDebt already includes the current portion.
    return { value: ltd, review: false, basis: 'LongTermDebt (aggregate; current sibling untagged)', components };
  }
  if (noncurrent != null) {
    return { value: noncurrent, review: false, basis: 'noncurrent only (no current portion tagged)', components };
  }
  return { value: null, review: false, basis: 'none (caller applies convertible / line-of-credit fallbacks)', components };
}

module.exports = { resolveTotalDebt };
