'use strict';
// LTM (trailing-twelve-month) calculator — Stage 0, ISOLATED. Reads the quarterly (10-Q) frames that
// ALREADY sit in the EDGAR companyfacts payload but are filtered out by the annual-only paths
// (edgarClient latestAnnualEntry/pickAtEnd form+span filters, server.js pnlLineSeries). NOTHING in the
// app consumes this yet — it is additive; the annual path is untouched.
//
//   LTM(flow) = latest annual (10-K/20-F full year) + latest cumulative-YTD interim
//               − prior-year same-span cumulative-YTD interim
//   Balance sheet (debt/cash/assets/equity) = latest quarter, point-in-time (NOT summed).
//   LTM EPS = LTM net income ÷ latest interim diluted weighted-avg shares (NOT Σ quarterly EPS).
//
// A tie-out gate must pass or it returns {ltm:false, fallback:'annual', reason} — never a wrong LTM:
//   • span-match: added-YTD span ≈ subtracted-prior-YTD span (both ~90/182/273 days)
//   • TTM-window: prior-interim-end → latest-interim-end ≈ 365 days (the trailing-12 span)
//   • cumulative-anchor: latest interim STARTS at the annual FYE+1 (proves it is the YTD-from-FY-start,
//     not the 3-month) AND prior interim shares the annual's FY start (no double-counted quarter)
// EDGAR is the sole source for LTM v1 (no FMP).

const { get } = require('../utils/httpGet');

const DAY = 86400000;
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const inM  = (v) => (v != null ? Math.round(v / 1e6) : null);

// Some filers (e.g. MCD) tag weighted-average shares in MILLIONS in XBRL (val 716.4 = 716.4M) rather
// than a full count; others (CRM/TEAM/KO) tag the full count (871,000,000). A real public-company share
// count is ≥ ~1e6, so a value below that is millions-scaled → normalize to a full count (×1e6). This
// keeps LTM EPS = NI ÷ shares sane (else MCD NI 8.68e9 ÷ 713.5 → a fabricated $12M EPS).
function scaleShares(v) {
  return (v != null && v > 0 && v < 1e6) ? v * 1e6 : v;
}

// Cost-of-revenue concept lists — the SINGLE source for every "gross profit = revenue − COGS" derivation
// in the app. Three surfaces derive gross profit this way for filers that never tag GrossProfit (AMZN,
// GOOGL and 30 more): /quote's annual gross profit (server.js), /api/pnl's annual columns (PNL_GAAP/IFRS
// .cogs), and the LTM legs below. They were three identical literals; a drift in any one of them would
// have made the LTM column disagree with the annual column beside it on the same table. One list now.
const COGS_CONCEPTS = {
  gaap: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'],
  ifrs: ['CostOfSales', 'CostOfGoodsAndServicesSold'],
};

const NAMES = {
  gaap: {
    revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet',
              'RevenueFromContractWithCustomerIncludingAssessedTax', 'RevenuesNetOfInterestExpense'],
    grossProfit: ['GrossProfit'],
    costOfRevenue: COGS_CONCEPTS.gaap,
    operatingIncome: ['OperatingIncomeLoss'],
    netIncome: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
    nonOperating: ['NonoperatingIncomeExpense'],   // net non-operating income/(expense): interest, FX, securities gains — the OI→NI reconciling line
    da: ['DepreciationDepletionAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'DepreciationAndAmortization'],
    ocf: ['NetCashProvidedByUsedInOperatingActivities'],
    capex: ['PaymentsToAcquirePropertyPlantAndEquipment'],
    dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted'],
    cash: ['CashAndCashEquivalentsAtCarryingValue'],
    debt: ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations'],
    assets: ['Assets'],
    equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    sharesInstant: ['CommonStockSharesOutstanding'],
  },
  ifrs: {
    revenue: ['Revenue', 'RevenueFromContractsWithCustomers', 'RevenueAndOtherIncome'],
    grossProfit: ['GrossProfit'],
    costOfRevenue: COGS_CONCEPTS.ifrs,
    operatingIncome: ['OperatingProfitLoss', 'ProfitLossFromOperatingActivities'],
    netIncome: ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'],
    nonOperating: [],   // no clean IFRS non-operating total — renders "—" (no test ticker is IFRS)
    da: ['DepreciationAndAmortisationExpense'],
    ocf: ['CashFlowsFromUsedInOperatingActivities'],
    capex: ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
    dilutedShares: ['WeightedAverageShares'],
    cash: ['CashAndCashEquivalents'],
    debt: ['Borrowings', 'LongtermBorrowings', 'NoncurrentPortionOfLongtermBorrowings'],
    assets: ['Assets'],
    equity: ['Equity', 'EquityAttributableToOwnersOfParent'],
    sharesInstant: [],
  },
};

