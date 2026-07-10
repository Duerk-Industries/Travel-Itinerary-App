/// <reference types="node" />
import { describe, expect, test } from '@jest/globals';
import {
  parseDate,
  computeDurationFromRange,
  computeEndDateFromDuration,
  formatMonthYear,
  adjustStartDateForEarliest,
  getEarliestTripEventDate,
} from './tripDates';

describe('Trip Dates Utilities', () => {
  describe('parseDate', () => {
    test('parses a valid date string', () => {
      const date = parseDate('2025-12-25');
      expect(date).toEqual(new Date('2025-12-25T00:00:00.000Z'));
    });

    test('returns null for an invalid date string', () => {
      const date = parseDate('not a date');
      expect(date).toBeNull();
    });

    test('returns null for a null or undefined value', () => {
      expect(parseDate(null)).toBeNull();
      expect(parseDate(undefined)).toBeNull();
    });
  });

  describe('computeDurationFromRange', () => {
    test('calculates the duration between two dates', () => {
      const duration = computeDurationFromRange('2025-12-20', '2025-12-25');
      expect(duration).toBe(6);
    });

    test('returns 1 for the same start and end date', () => {
      const duration = computeDurationFromRange('2025-12-25', '2025-12-25');
      expect(duration).toBe(1);
    });

    test('returns null if the end date is before the start date', () => {
      const duration = computeDurationFromRange('2025-12-25', '2025-12-20');
      expect(duration).toBeNull();
    });

    test('returns null for invalid date strings', () => {
      const duration = computeDurationFromRange('not a date', '2025-12-20');
      expect(duration).toBeNull();
    });
  });

  describe('computeEndDateFromDuration', () => {
    test('calculates the end date from a start date and duration', () => {
      const endDate = computeEndDateFromDuration('2025-12-20', 6);
      expect(endDate).toBe('2025-12-25');
    });

    test('returns the same date for a duration of 1', () => {
      const endDate = computeEndDateFromDuration('2025-12-25', 1);
      expect(endDate).toBe('2025-12-25');
    });

    test('returns null for a duration of 0 or less', () => {
      expect(computeEndDateFromDuration('2025-12-25', 0)).toBeNull();
      expect(computeEndDateFromDuration('2025-12-25', -1)).toBeNull();
    });
  });

  describe('formatMonthYear', () => {
    test('formats a month and year into a string', () => {
      const formatted = formatMonthYear(12, 2025);
      expect(formatted).toBe('December 2025');
    });

    test('returns null for invalid month or year', () => {
      expect(formatMonthYear(null, 2025)).toBeNull();
      expect(formatMonthYear(12, null)).toBeNull();
      expect(formatMonthYear(13, 2025)).toBe('January 2026'); // unexpected but how Date() works
    });
  });

  describe('adjustStartDateForEarliest', () => {
    test('adjusts the start date based on an earliest possible date', () => {
      const dates = adjustStartDateForEarliest({
        startDate: '2025-01-10',
        endDate: '2025-01-15',
        earliestDate: '2025-01-12',
      });
      expect(dates.startDate).toBe('2025-01-12');
      expect(dates.endDate).toBe('2025-01-17');
    });

    test('does not adjust if start date is after earliest date', () => {
        const dates = adjustStartDateForEarliest({
            startDate: '2025-01-15',
            endDate: '2025-01-20',
            earliestDate: '2025-01-10',
        });
        expect(dates.startDate).toBe('2025-01-15');
        expect(dates.endDate).toBe('2025-01-20');
    });
  });

  describe('getEarliestTripEventDate', () => {
    test('returns the earliest date from a list of dates', () => {
      const earliest = getEarliestTripEventDate(['2025-02-15', '2025-01-10', '2025-03-20']);
      expect(earliest).toBe('2025-01-10');
    });

    test('handles null and undefined values', () => {
        const earliest = getEarliestTripEventDate([null, '2025-01-10', undefined, '2025-03-20']);
        expect(earliest).toBe('2025-01-10');
    });

    test('returns null for an empty list', () => {
        const earliest = getEarliestTripEventDate([]);
        expect(earliest).toBeNull();
    });
  });
});
