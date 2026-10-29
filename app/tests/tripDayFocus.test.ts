import { dayToOpen, localIsoDate } from '../utils/tripDayFocus';

describe('tripDayFocus', () => {
  it('formats a date in local time, zero padded', () => {
    expect(localIsoDate(new Date(2027, 0, 5, 23, 59))).toBe('2027-01-05');
  });

  it("opens on today only while it is one of the trip's days", () => {
    const days = ['2027-05-01', '2027-05-02', '2027-05-03'];
    expect(dayToOpen(days, '2027-05-02')).toBe('2027-05-02');
    expect(dayToOpen(days, '2027-04-30')).toBeNull();
    expect(dayToOpen(days, '2027-05-04')).toBeNull();
    expect(dayToOpen([], '2027-05-02')).toBeNull();
  });
});