const isAnnualForm  = (f) => f === '10-K' || f === '20-F';
const isInterimForm = (f) => f === '10-Q';

function entriesFor(space, names, unit = 'USD') {
  for (const n of names) {
    const e = space[n]?.units?.[unit];
    if (e && e.length) return e;
  }
  return [];
}

// latest full-year (annual) entry — 10-K/20-F, span 350-380
function fullYear(entries) {
  const c = entries.filter(e => isAnnualForm(e.form) && e.start && days(e.end, e.start) >= 350 && days(e.end, e.start) <= 380);
  if (!c.length) return null;
  const latestEnd = c.reduce((m, e) => (e.end > m ? e.end : m), '');
  const at = c.filter(e => e.end === latestEnd);
  const chosen = at.reduce((a, e) => ((e.filed || '') > (a.filed || '') ? e : a), at[0]);
  return { val: chosen.val, start: chosen.start, end: chosen.end, span: days(chosen.end, chosen.start), form: chosen.form, filed: chosen.filed };
}

// latest CUMULATIVE-YTD interim: the most-recent interim end, and at that end the LONGEST span
// (= YTD from fiscal-year start, e.g. 9-month for Q3 — NOT the 3-month, which the anchor gate rejects).
function latestCumInterim(entries) {
  const c = entries.filter(e => isInterimForm(e.form) && e.start);
  if (!c.length) return null;
  const latestEnd = c.reduce((m, e) => (e.end > m ? e.end : m), '');
  const at = c.filter(e => e.end === latestEnd);
  const chosen = at.reduce((a, e) => (days(e.end, e.start) > days(a.end, a.start) ? e : a), at[0]);
  return { val: chosen.val, start: chosen.start, end: chosen.end, span: days(chosen.end, chosen.start), filed: chosen.filed };
}

// prior-year same-span interim ending ~365d before latestEnd
function priorInterim(entries, latestEnd, span) {
  const target = Date.parse(latestEnd) - 365 * DAY;
  const c = entries.filter(e => {
    if (!isInterimForm(e.form) || !e.start) return false;
    const back = days(latestEnd, e.end);
    return back >= 350 && back <= 380 && Math.abs(days(e.end, e.start) - span) <= 10;
  });
  if (!c.length) return null;
  const chosen = c.reduce((a, e) => {
    const da = Math.abs(Date.parse(a.end) - target), de = Math.abs(Date.parse(e.end) - target);
    return de < da ? e : (de === da && (e.filed || '') > (a.filed || '') ? e : a);
  }, c[0]);
  return { val: chosen.val, start: chosen.start, end: chosen.end, span: days(chosen.end, chosen.start), filed: chosen.filed };
}

