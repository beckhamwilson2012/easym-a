import { calculate, acquisitionNewDebt, calcProFormaEPS, privateConsideration, minCashRevenue, FY_NO_LTM } from '../../utils/dealCalc';

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
// retained minimum is 2% of the two FY revenues, labeled FY_NO_LTM — Fix 7b), total consideration typed as offerValueTotal.
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
    expect(f.minCash).toBe(0.02 * (50000 + 10000));       // 1,200: FY revenue on both sides (no LTM)
    expect(f.excessCashUsed).toBe(6000 - 1200);           // 4,800 of 5,000 + 1,000 above the 1,200 minimum
    expect(f.newDebt).toBe(54000 + 500 - 4800);           // 49,700
  });

  test('the private fixture foots to the dollar', () => {
    const r = calculate(privateDeal);
    expect(r.totalUses).toBe('90500');                    // 90,000 equity + 500 debt repaid
    expect(r.totalSources).toBe('90500');                 // 49,700 debt + 36,000 stock + 4,800 cash
    expect(r.newDebt).toBe('49700');
    expect(r.stockPortion).toBe('36000');
    expect(r.excessCashUsed).toBe('4800');
    expect(r.minCashRetained).toBe('1200');
    expect(r.minCashBasis.A).toEqual({ value: 50000, basis: 'FY', label: FY_NO_LTM });
    expect(r.minCashBasis.B).toEqual({ value: 10000, basis: 'FY', label: FY_NO_LTM });
    expect(r.fundingGap).toBeNull();
  });

  test('a private target whose cash covers the need draws no debt (zero floor) and still foots', () => {
    const r = calculate({ ...privateDeal, offerValueTotal: 4000, cashPercent: 100 });
    expect(r.newDebt).toBe('0');
    expect(r.excessCashUsed).toBe('4500');                // 4,000 cash part + 500 debt repaid, within the 4,800 excess
    expect(r.totalSources).toBe(r.totalUses);
  });

  test('listed acquirer, private target: the EPS helper uses the same purchase price and drag as calculate()', () => {
    const inp = { ...privateDeal, companyAEPS: 2, companyADilutedShares: 5000, companyAShares: 5000, currentSharePriceA: 30 };
    const r = calculate(inp);
    // 36,000 stock / $30 = 1,200 new shares; NI 10,000 + 2,000 + 600 × 0.79 − 49,700 × 5% × 0.79 over 6,200 shares
    const expected = (12000 + 600 * 0.79 - 49700 * 0.05 * 0.79) / 6200;
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

describe('Minimum cash basis (Fix 7b Task 1)', () => {
  test('LTM revenue wins; FY revenue is used only when there is no LTM, and says so; neither is null with the reason', () => {
    expect(minCashRevenue(801, 588)).toEqual({ value: 801, basis: 'LTM', label: 'LTM revenue' });
    expect(minCashRevenue(null, 50)).toEqual({ value: 50, basis: 'FY', label: 'FY revenue (no LTM)' });
    expect(minCashRevenue(0, 50)).toEqual({ value: 0, basis: 'LTM', label: 'LTM revenue' });   // a genuine 0 LTM is LTM, not absent
    expect(minCashRevenue(null, null)).toEqual({ value: null, basis: null, label: null, reason: 'no LTM or FY revenue' });
    expect(minCashRevenue(undefined, '')).toMatchObject({ value: null });
  });

  test('a public deal on two LTM revenues is unchanged: 2% of the LTM sum', () => {
    const f = acquisitionNewDebt(deal);
    expect(f.minCash).toBeCloseTo(0.02 * (1100 + 510), 12);
    expect(f.minCashBasis.A.basis).toBe('LTM');
    expect(f.minCashBasis.B.basis).toBe('LTM');
  });

  test('listed acquirer on LTM, private target on FY (the HNGE tuck-in): the target revenue is no longer dropped', () => {
    const f = acquisitionNewDebt({ ...privateDeal, companyALtmRevenue: 801, companyACash: 212, companyASti: 83,
      companyBRevenue: 50, companyBCash: 10, companyBDebt: 0, offerValueTotal: 300, cashPercent: 100 });
    expect(f.minCash).toBeCloseTo(0.02 * 851, 12);                        // 17.02, not 2% × 801 = 16.02
    expect(f.excessCashAvail).toBeCloseTo(212 + 83 + 10 - 17.02, 9);       // 287.98
    expect(f.newDebt).toBeCloseTo(300 - 287.98, 9);                        // 12.02
    expect(f.excessCashUsed).toBeCloseTo(287.98, 9);
  });

  test('a company with neither LTM nor FY revenue: minimum cash, excess cash, new debt and the totals are null, never 0', () => {
    const r = calculate({ ...privateDeal, companyBRevenue: null });
    expect(r.minCashRetained).toBeNull();
    expect(r.excessCashAvail).toBeNull();
    expect(r.excessCashUsed).toBeNull();
    expect(r.newDebt).toBeNull();
    expect(r.newInterestAfterTax).toBeNull();
    expect(r.totalSources).toBeNull();
    expect(r.proFormaNetIncome).toBeNull();
    expect(r.fundingGap).toBe('minCash');
    expect(r.minCashBasis.B.reason).toBe('no LTM or FY revenue');
    expect(r.totalUses).toBe('90500');                    // the uses do not depend on it
  });

  test('unknown combined cash is an unknown excess, not a $0 excess', () => {
    const r = calculate({ ...privateDeal, companyBCash: null });
    expect(r.excessCashAvail).toBeNull();
    expect(r.newDebt).toBeNull();
    expect(r.fundingGap).toBe('cash');
  });
});
