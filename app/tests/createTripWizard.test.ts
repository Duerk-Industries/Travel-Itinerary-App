import { describe, expect, test } from '@jest/globals';
import {
  buildTripDescription,
  computeTripDays,
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
    expect(validateTripDates({ startDate: '2025-02-10', endDate: '2025-02-01' })).toBe(
      'End date cannot be before start date.'
    );
    expect(validateTripDates({ startDate: 'bad-date', endDate: '2025-02-10' })).toBe(
      'Invalid start or end date.'
    );
    expect(validateTripDates({ startDate: '2025-02-01', endDate: '2025-02-10' })).toBeNull();
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
});
