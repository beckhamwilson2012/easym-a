import { cashBucket } from '../lib/netDebt';
import { synergySchedule } from '../lib/synergies';
import { basesDiffer, combination } from '../lib/companyBasis';

// ── Sensitivity table constants ───────────────────────────────────────────────
export const PRICE_MULTS  = [0.8, 0.9, 1.0, 1.1, 1.2];
export const PRICE_LABELS = ['-20%', '-10%', 'Current', '+10%', '+20%'];
export const SYN_MULTS    = [0.5, 0.75, 1.0, 1.25, 1.5];
export const SYN_LABELS   = ['50%', '75%', '100%', '125%', '150%'];

// ── Transaction assumptions (documented; not fetched data) ────────────────────
// TAX_RATE applies to synergies (taxed) and to financing interest (tax-shielded).
export const TAX_RATE           = 0.21;  // US federal statutory rate
// Incremental acquisition-financing cost. A cash-financed deal carries a real interest drag: the
// cash portion is funded by new debt at the acquirer's marginal cost. We charge this on the FULL
// cash portion, after tax — i.e. recurring pro-forma EPS = (A.NI + B.NI + after-tax synergies
// − cashPortion × DEBT_INTEREST_RATE × (1 − TAX_RATE)) ÷ combined shares. This is ON by default
// because a real cash deal does carry the cost; set to 0 for the simpler quick-accretion convention.
export const DEBT_INTEREST_RATE = 0.05;  // ~marginal investment-grade acquisition-debt rate (2026)
// Minimum operating cash the PRO-FORMA company retains, as a % of pro-forma LTM revenue — scales with the
// business (never a flat constant, which produced a nonsense flip on a $176M deal). Combined cash above this
// floor funds the deal (excess cash used), cutting new debt vs the old 100%-debt assumption. User-overridable.
export const MIN_CASH_PCT_DEFAULT = 0.02;

// Acquirer market price for share issuance: prefer the REAL live price; only fall back to a
// P/E proxy (EPS×15) when no live price is available, and never produce a price from a loss.
export function acquirerSharePrice(inputs) {
  const live = parseFloat(inputs.currentSharePriceA) || 0;
  if (live > 0) return live;
  const eps = parseFloat(inputs.companyAEPS) || 0;
  return null; // no live acquirer price → absent (was: eps × 15 proxy). Consumers must render "—", not fabricate.
}

// Acquirer standalone EPS — the accretion/dilution BASELINE. The company's REPORTED DILUTED EPS
// (the filed per-share figure) is canonical and primary. Fall back to net income ÷ weighted-average
// DILUTED shares only when reported EPS is genuinely unavailable — never net income ÷ the
// point-in-time cover-page share count, which biased EPS high (the bug this fixes).
export function acquirerStandaloneEPS(inputs) {
  const reported = parseFloat(inputs.companyAEPS);
  if (Number.isFinite(reported) && reported !== 0) return reported;
  const ni     = parseFloat(inputs.companyANetIncome) || 0;
  const shares = parseFloat(inputs.companyADilutedShares) || parseFloat(inputs.companyAShares) || 0;
  return shares > 0 ? ni / shares : 0;
}

// Effective acquirer DILUTED share count for the EPS basis. Prefer the real weighted-average diluted
// count (companyADilutedShares). When it is unavailable, DERIVE the count from reported EPS
// (companyANetIncome ÷ companyAEPS) so net income ÷ this count ≈ the reported EPS — i.e. the pro-forma
// acquirer leg sits on the SAME basis as the reported-EPS standalone baseline, never the point-in-time
// cover-page count on one side only. If reported EPS is also unavailable, fall back to the cover-page
// count (companyAShares) — used on BOTH sides so they still agree — and flag the figure as approximate.
export function acquirerDilutedShares(inputs) {
  const diluted = parseFloat(inputs.companyADilutedShares) || 0;
  if (diluted > 0) return { shares: diluted, approximate: false };
  const eps = parseFloat(inputs.companyAEPS);
  const ni  = parseFloat(inputs.companyANetIncome);
  if (Number.isFinite(eps) && eps !== 0 && Number.isFinite(ni) && ni !== 0) {
    return { shares: ni / eps, approximate: false }; // NI ÷ shares ≈ reported EPS by construction
  }
  const cover = parseFloat(inputs.companyAShares) || 0;
  return { shares: cover, approximate: true }; // last resort: same cover-page basis on BOTH sides
}

