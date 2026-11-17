// Fix 19 Task 4: one free cash flow and one equity value per company, for Company Profiles' Key Financials and the
// Target Profile's FCF yield. FCF is the trusted LTM figure from /quote's data.ltm when present, else the company
// object's fiscal-year figure; equity value is the TRADING market cap (live price × shares, currentMarketCap), the
// same value Comparables prints. Nothing is estimated: a missing input is null, and the yield is then null ("—").
const num = (x) => (x != null && x !== '' ? parseFloat(x) : null);

export function fcfAndEquity(co, ltmRaw) {
  const T = ltmRaw && ltmRaw.trusted === true ? ltmRaw : null;
  const fcfL = T && T.freeCashFlow != null ? num(T.freeCashFlow) : null;
  const fcf = fcfL != null ? fcfL : num(co?.freeCashFlow);
  const equity = num(co?.currentMarketCap);
  return { fcf: Number.isFinite(fcf) ? fcf : null, fcfBasis: fcfL != null ? 'LTM' : 'FY', equity: Number.isFinite(equity) ? equity : null };
}

// FCF ÷ equity value, as a decimal. null when either is missing or equity is not positive.
export function fcfYield(co, ltmRaw) {
  const { fcf, equity } = fcfAndEquity(co, ltmRaw);
  return fcf != null && equity != null && equity > 0 ? fcf / equity : null;
}

export const FCF_YIELD_FORMULA = 'Free cash flow yield = free cash flow (CFO − capex) ÷ equity value (live price × shares), the same two figures as Company Profiles and Comparables';
