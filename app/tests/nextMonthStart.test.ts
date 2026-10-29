import { nextMonthStart } from '../utils/tripDates';

describe('nextMonthStart', () => {
  const today = new Date(2026, 9, 28); // 28 Oct 2026

  it('uses this year for a month still to come', () => {
    expect(nextMonthStart(11, today)).toBe('2026-11-01');
    expect(nextMonthStart(4, new Date(2026, 0, 15))).toBe('2026-04-01');
  });

  it('uses next year for the current month once its 1st has passed, and for earlier months', () => {
    expect(nextMonthStart(10, today)).toBe('2027-10-01');
    expect(nextMonthStart(3, today)).toBe('2027-03-01');
  });

  it('counts today when today is the 1st of that month', () => {
    expect(nextMonthStart(10, new Date(2026, 9, 1))).toBe('2026-10-01');
  });

  it('rejects a month that is not 1 to 12', () => {
    expect(nextMonthStart(0, today)).toBeNull();
    expect(nextMonthStart(13, today)).toBeNull();
    expect(nextMonthStart(Number.NaN, today)).toBeNull();
  });
});
