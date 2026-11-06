'use strict';
// server/services/cashFlowConcepts.js — the ONE place depreciation & amortization and capex are resolved, and the ONE place
// EBITDA and free cash flow are calculated, so /quote, /api/pnl, the LTM legs and the §16 verification (edgarClient) agree.
// Same style as revenueConcepts.js and incomeConcepts.js.
//
// WHICH VALUE, always at one exact fiscal period (the revenue's), so a tag that stopped in an older year cannot match:
//   1. The first listed total tag filed for that period. Checked against the filing's cash flow statement: its row, or the
//      statement's own lines adding to it (S&P Global: Depreciation 110 + Amortization 1,069 = 1,179). No match keeps the value
//      and flags it, naming what the statement shows.
//   2. No total tag: the statement's own lines. One line, or a sum, ONLY when each is a separate line on the statement for that
//      period (AMD: 750 + 2,254). A line that cannot be classified stops the sum: a partial sum is a plausible wrong number.
//   3. Otherwise null, with the reason.
//
// A partial tag is never a total. Airbnb files Depreciation 17 and Globalstar PaymentsToAcquireOtherPropertyPlantAndEquipment
// 5.5, both current and both real. Neither is the company's D&A or capex, so neither is a candidate in step 1. Step 2 can use
// such a tag only because the statement shows the line, and shows everything else beside it.
//
// SIGN: payment tags are filed as positive outflows (AMZN PaymentsToAcquireProductiveAssets 131,819, printed as (131,819) on the
// statement), so free cash flow is operating cash flow MINUS capex.

const { pickAnnualAt } = require('./incomeConcepts');
const { columnOf, statementRow, sameFiled } = require('./filingStatements');

const DEPRECIATION_CONCEPTS = {
  gaap: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet'],
  ifrs: ['DepreciationAmortisationAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss',
         'AdjustmentsForDepreciationAndAmortisationExpenseAndImpairmentLossReversalOfImpairmentLossRecognisedInProfitOrLoss',
         'DepreciationAndAmortisationExpense', 'DepreciationAmortisationAndImpairmentLoss', 'DepreciationAndAmortisation'],
};
// Free cash flow reads us-gaap only: an IFRS filer that tags no us-gaap cash flow has none here, as before.
const CAPEX_CONCEPTS = ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'];
const OPERATING_CASH_FLOW_CONCEPTS = ['NetCashProvidedByUsedInOperatingActivities'];

const DA_LINE = /deprec|amorti[sz]/i;
// Amortization that is not D&A: financing costs, discounts on securities, deferred contract costs, leases, inventory step-ups.
const NOT_DA_LINE = /financ|debt|discount|premium|deferred|contract|commission|step-up|lease|right.of.use|stock|share.based|equity.based|compensation|net of|investment|securit|inventory|incentive|nuclear|content|notes|convertible|loan|mortgage|policy/i;
const CAPEX_LINE = /capital expend|capex|propert|plant|equipment|fixed asset|aircraft|flight|internal.use|software/i;
const CAPEX_TAG = /^(PaymentsToAcquire(ProductiveAssets|(Other)?PropertyPlantAndEquipment|MachineryAndEquipment|Software)|PaymentsToDevelopSoftware|PaymentsForFlightEquipment|PaymentsForConstructionInProcess)$/;
// A capex tag on a row that says it is an acquisition is not the company's capex. AEP FY25 files PaymentsToAcquireProductiveAssets
// 3,453 on "Acquisitions of Generation Facilities"; its capex is the line above it, "Construction Expenditures" 8,453. Buying
// property is capex however it is worded: Roblox's line is "Acquisition of property and equipment".
const ACQUISITION_LINE = /^acquisitions?\b(?!.*(propert|equipment|plant|fixed asset))/i;
const NOT_CAPEX_LINE = new RegExp(`proceeds|sale|lease|intangible|business|${ACQUISITION_LINE.source}`, 'i');
// Company-specific investing outflows that are plainly not capex. Any other one stops a sum: it could be capex (Globalstar's 442).
const FINANCIAL_INVESTING = /invest|securit|acqui|business|loan|collateral|crypto|deposit|derivative|note|receivable|insurance/i;

