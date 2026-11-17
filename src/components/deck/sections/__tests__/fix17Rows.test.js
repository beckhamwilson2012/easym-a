import { cellText, rowCells, rowAllDash, beyondConsensusLine } from '../SectionProFormaPL';

// Fix 17 Task 3: rows that print "—" in every column are hidden; synergy rows say "in EBIT" in PF Tot.; a year past the
// consensus years is one line.
describe('Pro Forma rows', () => {
  test('cost of revenue / gross profit with no consensus: every cell "—" → hidden', () => {
    expect(rowAllDash({ label: 'Cost of Revenue', a: null, b: null, c: null, syn: null, pf: null })).toBe(true);
    expect(rowAllDash({ label: 'Gross margin %', a: null, b: null, c: null, pct: true })).toBe(true);
    expect(rowAllDash({ label: 'Operating Expense', dash: true })).toBe(true);
  });

  test('a cost synergy prints in Syn. and PF Tot. says "in EBIT"', () => {
    const r = { label: 'Cost synergies', syn: 9.12, synText: null, pf: null, synRow: true };
    expect(cellText(rowCells(r).syn)).toBe('+$9');
    expect(cellText(rowCells(r).pf)).toBe('in EBIT');
    expect(rowAllDash(r)).toBe(false);
  });

  test('a zero revenue synergy (Year 1 ramp 0%) prints "—" everywhere → hidden; PF never says "in EBIT" for nothing', () => {
    const r = { label: 'Revenue synergies at 81.3% margin', syn: 0, synText: null, pf: null, synRow: true };
    expect(cellText(rowCells(r).pf)).toBe('—');
    expect(rowAllDash(r)).toBe(true);
  });

  test('"none entered" is text, not "—": the row stays and PF Tot. stays "—"', () => {
    const r = { label: 'Total synergies (EBITDA impact)', syn: 0, synText: 'none entered', pf: null, synRow: true };
    expect(cellText(rowCells(r).pf)).toBe('—');
    expect(rowAllDash(r)).toBe(false);
  });

  test('a $0.0 financing line is a value, not "—"', () => {
    const r = { label: 'Less: Acq. financing interest (after-tax)', a: null, b: null, c: null, syn: null, pf: -0, fin: true };
    expect(cellText(rowCells(r).pf)).toBe('$0.0');
    expect(rowAllDash(r)).toBe(false);
  });

  test('total-cost and revenue rows with values stay', () => {
    expect(rowAllDash({ label: 'Total costs (derived: revenue − operating income)', a: 806, b: 364, c: 1170, syn: null, pf: 1170 })).toBe(false);
  });
});

describe('a year past the consensus years', () => {
  const fys = [2026, 2027, 2028];
  test('FY2029: one line with Year 3 synergies from the schedule', () => {
    const slot = { a: null, b: null, fyA: 2029, synYr: 3 };
    expect(beyondConsensusLine(slot, { ebitda: 32.2734, entered: true }, fys))
      .toBe('Year 3 synergies ($32.3M) fall in FY2029, beyond the consensus years (FY2026–FY2028)');
  });
  test('none entered', () => {
    expect(beyondConsensusLine({ a: null, fyA: 2029, synYr: 3 }, { ebitda: 0, entered: false }, fys))
      .toBe('Year 3 synergies (none entered) fall in FY2029, beyond the consensus years (FY2026–FY2028)');
  });
  test('a year within the consensus years keeps its table', () => {
    expect(beyondConsensusLine({ a: { fy: 2028 }, fyA: 2028, synYr: 2 }, { ebitda: 20, entered: true }, fys)).toBeNull();
    expect(beyondConsensusLine({ a: null, fyA: 2027, synYr: 1 }, { ebitda: 9, entered: true }, fys)).toBeNull();
  });
});
