import { fcfAndEquity, fcfYield } from '../fcfYield';

// Fix 19 Task 4: FCF yield = the Company Profiles FCF ÷ the deck's equity value (OMDA $28M ÷ $899M = 3.1%).
describe('Fix 19 Task 4 — FCF yield', () => {
  const omda = { freeCashFlow: 20, currentMarketCap: 898.93 };
  test('trusted LTM FCF over the trading market cap', () => {
    expect(fcfAndEquity(omda, { trusted: true, freeCashFlow: 28 })).toEqual({ fcf: 28, fcfBasis: 'LTM', equity: 898.93 });
    expect(fcfYield(omda, { trusted: true, freeCashFlow: 28 })).toBeCloseTo(28 / 898.93, 12);
  });
  test('untrusted LTM falls to the fiscal-year FCF and says so', () => {
    expect(fcfAndEquity(omda, { trusted: false, freeCashFlow: 28 }).fcfBasis).toBe('FY');
    expect(fcfYield(omda, null)).toBeCloseTo(20 / 898.93, 12);
  });
  test('a missing input is null, never 0', () => {
    expect(fcfYield({ freeCashFlow: null, currentMarketCap: 900 }, null)).toBeNull();
    expect(fcfYield({ freeCashFlow: 28, currentMarketCap: null }, null)).toBeNull();
    expect(fcfYield({ freeCashFlow: 28, currentMarketCap: 0 }, null)).toBeNull();
  });
});