const fmtM = (v) => `$${(v / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
const isStandard = (row) => row.ns === 'us-gaap' || row.ns === 'ifrs-full';
const rowName = (row) => `${row.ns}:${row.tag} "${row.label}"`;

// Everything the trace-back carries. value is raw dollars, positive for an outflow; null always comes with a reason.
const resolved = (fields) => ({ value: null, end: null, concept: null, concepts: [], components: null, status: null, label: null, flag: null, reason: null, ...fields });

// Does the statement show this value at this period? Its own tag first, then the lines that add to it.
function checkAgainstStatement(statement, end, concept, value, lineRows, what) {
  if (!statement) return { status: 'unconfirmed', flag: `${what} ${concept} ${fmtM(value)} not confirmed: cash flow statement could not be read` };
  if (columnOf(statement, end) < 0) return { status: 'unconfirmed', flag: `${what} ${concept} ${fmtM(value)} not confirmed: ${end} is not on the latest filing's cash flow statement` };
  const own = statementRow(statement, concept, end);
  const col = columnOf(statement, end);
  const lines = lineRows(statement, col);
  if (own && sameFiled(statement, own.value, value)) {
    // On the statement, but it may not be the whole figure: Home Depot's D&A line excludes a separate amortization line of 607. Value kept, and said.
    const beside = lines.filter((r) => r !== own.row);
    return { status: 'confirmed', statementLine: own.row.label,
      flag: beside.length ? `${what} ${concept} ${fmtM(value)} is on the cash flow statement, which also shows ${beside.map((r) => `${rowName(r)} ${fmtM(Math.abs(r.values[col]))}`).join(', ')}` : null };
  }
  const sum = lines.reduce((s, r) => s + Math.abs(r.values[col]), 0);
  // The lines that confirmed it are kept: they are the statement's own lines for this figure, which the LTM can follow (SPGI).
  if (lines.length && sameFiled(statement, sum, value)) return { status: 'confirmed', flag: null, statementLine: lines.map((r) => r.label).join(' + '),
    confirmingLines: lines.map((r) => ({ ns: r.ns, concept: r.tag, label: r.label, value: Math.abs(r.values[col]) })) };
  const shows = lines.length ? lines.map((r) => `${rowName(r)} ${fmtM(Math.abs(r.values[col]))}`).join(', ') : 'no such line';
  return { status: 'unconfirmed', flag: `${what} ${concept} ${fmtM(value)} does not match the cash flow statement, which shows ${shows}` };
}

// The operating section's total row. Section headings carry the same name plus "Abstract", so the match is exact.
const operatingTotalIndex = (statement) => statement.rows.findIndex((r) => /^(NetCashProvidedByUsedIn|CashFlowsFromUsedIn)OperatingActivities(ContinuingOperations)?$/.test(r.tag));
const operatingRows = (statement) => {
  const total = operatingTotalIndex(statement);
  return total >= 0 ? statement.rows.slice(0, total) : statement.rows;
};
const daLines = (statement, col) => operatingRows(statement).filter((r) => r.values[col] != null && r.values[col] !== 0 && DA_LINE.test(r.label) && !NOT_DA_LINE.test(r.label));