// Target market price for the PREMIUM. Use ONLY the real live price — a premium measured against an
// EPS×15 proxy is meaningless (it produced the nonsensical "−34.5% premium" when the live price was
// missing). Returns 0 when there is no live price, so the premium is reported as N/A rather than a
// fabricated discount.
// With "Price before deal news" chosen on the input page, that close (inputs.premiumReferencePrice) is the reference;
// it is absent otherwise, so today's price is used exactly as before.
export function targetMarketPrice(inputs) {
  const ref = parseFloat(inputs.premiumReferencePrice);
  if (Number.isFinite(ref) && ref > 0) return ref;
  return parseFloat(inputs.currentSharePriceB) || 0;
}

// ── Purchase price of a PRIVATE target ────────────────────────────────────────
// A private target has no per-share price or share count, so its total consideration is entered directly ($M) as
// offerValueTotal. This is the one read of that field: calculate(), acquisitionNewDebt() and calcProFormaEPS() all
// take it from here, so the cash part of a private offer is funded exactly like a public one (excess cash first,
// then new debt). Returns null when it is not set (> 0); callers then use offer × shares, unchanged for public deals.
export function privateConsideration(inputs) {
  const v = parseFloat(inputs.offerValueTotal);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// ── Sources of funds: acquisition new debt ────────────────────────────────────
// Faculty's construction: combined cash is a real funding source (subject to a retained minimum) and target
// debt is assumed repaid on change of control, so
//   new debt = max(0, cash consideration + target debt repaid − excess cash),   excess cash = max(0, combined cash − min cash).
// THREE GUARDS (all required — see the Stage-2E diagnostic):
//  (1) BANK deals keep today's 100%-debt behavior. Bank cash sits off the standard concept (resolves null) and
//      bank debt/deposits are NOT repaid on change of control — netting them is category-wrong, not imprecise.
//      Gate on the deck's isBankDeal, passed in as inputs.bankDeal (single source; not recomputed here).
//  (2) ZERO FLOOR — combined cash can exceed the funding need; surplus can't create negative debt, it renders
//      as EXCESS CASH USED in Sources & Uses.
//  (3) MIN CASH SCALES with pro-forma LTM revenue (never a flat dollar), user-overridable via inputs.minCashPct.
// offerOverride lets the sensitivity grid (calcProFormaEPS) vary the offer while sharing this one construction.
// A private target's total consideration (privateConsideration) is the purchase price whenever it is set, exactly as
// in calculate(): a private target has no per-share offer to vary.
export function acquisitionNewDebt(inputs, offerOverride) {
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const offer  = offerOverride != null ? offerOverride : (num(inputs.offerPricePerShare) || 0);
  const shares = num(inputs.companyBShares) || 0;
  const cashPct = num(inputs.cashPercent) || 0;
  const privateTotal = privateConsideration(inputs);
  const purchasePrice = privateTotal != null ? privateTotal : offer * shares;
  const cashConsideration = purchasePrice * (cashPct / 100);
  // Opt-in + Guard 1. Only the MAIN deal threads combined cash / target debt / pro-forma LTM revenue and sets
  // applySourcesOfFunds; peer-screen impacts (§2, which carry no per-peer balance sheet) and BANK deals keep
  // today's simple 100%-debt convention — newDebt = full cash consideration (no cash netting, no debt repaid).
  if (!inputs.applySourcesOfFunds || inputs.bankDeal) {
    return { newDebt: cashConsideration, cashConsideration, targetDebtRepaid: null, combinedCash: null,
             minCash: null, excessCashAvail: null, excessCashUsed: null, pfLtmRevenue: null, minCashPct: null, bank: !!inputs.bankDeal };
  }
  // Combined cash available to fund the deal — convention (b) bucket (cash + short-term marketable), shared helper.
  const aBucket = cashBucket(num(inputs.companyACash), num(inputs.companyASti)).value;
  const bBucket = cashBucket(num(inputs.companyBCash), num(inputs.companyBSti)).value;
  const combinedCash = (aBucket != null && bBucket != null) ? aBucket + bBucket : null;
  // Guard 3 — min cash scales with pro-forma LTM revenue (LTM, not FY — same figure §2/§3/§11 use).
  const pfLtmRevenue = (num(inputs.companyALtmRevenue) || 0) + (num(inputs.companyBLtmRevenue) || 0);
  const pct = Number.isFinite(num(inputs.minCashPct)) ? num(inputs.minCashPct) : MIN_CASH_PCT_DEFAULT;
  const minCash = pfLtmRevenue * pct;
  const excessCashAvail  = combinedCash != null ? Math.max(0, combinedCash - minCash) : 0; // above the retained min
  // Faculty assumption: 100% repaid. Unavailable target debt stays null (never "$0 repaid"), and every sum that
  // takes it as an addend goes null with it — a coerced 0 here produced newDebt identical to a debt-free target.
  const targetDebtRepaid = num(inputs.companyBDebt);
  const newDebt = targetDebtRepaid != null
    ? Math.max(0, cashConsideration + targetDebtRepaid - excessCashAvail) : null;       // Guard 2 — zero floor
  const excessCashUsed = newDebt != null
    ? cashConsideration + targetDebtRepaid - newDebt : null;                            // = min(avail, need); surplus stays on B/S
  return { newDebt, cashConsideration, targetDebtRepaid, combinedCash, minCash,
           excessCashAvail, excessCashUsed, pfLtmRevenue, minCashPct: pct, bank: false };
}

// ── Core calculation ──────────────────────────────────────────────────────────

export function calculate(inputs) {
  const {
    companyADebt,
    companyBShares, companyBEPS, companyBCash, companyBDebt,
    companyARevenue, companyAEBITDA, companyANetIncome,
    companyBRevenue, companyBEBITDA, companyBNetIncome,
    offerPricePerShare, cashPercent,
  } = inputs;
  // The one synergy calculation. Year 1 pre-tax EBITDA impact = cost + revenue × combined gross margin.
  const synergies          = synergySchedule(inputs);
  const synergyY1          = synergies.years[0];
  const synergiesY1        = synergyY1.ebitda;

  const stockPercent       = 100 - cashPercent;
  // Purchase price: a PRIVATE target's total consideration (privateConsideration, the same read acquisitionNewDebt
  // uses); a public target uses offer price × shares.
  const _privateTotal      = privateConsideration(inputs);
  const totalPurchasePrice = _privateTotal != null ? _privateTotal : offerPricePerShare * companyBShares;
  const cashPortion        = totalPurchasePrice * (cashPercent / 100);
  const stockPortion       = totalPurchasePrice * (stockPercent / 100);

  // New shares issued = stock consideration ÷ REAL acquirer price (non-zero whenever there is a
  // stock portion and we have a price). This is the bug that previously produced "0M new shares".
  const acqPrice         = acquirerSharePrice(inputs);
  const newSharesIssued  = acqPrice > 0 ? stockPortion / acqPrice : null;
  // EPS math uses the weighted-average DILUTED share base (falls back to companyAShares if absent),
  // so pro-forma EPS sits on the same basis as the reported-diluted standalone EPS. Ownership and
  // market cap read companyAShares (point-in-time) directly elsewhere and are unaffected by this.
  const acqDiluted       = acquirerDilutedShares(inputs);
  const acqBaseShares    = acqDiluted.shares;
  const totalShares      = acqBaseShares + newSharesIssued;

  // Two companies on different bases are never added: every combined figure below is null, and the slides say why.
  const differentBases   = basesDiffer(inputs);
  const combinedRevenue  = (!differentBases && companyARevenue != null && companyBRevenue != null) ? companyARevenue + companyBRevenue : null;
  // Pro forma revenue carries the revenue synergies; combined revenue stays the two companies' own sum.
  const proFormaRevenue  = combinedRevenue != null ? combinedRevenue + (synergyY1.revenue ?? 0) : null;
  // BOTH sides required. A null EBITDA (e.g. BMY: OperatingIncomeLoss untagged → null EBITDA) must NOT
  // coerce to 0 inside the sum and silently understate combined leverage — a partial input renders '—',
  // never a published ratio (matches the enterpriseValue / netDebt short-circuit, Fix A / 2C-2). Both-real
  // deals are unchanged.
  const combinedEBITDA   = (!differentBases && companyAEBITDA != null && companyBEBITDA != null)
    ? companyAEBITDA + companyBEBITDA + synergiesY1 : null; // synergies pre-tax

  // Pro-forma RECURRING net income: combine both companies, add after-tax synergies, subtract the
  // after-tax interest cost of debt-funding the cash portion.
  const afterTaxSynergies   = synergiesY1 * (1 - TAX_RATE);
  // Sources of funds (Stage 2E): the drag is charged on the NEW debt after combined excess cash funds part of
  // the deal — ONE construction, shared with the sensitivity grid (calcProFormaEPS) and read by §8/§9/§10/§11.
  const sources             = acquisitionNewDebt(inputs);
  // newDebt is null when the target's debt is unavailable → the drag is unknown, not zero.
  const newInterestAfterTax = sources.newDebt != null ? sources.newDebt * DEBT_INTEREST_RATE * (1 - TAX_RATE) : null;
  // Sources & Uses totals at full precision, so the table foots on the real figures rather than on rounded rows.
  // Bank deals repay no target debt and draw no excess cash (a genuine 0). Otherwise an unavailable leg stays null.
  const debtRepaidInUses   = sources.bank ? 0 : sources.targetDebtRepaid;
  const excessCashInSources = sources.bank ? 0 : sources.excessCashUsed;
  const totalUses    = debtRepaidInUses != null ? totalPurchasePrice + debtRepaidInUses : null;
  const totalSources = (sources.newDebt != null && excessCashInSources != null) ? sources.newDebt + stockPortion + excessCashInSources : null;
  // BOTH net incomes required — a null side must NOT coerce to 0 and understate the pro-forma net income
  // that drives EPS and the headline accretion. Null → EPS null → accretion not meaningful → '—' / n/m.
  // Same for an unknown financing drag.
  const proFormaNetIncome   = (!differentBases && companyANetIncome != null && companyBNetIncome != null && newInterestAfterTax != null)
    ? companyANetIncome + companyBNetIncome + afterTaxSynergies - newInterestAfterTax : null;
  const proFormaEPS         = (proFormaNetIncome != null && totalShares > 0) ? proFormaNetIncome / totalShares : null;

  // Accretion / dilution. A percent change is only meaningful when BOTH the standalone and the
  // pro-forma EPS are positive — a move off a non-positive base (e.g. -$0.98 → $0.00) is neither a
  // clean "accretive" nor a real "-100%". In any degenerate case we lean dilutive and show the
  // absolute EPS values with no percentage.
  const standaloneEPS       = acquirerStandaloneEPS(inputs); // net income ÷ shares (same basis as PF)
  const accretionMeaningful = standaloneEPS > 0 && proFormaEPS > 0;
  const isAccretive         = accretionMeaningful && proFormaEPS > standaloneEPS;
  // Single shared helper (also used by §7) so the headline % and the accretion table never diverge.
  const epsChangePct        = accretionMeaningful
    ? epsAccretionPct(offerPricePerShare, synergiesY1, inputs) : null;

  // Premium against the REAL current target price (not an EPS×15 proxy).
  const tgtPrice         = targetMarketPrice(inputs);
  const purchasePremium  = tgtPrice > 0 ? ((offerPricePerShare - tgtPrice) / tgtPrice) * 100 : null;

  // Multiples / leverage — guard non-positive denominators (negative EBITDA/EPS → N/A, not nonsense).
  // Fix A: EV and combined leverage require BOTH debt and cash; if a component was stale-rejected (null),
  // the metric is unavailable (null → 'N/A') — never let null coerce to 0 (silent $0 EV / understated
  // leverage that could mute the ">5×" flag). Non-stale deals pass real numbers → unchanged.
  const enterpriseValue  = (companyBDebt != null && companyBCash != null) ? totalPurchasePrice + companyBDebt - companyBCash : null;
  const evEBITDA         = (companyBEBITDA > 0 && enterpriseValue != null) ? enterpriseValue / companyBEBITDA : null;
  const peRatio          = companyBEPS    > 0 ? offerPricePerShare / companyBEPS : null;
  const combinedDebt     = (companyADebt != null && companyBDebt != null) ? companyADebt + companyBDebt + cashPortion : null;
  const debtEBITDA       = (combinedEBITDA > 0 && combinedDebt != null) ? combinedDebt / combinedEBITDA : null;

  return {
    isAccretive,
    accretionMeaningful,
    epsChangePct:      epsChangePct === null ? null : epsChangePct.toFixed(1),
    proFormaEPS:       proFormaEPS === null ? null : proFormaEPS.toFixed(2),
    proFormaNetIncome: proFormaNetIncome === null ? null : proFormaNetIncome.toFixed(0),
    afterTaxSynergies: afterTaxSynergies.toFixed(0),
    newInterestAfterTax: newInterestAfterTax == null ? null : newInterestAfterTax.toFixed(0),
    // ── Sources of funds (Stage 2E) — the drag above is charged on newDebt; §10 renders the build ──
    newDebt:           sources.newDebt == null ? null : sources.newDebt.toFixed(0),
    cashConsideration: sources.cashConsideration.toFixed(0),
    excessCashUsed:    sources.excessCashUsed  == null ? null : sources.excessCashUsed.toFixed(0),
    excessCashAvail:   sources.excessCashAvail == null ? null : sources.excessCashAvail.toFixed(0),
    minCashRetained:   sources.minCash       == null ? null : sources.minCash.toFixed(0),
    combinedCash:      sources.combinedCash  == null ? null : sources.combinedCash.toFixed(0),
    targetDebtRepaid:  sources.targetDebtRepaid == null ? null : sources.targetDebtRepaid.toFixed(0),
    totalUses:         totalUses == null ? null : totalUses.toFixed(0),
    totalSources:      totalSources == null ? null : totalSources.toFixed(0),
    pfLtmRevenue:      sources.pfLtmRevenue  == null ? null : sources.pfLtmRevenue.toFixed(0),
    minCashPct:        sources.minCashPct,
    bankFinancing:     sources.bank,
    acquirerSharePrice: acqPrice === null ? 'N/A' : acqPrice.toFixed(2),
    evEBITDA:          evEBITDA   === null ? 'N/A' : evEBITDA.toFixed(1),
    peRatio:           peRatio    === null ? 'N/A' : peRatio.toFixed(1),
    debtEBITDA:        debtEBITDA === null ? 'N/A' : debtEBITDA.toFixed(1),
    // The numerators of the two multiples above, exposed so explainers show the SAME figure the multiple
    // was built from — null (never a $0-debt rebuild) whenever a leg is unavailable.
    enterpriseValue:   enterpriseValue === null ? null : enterpriseValue.toFixed(0),
    combinedDebt:      combinedDebt    === null ? null : combinedDebt.toFixed(0),
    totalPurchasePrice: totalPurchasePrice.toFixed(0),
    cashPortion:        cashPortion.toFixed(0),
    stockPortion:       stockPortion.toFixed(0),
    newSharesIssued:    newSharesIssued === null ? null : newSharesIssued.toFixed(0),
    purchasePremium:    purchasePremium === null ? null : purchasePremium.toFixed(1),
    combinedRevenue:    combinedRevenue === null ? null : combinedRevenue.toFixed(0),
    proFormaRevenue:    proFormaRevenue === null ? null : proFormaRevenue.toFixed(0),
    combinedEBITDA:     combinedEBITDA === null ? null : combinedEBITDA.toFixed(0),
    // combinedNetIncome reflects the pro-forma recurring net income used for EPS (consistent).
    combinedNetIncome:  proFormaNetIncome === null ? null : proFormaNetIncome.toFixed(0),
    // Total pre-tax EBITDA impact per year. The cost and revenue lines are in synergies.years.
    synergiesY1, synergiesY2: synergies.years[1].ebitda, synergiesY3: synergies.years[2].ebitda,
    synergies,
    basesDiffer: differentBases,
    basisNote: combination(inputs).note,
    // Standalone EPS on the net-income÷shares basis used for the accretion comparison (so the
    // dashboard "Before → After" and the percent change are internally consistent).
    companyAEPS:        standaloneEPS.toFixed(2),
    // True only when the acquirer diluted-share count fell all the way back to the cover-page count
    // (no weighted-avg diluted AND no reported EPS to derive from). Baseline and pro-forma still share
    // that basis (they never disagree), but it is approximate. False whenever a real or EPS-derived
    // diluted count was used.
    proFormaDilutedApproximate: acqDiluted.approximate,
  };
}

// ── Sensitivity helper ────────────────────────────────────────────────────────
// Must mirror calculate()'s pro-forma EPS exactly so the sensitivity grid is consistent.

export function calcProFormaEPS(offerPrice, synergiesY1, inputs) {
  const { companyANetIncome, companyBShares, companyBNetIncome, cashPercent } = inputs;
  const acqPrice = acquirerSharePrice(inputs);
  if (!(acqPrice > 0) || companyBShares === 0) return null; // !(x>0) catches null AND 0 (=== 0 missed null → NaN)
  if (companyANetIncome == null || companyBNetIncome == null) return null; // partial input → null (→ '—'), never a 0-coerced EPS
  if (basesDiffer(inputs)) return null; // one on LTM, one on FY: not added
  const stockPercent = 100 - cashPercent;
  const _privateTotal = privateConsideration(inputs);   // same purchase price as calculate() for a private target
  const totalPP      = _privateTotal != null ? _privateTotal : offerPrice * companyBShares;
  const stockPortion = totalPP * (stockPercent / 100);
  const newShares    = stockPortion / acqPrice;
  const totalShares  = acquirerDilutedShares(inputs).shares + newShares; // effective diluted base (matches calculate())
  if (totalShares === 0) return null;
  const afterTaxSynergies   = synergiesY1 * (1 - TAX_RATE);
  // SAME sources-of-funds construction as calculate(), at this grid cell's offer — so the drag never diverges.
  const newDebt = acquisitionNewDebt(inputs, offerPrice).newDebt;
  if (newDebt == null) return null; // unknown target debt → unknown drag → null (matches calculate())
  const newInterestAfterTax = newDebt * DEBT_INTEREST_RATE * (1 - TAX_RATE);
  const netIncome = companyANetIncome + companyBNetIncome + afterTaxSynergies - newInterestAfterTax;
  return netIncome / totalShares;
}

// Single source of truth for the EPS accretion/(dilution) PERCENTAGE. Both the dashboard headline
// (via calculate) and the §7 multi-year accretion table call THIS, so they never diverge by a
// rounding step — the table previously divided by the 2-dp-rounded standalone EPS (8.03) and reported
// -11.2% where the dashboard, using the full-precision standalone EPS (8.0269), showed -11.1%.
// Returns a full-precision percentage, or null when a % is not meaningful (standalone or pro-forma
// EPS ≤ 0). Callers round for display.
export function epsAccretionPct(offerPrice, synergiesY1, inputs) {
  const pf   = calcProFormaEPS(offerPrice, synergiesY1, inputs);
  const base = acquirerStandaloneEPS(inputs);
  if (pf == null || !(base > 0) || !(pf > 0)) return null;
  return ((pf - base) / base) * 100;
}

// The inputs for one forward accretion year: net income = consensus EPS × today's diluted shares. Slide 8's
// accretion table and the input page's premium solve both read this, so they cannot diverge.
export function forwardYearInputs(inputs, acquirerEps, targetEps) {
  const acqDilSh = acquirerDilutedShares(inputs).shares;
  const tgtDilSh = parseFloat(inputs.companyBDilutedShares) || parseFloat(inputs.companyBShares) || 0;
  return {
    ...inputs,
    companyANetIncome:     acquirerEps * acqDilSh,
    companyAEPS:           acquirerEps,
    companyADilutedShares: acqDilSh,
    companyBNetIncome:     targetEps * tgtDilSh,
    // Both legs are consensus here, whatever basis the historical figures are on.
    companyABasis:         'consensus',
    companyBBasis:         'consensus',
  };
}

// ── Risk flags ────────────────────────────────────────────────────────────────

export function computeFlags(results, inputs) {
  const flags = [];
  if (parseFloat(results.totalPurchasePrice) > 500000)
    flags.push({ level: 'critical', icon: '🚨', text: 'Deal size exceeds $500B — likely to face significant antitrust scrutiny' });
  if (results.debtEBITDA !== 'N/A' && parseFloat(results.debtEBITDA) > 5)
    flags.push({ level: 'critical', icon: '🚨', text: 'Combined leverage is very high — debt burden may be unsustainable' });
  if (inputs.companyAShares > 0 && parseFloat(results.newSharesIssued) / inputs.companyAShares > 0.2)
    flags.push({ level: 'warning', icon: '⚠️', text: 'Significant share dilution — existing shareholders may be negatively impacted' });
  if (parseFloat(results.purchasePremium) > 50)
    flags.push({ level: 'warning', icon: '⚠️', text: 'Very high acquisition premium — overpaying risk is elevated' });
  return flags;
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function formatDollars(m) {
  const v = parseFloat(m);
  if (isNaN(v)) return 'N/A';
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}B`;
  return `$${v.toFixed(0)}M`;
}

// ── Narrative ─────────────────────────────────────────────────────────────────

export function buildNarrative(results, inputs, nameA, nameB, flags) {
  const a   = nameA || 'Company A';
  const b   = nameB || 'Company B';
  const priceStr = `$${(parseFloat(inputs.offerPricePerShare) || 0).toFixed(2)}`;
  const totalStr = formatDollars(results.totalPurchasePrice);
  const direction = results.isAccretive ? 'accretive' : 'dilutive';

  // When the acquirer is loss-making (standalone EPS ≤ 0) a percentage change from a negative base
  // is not meaningful — describe the absolute EPS move instead of reporting a misleading percentage.
  const pct = results.epsChangePct === null ? null : parseFloat(results.epsChangePct);
  let text;
  if (pct === null || isNaN(pct)) {
    text = `${a}'s acquisition of ${b} at ${priceStr}/share (${totalStr} total) moves pro forma EPS from $${results.companyAEPS} to $${results.proFormaEPS} — accretion/(dilution) is not meaningful from a non-positive EPS base.`;
  } else {
    const epsDir = results.isAccretive ? 'increasing' : 'decreasing';
    text = `${a}'s acquisition of ${b} at ${priceStr}/share (${totalStr} total) would be ${direction}, ${epsDir} EPS by ${Math.abs(pct).toFixed(1)}% from $${results.companyAEPS} to $${results.proFormaEPS}.`;
  }
  if (results.basesDiffer) {
    return `${a}'s acquisition of ${b} at ${priceStr}/share (${totalStr} total): pro forma EPS and accretion are not shown because the companies are on different bases. Put both on the same basis to combine them.`;
  }
  if (flags.length > 0) {
    text += ` ${flags[0].text.split('—')[0].trim()} represents the deal's biggest structural risk.`;
  }
  return text;
}