// The revenue-anchor leg sequence, in ONE place: annual full-year + a cumulative interim past the FYE +
// a prior-year same-span comparative. SOLE author of the four degrade-reason strings. Both the selection
// path (conceptComplete → is a concept usable?) and the computed path (computeLTM) call this, so the
// "can an LTM be built?" rule can never drift between choosing a concept and actually using it.
function deriveRevenueLegs(entries) {
  const annual = fullYear(entries);
  if (!annual) return { degradeReason: 'no annual (10-K/20-F) revenue full-year frame' };
  const latestYTD = latestCumInterim(entries);
  if (!latestYTD) return { degradeReason: 'no interim (10-Q) revenue frames — annual-only filer (foreign 20-F/6-K or no quarterly XBRL)' };
  if (latestYTD.end <= annual.end) return { degradeReason: 'no interim period past the latest fiscal year-end (LTM == annual)' };
  const priorYTD = priorInterim(entries, latestYTD.end, latestYTD.span);
  if (!priorYTD) return { degradeReason: 'no prior-year same-span interim to subtract' };
  return { annual, latestYTD, priorYTD };
}

// ── B1: revenue-anchor concept selection with STALENESS-TRIGGERED FALLTHROUGH ────────────────────────
// entriesFor() returns the FIRST concept with data, which goes STALE when a filer migrates its revenue
// tag to a later-listed alias but leaves dead residue under the first (GOOGL: RFCWCEAT frozen at
// 2025-03-31 after migrating to Revenues@2026-06-30). selectConcept keeps first-with-data EXCEPT when
// that concept would produce a COMPUTED-BUT-STALE LTM *and* a later-listed alias is BOTH strictly fresher
// AND able to supply all three legs. It NEVER converts an honest degrade into a number: a first concept
// that cannot itself build an LTM (JPM's interim-less Revenues, SHOP's 40-F-only annual) is returned
// as-is so the engine degrades exactly as before. Scoped to the revenue anchor only — the other LTM line
// items keep entriesFor() (first-with-data), so every non-migrator filer is byte-identical.
const maxEndOf = (entries) => entries.reduce((m, e) => (e.end > m ? e.end : m), '');

// Can THIS concept alone supply all three LTM legs? Delegates to deriveRevenueLegs — the SAME predicate
// computeLTM uses — so "complete" means exactly "an LTM is buildable from this one concept" and the
// selection verdict can never disagree with what the computed path actually does. No cross-concept mixing.
function conceptComplete(entries) {
  return !deriveRevenueLegs(entries).degradeReason;
}

// present aliases in LIST ORDER, each with list index, max period-end, and completeness.
function presentConcepts(space, names) {
  const out = [];
  names.forEach((n, idx) => {
    const entries = space[n]?.units?.['USD'];
    if (entries && entries.length) out.push({ conceptName: n, entries, idx, maxEnd: maxEndOf(entries), complete: conceptComplete(entries) });
  });
  return out;
}

// A later-listed alias that is BOTH strictly fresher AND complete than `chosenConcept` (the migrator
// condition). Used by selectConcept (to fall through) and by the B4 freshness assertion (to trip).
function fresherCompleteAlias(space, names, chosenConcept) {
  const present = presentConcepts(space, names);
  const chosen = present.find(p => p.conceptName === chosenConcept);
  if (!chosen) return null;
  return present.find(p => p.idx > chosen.idx && p.maxEnd > chosen.maxEnd && p.complete) || null;
}

function selectConcept(space, names) {
  const present = presentConcepts(space, names);
  if (!present.length) return null;
  for (const cur of present) {                       // list order (first-with-data preserved)
    // Skip ONLY a stale-COMPUTED concept: it can itself build an LTM (complete) AND a later-listed alias
    // is strictly fresher and also complete. A non-complete first concept (an honest degrade) is NEVER
    // skipped — we do not rescue a degrade into a number (JPM / SHOP stay degraded, by design).
    const staleComputed = cur.complete && present.some(p => p.idx > cur.idx && p.maxEnd > cur.maxEnd && p.complete);
    if (staleComputed) continue;
    return { conceptName: cur.conceptName, entries: cur.entries };
  }
  return { conceptName: present[0].conceptName, entries: present[0].entries }; // unreachable (freshest-complete has no fresher)
}

