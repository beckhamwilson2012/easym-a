import { BASIS_LTM, DIFFERENT_BASES } from './companyBasis';
import { computeAdjusted } from './computedAdjusted';

// The one GAAP | Non-GAAP switch. The input page's toggle picks the reporting basis; this file decides, for that
// choice, which of each company's figures the deal model and the deck use, and what every slide must say about it.
// Non-GAAP figures are company reported: /api/nongaap reads them from the fiscal-year-end earnings release's own
// reconciliation tables, and each one ties to GAAP there. Nothing here estimates, derives or defaults a figure.
//
// Rules (Fix 6):
//   EPS     — EPS, pro forma EPS, accretion and the verdict use non-GAAP only when BOTH companies report adjusted
//             EPS for the Year 1 period. Otherwise Year 1 EPS is "—" with the reason (Fix 10 Task 2: never a GAAP
//             Year 1 beside non-GAAP forward years); the forward years are FMP consensus (non-GAAP).
//   EBITDA  — each company uses its own adjusted EBITDA where reported, under the company's own name. A combined
//             EBITDA adds the two only when both are on the same basis; otherwise "—" (companies on different bases).
//   Period  — non-GAAP figures are fiscal-year only. A company card on LTM shows its non-GAAP rows as "—".
//   GAAP    — with GAAP selected the inputs pass through untouched, so every deck is exactly what it was.
//   Computed (Fix 13) — where a company's release has no reconciled figure for the period (no adjusted EPS, no adjusted
//             EBITDA, or an LTM card, which no fiscal-year release covers), the figure is computed by the one calculation
//             (src/lib/computedAdjusted.js) from the company's filed facts, and labeled "Computed by EasyM&A: …" everywhere.
//             A company-reported figure always wins for its period. Computed and reported are both non-GAAP, so EPS and
//             combined EBITDA may pair one of each; the slides say which is which.

export const GAAP = 'GAAP';
export const NON_GAAP = 'Non-GAAP';
export const FY_ONLY = 'non-GAAP available for fiscal year only';
export { DIFFERENT_BASES };

const fin = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

// The ⓘ text beside a company-reported adjusted EPS whose filing shows no per-share adjustments (DDOG): the server
// checked it as filed non-GAAP net income ÷ filed non-GAAP diluted shares (method 'net-income identity'). The note
// says whether that quotient rounds to the filed EPS. null for every other method (the per-share table itself ties).
export function epsCheckNote(ticker, eps) {
  if (!eps || eps.checkMethod !== 'net-income identity') return null;
  const v = fin(eps.value), ni = fin(eps.netIncome), sh = fin(eps.dilutedShares);
  if (v == null || ni == null || !(sh > 0)) return null;
  const q = ni / sh;
  const ties = Math.round(q * 100) === Math.round(v * 100);
  return `${ticker} doesn't list per-share adjustments, so $${v.toFixed(2)} is checked as filed non-GAAP net income ÷ filed non-GAAP diluted shares. `
    + (ties ? 'It ties to the cent.' : `It does not tie: ${q.toFixed(3)} against the filed $${v.toFixed(2)}.`);
}

// One company's usable figures from its /api/nongaap payload. Adjusted EPS is usable for the deal only with the
// net income and diluted share count it was filed with (the deal model divides one by the other).
export function reportedNonGaap(payload) {
  const f = (payload && payload.figures) || {};
  const r = (payload && payload.reasons) || {};
  const eps = f.eps && fin(f.eps.value) != null && f.netIncome && fin(f.netIncome.value) != null && f.dilutedShares && fin(f.dilutedShares.value) > 0
    ? {
        value: fin(f.eps.value), netIncome: fin(f.netIncome.value), dilutedShares: fin(f.dilutedShares.value),
        rowLabel: f.eps.rowLabel || null, label: f.eps.label || null, period: f.eps.period || null,
        accession: f.eps.accession || payload.sourceAccession || null, fiscalYear: payload.fiscalYear ?? null, fiscalYearEnd: payload.fiscalYearEnd ?? null,
        checkMethod: f.eps.method || null,   // how the server tied the EPS to GAAP: per-share reconciliation, or net-income identity
      }
    : null;
  const ebitda = f.ebitda && fin(f.ebitda.value) != null
    ? {
        value: fin(f.ebitda.value), name: f.ebitda.name || f.ebitda.rowLabel || 'Adjusted EBITDA', rowLabel: f.ebitda.rowLabel || null,
        label: f.ebitda.label || null, period: f.ebitda.period || null, accession: f.ebitda.accession || payload.sourceAccession || null,
        fiscalYear: payload.fiscalYear ?? null,
      }
    : null;
  return {
    eps, ebitda,
    epsReason: eps ? null : (r.eps || r.netIncome || r.dilutedShares || 'no adjusted EPS reported'),
    ebitdaReason: ebitda ? null : (r.ebitda || 'no adjusted EBITDA reported'),
  };
}

