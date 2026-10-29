import { getTripPeriod } from '../utils/tripPeriod';

describe('trip date grouping', () => {
  const today = new Date(2026, 9, 25, 23, 59);
  it.each([
    ['2026-10-24', '2026-10-24', 'Past'],
    ['2026-10-24', '2026-10-25', 'Current'],
    ['2026-10-25', '2026-10-28', 'Current'],
    ['2026-10-26', '2026-10-28', 'Upcoming'],
  ])('groups %s through %s as %s', (startDate, endDate, expected) => {
    expect(getTripPeriod({ startDate, endDate }, today)).toBe(expected);
  });
  it('uses duration when the end date is absent', () => {
    expect(getTripPeriod({ startDate: '2026-10-24', durationDays: 2 }, today)).toBe('Current');
  });
  it('supports month-only trips and undated trips', () => {
    expect(getTripPeriod({ startYear: 2026, startMonth: 10 }, today)).toBe('Current');
    expect(getTripPeriod({}, today)).toBe('Unscheduled');
    expect(getTripPeriod({ durationDays: 7 }, today)).toBe('Unscheduled');
  });
});
