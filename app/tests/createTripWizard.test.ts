import { describe, expect, test } from '@jest/globals';
import {
  buildTripDescription,
  computeTripDays,
  ensureParticipantIncluded,
  ensureRangeEndDate,
  getDefaultParticipant,
  getDefaultTripRangeDates,
  normalizeEmail,
  validateParticipants,
  validateTripDates,
  validateTripDetails,
} from '../utils/createTripWizard';

describe('Create Trip Wizard helpers', () => {
  test('validates trip details', () => {
    expect(validateTripDetails({ name: '', description: '', destination: '' })).toBe('Trip name is required.');
    expect(validateTripDetails({ name: 'Paris', description: '', destination: '' })).toBeNull();
  });

  test('validates trip dates', () => {
    expect(
      validateTripDates({
        mode: 'range',
        startDate: '2025-02-10',
        endDate: '2025-02-01',
        startMonth: '',
        startYear: '',
        durationDays: '',
      })
    ).toBe(
      'End date cannot be before start date.'
    );
    expect(
      validateTripDates({
        mode: 'range',
        startDate: 'bad-date',
        endDate: '2025-02-10',
        startMonth: '',
        startYear: '',
        durationDays: '',
      })
    ).toBe(
      'Invalid start or end date.'
    );
    expect(
      validateTripDates({
        mode: 'range',
        startDate: '2025-02-01',
        endDate: '2025-02-10',
        startMonth: '',
        startYear: '',
        durationDays: '',
      })
    ).toBeNull();
    expect(
      validateTripDates({
        mode: 'month',
        startDate: '',
        endDate: '',
        startMonth: '4',
        startYear: '2025',
        durationDays: '5',
      })
    ).toBeNull();
  });

  test('validates participants and unique emails', () => {
    expect(validateParticipants([{ firstName: '', lastName: 'Smith', email: '' }])).toBe(
      'Each participant needs a first and last name.'
    );
    expect(
      validateParticipants([
        { firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com' },
        { firstName: 'Pat', lastName: 'Lee', email: 'sam@example.com' },
      ])
    ).toBe('Participant emails must be unique.');
    expect(
      validateParticipants([
        { firstName: 'Sam', lastName: 'Lee', email: 'sam@example.com' },
        { firstName: 'Pat', lastName: 'Lee', email: '' },
      ])
    ).toBeNull();
  });

  test('computes trip days', () => {
    expect(computeTripDays('2025-02-01', '2025-02-01')).toBe(1);
    expect(computeTripDays('2025-02-01', '2025-02-03')).toBe(3);
    expect(computeTripDays('invalid', '2025-02-03')).toBeNull();
  });

  test('builds description with known info', () => {
    const description = buildTripDescription(
      { name: 'Trip', description: 'Base', destination: '' },
      { flights: 'DL123', lodging: '', tours: 'Museum', cars: '' }
    );
    expect(description).toContain('Base');
    expect(description).toContain('## Known Info');
    expect(description).toContain('Flights: DL123');
    expect(description).toContain('Tours & Activities: Museum');
  });

  test('normalizes emails', () => {
    expect(normalizeEmail('  TEST@Example.com ')).toBe('test@example.com');
  });

  test('defaults trip range dates to today and next day', () => {
    const today = new Date('2025-03-10T12:00:00Z');
    const defaults = getDefaultTripRangeDates({ startDate: '', endDate: '', today });
    expect(defaults.startDate).toBe('2025-03-10');
    expect(defaults.endDate).toBe('2025-03-11');
  });

  test('ensures end date is after start date', () => {
    expect(ensureRangeEndDate('2025-03-10', '2025-03-09')).toBe('2025-03-11');
    expect(ensureRangeEndDate('2025-03-10', '')).toBe('2025-03-11');
    expect(ensureRangeEndDate('2025-03-10', '2025-03-12')).toBe('2025-03-12');
  });

  test('adds current user as default participant once', () => {
    const user = getDefaultParticipant('Ava Smith', 'ava@example.com');
    expect(user).toEqual({ firstName: 'Ava', lastName: 'Smith', email: 'ava@example.com' });
    const seeded = ensureParticipantIncluded([], 'Ava Smith', 'ava@example.com');
    expect(seeded).toHaveLength(1);
    const secondPass = ensureParticipantIncluded(seeded, 'Ava Smith', 'ava@example.com');
    expect(secondPass).toHaveLength(1);
  });
});
