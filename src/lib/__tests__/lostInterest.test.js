// Fix 14 Task 2: lost interest on cash used. One after-tax line in dealCalc.financingCost, read by calculate(), the
// sensitivity grid / forward years (calcProFormaEPS) and the breakeven; the yield is the acquirer's realized yield, else
// the stated 4.0% assumption.
import { calculate, calcProFormaEPS, financingCost, cashYieldUsed, acquisitionNewDebt, TAX_RATE, DEBT_INTEREST_RATE, CASH_YIELD_ASSUMPTION } from '../../utils/dealCalc';
import { companyInputs, BASIS_LTM, BASIS_FY } from '../companyBasis';

const deal = {
  companyARevenue: 1000, companyAEBITDA: 200, companyANetIncome: 100, companyAEPS: 1, companyADilutedShares: 100, companyAShares: 100, currentSharePriceA: 37.13,
  companyACash: 333.3, companyASti: 11.1, companyALtmRevenue: 1100, companyADebt: 50,
  companyBRevenue: 500, companyBEBITDA: 90, companyBNetIncome: 50, companyBShares: 47.7, companyBDilutedShares: 48, companyBEPS: 1, companyBCash: 77.7, companyBSti: null, companyBLtmRevenue: 510, companyBDebt: 123.4,
  currentSharePriceB: 22.22, offerPricePerShare: 28.886, cashPercent: 60, synergiesY1: 10, synergiesY2: 20, synergiesY3: 30, applySourcesOfFunds: true,
};

describe('lost interest on cash used', () => {
  test('no realized yield → the stated 4.0% assumption, labeled', () => {
    expect(CASH_YIELD_ASSUMPTION).toBe(0.04);
    const y = cashYieldUsed(deal);
    expect(y).toMatchObject({ rate: 0.04, assumption: true, label: '4.0% (assumption)' });
  });

  test('after tax at TAX_RATE on the excess cash used; pro forma net income subtracts it beside the financing cost', () => {
    const s = acquisitionNewDebt(deal);
    const r = calculate(deal);
    const lost = s.excessCashUsed * 0.04 * (1 - TAX_RATE);
    const fin = s.newDebt * DEBT_INTEREST_RATE * (1 - TAX_RATE);
    expect(r.lostInterestAfterTax).toBeCloseTo(lost, 10);
    expect(r.newInterestAfterTax).toBeCloseTo(fin, 10);
    expect(parseFloat(r.proFormaNetIncome)).toBeCloseTo(100 + 50 + 10 * (1 - TAX_RATE) - fin - lost, 0);
  });

  test('the acquirer’s realized yield wins when filed', () => {
    const d = { ...deal, companyACashYield: { value: 0.034, label: '3.4% realized: …' } };
    const s = acquisitionNewDebt(d);
    expect(calculate(d).lostInterestAfterTax).toBeCloseTo(s.excessCashUsed * 0.034 * (1 - TAX_RATE), 10);
    expect(cashYieldUsed(d).assumption).toBe(false);
    // a null or non-positive realized value falls back to the assumption, with its reason
    expect(cashYieldUsed({ ...deal, companyACashYield: { value: null, reason: 'no interest income tagged' } })).toMatchObject({ rate: 0.04, reason: 'no interest income tagged' });
  });

  test('one calculation: the grid / forward EPS equals calculate()’s pro forma EPS (no second copy)', () => {
    const r = calculate(deal);
    expect(calcProFormaEPS(deal.offerPricePerShare, r.synergiesY1, deal).toFixed(2)).toBe(r.proFormaEPS);
    expect(financingCost(deal).total).toBeCloseTo(r.newInterestAfterTax + r.lostInterestAfterTax, 10);
  });

  test('no cash funds the deal by construction (peer screen, bank deal) → a genuine 0, EPS unchanged from before', () => {
    const peer = { ...deal, applySourcesOfFunds: false };
    expect(financingCost(peer).lostInterestAfterTax).toBe(0);
    expect(financingCost({ ...deal, bankDeal: true }).lostInterestAfterTax).toBe(0);
  });

  test('unknown target debt → unknown cash used → lost interest and pro forma net income null, never 0', () => {
    const r = calculate({ ...deal, companyBDebt: null });
    expect(r.lostInterestAfterTax).toBeNull();
    expect(r.proFormaNetIncome).toBeNull();
  });

  test('companyInputs carries the realized yield on the selected basis', () => {
    const data = { cashYield: { value: 0.036 }, ltm: { trusted: true, asOf: '2026-09-30', revenue: 1, cashYield: { value: 0.034 } } };
    expect(companyInputs('A', data, BASIS_LTM).companyACashYield.value).toBe(0.034);
    expect(companyInputs('A', data, BASIS_FY).companyACashYield.value).toBe(0.036);
  });
});
