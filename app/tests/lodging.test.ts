/// <reference types="node" />
import { describe, expect, test } from '@jest/globals';
import { buildLodgingPayload, calculateNights, createInitialLodgingState, createLodgingDraftForTrip } from '../tabs/lodging';

describe('Lodging helpers', () => {
  test('calculateNights returns whole-night stay length', () => {
    expect(calculateNights('2025-04-10', '2025-04-12')).toBe(2);
  });

  test('buildLodgingPayload validates name and dates', () => {
    const draft = createInitialLodgingState({ status: 'Booked' });
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
    expect(result.payload?.status).toBe('Needed');
  });

  test('createLodgingDraftForTrip defaults check-in to trip start and travelers to provided list', () => {
    const draft = createLodgingDraftForTrip({
      tripStartDate: '2025-05-01',
      existingLodgings: [],
      defaultPayerId: 'payer-1',
      defaultTravelerIds: ['t1', 't2'],
    });
    expect(draft.checkInDate).toBe('2025-05-01');
    expect(draft.checkOutDate).toBe('2025-05-02');
    expect(draft.travelerIds).toEqual(['t1', 't2']);
  });

  test('createLodgingDraftForTrip uses latest checkout for subsequent lodgings', () => {
    const draft = createLodgingDraftForTrip({
      tripStartDate: '2025-05-01',
      existingLodgings: [{ checkOutDate: '2025-05-03' }, { checkOutDate: '2025-05-05' }],
      defaultTravelerIds: ['t3'],
    });
    expect(draft.checkInDate).toBe('2025-05-05');
    expect(draft.checkOutDate).toBe('2025-05-06');
  });

  test('buildLodgingPayload allows missing business fields when status is Needed', () => {
    const draft = createInitialLodgingState({
      status: 'Needed',
      name: '',
      checkInDate: '',
      checkOutDate: '',
    });
    const result = buildLodgingPayload(draft, 'trip-1', null);
    expect(result.error).toBeUndefined();
    expect(result.payload?.status).toBe('Needed');
  });
});
