import { calculate, acquisitionNewDebt, calcProFormaEPS, privateConsideration } from '../../utils/dealCalc';

const deal = {
  companyARevenue: 1000, companyAEBITDA: 200, companyANetIncome: 100, companyAEPS: 1, companyADilutedShares: 100, companyAShares: 100, currentSharePriceA: 37.13,
  companyACash: 333.3, companyASti: 11.1, companyALtmRevenue: 1100, companyADebt: 50,
  companyBRevenue: 500, companyBEBITDA: 90, companyBNetIncome: 50, companyBShares: 47.7, companyBDilutedShares: 48, companyBEPS: 1, companyBCash: 77.7, companyBSti: null, companyBLtmRevenue: 510, companyBDebt: 123.4,
  currentSharePriceB: 22.22, offerPricePerShare: 28.886, cashPercent: 60, synergiesY1: 10, synergiesY2: 20, synergiesY3: 30, applySourcesOfFunds: true,
};

describe('Sources & Uses totals', () => {
  test('foot exactly with no balancing row', () => {
    const r = calculate(deal);
    expect(r.totalSources).toBe(r.totalUses);
    expect(parseFloat(r.totalUses)).toBeCloseTo(28.886 * 47.7 + 123.4, -0.5);
  });

  test('a bank deal foots on new debt and stock alone', () => {
    const r = calculate({ ...deal, bankDeal: true });
    expect(r.totalSources).toBe(r.totalUses);
    expect(r.totalUses).toBe((28.886 * 47.7).toFixed(0));
  });

  test('unavailable target debt leaves both totals null, never a $0-debt sum', () => {
    const r = calculate({ ...deal, companyBDebt: null });
    expect(r.totalUses).toBeNull();
    expect(r.totalSources).toBeNull();
  });
});

// STAGE_11E_PRIVATE_NOOP_INPUTS.json as the deck resolves it: no share counts or prices, no LTM revenue (so the
// retained minimum computes to 0 today — see FIX5), total consideration typed as offerValueTotal.
const privateDeal = {
  companyARevenue: 50000, companyAEBITDA: 15000, companyANetIncome: 10000, companyACash: 5000, companyADebt: 2000,
  companyBRevenue: 10000, companyBEBITDA: 3000, companyBNetIncome: 2000, companyBCash: 1000, companyBDebt: 500,
  companyALtmRevenue: null, companyBLtmRevenue: null,
  offerPricePerShare: 0, offerValueTotal: 90000, cashPercent: 60, synergiesY1: 600, synergiesY2: 960, synergiesY3: 1320,
  applySourcesOfFunds: true,
};

describe('Sources & Uses, private target', () => {
  test('the cash part of a private offer is funded like a public one: excess cash first, then new debt', () => {
    const f = acquisitionNewDebt(privateDeal);
    expect(f.cashConsideration).toBe(54000);              // 90,000 × 60%
    expect(f.excessCashUsed).toBe(6000);                  // all of 5,000 + 1,000 above the 0 minimum
    expect(f.newDebt).toBe(54000 + 500 - 6000);           // 48,500
  });

  test('the private fixture foots to the dollar', () => {
    const r = calculate(privateDeal);
    expect(r.totalUses).toBe('90500');                    // 90,000 equity + 500 debt repaid
    expect(r.totalSources).toBe('90500');                 // 48,500 debt + 36,000 stock + 6,000 cash
    expect(r.newDebt).toBe('48500');
    expect(r.stockPortion).toBe('36000');
    expect(r.excessCashUsed).toBe('6000');
    expect(r.newInterestAfterTax).toBe((48500 * 0.05 * 0.79).toFixed(0));   // 1,916
  });

  test('a private target whose cash covers the need draws no debt (zero floor) and still foots', () => {
    const r = calculate({ ...privateDeal, offerValueTotal: 5000, cashPercent: 100 });
    expect(r.newDebt).toBe('0');
    expect(r.excessCashUsed).toBe('5500');                // 5,000 cash part + 500 debt repaid
    expect(r.totalSources).toBe(r.totalUses);
  });

  test('listed acquirer, private target: the EPS helper uses the same purchase price and drag as calculate()', () => {
    const inp = { ...privateDeal, companyAEPS: 2, companyADilutedShares: 5000, companyAShares: 5000, currentSharePriceA: 30 };
    const r = calculate(inp);
    // 36,000 stock / $30 = 1,200 new shares; NI 10,000 + 2,000 + 600 × 0.79 − 48,500 × 5% × 0.79 over 6,200 shares
    const expected = (12000 + 600 * 0.79 - 48500 * 0.05 * 0.79) / 6200;
    expect(calcProFormaEPS(0, 600, inp)).toBeCloseTo(expected, 12);
    expect(r.proFormaEPS).toBe(expected.toFixed(2));
  });

  test('a public target is unaffected: no private total, the offer × shares path as before', () => {
    expect(privateConsideration(deal)).toBeNull();
    expect(privateConsideration({ ...deal, offerValueTotal: 0 })).toBeNull();
    const r = calculate({ ...deal, offerValueTotal: 0 });
    expect(r).toEqual(calculate(deal));
    expect(acquisitionNewDebt(deal).cashConsideration).toBeCloseTo(28.886 * 47.7 * 0.6, 9);
  });
});
