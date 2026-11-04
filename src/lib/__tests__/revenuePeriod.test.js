import { revenuePeriodLabel } from '../revenuePeriod';

describe('revenue period label', () => {
  test('annual figure', () => expect(revenuePeriodLabel({ revenue: 872, fiscalYearEnd: '2025-12-31' })).toBe('FY ended Dec 31, 2025'));
  test('non-December year end', () => expect(revenuePeriodLabel({ revenue: 4640, fiscalYearEnd: '2026-03-31' })).toBe('FY ended Mar 31, 2026'));
  test('LTM only when the LTM revenue is the figure shown', () => {
    expect(revenuePeriodLabel({ revenue: 903, ltm: { trusted: true, revenue: 903, asOf: '2026-09-30' } })).toBe('LTM to Sep 30, 2026');
  });
  test('an LTM block that is not the figure shown does not label it', () => {
    expect(revenuePeriodLabel({ revenue: 872, ltm: { trusted: true, revenue: 903, asOf: '2026-09-30' } })).toBe('period unknown');
    expect(revenuePeriodLabel({ revenue: 903, ltm: { trusted: false, revenue: 903, asOf: '2026-09-30' } })).toBe('period unknown');
  });
  test('the FMP fallback labels its own period, and an EDGAR year end still comes first', () => {
    expect(revenuePeriodLabel({ revenue: 41735, revenueTrace: { source: 'fmp', fiscalYearEnd: '2025-12-31' } })).toBe('FY ended Dec 31, 2025');
    expect(revenuePeriodLabel({ revenue: 4264, fiscalYearEnd: '2025-12-31', revenueTrace: { fiscalYearEnd: '2024-12-31' } })).toBe('FY ended Dec 31, 2025');
    expect(revenuePeriodLabel({ revenue: 100, revenueTrace: { source: 'fmp', fiscalYearEnd: null } })).toBe('period unknown');
  });
  test('no data is unknown', () => {
    expect(revenuePeriodLabel(null)).toBe('period unknown');
    expect(revenuePeriodLabel({ revenue: 100 })).toBe('period unknown');
  });
});
