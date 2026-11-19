'use strict';
// server/services/unusualItems.js — the filed figures behind the GAAP one-time-item flag (Fix 22 Task 3). Facts only: the rule
// that decides what is large enough to flag is src/lib/oneTimeItems.js, and no figure in the deal is adjusted by either file.
//
//   • fiscal year — the 10-K full-year value at the deck's fiscal-year end (ltmCalc.valFullYearAt);
//   • LTM        — ltmCalc.ltmFlow at the same revenue-anchored periods as LTM net income (annual + latest YTD − prior YTD).
//
// A tag missing any LTM leg has no LTM value: it is listed under `incomplete`, never treated as 0. A tagged 0 is a filed 0.
// IncomeTaxExpenseBenefit is signed as filed: negative is a benefit (LYFT FY2025: −2,897.255M).

const { ltmFlow, valFullYearAt } = require('./ltmCalc');
const { PRETAX } = require('./adjustedComponents');

const NET_INCOME = ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'];
const INCOME_TAX = ['IncomeTaxExpenseBenefit'];

// kind 'charge': the tag is a positive expense. kind 'gainLoss': positive is a gain, negative a loss.
const ITEMS = [
  { key: 'goodwillImpairment', kind: 'charge', label: 'goodwill impairment', concepts: ['GoodwillImpairmentLoss'] },
  { key: 'assetImpairment', kind: 'charge', label: 'asset impairment charge', concepts: ['AssetImpairmentCharges'] },
  { key: 'saleOfBusiness', kind: 'gainLoss', label: 'sale of a business', concepts: ['GainLossOnSaleOfBusiness'] },
  { key: 'disposalGroup', kind: 'gainLoss', label: 'disposal of a business unit', concepts: ['DisposalGroupNotDiscontinuedOperationGainLossOnDisposal', 'DiscontinuedOperationGainLossOnDisposalOfDiscontinuedOperationNetOfTax'] },
  { key: 'investments', kind: 'gainLoss', label: 'investments', concepts: ['GainLossOnInvestments'] },
];

const toM = (v) => (v == null ? null : v / 1e6);
const usd = (gaap, c) => gaap[c]?.units?.USD || [];

function fyValue(gaap, concepts, end) {
  for (const c of concepts) {
    const v = valFullYearAt(usd(gaap, c), end);
    if (v != null) return { value: v, concept: c };
  }
  return null;
}

function unusualItemsFy(gaap, fyEnd) {
  if (!gaap || !fyEnd) return null;
  const read = (concepts) => fyValue(gaap, concepts, fyEnd);
  const ni = read(NET_INCOME), tax = read(INCOME_TAX), pre = read(PRETAX.concepts);
  const items = [];
  for (const it of ITEMS) {
    const r = read(it.concepts);
    if (r) items.push({ key: it.key, kind: it.kind, label: it.label, value: toM(r.value), concept: r.concept });
  }
  return { basis: 'fy', periodEnd: fyEnd, netIncome: toM(ni?.value), incomeTax: toM(tax?.value), taxConcept: tax?.concept ?? null,
    pretaxIncome: toM(pre?.value), pretaxConcept: pre?.concept ?? null, items, incomplete: [] };
}

// periods = computeLTM's { annual, latestInterim, priorInterim }: the window LTM net income was built on.
function unusualItemsLtm(gaap, periods) {
  if (!gaap || !periods) return null;
  const P = { annualEnd: periods.annual.end, iEnd: periods.latestInterim.end, pEnd: periods.priorInterim.end, span: periods.latestInterim.span };
  const ni = ltmFlow(gaap, NET_INCOME, P), tax = ltmFlow(gaap, INCOME_TAX, P), pre = ltmFlow(gaap, PRETAX.concepts, P);
  const items = [], incomplete = [];
  for (const it of ITEMS) {
    const f = ltmFlow(gaap, it.concepts, P);
    if (f.ltm != null) items.push({ key: it.key, kind: it.kind, label: it.label, value: toM(f.ltm), concept: f.conceptName,
      legs: { annual: toM(f.annual), latestYTD: toM(f.latestYTD), priorYTD: toM(f.priorYTD) } });
    else if (f.annual != null || f.latestYTD != null || f.priorYTD != null) incomplete.push({ key: it.key, label: it.label, concept: f.conceptName,
      legs: { annual: toM(f.annual), latestYTD: toM(f.latestYTD), priorYTD: toM(f.priorYTD) } });
  }
  return { basis: 'ltm', periodEnd: P.iEnd, netIncome: toM(ni.ltm), incomeTax: toM(tax.ltm), taxConcept: tax.conceptName,
    taxLegs: { annual: toM(tax.annual), latestYTD: toM(tax.latestYTD), priorYTD: toM(tax.priorYTD) },
    pretaxIncome: toM(pre.ltm), pretaxConcept: pre.conceptName, items, incomplete };
}

module.exports = { unusualItemsFy, unusualItemsLtm, ITEMS };
