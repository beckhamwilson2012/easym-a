import { dealVerdict, TAG_YEAR1, TAG_PREMIUM } from '../dealVerdict';
import { calcProFormaEPS } from '../../utils/dealCalc';

// Acquirer: NI 200, 100 diluted shares (EPS 2), price 40. Target: NI 50, 50 shares, price 25. 0% cash: no financing drag.
const inputs = (over = {}) => ({
  companyANetIncome: 200, companyAEPS: 2, companyADilutedShares: 100, companyAShares: 100, currentSharePriceA: 40,
  companyBNetIncome: 50, companyBShares: 50, companyBDilutedShares: 50, currentSharePriceB: 25, companyBDebt: 0,
  cashPercent: 0, offerPricePerShare: 30, ...over,
});
const years = (y1, y2, y3) => ({ years: [y1, y2, y3].map((v, i) => ({ year: i + 1, ebitda: v ?? 0, entered: v != null })) });
const deal = (inp, syn = [null, null, null]) => ({
  offerPrice: inp.offerPricePerShare, _inputs: inp, _results: {},
  synergiesY1: syn[0] ?? 0, synergiesY2: syn[1] ?? 0, synergiesY3: syn[2] ?? 0, synergies: years(...syn),
});
const model = (over = {}) => ({ derived: { evAcquirer: 4000, ...over.derived }, verifiedData: { acquirer: { price: 40, ebitda: 400, ...over.acquirer } } });

describe('deal verdict ladder', () => {
  test('step 1: Year 1 EPS test when standalone EPS is positive, with the breakeven solved from the same EPS function', () => {
    const inp = inputs();
    const v = dealVerdict({ deal: deal(inp, [10, 20, 30]), model: model(), acquirerFwd: [], targetFwd: [] });
    expect(v.step).toBe(1);
    expect(v.tag).toBe(TAG_YEAR1);
    // 30 × 50 / 40 = 37.5 new shares; (250 + 10 × 0.79) / 137.5 = 1.8757 < 2
    expect(v.verdict).toBe('dilutive');
    // (2 × 137.5 − 250) / 0.79 = 31.6456
    expect(v.breakeven).toBeCloseTo(25 / 0.79, 9);
    expect(calcProFormaEPS(30, v.breakeven, inp)).toBeCloseTo(2, 12);
    expect(v.line).toBe('Breaks even at $32M of synergies; entered $10M');
  });

  test('step 2: first forecast year with positive acquirer consensus EPS', () => {
    const inp = inputs({ companyANetIncome: -100, companyAEPS: -1 });
    const v = dealVerdict({
      deal: deal(inp, [10, 20, 30]), model: model(),
      acquirerFwd: [{ label: 'FY2026E', fy: 2026, eps: -0.5 }, { label: 'FY2027E', fy: 2027, eps: 3 }],
      targetFwd: [{ label: 'FY2026E', eps: 1 }, { label: 'FY2027E', eps: 2 }],
    });
    expect(v.step).toBe(2);
    expect(v.tag).toBe('EPS test, FY2027E (first profitable year)');
    // FY2027E: NI 300 + 100 + 20 × 0.79 = 415.8 over 137.5 = 3.024 > 3; slide 8 pairs FY2027E with Year 2 synergies
    expect(v.proFormaEPS).toBeCloseTo(415.8 / 137.5, 12);
    expect(v.verdict).toBe('accretive');
    expect(v.entered).toBe(20);
  });

  test('step 3: synergies vs premium at EV/EBITDA when P/E is not meaningful', () => {
    const inp = inputs({ companyANetIncome: -100, companyAEPS: -1 });
    const v = dealVerdict({ deal: deal(inp, [10, 20, 30]), model: model(), acquirerFwd: [{ label: 'FY2026E', eps: -0.2 }], targetFwd: [{ label: 'FY2026E', eps: 1 }] });
    expect(v.step).toBe(3);
    expect(v.tag).toBe(TAG_PREMIUM);
    expect(v.multiple).toEqual({ value: 10, name: 'EV/EBITDA' });
    expect(v.premiumDollars).toBe((30 - 25) * 50);          // 250
    expect(v.capitalizedValue).toBeCloseTo(30 * 0.79 * 10, 12); // 237
    expect(v.text).toBe("Synergies don't cover the premium");
    expect(v.breakeven).toBeCloseTo(250 / (10 * 0.79), 12);
  });

  test('step 3 uses the premium reference price when one is chosen', () => {
    const inp = inputs({ companyANetIncome: -100, companyAEPS: -1, premiumReferencePrice: 20 });
    const v = dealVerdict({ deal: deal(inp, [10, 20, 30]), model: model(), acquirerFwd: [], targetFwd: [] });
    expect(v.premiumDollars).toBe((30 - 20) * 50);
  });

  test('nothing computable: a dash naming the missing inputs, never a default', () => {
    const inp = inputs({ companyANetIncome: -100, companyAEPS: -1 });
    const v = dealVerdict({ deal: deal(inp), model: model({ acquirer: { ebitda: -5 } }), acquirerFwd: [], targetFwd: [] });
    expect(v.step).toBeNull();
    expect(v.text).toBe('—');
    expect(v.line).toMatch(/standalone EPS is not positive/);
    expect(v.line).toMatch(/no Year 3 synergies are entered/);
    expect(v.line).toMatch(/P\/E and EV\/EBITDA are not meaningful/);
  });
});
