import { calcProFormaEPS, forwardYearInputs, acquisitionNewDebt, DEBT_INTEREST_RATE, TAX_RATE, calculate } from '../../utils/dealCalc';

// Fix 10 Task 7: slide 9's forward table carries ONE net income per company — consensus EPS × the one diluted share
// count, the same figure the strip divides — so PF net income ÷ (diluted + new shares) is the strip's PF EPS.
const inputs = { offerPricePerShare: 11.30, companyBShares: 178, cashPercent: 60, currentSharePriceA: 120.99,
  companyADilutedShares: 85, companyBDilutedShares: 181, companyANetIncome: 166, companyBNetIncome: -155, companyAEPS: 1.95,
  companyBDebt: 998, companyBCash: 850, companyACash: 212, companyASti: 83, companyALtmRevenue: 801, companyBLtmRevenue: 2468,
  applySourcesOfFunds: true };

describe('Fix 10 Task 7 — slide 9 ties', () => {
  test('HNGE/TDOC FY2027E: table net incomes are consensus EPS × shares, and PF NI ÷ PF shares = the strip PF EPS', () => {
    const fwd = forwardYearInputs(inputs, 3.12917, -0.61303);
    expect(fwd.companyANetIncome).toBeCloseTo(3.12917 * 85, 9);     // not FMP's separate net-income mean
    expect(fwd.companyBNetIncome).toBeCloseTo(-0.61303 * 181, 9);
    const r = calculate(inputs);
    const finDrag = r.newInterestAfterTax;
    expect(finDrag).toBeCloseTo(acquisitionNewDebt(inputs).newDebt * DEBT_INTEREST_RATE * (1 - TAX_RATE), 9);
    const pfNi = fwd.companyANetIncome + fwd.companyBNetIncome + 0 - finDrag;
    const pfSh = 85 + parseFloat(r.stockPortion) / 120.99;
    expect(pfNi / pfSh).toBeCloseTo(calcProFormaEPS(11.30, 0, fwd), 3);   // stockPortion is rounded to $1M in results
  });
});
