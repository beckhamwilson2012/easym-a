import { shortPeriod } from '../../components/shared/SynergyInputs';

describe('short base period on the synergy line', () => {
  test('fiscal year and LTM labels shorten; anything else is shown as it is', () => {
    expect(shortPeriod('FY ended Dec 31, 2025')).toBe('FY25');
    expect(shortPeriod('FY ended Mar 31, 2026')).toBe('FY26');
    expect(shortPeriod('LTM to Jun 30, 2026')).toBe('LTM Jun 30, 2026');
    expect(shortPeriod('period unknown')).toBe('period unknown');
  });
});
