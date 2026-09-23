/// <reference types="jest" />

import { formatLocalDateOnly, localTodayDateOnly, parseLocalDateOnly } from '../utils/dateOnly';

describe('date-only helpers', () => {
  it('parses a calendar date into local date-picker values without UTC parsing', () => {
    const date = parseLocalDateOnly('2026-03-08');

    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(8);
    expect(date.getHours()).toBe(0);
    expect(formatLocalDateOnly(date)).toBe('2026-03-08');
  });

  it('keeps local calendar dates stable when formatting and rejects invalid date-only input', () => {
    const localDate = new Date(2026, 10, 1, 23, 45, 0);
    const fallback = new Date(2026, 0, 15, 9, 30, 0);

    expect(formatLocalDateOnly(localDate)).toBe('2026-11-01');
    expect(formatLocalDateOnly(parseLocalDateOnly('2026-02-31', fallback))).toBe('2026-01-15');
  });

  it('returns a device-local representation of today', () => {
    expect(localTodayDateOnly()).toBe(formatLocalDateOnly(new Date()));
  });
});
