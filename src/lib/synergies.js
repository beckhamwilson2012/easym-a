import { basesDiffer, DIFFERENT_BASES } from './companyBasis';

// The one synergy calculation. Every slide, the deal model and the input page read this schedule; nothing else
// derives a synergy figure.
//
// inputs.synergiesY1..3 are the COST synergies as entered, inputs.revenueSynergiesY1..3 the revenue synergies.
// Empty is null, and means no synergy is assumed: it adds nothing and renders "none entered". A typed 0 is a real 0.
//   Cost synergies add to EBITDA dollar for dollar.
//   Revenue synergies add to pro forma revenue, and add to EBITDA at the combined gross margin from filed figures.
//   With no such margin, they add to revenue only, and the schedule carries the reason so the slides can flag it.

// App defaults, editable on the input page. They are not market figures.
export const SYNERGY_PRESETS = [
  { key: 'conservative', label: 'Conservative', pct: 2 },
  { key: 'base',         label: 'Base',         pct: 3.5 },
  { key: 'aggressive',   label: 'Aggressive',   pct: 5 },
];
export const SYNERGY_RAMP = [0.4, 0.7, 1];
export const SYNERGY_YEARS = [1, 2, 3];
export const NONE_ENTERED = 'none entered';

const val = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// Year 1-3 dollars for one preset: base × pct × ramp. toFixed strips float noise, it does not round the figure.
export function presetYears(base, pct) {
  const b = val(base), p = val(pct);
  if (b == null || p == null) return null;
  return SYNERGY_RAMP.map((r) => Number((b * (p / 100) * r).toFixed(6)));
}

// The same definition as the Standalone P&L's operating expense line: gross profit − operating income.
export function totalOperatingExpenses(grossProfit, operatingIncome) {
  const g = val(grossProfit), o = val(operatingIncome);
  return (g != null && o != null) ? g - o : null;
}

const periodOf = (inputs, P) => inputs[`company${P}PeriodLabel`] || 'period unknown';
const SOURCE_NAMES = { sec_edgar: 'SEC EDGAR', fmp: 'FMP', yahoo: 'Yahoo Finance' };
const sourceOf = (inputs, P) => SOURCE_NAMES[inputs[`company${P}DataSource`]] || 'entered by hand';

// Cost presets: % of the target's cost of revenue + total operating expenses. Either figure null → no base.
export function costSynergyBase(inputs) {
  const costOfRevenue = val(inputs.companyBCostOfRevenue);
  const operatingExpenses = totalOperatingExpenses(inputs.companyBGrossProfit, inputs.companyBOperatingIncome);
  const missing = [];
  if (costOfRevenue == null) missing.push('cost of revenue');
  if (operatingExpenses == null) missing.push('total operating expenses');
  return {
    amount: missing.length ? null : costOfRevenue + operatingExpenses,
    costOfRevenue, operatingExpenses, missing,
    period: periodOf(inputs, 'B'),
    source: `cost of revenue: ${inputs.companyBCostOfRevenueSource || 'not available'}; operating expenses: gross profit − operating income, ${sourceOf(inputs, 'B')}`,
  };
}

// Revenue presets: % of the target's revenue. Absent and 0 both leave nothing to apply a percentage to.
export function revenueSynergyBase(inputs) {
  const revenue = val(inputs.companyBRevenue);
  const usable = revenue != null && revenue > 0;
  return { amount: usable ? revenue : null, missing: usable ? [] : ['revenue'], period: periodOf(inputs, 'B'), source: sourceOf(inputs, 'B') };
}

// Pro forma combined gross margin, from filed gross profit and revenue on each company's own period. Null with a reason
// whenever a leg is missing or did not come from a filing.
export function combinedGrossMargin(inputs) {
  const names = { A: inputs.companyAName || 'the acquirer', B: inputs.companyBName || 'the target' };
  const none = (reason) => ({ pct: null, reason });
  if (basesDiffer(inputs)) return none(DIFFERENT_BASES);
  for (const P of ['A', 'B']) {
    if (val(inputs[`company${P}GrossProfit`]) == null) return none(`${names[P]} has no gross profit figure`);
    if (inputs[`company${P}GrossProfitSource`] !== 'sec_edgar') return none(`${names[P]}'s gross profit is not from a filing`);
    if (val(inputs[`company${P}Revenue`]) == null) return none(`${names[P]} has no revenue figure`);
  }
  const grossProfitA = val(inputs.companyAGrossProfit), grossProfitB = val(inputs.companyBGrossProfit);
  const revenueA = val(inputs.companyARevenue), revenueB = val(inputs.companyBRevenue);
  if (!(revenueA + revenueB > 0)) return none('combined revenue is not positive');
  return {
    pct: (grossProfitA + grossProfitB) / (revenueA + revenueB) * 100,
    reason: null, grossProfitA, grossProfitB, revenueA, revenueB,
    periodA: periodOf(inputs, 'A'), periodB: periodOf(inputs, 'B'), source: 'SEC EDGAR filings',
    calculatedA: inputs.companyAGrossProfitBasis === 'calculated', calculatedB: inputs.companyBGrossProfitBasis === 'calculated',
  };
}

export function synergySchedule(inputs) {
  const margin = combinedGrossMargin(inputs);
  const years = SYNERGY_YEARS.map((year) => {
    const cost = val(inputs[`synergiesY${year}`]);
    const revenue = val(inputs[`revenueSynergiesY${year}`]);
    const revenueEbitda = (revenue != null && margin.pct != null) ? revenue * margin.pct / 100 : null;
    const entered = cost != null || revenue != null;
    // The spec's rule, not a coercion: an empty line assumes no synergy. `entered` keeps that state visible, so
    // the slides print "none entered" and never a plausible $0.
    const ebitda = (cost ?? 0) + (revenueEbitda ?? 0);
    return { year, cost, revenue, revenueEbitda, ebitda, entered };
  });
  return {
    years, margin,
    anyEntered: years.some((y) => y.entered),
    anyRevenue: years.some((y) => y.revenue != null),
    // Revenue synergies were entered and cannot reach EBITDA: the condition every slide must flag.
    revenueOnly: margin.pct == null && years.some((y) => y.revenue != null),
  };
}

export const fmtSynergy = (v) => (v == null ? NONE_ENTERED : `${v < 0 ? '-' : ''}$${Number(Math.abs(v).toFixed(1)).toLocaleString('en-US')}M`);

// What the margin line says, on the input page and on every slide.
export function marginSentence(margin) {
  if (margin.pct == null) return `Combined gross margin not available: ${margin.reason}.`;
  const period = margin.periodA === margin.periodB ? margin.periodA : `${margin.periodA} and ${margin.periodB}`;
  const calculated = (margin.calculatedA || margin.calculatedB) ? ' Gross profit that the filer does not tag is calculated: filed revenue − filed cost of revenue.' : '';
  return `Combined gross margin ${margin.pct.toFixed(1)}% = ($${margin.grossProfitA.toLocaleString('en-US')}M + $${margin.grossProfitB.toLocaleString('en-US')}M) ÷ ($${margin.revenueA.toLocaleString('en-US')}M + $${margin.revenueB.toLocaleString('en-US')}M), ${period}, ${margin.source}.${calculated}`;
}
export const REVENUE_ONLY_FLAG = 'Revenue synergies add to revenue only, not to EBITDA.';
