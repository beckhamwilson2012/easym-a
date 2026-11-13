import { verdictFlags } from '../dealVerdict';

// Fix 10 Task 6: "No major flags — deal looks structurally sound" never sits under a dilutive verdict or a synergy gap.
describe('Fix 10 Task 6 — risk flags match the verdict', () => {
  test('HNGE/TDOC LTM GAAP: dilutive, breakeven $269M, none entered → two flags with their numbers', () => {
    const v = { step: 1, verdict: 'dilutive', text: 'Dilutive (pro forma EPS −$0.36 vs $1.95)', tag: 'EPS test, Year 1', breakeven: 269.4, entered: null };
    expect(verdictFlags(v).map(f => f.text)).toEqual([
      'Dilutive: Dilutive (pro forma EPS −$0.36 vs $1.95), EPS test, Year 1',
      'Synergy gap: breaks even at $269M of synergies; none entered',
    ]);
  });
  test('an accretive deal that breaks even with no synergies has no verdict flag', () => {
    expect(verdictFlags({ step: 1, verdict: 'accretive', text: 'Accretive (+1.1%)', tag: 'EPS test, Year 1', breakeven: -2.25, entered: null })).toEqual([]);
  });
  test('entered synergies above the breakeven → no gap; below → a gap naming both', () => {
    expect(verdictFlags({ step: 1, verdict: 'accretive', text: 'x', tag: 't', breakeven: 50, entered: 80 })).toEqual([]);
    expect(verdictFlags({ step: 1, verdict: 'accretive', text: 'x', tag: 't', breakeven: 1300, entered: 600 })[0].text).toBe('Synergy gap: breaks even at $1.3B of synergies; entered $600M');
  });
  test('synergies short of the premium is a flag with both figures', () => {
    const f = verdictFlags({ step: 3, verdict: 'short', text: "Synergies don't cover the premium", tag: 'Premium vs synergies (pre-tax, EV/EBITDA 10.00x)', premiumDollars: 500, capitalizedValue: 300, breakeven: 50, entered: 30 });
    expect(f[0].text).toBe("Synergies don't cover the premium: premium $500M vs capitalized Year 3 synergies $300M (Premium vs synergies (pre-tax, EV/EBITDA 10.00x))");
  });
  test('no verdict is a flag, never "structurally sound"', () => {
    expect(verdictFlags({ step: null, text: '—', line: "No test can be computed: NET's standalone EPS is not positive." })[0].text)
      .toBe("No deal verdict: no test can be computed — NET's standalone EPS is not positive.");
  });
});
