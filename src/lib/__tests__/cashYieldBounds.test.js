import { cashYieldUsed, CASH_YIELD_ASSUMPTION, DEBT_INTEREST_RATE } from '../../utils/dealCalc';

// Fix 16 Task 5: the realized yield is used only between 0% and the 5% debt rate; otherwise the stated 4.0% assumption,
// with the reason in the label.
describe('cashYieldUsed bounds', () => {
  const at = (value, label = 'LTM interest income $X ÷ average cash + ST investments $Y') => cashYieldUsed({ companyACashYield: { value, label } });
  test('inside the range: the realized yield', () => {
    expect(at(0.031)).toEqual({ rate: 0.031, assumption: false, label: 'LTM interest income $X ÷ average cash + ST investments $Y', reason: null });
    expect(at(DEBT_INTEREST_RATE).rate).toBe(0.05);   // at the debt rate: still the company's own
  });
  test('KO 7.5%: above the debt rate → 4.0% assumption, and the label says why', () => {
    const y = at(0.0753);
    expect(y.rate).toBe(CASH_YIELD_ASSUMPTION);
    expect(y.assumption).toBe(true);
    expect(y.label).toBe('4.0% (assumption: realized yield 7.5% is above the 5.0% debt rate)');
    expect(y.reason).toMatch(/^the acquirer's realized yield 7\.5% is above the 5\.0% debt rate \(LTM interest income/);
  });
  test('zero or negative realized yield → assumption, said so', () => {
    expect(at(0).label).toBe('4.0% (assumption: realized yield 0.0% is not above 0%)');
    expect(at(-0.01).rate).toBe(CASH_YIELD_ASSUMPTION);
  });
  test('no realized yield → the unchanged assumption label', () => {
    expect(cashYieldUsed({ companyACashYield: { value: null, reason: 'no interest income tagged' } }))
      .toEqual({ rate: 0.04, assumption: true, label: '4.0% (assumption)', reason: 'no interest income tagged' });
    expect(cashYieldUsed({}).label).toBe('4.0% (assumption)');
  });
});