// Fix 16: one company's company-reported LTM figures, the sum of its last four quarterly releases (/api/nongaap `ltm`).
// A figure is here only when all four quarters report it; otherwise null with the reason, and the LTM figure is computed.
// The LTM EPS is the sum of the four quarters' EPS; the deal's Year 1 keeps the diluted count it already uses.
export const LTM_REPORTED = 'company reported, sum of four quarterly releases';
export function reportedLtmNonGaap(payload) {
  const l = payload && payload.ltm;
  if (!l) return { eps: null, ebitda: null };
  const eps = l.eps && fin(l.eps.value) != null && l.netIncome && fin(l.netIncome.value) != null
    ? { value: fin(l.eps.value), netIncome: fin(l.netIncome.value), dilutedShares: null, ltmReported: true, quarters: l.eps.quarters || [], niQuarters: l.netIncome.quarters || [],
        rowLabel: l.eps.rowLabel || null, label: l.eps.label || null, period: l.eps.period || null, accession: null, fiscalYear: null, fiscalYearEnd: null, checkMethod: null }
    : null;
  const ebitda = l.ebitda && fin(l.ebitda.value) != null
    ? { value: fin(l.ebitda.value), name: l.ebitda.name || l.ebitda.rowLabel || 'Adjusted EBITDA', rowLabel: l.ebitda.rowLabel || null, label: l.ebitda.label || null, period: l.ebitda.period || null, quarters: l.ebitda.quarters || [] }
    : null;
  return { eps, ebitda, epsReason: eps ? null : (l.reasons && l.reasons.eps) || null, ebitdaReason: ebitda ? null : (l.reasons && l.reasons.ebitda) || null };
}

// What the toggle shows. Non-GAAP is offered when at least one company has at least one company-reported figure.
export function nonGaapAvailability({ ngA, ngB, loadingA, loadingB, tickerA, tickerB, privateA, privateB }) {
  if (loadingA || loadingB) return { state: 'loading', available: false, reason: 'checking each company’s fiscal-year earnings release' };
  const a = privateA ? { eps: null, ebitda: null } : reportedNonGaap(ngA);
  const b = privateB ? { eps: null, ebitda: null } : reportedNonGaap(ngB);
  if (a.eps || a.ebitda || b.eps || b.ebitda) return { state: 'ready', available: true, reason: null };
  const la = privateA ? {} : reportedLtmNonGaap(ngA), lb = privateB ? {} : reportedLtmNonGaap(ngB);
  if (la.eps || la.ebitda || lb.eps || lb.ebitda) return { state: 'ready', available: true, reason: null };
  if ((!privateA && anyComputed(ngA)) || (!privateB && anyComputed(ngB))) return { state: 'ready', available: true, reason: null };
  const who = [tickerA || 'the acquirer', tickerB || 'the target'].join(' nor ');
  return { state: 'ready', available: false, reason: `neither ${who} reports an adjusted EPS or EBITDA that ties to GAAP in its fiscal-year earnings release, and neither can be computed from its filings` };
}

// Whether a computed adjusted net income or EBITDA exists for either period (Fix 13).
function anyComputed(payload) {
  const c = payload && payload.computed;
  if (!c) return false;
  return [c.fy, c.ltm].some((p) => { if (!p) return false; const r = computeAdjusted(p); return r.netIncome != null || r.ebitda != null; });
}

