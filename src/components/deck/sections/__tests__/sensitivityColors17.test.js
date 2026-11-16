import { epsVsBreakeven } from '../../shared/deckTokens';

// Fix 17 Task 5: green above the stated breakeven, red below, at the cent the slide prints. The old grid had a ±3%
// neutral band, so against a $2.24 breakeven only cells ≥ $2.31 were green.
describe('epsVsBreakeven', () => {
  test('cells between breakeven and +3% are above (they were grey)', () => {
    for (const eps of [2.25, 2.26, 2.27, 2.28, 2.29, 2.30]) expect(epsVsBreakeven(eps, 2.24)).toBe('above');
  });
  test('below breakeven is below, whatever the distance', () => {
    expect(epsVsBreakeven(2.23, 2.24)).toBe('below');
    expect(epsVsBreakeven(2.12, 2.2165)).toBe('below');
  });
  test('compared at the printed cent: $2.22 against a $2.2165 breakeven (printed $2.22) is at breakeven', () => {
    expect(epsVsBreakeven(2.2190, 2.2165)).toBe('at');
    expect(epsVsBreakeven(2.2251, 2.2165)).toBe('above');
  });
  test('no EPS or a non-positive breakeven: no comparison', () => {
    expect(epsVsBreakeven(null, 2.24)).toBeNull();
    expect(epsVsBreakeven(2.3, 0)).toBeNull();
    expect(epsVsBreakeven(2.3, -0.17)).toBeNull();
  });
});