// value at a specific period key (for the non-anchor line items — same 3 periods as revenue)
function valFullYearAt(entries, end) {
  const c = entries.filter(e => isAnnualForm(e.form) && e.end === end && e.start && days(e.end, e.start) >= 350 && days(e.end, e.start) <= 380);
  return c.length ? c.reduce((a, e) => ((e.filed || '') > (a.filed || '') ? e : a), c[0]).val : null;
}
function valInterimAt(entries, end, span) {
  const c = entries.filter(e => isInterimForm(e.form) && e.end === end && e.start && Math.abs(days(e.end, e.start) - span) <= 10);
  return c.length ? c.reduce((a, e) => ((e.filed || '') > (a.filed || '') ? e : a), c[0]).val : null;
}
// ── Flow-concept selection — DELIBERATELY SEPARATE from selectConcept. DO NOT CONSOLIDATE THE TWO. ────
// Revenue derives its OWN trailing window, so selectConcept tests own-window completeness and skips a
// stale-but-complete first-match for a strictly-fresher alias. FLOW items (GP/OI/NI/OCF/CapEx) ride the
// already-validated revenue period keys P — they build no window — so the ONLY correct test is "can this
// alias supply all three legs AT P?". Reusing selectConcept's freshness-skip here would be a BUG: for
// netIncome it would switch a working NetIncomeLoss to a strictly-fresher NetIncomeLossAvailableToCommon-
// StockholdersBasic — a DIFFERENT BASIS (net of preferred dividends): JPM 57,048 vs 55,681 (Δ1,367M),
// BAC 30,509 vs 29,055 (Δ1,454M) — silently changing a correctly-sourced number. selectFlowConcept falls
// through ONLY when the first-match cannot supply at P (a frozen/migrated tag that would otherwise render
// "—"); it can only RESCUE a would-be blank row, never override a working first-match on a freshness edge.
function selectFlowConcept(space, names, P) {
  let firstWithData = null;
  for (const n of names) {
    const entries = space[n]?.units?.['USD'];
    if (!entries || !entries.length) continue;
    if (firstWithData == null) firstWithData = { conceptName: n, entries };
    const suppliesAtP = valFullYearAt(entries, P.annualEnd) != null
      && valInterimAt(entries, P.iEnd, P.span) != null
      && valInterimAt(entries, P.pEnd, P.span) != null;
    if (suppliesAtP) return { conceptName: n, entries, fellThrough: n !== firstWithData.conceptName };
  }
  return firstWithData ? { conceptName: firstWithData.conceptName, entries: firstWithData.entries, fellThrough: false } : null; // none supply → ltmFlow nulls the row ("—"), as today
}