// One company's computed figures for the card's period, on the Year 1 diluted share count. null when no inputs.
function computedFor(payload, ltm, dilutedShares) {
  const c = payload && payload.computed;
  const per = c ? (ltm ? c.ltm : c.fy) : null;
  if (!per) return { r: null, reason: (c && c.reasons && (ltm ? c.reasons.ltm : c.reasons.fy)) || 'no filed inputs for a computed figure' };
  return { r: computeAdjusted(per, { dilutedShares }), reason: null };
}

// The default the toggle starts on: Non-GAAP when anything is available, else GAAP.
export const defaultBasis = (availability) => (availability && availability.available ? NON_GAAP : GAAP);

// The basis the deal is built on: the user's pick if it is allowed, else the default.
export function effectiveBasis(choice, availability) {
  if (choice === GAAP) return GAAP;
  if (choice === NON_GAAP) return availability && availability.available ? NON_GAAP : GAAP;
  return defaultBasis(availability);
}

const GAAP_PLAN = Object.freeze({ selected: GAAP, eps: { nonGaap: false, note: null, A: null, B: null }, ebitda: { A: { nonGaap: false }, B: { nonGaap: false }, combinable: true, note: null } });

// The plan for one deal: which figures each company uses and what the slides say.
export function resolveReportingBasis({ selected, ngA, ngB, inputs, tickerA, tickerB }) {
  if (selected !== NON_GAAP) return GAAP_PLAN;
  // Fix 16: a computed figure needs filed inputs for BOTH companies. With a private counterparty (no payload) neither side
  // is computed, so a tuck-in's two EBITDAs stay on one basis and combine, as they did before Fix 13.
  if (!ngA || !ngB) { ngA = ngA && { ...ngA, computed: null }; ngB = ngB && { ...ngB, computed: null }; }
  const a = reportedNonGaap(ngA), b = reportedNonGaap(ngB);
  const ltmA = inputs?.companyABasis === BASIS_LTM, ltmB = inputs?.companyBBasis === BASIS_LTM;
  const tA = tickerA || 'the acquirer', tB = tickerB || 'the target';

  // Computed figures (Fix 13) for each card's period, on the diluted count Year 1 already uses.
  const cA = computedFor(ngA, ltmA, inputs?.companyADilutedShares), cB = computedFor(ngB, ltmB, inputs?.companyBDilutedShares);
  // Company-reported LTM figures (Fix 16): on an LTM card they win over a computed figure.
  const lA = ltmA ? reportedLtmNonGaap(ngA) : {}, lB = ltmB ? reportedLtmNonGaap(ngB) : {};

  // EPS: both or neither. Each side is its company-reported figure (fiscal-year card only), else its computed figure.
  const epsSide = (x, ltm, c, t, l) => {
    if (x.eps && !ltm) return { eps: x.eps, why: null };
    if (ltm && l.eps) return { eps: l.eps, why: null };
    if (c.r && c.r.eps != null) return { eps: computedEps(c.r), why: null };
    const head = x.eps ? `${t} has no company-reported EPS for the LTM period (${FY_ONLY})`
      : NOT_REPORTED.test(x.epsReason || '') ? `${t} doesn’t report adjusted EPS` : `${t}’s adjusted EPS doesn’t tie to GAAP in its release`;
    return { eps: null, why: `${head}, and its computed figure is “—”: ${(c.r && c.r.epsReason) || c.reason}` };
  };
  const eA = epsSide(a, ltmA, cA, tA, lA), eB = epsSide(b, ltmB, cB, tB, lB);
  const epsNonGaap = !!(eA.eps && eB.eps);
  let epsNote = null;
  if (!epsNonGaap && !(ngA && ngA.computed) && !(ngB && ngB.computed)) {
    // No computed inputs in either payload (a private company, or a payload from before Fix 13): the wording is unchanged.
    const missing = [!a.eps && tA, !b.eps && tB].filter(Boolean);
    epsNote = missing.length
      ? `Year 1 non-GAAP EPS not available: ${missing.join(' and ')} ${missing.length > 1 ? 'don’t' : 'doesn’t'} report adjusted EPS`
      : `Year 1 non-GAAP EPS not available: ${FY_ONLY}`;
  } else if (!epsNonGaap) epsNote = `Year 1 non-GAAP EPS not available: ${[eA.why, eB.why].filter(Boolean).join('; ')}`;

  // EBITDA: each company on its own. Company reported (fiscal-year card), else computed, else GAAP computed.
  // fyValue (Fix 14 Task 5): the filed fiscal-year figure, for its own fiscal-year column on the P&L even when the card is
  // on LTM.
  const side = (x, ltm, c, l) => {
    const fy = x.ebitda ? { fyValue: x.ebitda.value, period: x.ebitda.period || null } : {};
    if (ltm && l.ebitda) return { nonGaap: true, ltmReported: true, value: l.ebitda.value, fyValue: x.ebitda ? x.ebitda.value : null, period: l.ebitda.period, name: l.ebitda.name, rowLabel: l.ebitda.rowLabel, label: l.ebitda.label, accession: null, fiscalYear: x.ebitda ? x.ebitda.fiscalYear : null, note: null, quarters: l.ebitda.quarters };
    if (x.ebitda && !ltm) return { nonGaap: true, value: x.ebitda.value, ...fy, name: x.ebitda.name, rowLabel: x.ebitda.rowLabel, label: x.ebitda.label, accession: x.ebitda.accession, fiscalYear: x.ebitda.fiscalYear, note: null };
    if (c.r && c.r.ebitda != null) return { nonGaap: true, computed: true, value: c.r.ebitda, name: COMPUTED_EBITDA_NAME, rowLabel: null, label: c.r.ebitdaLabel || c.r.label, accession: null, fiscalYear: x.ebitda ? x.ebitda.fiscalYear : null, note: null, result: c.r };
    if (x.ebitda) return { nonGaap: true, value: null, ...fy, name: x.ebitda.name, rowLabel: x.ebitda.rowLabel, label: x.ebitda.label, accession: x.ebitda.accession, fiscalYear: x.ebitda.fiscalYear, note: FY_ONLY };
    return { nonGaap: false, value: null, reason: x.ebitdaReason, computedReason: (c.r && c.r.ebitdaReason) || c.reason };
  };
  const A = side(a, ltmA, cA, lA), B = side(b, ltmB, cB, lB);
  const combinable = A.nonGaap === B.nonGaap;
  const noChange = (!epsNonGaap && !A.nonGaap && !B.nonGaap) ? noChangeLine(a, b, tA, tB, epsNote) : null;
  return {
    selected: NON_GAAP,
    tickers: { A: tA, B: tB },   // Fix 13: the source lines name each company
    noChange,   // one line when Non-GAAP changes no figure for this pair; null otherwise
    eps: { nonGaap: epsNonGaap, note: epsNote, A: epsNonGaap ? eA.eps : null, B: epsNonGaap ? eB.eps : null },
    ebitda: { A, B, combinable, note: combinable ? null : DIFFERENT_BASES },
  };
}

