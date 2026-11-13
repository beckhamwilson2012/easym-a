import { NON_GAAP } from './reportingBasis';
import { BASIS_LTM } from './companyBasis';

// The forward accretion years (Years 2–4), chosen once for slide 9's tables and strip, the deal verdict and the input
// page's premium solve (Fix 10 Tasks 2 and 3). Nothing here computes a figure; it only decides which /api/pnl forward
// column each year reads, and why a year is "—".
//
//   Basis (Task 2). FMP's consensus EPS is on the non-GAAP basis (FIX6: it matches NET's and DDOG's own non-GAAP
//   guidance). It is labeled CONSENSUS_BASIS wherever it appears. On a GAAP deal there is no GAAP forecast, so every
//   forward EPS year is "—" with NO_GAAP_FORECAST; Year 1 GAAP stays. A GAAP figure and a consensus figure are never
//   put in one year.
//   Period (Task 3). Year 2 is the first fiscal year that begins after Year 1's period ends, so no forward year overlaps
//   Year 1: HNGE on LTM to 9/30/2026 → Year 2 = FY2027 (FY2026 began 1/1/2026, inside Year 1). On the fiscal-year card
//   (Year 1 = FY2025) Year 2 = FY2026, as before. A year with no consensus is "—" with the reason.

export const CONSENSUS_BASIS = 'FMP consensus (non-GAAP)';
export const NO_GAAP_FORECAST = 'consensus is non-GAAP; no GAAP forecast';
export const FORWARD_SLOTS = 3;

const isoDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

// Year 1's period end for one company: its LTM end on an LTM card, else its fiscal year end.
export function year1End(inputs, P) {
  return isoDate(inputs?.[`company${P}Basis`] === BASIS_LTM ? inputs?.[`company${P}LtmAsOf`] : inputs?.[`company${P}FiscalYearEnd`]);
}

// The first fiscal year (named by the calendar year it ends in, as /api/pnl labels it) that begins after `end`, for a
// company whose fiscal year ends on the month-day of `fyeIso`. null when either date is unknown.
export function firstFiscalYearAfter(end, fyeIso) {
  const e = isoDate(end), fye = isoDate(fyeIso);
  if (!e || !fye) return null;
  const md = fye.slice(5);
  let y = parseInt(e.slice(0, 4), 10);
  if (`${y}-${md}` < e) y += 1;   // y: the fiscal year that contains (or ends on) Year 1's end
  return y + 1;                   // the next one begins the day after y's year end
}

// slots[k] is Year k+2. a / b are the companies' /api/pnl forward columns for that year (or null), epsOk says whether the
// EPS test can run, reason says why not. synYr is the synergy year it carries (Year 2 → Year-1 synergies, as before).
export function selectForwardYears({ inputs, acquirerFwd, targetFwd, acquirerName, targetName, privateTarget }) {
  const A = acquirerName || 'the acquirer';
  const T = targetName || 'the target';
  const gaap = inputs?.reportingBasis !== NON_GAAP;
  const firstCol = (cols) => (Array.isArray(cols) ? (cols.find((c) => c && !c.actual && c.fy != null)?.fy ?? null) : null);
  const fA = firstCol(acquirerFwd);
  const fB = firstCol(targetFwd);
  const find = (cols, fy) => (fy != null && Array.isArray(cols) ? cols.find((c) => c && !c.actual && c.fy === fy) || null : null);
  const slots = [];
  for (let k = 0; k < FORWARD_SLOTS; k++) {
    const fyA = fA != null ? fA + k : null;
    const fyB = fB != null ? fB + k : null;
    const a = find(acquirerFwd, fyA), b = find(targetFwd, fyB);
    let reason = null;
    if (gaap) reason = NO_GAAP_FORECAST;
    else if (!Array.isArray(acquirerFwd) || !acquirerFwd.length) reason = `no forecast EPS for ${A}`;
    else if (fyA == null) reason = `${A}'s Year 1 period or fiscal year end is not known`;
    else if (!a || a.eps == null) reason = `no FMP consensus EPS for ${A} FY${fyA}`;
    else if (privateTarget) reason = `${T} has no forecast EPS (a private company has no analyst consensus)`;
    else if (fyB == null) reason = `${T}'s Year 1 period or fiscal year end is not known`;
    else if (!b || b.eps == null) reason = `no FMP consensus EPS for ${T} FY${fyB}`;
    slots.push({
      year: k + 2, synYr: k + 1, fyA, fyB,
      label: fyA != null ? `FY${fyA}E` : null,
      a, b, epsOk: reason == null, reason,
      // Why the column itself (revenue, EBIT, net income) is missing, for the slide 9 tables.
      colReason: fyA == null ? `${A}'s fiscal year end is not known` : !a ? `no FMP consensus for ${A} FY${fyA}` : (!privateTarget && !b) ? `no FMP consensus for ${T} FY${fyB}` : null,
    });
  }
  return { slots, gaap, firstFy: { A: fA, B: fB } };
}

// "Year 2 (FY2027E)" for the verdict's "uses" line.
export const slotName = (s) => `Year ${s.year}${s.label ? ` (${s.label})` : ''}`;
