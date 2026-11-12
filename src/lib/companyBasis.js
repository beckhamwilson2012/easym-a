import { fmtCalendarDate } from './easternTime';
import { revenuePeriodLabel } from './revenuePeriod';

// The one basis switch. Each company's flow figures reach the deal model and the deck through companyInputs:
// on Fiscal year it reads the annual /quote fields, on LTM it reads data.ltm. An LTM field that is null stays
// null: it never falls back to the annual figure. Balance-sheet items and share prices are point-in-time, so
// the basis does not touch them.
export const BASIS_FY = 'fy';
export const BASIS_LTM = 'ltm';
export const DIFFERENT_BASES = 'companies on different bases';
export const DIFFERENT_FY_MONTHS = 'fiscal years end in different months';

export function ltmAvailability(data, { bank = false } = {}) {
  if (!data) return { available: false, reason: 'no company data' };
  if (bank) return { available: false, reason: 'bank figures in this deck are annual, with no LTM path' };
  const L = data.ltm;
  if (!L || !L.trusted) return { available: false, reason: (L && L.reason) || 'no trusted LTM for this company' };
  if (L.revenue == null) return { available: false, reason: 'LTM revenue is missing' };
  if (!fmtCalendarDate(L.asOf)) return { available: false, reason: 'LTM period end is missing' };
  return { available: true, reason: null };
}

export function basisLabel(data, basis) {
  return basis === BASIS_LTM ? `LTM to ${fmtCalendarDate(data?.ltm?.asOf)}` : revenuePeriodLabel(data);
}

function figures(data, basis) {
  if (basis === BASIS_LTM) {
    const L = data.ltm;
    return {
      // NetIncome is the EPS numerator: net income attributable to common stockholders when filed (ltmEps), else net income.
      Revenue: L.revenue, EBITDA: L.ebitda, NetIncome: L.epsNetIncome ?? L.netIncome, OperatingIncome: L.operatingIncome,
      NetIncomeToCommon: L.epsNetIncome != null && L.epsNetIncome !== L.netIncome,
      EpsLabel: L.epsLabel ?? null, EpsReason: L.eps == null ? (L.epsReason ?? null) : null,
      GrossProfit: L.grossProfit ?? null, FreeCashFlow: L.freeCashFlow ?? null, EPS: L.eps, DilutedShares: L.dilutedShares,
      DilutedSharesPeriod: L.dilutedShares != null ? { basis: 'weighted average', end: L.asOf, interim: true } : null,
      CostOfRevenue: L.costOfRevenue ?? null, CostOfRevenueSource: L.costOfRevenueSource ?? null,
      GrossProfitSource: L.grossProfit != null ? 'sec_edgar' : null, // LTM is EDGAR only (ltmCalc)
      GrossProfitBasis: L.grossProfit != null ? (L.audit?.breakdown?.grossProfit?.derived ? 'calculated' : 'filed') : null,
    };
  }
  return {
    Revenue: data.revenue, EBITDA: data.ebitda, NetIncome: data.epsNetIncome ?? data.netIncome, OperatingIncome: data.operatingIncome,
    NetIncomeToCommon: data.epsNetIncome != null && data.epsNetIncome !== data.netIncome,
    EpsLabel: null, EpsReason: null,
    GrossProfit: data.grossProfit ?? null, FreeCashFlow: data.freeCashFlow ?? null, EPS: data.eps, DilutedShares: data.dilutedShares,
    DilutedSharesPeriod: data.dilutedSharesPeriod ?? null,
    CostOfRevenue: data.costOfRevenue ?? null, CostOfRevenueSource: data.costOfRevenueSource ?? null,
    GrossProfitSource: data.grossProfitSource ?? null, GrossProfitBasis: data.grossProfitBasis ?? null,
  };
}

export function companyInputs(P, data, basis) {
  const out = {
    [`company${P}Basis`]: basis,
    [`company${P}PeriodLabel`]: basisLabel(data, basis),
    [`company${P}FiscalYearEnd`]: data.fiscalYearEnd ?? null,
    [`company${P}LtmAsOf`]: data.ltm?.trusted ? data.ltm.asOf : null,
  };
  Object.entries(figures(data, basis)).forEach(([k, v]) => { out[`company${P}${k}`] = v; });
  return out;
}

// Both set and different. A private company carries no basis, so it never counts as different.
export const basesDiffer = (inputs) => !!(inputs?.companyABasis && inputs?.companyBBasis && inputs.companyABasis !== inputs.companyBBasis);

// Whether the two companies' figures may be added, and what the slides must say about it.
export function combination(inputs) {
  if (basesDiffer(inputs)) return { comparable: false, note: DIFFERENT_BASES };
  if (inputs?.companyABasis === BASIS_FY && inputs?.companyBBasis === BASIS_FY) {
    const a = String(inputs.companyAFiscalYearEnd || '').slice(5, 7), b = String(inputs.companyBFiscalYearEnd || '').slice(5, 7);
    if (a && b && a !== b) return { comparable: true, note: DIFFERENT_FY_MONTHS };
  }
  if (inputs?.companyABasis === BASIS_LTM && inputs?.companyBBasis === BASIS_LTM && inputs.companyALtmAsOf !== inputs.companyBLtmAsOf) {
    return { comparable: true, note: `LTM periods end on different dates: ${inputs.companyAPeriodLabel} and ${inputs.companyBPeriodLabel}` };
  }
  return { comparable: true, note: null };
}