// A computed EPS in the same shape as a company-reported one (the deal model reads value / netIncome / dilutedShares).
export const COMPUTED_EBITDA_NAME = 'Adjusted EBITDA';
function computedEps(r) {
  return {
    value: r.eps, netIncome: r.netIncome, dilutedShares: r.dilutedShares, computed: true, result: r,
    rowLabel: 'Adjusted EPS (computed)', label: r.label, period: r.period ? r.period.label : null,
    accession: null, fiscalYear: null, fiscalYearEnd: null, checkMethod: null,
  };
}

// "Non-GAAP changes nothing here: …" — why, from each company's own reasons. "Doesn't report" only where the release has no
// such row; a figure the release prints but that does not tie to GAAP (TDOC's Adjusted EBITDA) is said so, never "not reported".
const NOT_REPORTED = /^no (adjusted|non-gaap)\b|^no adjusted (eps|ebitda) reported$/i;
function noChangeLine(a, b, tA, tB, epsNote) {
  // Fix 10 Task 2: Non-GAAP now changes the EPS figures (Year 1 "—", forward years on consensus), so the line says that.
  const eps = [];
  if (a.eps && b.eps) eps.push(epsNote.replace(/^Year 1 non-GAAP EPS not available: /, ''));   // both report, but an LTM card has no non-GAAP period
  else [[a, tA], [b, tB]].forEach(([x, t]) => { if (!x.eps) eps.push(NOT_REPORTED.test(x.epsReason || '') ? `${t} doesn’t report adjusted EPS` : `${t}’s adjusted EPS doesn’t tie to GAAP in its release`); });
  const ebitda = [];
  [[a, tA], [b, tB]].forEach(([x, t]) => { if (!x.ebitda) ebitda.push(NOT_REPORTED.test(x.ebitdaReason || '') ? `${t} doesn’t report adjusted EBITDA` : `${t}’s adjusted EBITDA doesn’t tie to GAAP in its release`); });
  return `On Non-GAAP, Year 1 EPS is “—” (${eps.join('; ')}) and the forward years use FMP consensus (non-GAAP). EBITDA stays computed: ${ebitda.join('; ')}.`;
}