function resolveDepreciationAt(ns, end, { useIfrs = false, statement = null } = {}) {
  if (!end) return resolved({ reason: 'no fiscal period to read D&A for' });
  const names = DEPRECIATION_CONCEPTS[useIfrs ? 'ifrs' : 'gaap'];
  const filed = pickAnnualAt(ns, names, end);
  if (filed) {
    const check = checkAgainstStatement(statement, end, filed.concept, filed.val, daLines, 'D&A');
    return resolved({ value: filed.val, end, concept: filed.concept, concepts: [filed.concept], status: check.status, flag: check.flag, statementLine: check.statementLine ?? null,
      confirmingLines: check.confirmingLines ?? null, label: `SEC EDGAR companyfacts (${filed.concept})` });
  }
  const noTag = `no D&A total tag filed for ${end}`;
  if (!statement) return resolved({ end, reason: `${noTag}, and the cash flow statement could not be read` });
  const col = columnOf(statement, end);
  if (col < 0) return resolved({ end, reason: `${noTag}, and ${end} is not on the latest filing's cash flow statement` });
  const lines = daLines(statement, col);
  if (!lines.length) return resolved({ end, reason: `${noTag}, and the cash flow statement has no depreciation or amortization line` });
  const impaired = lines.find((r) => /impair/i.test(r.label));
  if (impaired) return resolved({ end, reason: `${noTag}; the statement's line ${rowName(impaired)} ${fmtM(Math.abs(impaired.values[col]))} includes impairment, so D&A cannot be separated` });
  if (!lines.some((r) => /deprec/i.test(r.label))) return resolved({ end, reason: `${noTag}; the statement shows amortization only (${lines.map(rowName).join(', ')}), with no depreciation line` });
  const value = lines.reduce((s, r) => s + r.values[col], 0);
  return resolved({ value, end, concept: lines.length === 1 ? lines[0].tag : null, concepts: lines.filter(isStandard).map((r) => r.tag), status: 'confirmed',
    components: lines.map((r) => ({ concept: `${r.ns}:${r.tag}`, label: r.label, value: r.values[col] })),
    statementLine: lines.map((r) => r.label).join(' + '),
    allStandard: lines.every(isStandard),
    label: `${statement.form || 'filing'} cash flow statement: ${lines.map((r) => `${r.ns}:${r.tag}`).join(' + ')}` });
}

// The statement's investing section: rows after operating cash flow, up to the investing total.
function investingRows(statement) {
  const start = operatingTotalIndex(statement);
  const end = statement.rows.findIndex((r) => /^(NetCashProvidedByUsedIn|CashFlowsFromUsedIn)InvestingActivities(ContinuingOperations)?$/.test(r.tag));
  return start >= 0 && end > start ? statement.rows.slice(start + 1, end) : statement.rows;
}
const capexLines = (statement, col) => investingRows(statement).filter((r) => r.values[col] != null && r.values[col] < 0 && !NOT_CAPEX_LINE.test(r.label) && (CAPEX_TAG.test(r.tag) || CAPEX_LINE.test(r.label)));

