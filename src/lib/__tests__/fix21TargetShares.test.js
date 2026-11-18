import { calculate, calcProFormaEPS, epsAccretionPct, forwardNetIncome, forwardShareCount, forwardYearInputs, acquisitionNewDebt, newSharesLabel, TARGET_SHARES_MISSING } from '../../utils/dealCalc';
import { dealVerdict, headlineEps, verdictFlags } from '../dealVerdict';

// Fix 21 Task 5: no live ticker lacks a share count today, so this is shown on the functions themselves.
const inputs = (over = {}) => ({
  companyANetIncome: 300, companyAEPS: 3, companyADilutedShares: 100, companyAShares: 100, currentSharePriceA: 60, companyACash: 500, companyADebt: 200,
  companyAEBITDA: 400, companyARevenue: 2000, companyALtmRevenue: 2000, companyBNetIncome: 50, companyBEPS: 1, companyBShares: 50, companyBDilutedShares: 50,
  currentSharePriceB: 25, companyBCash: 20, companyBDebt: 10, companyBEBITDA: 100, companyBRevenue: 500, companyBLtmRevenue: 500,
  cashPercent: 50, offerPricePerShare: 30, applySourcesOfFunds: true, reportingBasis: 'Non-GAAP', companyAEpsBasis: 'Non-GAAP',
  companyABasis: 'fy', companyBBasis: 'fy', companyAFiscalYearEnd: '2025-12-31', companyBFiscalYearEnd: '2025-12-31', ...over,
});
const noShares = { companyBShares: null, companyBDilutedShares: null };
const fwd = [{ fy: 2026, eps: 4, actual: false }, { fy: 2027, eps: 5, actual: false }];
const deal = (inp, results) => ({ offerPrice: 30, _inputs: inp, _results: results, synergies: { years: [1, 2, 3].map((year) => ({ year, ebitda: 0, entered: false })) } });
const model = { derived: {}, verifiedData: { acquirer: {} } };

describe('forward net income', () => {
  test('no target count is null, not $0', () => {
    expect(forwardShareCount(inputs(noShares), 'B')).toBeNull();
    expect(forwardNetIncome(inputs(noShares), 'B', 2)).toBeNull();
    expect(forwardYearInputs(inputs(noShares), 4, 2).companyBNetIncome).toBeNull();
  });
  test('diluted count first, then shares outstanding, as before', () => {
    expect(forwardNetIncome(inputs(), 'B', 2)).toBe(100);
    expect(forwardNetIncome(inputs({ companyBDilutedShares: null }), 'B', 2)).toBe(100);
    expect(forwardNetIncome(inputs(), 'A', 4)).toBe(400);
  });
});

describe('the deal with no target share count', () => {
  const r = calculate(inputs(noShares));
  test('no purchase price, funding, EV or pro forma figure is computed', () => {
    expect(r.targetSharesMissing).toBe(true);
    ['totalPurchasePrice', 'cashPortion', 'stockPortion', 'newSharesIssued', 'cashConsideration', 'newDebt', 'totalUses', 'totalSources', 'enterpriseValue', 'proFormaNetIncome', 'proFormaEPS', 'epsChangePct']
      .forEach((k) => expect([k, r[k]]).toEqual([k, null]));
    expect(r.isAccretive).toBe(false);
    expect(r.fundingGap).toBe('targetShares');
  });
  test('per-share math returns null in every year', () => {
    expect(calcProFormaEPS(30, 0, inputs(noShares))).toBeNull();
    expect(epsAccretionPct(30, 0, inputs(noShares))).toBeNull();
    expect(calcProFormaEPS(30, 0, forwardYearInputs(inputs(noShares), 4, 2))).toBeNull();
    expect(acquisitionNewDebt(inputs(noShares)).newDebt).toBeNull();
  });
  test('the verdict is "—" with the reason, even with consensus for both companies', () => {
    const inp = inputs(noShares);
    const v = dealVerdict({ deal: deal(inp, r), model, acquirerFwd: fwd, targetFwd: fwd });
    expect(v.step).toBeNull();
    expect(v.text).toBe('—');
    expect(v.line).toBe(`No test can be computed: ${TARGET_SHARES_MISSING}.`);
    expect(verdictFlags(v)[0].text).toMatch(/target share count not available/);
    const h = headlineEps(v, deal(inp, r));   // reads results.targetSharesMissing
    expect(h.pct).toBeNull();
    expect(h.proFormaEPS).toBeNull();
    expect(h.reason).toBe(TARGET_SHARES_MISSING);
  });
  test('New Shares Issued says why', () => {
    expect(newSharesLabel(r)).toBe('— (target share count not available)');
  });
});

describe('unchanged when the count is there, and for a private target', () => {
  test('public target', () => {
    const r = calculate(inputs());
    expect(r.totalPurchasePrice).toBe('1500');
    expect(r.targetSharesMissing).toBe(false);
    expect(parseFloat(r.proFormaEPS)).toBeGreaterThan(0);
  });
  test('a private target needs no count', () => {
    const r = calculate(inputs({ ...noShares, offerValueTotal: 900, offerPricePerShare: 0 }));
    expect(r.totalPurchasePrice).toBe('900');
    expect(r.targetSharesMissing).toBe(false);
  });
});
