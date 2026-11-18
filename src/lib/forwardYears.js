import { NON_GAAP } from './reportingBasis';
import { BASIS_LTM, basesDiffer } from './companyBasis';
import { SYNERGY_YEARS } from './synergies';

// The forward accretion years (Years 2–4), chosen once for slide 9's tables and strip, the deal verdict and the input
// page's premium solve (Fix 10 Tasks 2 and 3). Nothing here computes a figure; it only decides which /api/pnl forward
// column each year reads, and why a year is "—".
//
//   Basis (Task 2). FMP's consensus EPS is on the non-GAAP basis (FIX6: it matches NET's and DDOG's own non-GAAP
//   guidance). It is labeled CONSENSUS_BASIS wherever it appears. On a GAAP deal there is no GAAP forecast, so every
//   forward EPS year is "—" with NO_GAAP_FORECAST; Year 1 GAAP stays. A GAAP figure and a consensus figure are never
//   put in one year.
//   Mixed bases (Fix 21 Task 6). With one company on LTM and the other on a fiscal year, Year 1 cannot be combined on either
//   toggle, so the forward years are the deal's only common basis: consensus for both, on a GAAP deck too, and every
//   forward year starts after the LATER of the two Year 1 periods, so neither company's year overlaps it.
//   Period (Task 3). Year 2 is the first fiscal year that begins after Year 1's period ends, so no forward year overlaps
//   Year 1: HNGE on LTM to 9/30/2026 → Year 2 = FY2027 (FY2026 began 1/1/2026, inside Year 1). On the fiscal-year card
//   (Year 1 = FY2025) Year 2 = FY2026, as before. A year with no consensus is "—" with the reason.

export const CONSENSUS_BASIS = 'FMP consensus (non-GAAP)';
export const NO_GAAP_FORECAST = 'consensus is non-GAAP; no GAAP forecast';
export const FORWARD_SLOTS = 3;

// Fix 19 Task 2: the one synergy-year rule. Accretion Year N carries synergy Year N for N = 1–3 (the deal's synergy
// schedule, SYNERGY_YEARS), whatever period Year 1 is (LTM or FY) and whether or not Year 1 computes. A year past the
// schedule (Year 4) carries none: null, and its row says BEYOND_SYNERGY_SCHEDULE.
export const synergyYearFor = (year) => (SYNERGY_YEARS.includes(year) ? year : null);
export const BEYOND_SYNERGY_SCHEDULE = `no synergies (beyond the Year ${SYNERGY_YEARS[0]}–${SYNERGY_YEARS[SYNERGY_YEARS.length - 1]} synergy schedule)`;
// That year's figure from a per-year list (synergiesY1..Y3, or deal.synergies.years). A year past the schedule has no
// synergy by the rule above, so the caller gets undefined, never the neighbouring year's figure.
export const synergyForSlot = (list, slot) => (slot && slot.synYr != null && Array.isArray(list) ? list[slot.synYr - 1] : undefined);

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
// EPS test can run, reason says why not. synYr is the synergy year it carries (synergyYearFor: Year 2 → Year-2 synergies, Year 4 → null).
export function selectForwardYears({ inputs, acquirerFwd, targetFwd, acquirerName, targetName, privateTarget }) {
  const A = acquirerName || 'the acquirer';
  const T = targetName || 'the target';
  const mixed = basesDiffer(inputs);
  const gaap = inputs?.reportingBasis !== NON_GAAP && !mixed;
  const endA = year1End(inputs, 'A'), endB = year1End(inputs, 'B');
  const laterEnd = mixed && endA && endB ? (endA > endB ? endA : endB) : null;
  const fA = firstFiscalYearAfter(laterEnd || endA, inputs?.companyAFiscalYearEnd);
  const fB = firstFiscalYearAfter(laterEnd || endB, inputs?.companyBFiscalYearEnd);
  // /api/pnl returns at most three forecast years after the latest 10-K (server.js, `.slice(0, 3)`): a year past them is
  // not "no consensus", it is beyond what the deck loads, and the reason says so.
  const beyond = (cols, fy) => {
    const fys = (Array.isArray(cols) ? cols : []).filter((c) => c && !c.actual && c.fy != null).map((c) => c.fy);
    return fys.length >= FORWARD_SLOTS && fy > Math.max(...fys) ? `FY${fy} is beyond the three forecast years the deck loads (FY${Math.min(...fys)}–FY${Math.max(...fys)})` : null;
  };
  const find = (cols, fy) => (fy != null && Array.isArray(cols) ? cols.find((c) => c && !c.actual && c.fy === fy) || null : null);
  const slots = [];
  for (let k = 0; k < FORWARD_SLOTS; k++) {
    const fyA = fA != null ? fA + k : null;
    const fyB = fB != null ? fB + k : null;
    const a = find(acquirerFwd, fyA), b = find(targetFwd, fyB);
    let reason = null;
    if (gaap) reason = NO_GAAP_FORECAST;
    // For a private deal the verdict hook loads no forecasts at all (acquirerFwd is null, not []): that is not the
    // acquirer's gap and must not be blamed on it (CHECK4/FIX7B "no forecast EPS for HNGE"). A loaded, empty list is.
    else if (privateTarget && !Array.isArray(acquirerFwd)) reason = `${T} has no forecast EPS (a private company has no analyst consensus)`;
    else if (!Array.isArray(acquirerFwd) || !acquirerFwd.length) reason = `no forecast EPS for ${A}`;
    else if (privateTarget) reason = `${T} has no forecast EPS (a private company has no analyst consensus)`;
    else if (mixed && (!Array.isArray(targetFwd) || !targetFwd.length)) reason = `no forecast EPS for ${T}`;
    else if (fyA == null) reason = `${A}'s Year 1 period or fiscal year end is not known`;
    else if (!a || a.eps == null) reason = beyond(acquirerFwd, fyA) || `no FMP consensus EPS for ${A} FY${fyA}`;
    else if (fyB == null) reason = `${T}'s Year 1 period or fiscal year end is not known`;
    else if (!b || b.eps == null) reason = beyond(targetFwd, fyB) || `no FMP consensus EPS for ${T} FY${fyB}`;
    slots.push({
      year: k + 2, synYr: synergyYearFor(k + 2), fyA, fyB,
      label: fyA != null ? `FY${fyA}E` : null,
      a, b, epsOk: reason == null, reason,
      // Why the column itself (revenue, EBIT, net income) is missing, for the slide 9 tables.
      colReason: fyA == null ? `${A}'s fiscal year end is not known` : !a ? (beyond(acquirerFwd, fyA) || `no FMP consensus for ${A} FY${fyA}`) : (!privateTarget && !b) ? `no FMP consensus for ${T} FY${fyB}` : null,
    });
  }
  return { slots, gaap, mixed, firstFy: { A: fA, B: fB } };
}

// "Year 2 (FY2027E)" for the verdict's "uses" line.
export const slotName = (s) => `Year ${s.year}${s.label ? ` (${s.label})` : ''}`;
