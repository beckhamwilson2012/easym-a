import { fmtEastern, fmtCalendarDate } from '../easternTime';

describe('US Eastern times', () => {
  test('standard time: UTC−5', () => expect(fmtEastern('2026-11-03T21:00:00.000Z')).toBe('Nov 3, 2026, 4:00 PM ET'));
  test('daylight time: UTC−4', () => expect(fmtEastern('2026-07-01T20:00:00.000Z')).toBe('Jul 1, 2026, 4:00 PM ET'));
  test('crosses midnight into the Eastern date', () => expect(fmtEastern('2026-11-04T02:30:00.000Z')).toBe('Nov 3, 2026, 9:30 PM ET'));
  test('absent or unreadable is null', () => { expect(fmtEastern(null)).toBeNull(); expect(fmtEastern('nope')).toBeNull(); });
  test('a calendar date never shifts', () => expect(fmtCalendarDate('2026-11-02')).toBe('Nov 2, 2026'));
  test('no date is null', () => expect(fmtCalendarDate(null)).toBeNull());
});
