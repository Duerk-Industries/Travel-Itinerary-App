import { describe, expect, test } from '@jest/globals';
import { buildLodgingPayload, calculateNights, createInitialLodgingState } from '../tabs/lodging';

describe('Lodging helpers', () => {
  test('calculateNights returns whole-night stay length', () => {
    expect(calculateNights('2025-04-10', '2025-04-12')).toBe(2);
  });

  test('buildLodgingPayload validates name and dates', () => {
    const draft = createInitialLodgingState();
    const missingName = buildLodgingPayload(draft, 'trip-1', null);
    expect(missingName.error).toBe('Please enter a lodging name and select an active trip.');

    const invalidDates = buildLodgingPayload(
      { ...draft, name: 'Hotel', checkInDate: '2025-04-12', checkOutDate: '2025-04-10' },
      'trip-1',
      null
    );
    expect(invalidDates.error).toBe('Check-out must be after check-in.');
  });

  test('buildLodgingPayload computes cost per night and applies default payer', () => {
    const draft = {
      ...createInitialLodgingState(),
      name: 'Hotel',
      checkInDate: '2025-04-10',
      checkOutDate: '2025-04-12',
      rooms: '2',
      totalCost: '200',
    };
    const result = buildLodgingPayload(draft, 'trip-1', 'payer-1');
    expect(result.payload?.costPerNight).toBe('50.00');
    expect(result.payload?.paidBy).toEqual(['payer-1']);
  });
});
