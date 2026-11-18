import { pfTotals, rowCells, cellText } from '../SectionProFormaPL';
import { forwardTotalCosts } from '../../../../lib/forwardCosts';

// Fix 20 Task 1: every PF Tot. margin is its own column's numerator ÷ its own revenue, both including synergies.
// Figures: KO/PEP FY2027E as the deck printed them on 4f5be4a (Comb. revenue $150,798, EBIT $35,901; Year 2 synergies
// cost $2,671.41, revenue $1,719.2175 at 57.0% → $979.95, total $3,650.63).
const yr2 = { cost: 2671.41, revenue: 1719.2175, revenueEbitda: 979.95, ebitda: 3651.36, entered: true };

describe('pfTotals', () => {
  test('revenue + revenue synergies; EBIT + total synergies', () => {
    const t = pfTotals({ cRev: 150798, cGross: null, cEbit: 35901 }, yr2);
    expect(t.pfRev).toBeCloseTo(152517.2175, 4);
    expect(t.pfEbit).toBeCloseTo(39552.36, 4);
    expect(t.pfGross).toBeNull();                       // forward gross profit is not in consensus
  });
  test('the PF Tot. operating margin is PF EBIT ÷ PF revenue, not the Combined margin', () => {
    const t = pfTotals({ cRev: 150798, cGross: null, cEbit: 35901 }, yr2);
    const r = { label: 'Operating margin %', c: 35901 / 150798 * 100, pf: t.pfEbit / t.pfRev * 100, pct: true };
    expect(cellText(rowCells(r).c)).toBe('23.8%');
    expect(cellText(rowCells(r).pf)).toBe('25.9%');
  });
  test('revenue synergies reach gross profit at the combined margin; cost synergies do not', () => {
    const t = pfTotals({ cRev: 1000, cGross: 600, cEbit: 200 }, { cost: 10, revenue: 50, revenueEbitda: 30, ebitda: 40, entered: true });
    expect(t.pfGross).toBe(630);
    expect(t.pfRev).toBe(1050);
    expect(t.pfEbit).toBe(240);
    expect((t.pfGross / t.pfRev * 100).toFixed(1)).toBe('60.0');
  });
  test('a revenue synergy with no margin to carry it leaves PF gross profit unknown, never Combined', () => {
    const t = pfTotals({ cRev: 1000, cGross: 600, cEbit: 200 }, { cost: null, revenue: 50, revenueEbitda: null, ebitda: 0, entered: true });
    expect(t.pfGross).toBeNull();
    expect(t.pfRev).toBe(1050);
  });
  test('no synergy year: PF equals Combined, and nulls stay null', () => {
    expect(pfTotals({ cRev: 1000, cGross: 600, cEbit: 200 }, null)).toEqual({ pfRev: 1000, pfGross: 600, pfEbit: 200 });
    expect(pfTotals({ cRev: null, cGross: null, cEbit: null }, yr2)).toEqual({ pfRev: null, pfGross: null, pfEbit: null });
  });
  test('PF Tot. total costs = PF revenue − PF EBIT, so the column foots', () => {
    const t = pfTotals({ cRev: 150798, cGross: null, cEbit: 35901 }, yr2);
    expect(forwardTotalCosts({ revenue: t.pfRev, operatingIncome: t.pfEbit })).toBeCloseTo(112964.8575, 4);
    expect(forwardTotalCosts({ revenue: null, operatingIncome: t.pfEbit })).toBeNull();
  });
  test('a % row with no PF value prints "—", not the Combined %', () => {
    expect(cellText(rowCells({ label: 'x', c: 23.8, pf: null, pct: true }).pf)).toBe('—');
  });
});