function ltmFlow(space, names, P) {
  const sel = selectFlowConcept(space, names, P);
  const entries = sel ? sel.entries : [];
  const a = valFullYearAt(entries, P.annualEnd);
  const l = valInterimAt(entries, P.iEnd, P.span);
  const p = valInterimAt(entries, P.pEnd, P.span);
  const ltm = (a != null && l != null && p != null) ? a + l - p : null;
  if (sel && sel.fellThrough) console.error(`[ltmCalc] FLOW FALLTHROUGH @P: first-match could not supply all three legs at the revenue window — rescued via later alias "${sel.conceptName}".`);
  return { annual: a, latestYTD: l, priorYTD: p, ltm, conceptName: sel ? sel.conceptName : null, fellThrough: sel ? !!sel.fellThrough : false };
}
// ── Gross profit for filers that never tag GrossProfit — LEG-LEVEL, not a period-mixing shortcut ──────
// Most filers tag `GrossProfit` directly; a large minority (AMZN, GOOGL, …) present the income statement
// as Revenue − Cost of sales and tag NO GrossProfit at all (AMZN's is dead residue frozen at 2009-12-31;
// GOOGL's is absent outright), so ltmFlow(GrossProfit) returns null on all three legs and the LTM Gross
// Profit row blanks — while the annual FY columns beside it on the SAME table render a gross profit,
// because BOTH annual paths already carry this exact fallback (server.js /quote + /api/pnl columns).
// This gives the LTM legs the same fallback, computed PER LEG at the already-validated revenue window P:
//   annual GP = annual rev − annual COGS, latestYTD GP = latestYTD rev − latestYTD COGS, likewise prior.
// So it is a real three-leg LTM (annual + latest YTD − prior YTD), tying out to the same window as every
// other flow — never annual GP relabeled as LTM, and never a margin held constant across periods.
// Fires ONLY when the tagged concept could not supply an LTM: a filer that tags GrossProfit keeps it,
// including a genuine ZERO (`!= null`, never a falsy test — a zero gross profit is a fact, not a gap).
// Returns null (→ honest "—") when COGS cannot supply all three legs; it never substitutes a proxy.
function grossFromCostOfRevenue(rev, cogs) {
  if (cogs.annual == null || cogs.latestYTD == null || cogs.priorYTD == null) return null;
  return {
    annual:    rev.annual    - cogs.annual,
    latestYTD: rev.latestYTD - cogs.latestYTD,
    priorYTD:  rev.priorYTD  - cogs.priorYTD,
    ltm:       rev.ltm       - cogs.ltm,
    conceptName: `${rev.conceptName} − ${cogs.conceptName}`,
    fellThrough: false,
    derived: true,
  };
}

// latest point-in-time (instant) value — balance sheet, not summed
function instantLatest(entries) {
  const pool = entries.filter(e => !e.start);
  const use = pool.length ? pool : entries;
  if (!use.length) return null;
  const latestEnd = use.reduce((m, e) => (e.end > m ? e.end : m), '');
  const at = use.filter(e => e.end === latestEnd);
  const chosen = at.reduce((a, e) => ((e.filed || '') > (a.filed || '') ? e : a), at[0]);
  return { val: chosen.val, end: chosen.end };
}

// LTM D&A for EBITDA (Stage 2.5) — sourced CONSISTENTLY with the deck's annual EBITDA D&A basis. The
// annual path (fetchFromEDGAR / PNL_GAAP) picks the FIRST D&A concept with an annual entry (DDA before
// DepreciationAndAmortization), so LTM D&A must use that SAME concept or LTM EBITDA won't reconcile with
// the FY EBITDA columns on the very same §4/§5 row. If that deck-basis concept isn't tagged at interim,
// an ALTERNATE cash-flow D&A concept is used ONLY when its annual leg reconciles with the deck basis
// (≤15%); a materially different concept (e.g. CRM's DepreciationAndAmortization 3,631 vs deck DDA 1,200)
// would inflate LTM EBITDA to ~12.5B beside the deck's ~9.5B — so we keep the honest opInc-basis fallback
// rather than mix D&A definitions. Span-match is enforced per period exactly like the other flows.
function ltmDA(ns, names, P) {
  const uni = (n) => ns[n]?.units?.['USD'] || [];
  let deckConcept = null, annualDA = null;
  for (const n of names) { const v = valFullYearAt(uni(n), P.annualEnd); if (v != null) { deckConcept = n; annualDA = v; break; } }
  if (deckConcept == null) return { ltm: null, concept: null, note: 'opInc(LTM) only — no annual D&A concept tagged' };
  const li = valInterimAt(uni(deckConcept), P.iEnd, P.span), pi = valInterimAt(uni(deckConcept), P.pEnd, P.span);
  if (li != null && pi != null) return { ltm: annualDA + li - pi, concept: deckConcept, note: `opInc(LTM) + D&A(LTM) — D&A from ${deckConcept}` };
  // deck-basis concept lacks interim → try an alternate, accept only if its annual leg reconciles (≤15%)
  for (const n of names) {
    if (n === deckConcept) continue;
    const a = valFullYearAt(uni(n), P.annualEnd), l = valInterimAt(uni(n), P.iEnd, P.span), p = valInterimAt(uni(n), P.pEnd, P.span);
    if (a == null || l == null || p == null) continue;
    if (annualDA > 0 && Math.abs(a - annualDA) / annualDA <= 0.15)
      return { ltm: a + l - p, concept: n, note: `opInc(LTM) + D&A(LTM) — interim D&A from cash-flow concept ${n} (annual leg reconciled to the ${deckConcept} basis)` };
  }
  return { ltm: null, concept: deckConcept, note: `opInc(LTM) only — the deck's EBITDA D&A concept (${deckConcept}) is not tagged at interim, and the only interim-tagged D&A concept is on a materially different basis; LTM EBITDA is kept on an operating-income basis rather than mixing D&A definitions` };
}

