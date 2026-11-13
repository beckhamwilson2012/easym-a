import { BASIS_LTM, DIFFERENT_BASES } from './companyBasis';

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

// What the toggle shows. Non-GAAP is offered when at least one company has at least one company-reported figure.
export function nonGaapAvailability({ ngA, ngB, loadingA, loadingB, tickerA, tickerB, privateA, privateB }) {
  if (loadingA || loadingB) return { state: 'loading', available: false, reason: 'checking each company’s fiscal-year earnings release' };
  const a = privateA ? { eps: null, ebitda: null } : reportedNonGaap(ngA);
  const b = privateB ? { eps: null, ebitda: null } : reportedNonGaap(ngB);
  if (a.eps || a.ebitda || b.eps || b.ebitda) return { state: 'ready', available: true, reason: null };
  const who = [tickerA || 'the acquirer', tickerB || 'the target'].join(' nor ');
  return { state: 'ready', available: false, reason: `neither ${who} reports an adjusted EPS or EBITDA that ties to GAAP in its fiscal-year earnings release` };
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
  const a = reportedNonGaap(ngA), b = reportedNonGaap(ngB);
  const ltmA = inputs?.companyABasis === BASIS_LTM, ltmB = inputs?.companyBBasis === BASIS_LTM;
  const tA = tickerA || 'the acquirer', tB = tickerB || 'the target';

  // EPS: both or neither.
  const epsNonGaap = !!(a.eps && b.eps) && !ltmA && !ltmB;
  let epsNote = null;
  if (!epsNonGaap) {
    const missing = [!a.eps && tA, !b.eps && tB].filter(Boolean);
    epsNote = missing.length
      ? `Year 1 non-GAAP EPS not available: ${missing.join(' and ')} ${missing.length > 1 ? 'don’t' : 'doesn’t'} report adjusted EPS`
      : `Year 1 non-GAAP EPS not available: ${FY_ONLY}`;
  }

  // EBITDA: each company on its own.
  const side = (x, ltm) => {
    if (!x.ebitda) return { nonGaap: false, value: null, reason: x.ebitdaReason };
    return { nonGaap: true, value: ltm ? null : x.ebitda.value, name: x.ebitda.name, rowLabel: x.ebitda.rowLabel, label: x.ebitda.label, accession: x.ebitda.accession, fiscalYear: x.ebitda.fiscalYear, note: ltm ? FY_ONLY : null };
  };
  const A = side(a, ltmA), B = side(b, ltmB);
  const combinable = A.nonGaap === B.nonGaap;
  const noChange = (!epsNonGaap && !A.nonGaap && !B.nonGaap) ? noChangeLine(a, b, tA, tB, epsNote) : null;
  return {
    selected: NON_GAAP,
    noChange,   // one line when Non-GAAP changes no figure for this pair; null otherwise
    eps: { nonGaap: epsNonGaap, note: epsNote, A: epsNonGaap ? a.eps : null, B: epsNonGaap ? b.eps : null },
    ebitda: { A, B, combinable, note: combinable ? null : DIFFERENT_BASES },
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
    out.companyADilutedShares = A.dilutedShares;
    out.companyADilutedSharesPeriod = { basis: 'non-GAAP diluted', end: A.fiscalYearEnd ?? null };
    out.companyBNetIncome = B.netIncome;
    out.companyBEPS = B.value;
    out.companyBDilutedShares = B.dilutedShares;
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
  return plan.eps.nonGaap ? 'non-GAAP EPS' : plan.eps.note;
}

// One company's EBITDA row label and footnote on a Non-GAAP deal, or null on GAAP.
export function ebitdaRow(plan, P) {
  if (!plan || plan.selected !== NON_GAAP) return null;
  const e = plan.ebitda[P];
  if (!e.nonGaap) return { label: 'EBITDA (computed, GAAP inputs)', nonGaap: false, value: undefined, note: null };
  return { label: `${e.name} (non-GAAP)`, nonGaap: true, value: e.value, note: e.note || e.label };
}

// The combined-EBITDA label on a Non-GAAP deal.
export function combinedEbitdaLabel(plan) {
  if (!plan || plan.selected !== NON_GAAP) return null;
  if (!plan.ebitda.combinable) return { basis: null, note: DIFFERENT_BASES };
  return { basis: plan.ebitda.A.nonGaap ? 'non-GAAP' : 'computed', note: null };
}