// The deal model's inputs on the plan's basis. GAAP: the same object, untouched.
export function applyReportingBasis(inputs, plan) {
  if (!plan || plan.selected !== NON_GAAP) return inputs;
  const out = { ...inputs, reportingBasis: NON_GAAP };
  if (!plan.eps.nonGaap) {
    // Fix 10 Task 2: no company-reported EPS for Year 1 → Year 1's EPS legs are absent ("—"), never the GAAP figures.
    // The forward years (consensus, non-GAAP) still compute: forwardYearInputs replaces both net incomes there.
    out.companyAEPS = null;
    out.companyANetIncome = null;
    out.companyBNetIncome = null;
    out.year1Reason = plan.eps.note;
  }
  if (plan.eps.nonGaap) {
    const A = plan.eps.A, B = plan.eps.B;
    out.companyANetIncome = A.netIncome;
    out.companyAEPS = A.value;
    // A computed EPS is on the Year 1 diluted count already in the inputs (Fix 13), so the count and its period stay as they are.
    // So is a company-reported LTM EPS (Fix 16): the sum of four quarters' EPS has no single filed share count.
    if (!A.computed && !A.ltmReported) {
      out.companyADilutedShares = A.dilutedShares;
      out.companyADilutedSharesPeriod = { basis: 'non-GAAP diluted', end: A.fiscalYearEnd ?? null };
    }
    out.companyBNetIncome = B.netIncome;
    out.companyBEPS = B.value;
    if (!B.computed && !B.ltmReported) out.companyBDilutedShares = B.dilutedShares;
  }
  out.companyAEpsBasis = NON_GAAP;   // Year 1 is non-GAAP or "—"; the forward years are consensus (non-GAAP)
  out.companyBEpsBasis = NON_GAAP;
  ['A', 'B'].forEach((P) => {
    const e = plan.ebitda[P];
    out[`company${P}EbitdaBasis`] = e.nonGaap ? NON_GAAP : GAAP;
    if (e.nonGaap) out[`company${P}EBITDA`] = e.value;   // null on an LTM card: shown "—", never the GAAP figure
  });
  return out;
}

// Both tagged and different: the combined EBITDA (and every ratio on it) is not added.
export const ebitdaBasesDiffer = (inputs) => !!(inputs?.companyAEbitdaBasis && inputs?.companyBEbitdaBasis && inputs.companyAEbitdaBasis !== inputs.companyBEbitdaBasis);

// ── Labels the slides use (only on a Non-GAAP deal; a GAAP deal keeps the deck's existing wording) ──
export const isNonGaapDeal = (deal) => !!(deal && deal.reportingBasis && deal.reportingBasis.selected === NON_GAAP);

// "Diluted EPS (non-GAAP)" / "Diluted EPS (GAAP)" plus the reason line when the deal had to stay on GAAP.
export function epsBasisLabel(plan) {
  if (!plan || plan.selected !== NON_GAAP) return null;
  if (!plan.eps.nonGaap) return plan.eps.note;
  const comp = computedSides(plan);
  return comp.length ? `non-GAAP EPS (${epsSourceText(plan)})` : 'non-GAAP EPS';
}