// Pure: takes an already-fetched companyfacts object. Returns an LTM structure or an honest degrade.
function computeLTM(facts) {
  const gaap = facts?.facts?.['us-gaap'] || {};
  const ifrs = facts?.facts?.['ifrs-full'] || {};
  const dei  = facts?.facts?.['dei'] || {};
  const useIfrs = Object.keys(ifrs).length > 0 && Object.keys(gaap).length === 0;
  const ns = useIfrs ? ifrs : gaap;
  const N  = useIfrs ? NAMES.ifrs : NAMES.gaap;
  const degrade = (reason, extra) => ({ ltm: false, fallback: 'annual', reason, ...(extra || {}) });

  // B2 — revenue anchor via staleness-triggered selection (single source for ALL THREE legs below).
  const sel = selectConcept(ns, N.revenue);
  if (!sel) return degrade('no revenue concept in companyfacts');
  const revE = sel.entries;
  const revConcept = sel.conceptName;
  // Same predicate the selector's conceptComplete() uses — one source of truth for the leg sequence.
  // degradeReason is passed through UNMODIFIED (deriveRevenueLegs is its sole author; no local rewording).
  const legs = deriveRevenueLegs(revE);
  if (legs.degradeReason) return degrade(legs.degradeReason);
  const { annual, latestYTD, priorYTD } = legs;

  // ── tie-out gate ─────────────────────────────────────────────────────────────
  const spanMatch     = Math.abs(latestYTD.span - priorYTD.span) <= 10;
  const ttmWindowDays = days(latestYTD.end, priorYTD.end);
  const ttmOk         = ttmWindowDays >= 350 && ttmWindowDays <= 380;
  const stubDays      = days(latestYTD.start, annual.end);            // interim continues from annual FYE (+~1d) → cumulative
  const stubOk        = stubDays >= 0 && stubDays <= 10;
  const priorAnchorDays = Math.abs(days(priorYTD.start, annual.start)); // prior interim shares the annual FY start
  const priorAnchorOk = priorAnchorDays <= 10;
  const trusted = spanMatch && ttmOk && stubOk && priorAnchorOk;
  const tieOut = { trusted, spanMatch, latestSpan: latestYTD.span, priorSpan: priorYTD.span,
                   ttmWindowDays, ttmOk, stubDays, stubOk, priorAnchorDays, priorAnchorOk };
  if (!trusted) return { ltm: false, fallback: 'annual', reason: 'tie-out gate failed', tieOut };

  // B3 — single-concept invariant. All three revenue legs read the SAME revE (annual/latestYTD/priorYTD
  // above), so they are one concept by construction. Assert it (not a retry) so any future per-leg
  // refactor that re-selected independently — silently mixing bases — is caught immediately, not shipped.
  // B3 THROWS (not degrades): a leg-concept mismatch is a PROGRAMMING error in B2, not a filer-data condition.
  if (entriesFor(ns, [revConcept]) !== revE) throw new Error(`ltmCalc: revenue legs are not single-concept (${revConcept})`);

  // B4 — freshness assertion (generic migrator trap). ON A COMPUTED LTM ONLY (never on the degrades
  // returned above — JPM/SHOP are out of scope by design): a later-listed alias must NOT be both strictly
  // fresher AND complete. If one is, the selector locked onto stale residue (the GOOGL failure mode) —
  // fail LOUD and degrade to annual rather than serve a stale number. Catches the next GOOGL unattended.
  // B4 DEGRADES (not throws): a stale concept is a FILER-DATA condition → the same honest annual exit as SHOP/JPM.
  const fresher = fresherCompleteAlias(ns, N.revenue, revConcept);
  if (fresher) {
    console.error(`[ltmCalc] FRESHNESS VIOLATION: selected ${revConcept}@${maxEndOf(revE)} but later alias ${fresher.conceptName}@${fresher.maxEnd} is fresher AND complete — concept migration. Degrading to annual rather than serve a stale LTM.`);
    return { ltm: false, fallback: 'annual', reason: 'freshness assertion failed — a later-listed revenue alias is fresher and complete (concept migration)',
      degradeReason: 'freshness assertion failed', freshnessViolation: { chosen: revConcept, chosenEnd: maxEndOf(revE), fresher: fresher.conceptName, fresherEnd: fresher.maxEnd }, tieOut };
  }

  const P = { annualEnd: annual.end, iEnd: latestYTD.end, pEnd: priorYTD.end, span: latestYTD.span };

  // Flow legs now select their concept via selectFlowConcept (supplies-at-P, migration-robust). netIncome
  // is the ONLY 2-alias GAAP flow (can fall through); grossProfit/operatingIncome/ocf/capex are single-alias
  // → trivially identical to the old entriesFor first-match. For IFRS filers, N === NAMES.ifrs, so the
  // 2-alias IFRS operatingIncome / netIncome lists route through the same selector — but no US-GAAP test
  // ticker (all 17; NSRGY has no companyfacts) exercises the IFRS path.
  const rev = { annual: annual.val, latestYTD: latestYTD.val, priorYTD: priorYTD.val, ltm: annual.val + latestYTD.val - priorYTD.val, conceptName: revConcept, fellThrough: false };
  const cogs = ltmFlow(ns, N.costOfRevenue, P);
  const gpTagged = ltmFlow(ns, N.grossProfit, P);
  // Tagged GrossProfit wins whenever it can supply the window (byte-identical to before for those filers,
  // a real 0 included); only a NON-supplying tag falls back to the revenue − COGS identity.
  const gp = gpTagged.ltm != null ? gpTagged : (grossFromCostOfRevenue(rev, cogs) || gpTagged);
  const oi  = ltmFlow(ns, N.operatingIncome, P);
  const niF = ltmFlow(ns, N.netIncome, P);
  const noi = ltmFlow(ns, N.nonOperating, P);   // net non-operating income/(expense) LTM — same P, same selector, disclosure only (does NOT touch NI)
  const daRes = ltmDA(ns, N.da, P);   // deck-consistent D&A (same concept as annual EBITDA, reconciled-alternate, or honest fallback)
  const ocf = ltmFlow(gaap, NAMES.gaap.ocf, P);   // cash flow always us-gaap
  const cpx = ltmFlow(gaap, NAMES.gaap.capex, P);

  const ebitdaLtm = oi.ltm != null ? oi.ltm + (daRes.ltm ?? 0) : null;
  const fcfLtm    = (ocf.ltm != null && cpx.ltm != null) ? ocf.ltm + cpx.ltm : null;

  const cash = instantLatest(entriesFor(ns, N.cash));
  const debt = instantLatest(entriesFor(ns, N.debt));
  const assets = instantLatest(entriesFor(ns, N.assets));
  const equity = instantLatest(entriesFor(ns, N.equity));

  const dilInterim = valInterimAt(entriesFor(ns, N.dilutedShares, 'shares'), latestYTD.end, latestYTD.span);
  const instShares = instantLatest(entriesFor(ns, N.sharesInstant, 'shares')) || instantLatest(entriesFor(dei, ['EntityCommonStockSharesOutstanding'], 'shares'));
  const dilutedShares = scaleShares(dilInterim ?? (instShares ? instShares.val : null));
  const sharesSource  = dilInterim != null ? 'interim diluted weighted-avg' : (instShares ? 'latest instant shares outstanding (loss quarter — diluted untagged)' : 'none');
  const epsLtm = (niF.ltm != null && dilutedShares) ? niF.ltm / dilutedShares : null;

  // % delta only for a POSITIVE annual base (negative base → not meaningful, like dealCalc)
  const pct  = (l, a) => (a > 0 && l != null ? +(((l - a) / a) * 100).toFixed(1) : null);
  const flow = (o) => ({ annualM: inM(o.annual), latestYtdM: inM(o.latestYTD), priorYtdM: inM(o.priorYTD), ltmM: inM(o.ltm), deltaPct: pct(o.ltm, o.annual), conceptName: o.conceptName ?? null, fellThrough: o.fellThrough ?? false, derived: o.derived ?? false });

  return {
    ltm: true,
    basis: 'LTM',
    conceptName: revConcept,                                   // B5 — the single revenue concept sourcing all three legs
    asOf: latestYTD.end,
    window: { start: priorYTD.end, end: latestYTD.end },       // the trailing-12-month span
    periods: {
      annual: { end: annual.end, start: annual.start, form: annual.form, filed: annual.filed },
      latestInterim: { start: latestYTD.start, end: latestYTD.end, span: latestYTD.span, filed: latestYTD.filed },
      priorInterim:  { start: priorYTD.start, end: priorYTD.end, span: priorYTD.span, filed: priorYTD.filed },
    },
    tieOut,
    flows: {
      revenue:         flow(rev),
      costOfRevenue:   flow(cogs),   // the subtracted leg — exposed so the LTM column can FOOT (rev − COGS = GP)
      grossProfit:     flow(gp),
      operatingIncome: flow(oi),
      nonOperatingIncome: flow(noi),   // disclosure line (§6/§7 LTM column) — reconciles operating income → net income; NEVER an adjustment to NI
      ebitda:          { ltmM: inM(ebitdaLtm), daFound: daRes.ltm != null, daConcept: daRes.concept, note: daRes.note },
      netIncome:       flow(niF),
      freeCashFlow:    { ltmM: inM(fcfLtm), note: 'OCF(LTM) + CapEx(LTM)', ocfConcept: ocf.conceptName, ocfFellThrough: ocf.fellThrough, capexConcept: cpx.conceptName, capexFellThrough: cpx.fellThrough },
    },
    balanceSheet: {
      cashM: cash ? inM(cash.val) : null, cashAsOf: cash?.end || null,
      totalDebtM: debt ? inM(debt.val) : null, debtAsOf: debt?.end || null,
      totalAssetsM: assets ? inM(assets.val) : null, equityM: equity ? inM(equity.val) : null,
      note: 'point-in-time latest quarter (not summed)',
    },
    epsDiluted: {
      ltm: epsLtm != null ? +epsLtm.toFixed(2) : null,
      dilutedSharesM: dilutedShares ? inM(dilutedShares) : null,
      sharesSource,
      convention: 'LTM net income ÷ latest interim diluted weighted-avg shares (NOT Σ quarterly EPS)',
    },
  };
}

// Convenience: fetch companyfacts for a CIK (reusing the app's UA-setting httpGet) then computeLTM.
async function computeLTMForCik(cik) {
  const padded = String(cik).padStart(10, '0');
  let facts;
  try {
    facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`);
  } catch (e) {
    return { ltm: false, fallback: 'annual', reason: `no EDGAR companyfacts (${e.message || 'fetch failed'})` };
  }
  if (!facts || !facts.facts) return { ltm: false, fallback: 'annual', reason: 'empty companyfacts (foreign/ADR — no XBRL financials)' };
  return computeLTM(facts);
}

module.exports = { computeLTM, computeLTMForCik, scaleShares, COGS_CONCEPTS };
