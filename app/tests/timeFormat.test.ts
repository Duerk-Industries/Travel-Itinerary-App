/// <reference types="jest" />
import { formatClockTime, formatTimeOfDay, getTimeFormatPreference, normalizeTimeFormat, setTimeFormatPreference } from '../utils/timeFormat';
import { formatTourSummary } from '../utils/overviewBuilder';

describe('time format', () => {
  afterEach(() => setTimeFormatPreference(null));

  it('shows times as before until the traveler picks a format', () => {
    expect(getTimeFormatPreference()).toBeNull();
    expect(normalizeTimeFormat(undefined)).toBe('24h');
    expect(normalizeTimeFormat('am/pm')).toBe('24h');
    expect(normalizeTimeFormat('12h')).toBe('12h');
    expect(formatClockTime('14:30')).toBe('14:30');
    expect(formatTimeOfDay(new Date(2027, 4, 10, 15, 5))).toBe(new Date(2027, 4, 10, 15, 5).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
  });

  it('shows stored times with AM and PM in 12-hour', () => {
    expect(['00:05', '09:00', '9:30', '12:00', '12:45', '13:15', '23:59', '14:30:00'].map((time) => formatClockTime(time, '12h')))
      .toEqual(['12:05 AM', '9:00 AM', '9:30 AM', '12:00 PM', '12:45 PM', '1:15 PM', '11:59 PM', '2:30 PM']);
  });

  it('converts every time in a range and leaves everything else alone', () => {
    expect(formatClockTime('09:00-11:30', '12h')).toBe('9:00 AM-11:30 AM');
    expect(formatClockTime('Time TBD', '12h')).toBe('Time TBD');
    expect(formatClockTime('', '12h')).toBe('');
    expect(formatClockTime(null, '12h')).toBe('');
    expect(formatClockTime('25:00', '12h')).toBe('25:00');
  });

  it('follows the preference App sets, wherever the time is formatted', () => {
    setTimeFormatPreference('12h');
    expect(formatTourSummary({ name: 'Museum', startTime: '15:00', startLocation: 'Centro' } as any)).toBe('Museum at 3:00 PM at Centro');
    expect(formatTimeOfDay(new Date(2027, 4, 10, 15, 5))).toMatch(/3:05\sPM/i);
    setTimeFormatPreference('24h');
    expect(formatTimeOfDay(new Date(2027, 4, 10, 15, 5))).toMatch(/15:05/);
  });
});
