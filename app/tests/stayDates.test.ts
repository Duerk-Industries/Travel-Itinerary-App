/// <reference types="jest" />
import { formatStayRange, stayDayNote } from '../utils/stayDates';

describe('formatStayRange', () => {
  it('shows short weekday dates and the number of nights', () => {
    expect(formatStayRange('2026-10-29', '2026-11-02')).toBe('Thu, Oct 29 → Mon, Nov 2 · 4 nights');
    expect(formatStayRange('2026-10-29', '2026-10-30')).toBe('Thu, Oct 29 → Fri, Oct 30 · 1 night');
  });

  it('handles timestamps without shifting the day', () => {
    expect(formatStayRange('2026-10-29T00:00:00.000Z', '2026-11-02T00:00:00.000Z')).toBe('Thu, Oct 29 → Mon, Nov 2 · 4 nights');
  });

  it('copes with a missing check-out or unparseable input', () => {
    expect(formatStayRange('2026-10-29', '')).toBe('Thu, Oct 29');
    expect(formatStayRange('TBD', '2026-11-02')).toBe('TBD');
  });
});

describe('stayDayNote', () => {
  it('notes check-in and check-out days only', () => {
    expect(stayDayNote('2026-10-29', '2026-11-02', '2026-10-29')).toBe('Check-in today');
    expect(stayDayNote('2026-10-29', '2026-11-02', '2026-11-02')).toBe('Check-out today');
    expect(stayDayNote('2026-10-29', '2026-11-02', '2026-10-31')).toBeNull();
  });
});