function resolveCapexAt(gaap, end, { statement = null } = {}) {
  if (!end) return resolved({ reason: 'no fiscal period to read capex for' });
  const tagged = pickAnnualAt(gaap, CAPEX_CONCEPTS, end);
  const filed = tagged && ACQUISITION_LINE.test(statementRow(statement, tagged.concept, end)?.row.label || '') ? null : tagged;
  if (filed) {
    const check = checkAgainstStatement(statement, end, filed.concept, filed.val, capexLines, 'capex');
    return resolved({ value: filed.val, end, concept: filed.concept, concepts: [filed.concept], status: check.status, flag: check.flag, statementLine: check.statementLine ?? null,
      label: `SEC EDGAR companyfacts (${filed.concept})` });
  }
  const noTag = `no capex total tag filed for ${end}`;
  if (!statement) return resolved({ end, reason: `${noTag}, and the cash flow statement could not be read` });
  const col = columnOf(statement, end);
  if (col < 0) return resolved({ end, reason: `${noTag}, and ${end} is not on the latest filing's cash flow statement` });
  const lines = capexLines(statement, col);
  if (!lines.length) return resolved({ end, reason: `${noTag}, and the cash flow statement has no capital expenditure line` });
  const custom = lines.find((r) => !isStandard(r));
  if (custom) return resolved({ end, reason: `${noTag}; the statement's line is company-specific: ${rowName(custom)} ${fmtM(Math.abs(custom.values[col]))}` });
  const lineSet = new Set(lines);
  const unclassified = investingRows(statement).find((r) => !isStandard(r) && !lineSet.has(r) && r.values[col] != null && r.values[col] < 0 && !FINANCIAL_INVESTING.test(r.label));
  if (unclassified) return resolved({ end, reason: `${noTag}; the investing section also has ${rowName(unclassified)} ${fmtM(Math.abs(unclassified.values[col]))}, which may be capex, so a sum could be partial` });
  const value = lines.reduce((s, r) => s + Math.abs(r.values[col]), 0);
  return resolved({ value, end, concept: lines.length === 1 ? lines[0].tag : null, concepts: lines.map((r) => r.tag), status: 'confirmed',
    components: lines.map((r) => ({ concept: `${r.ns}:${r.tag}`, label: r.label, value: Math.abs(r.values[col]) })),
    statementLine: lines.map((r) => r.label).join(' + '), allStandard: true,
    label: `${statement.form || 'filing'} cash flow statement: ${lines.map((r) => `${r.ns}:${r.tag}`).join(' + ')}` });
}

function resolveOperatingCashFlowAt(gaap, end) {
  const filed = end ? pickAnnualAt(gaap, OPERATING_CASH_FLOW_CONCEPTS, end) : null;
  return filed
    ? resolved({ value: filed.val, end, concept: filed.concept, concepts: [filed.concept], status: 'single', label: `SEC EDGAR companyfacts (${filed.concept})` })
    : resolved({ end, reason: `no us-gaap operating cash flow filed for ${end || 'this period'}` });
}

// The single EBITDA calculation. Inputs are { value, end, reason? }, in any one unit. Never a partial figure, never across years.
function computeEbitda(operatingIncome, depreciation) {
  if (operatingIncome?.value == null) return { value: null, reason: operatingIncome?.reason || 'no operating income filed for this fiscal year' };
  if (depreciation?.value == null) return { value: null, reason: depreciation?.reason || 'no D&A filed for this fiscal year' };
  if (operatingIncome.end && depreciation.end && operatingIncome.end !== depreciation.end) {
    return { value: null, reason: `operating income is for ${operatingIncome.end} and D&A for ${depreciation.end}` };
  }
  return { value: operatingIncome.value + depreciation.value, reason: null };
}

// The single free cash flow calculation: operating cash flow − capex, capex a positive outflow.
function computeFreeCashFlow(operatingCashFlow, capex) {
  if (operatingCashFlow?.value == null) return { value: null, reason: operatingCashFlow?.reason || 'no operating cash flow filed for this fiscal year' };
  if (capex?.value == null) return { value: null, reason: capex?.reason || 'no capex filed for this fiscal year' };
  if (operatingCashFlow.end && capex.end && operatingCashFlow.end !== capex.end) {
    return { value: null, reason: `operating cash flow is for ${operatingCashFlow.end} and capex for ${capex.end}` };
  }
  return { value: operatingCashFlow.value - capex.value, reason: null };
}

// API trace-back, in raw dollars. `usd`, not `value`: the /quote boundary (unwrapCompany) flattens any top-level { value } object.
const traceOf = (r) => ({ usd: r.value, fiscalYearEnd: r.end, concept: r.concept, status: r.status, label: r.label, statementLine: r.statementLine ?? null, components: r.components, flag: r.flag, reason: r.reason });

module.exports = {
  DEPRECIATION_CONCEPTS, CAPEX_CONCEPTS, OPERATING_CASH_FLOW_CONCEPTS,
  resolveDepreciationAt, resolveCapexAt, resolveOperatingCashFlowAt, computeEbitda, computeFreeCashFlow, traceOf,
};