// Fix 13: which side's Year 1 EPS is computed. [] when both are company reported (every existing label then stands).
export const computedSides = (plan) => (plan && plan.eps && plan.eps.nonGaap ? ['A', 'B'].filter((P) => plan.eps[P] && plan.eps[P].computed) : []);

// "HNGE company reported; OMDA Computed by EasyM&A: …" — the source of each company's Year 1 non-GAAP EPS.
// Fix 19 Task 5: `sideText` replaces one company's text (the Deal Summary passes the deal's own EPS method for the acquirer).
export function epsSourceText(plan, tickers = {}, sideText = {}) {
  if (!plan || !plan.eps || !plan.eps.nonGaap) return null;
  return ['A', 'B'].map((P) => {
    const e = plan.eps[P];
    const t = tickers[P] || plan.tickers?.[P] || (P === 'A' ? 'acquirer' : 'target');
    if (sideText[P]) return `${t}: ${sideText[P]}`;
    return e.computed ? `${t}: ${e.label}` : e.ltmReported ? `${t}: ${LTM_REPORTED}` : `${t}: company reported`;
  }).join('; ');
}

// The source of one company's non-GAAP EBITDA on a Non-GAAP deck: "company reported" or the computed label.
export const ebitdaSourceText = (e) => (e && e.nonGaap ? (e.computed ? e.label : e.ltmReported ? LTM_REPORTED : 'company reported') : null);

// One company's EBITDA row label and footnote on a Non-GAAP deal, or null on GAAP.
export function ebitdaRow(plan, P) {
  if (!plan || plan.selected !== NON_GAAP) return null;
  const e = plan.ebitda[P];
  if (!e.nonGaap) return { label: 'EBITDA (computed, GAAP inputs)', nonGaap: false, value: undefined, note: null };
  if (e.computed) return { label: `${e.name} (non-GAAP, computed by EasyM&A)`, nonGaap: true, computed: true, value: e.value, note: e.label };
  if (e.ltmReported) return { label: `${e.name} (non-GAAP, LTM, sum of four quarters)`, nonGaap: true, value: e.value, note: e.label };
  return { label: `${e.name} (non-GAAP)`, nonGaap: true, value: e.value, note: e.note || e.label };
}

// The combined-EBITDA label on a Non-GAAP deal.
export function combinedEbitdaLabel(plan) {
  if (!plan || plan.selected !== NON_GAAP) return null;
  if (!plan.ebitda.combinable) return { basis: null, note: DIFFERENT_BASES };
  // Fix 13: one or both non-GAAP EBITDAs computed. `note` stays null (it means "not combinable" to every slide); `sources`
  // says which company's figure is which, and `short` is the same in a few words for labels.
  if (plan.ebitda.A.nonGaap && (plan.ebitda.A.computed || plan.ebitda.B.computed)) return { basis: 'non-GAAP', note: null, sources: combinedEbitdaSources(plan), short: combinedEbitdaShort(plan) };
  return { basis: plan.ebitda.A.nonGaap ? 'non-GAAP' : 'computed', note: null };
}

// "HNGE computed by EasyM&A, OMDA company reported".
export function combinedEbitdaShort(plan) {
  if (!plan || !plan.ebitda || !plan.ebitda.A.nonGaap || !plan.ebitda.B.nonGaap) return null;
  return ['A', 'B'].map((P) => `${plan.tickers?.[P] || (P === 'A' ? 'acquirer' : 'target')} ${plan.ebitda[P].computed ? 'computed by EasyM&A' : 'company reported'}`).join(', ');
}

// Fix 13: which company's non-GAAP EBITDA is company reported and which is computed, for the combined-EBITDA footnote.
export function combinedEbitdaSources(plan, tickers = {}) {
  if (!plan || !plan.ebitda || !plan.ebitda.A.nonGaap || !plan.ebitda.B.nonGaap) return null;
  return ['A', 'B'].map((P) => `${tickers[P] || plan.tickers?.[P] || (P === 'A' ? 'acquirer' : 'target')}: ${ebitdaSourceText(plan.ebitda[P])}`).join('; ');
}
