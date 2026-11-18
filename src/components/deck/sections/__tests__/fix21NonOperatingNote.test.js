import { ltmNonOperatingNote } from '../SectionStandalonePL';

// Fix 21 Task 3: the LTM non-operating note never prints "undefined" or "$NaNM".
describe('ltmNonOperatingNote', () => {
  test('LTM = the latest 10-K: only the total exists, and the note says why the legs are "—"', () => {
    const t = ltmNonOperatingNote({ basis: 'latest-10-K', nonOperatingIncome: { ltmM: -321 }, audit: { periods: { annual: {} } } });
    expect(t).toBe('LTM net income includes non-operating expense of $321M (interim figures —: the LTM period is the latest fiscal year). LTM margins are not comparable to operating margins.');
    expect(t).not.toMatch(/NaN|undefined|null/);
  });
  test('a real LTM reads exactly as before', () => {
    const t = ltmNonOperatingNote({ nonOperatingIncome: { ltmM: 12, conceptName: 'NonoperatingIncomeExpense', latestYtdM: 9, priorYtdM: 4 },
      audit: { periods: { latestInterim: { span: 272, end: '2026-09-30', filed: '2026-11-01' }, priorInterim: { span: 272, end: '2025-09-30' } } } });
    expect(t).toBe("LTM net income includes non-operating income of $12M (NonoperatingIncomeExpense; 9M'26 $9M vs 9M'25 $4M), per the 10-Q filed 2026-11-01. LTM margins are not comparable to operating margins.");
  });
  test('one leg missing on a real LTM: "—" with the reason', () => {
    expect(ltmNonOperatingNote({ nonOperatingIncome: { ltmM: 5, conceptName: 'X', latestYtdM: 1 } })).toMatch(/\(X; interim figures —: not reported\)/);
  });
  test('no total: no note', () => {
    expect(ltmNonOperatingNote({ nonOperatingIncome: { ltmM: null } })).toBeNull();
    expect(ltmNonOperatingNote({})).toBeNull();
    expect(ltmNonOperatingNote(null)).toBeNull();
  });
});
