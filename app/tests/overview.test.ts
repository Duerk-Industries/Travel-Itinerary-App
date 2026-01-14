import { describe, expect, test } from '@jest/globals';
import {
  buildOverviewRows,
  formatFlightSummary,
  formatLodgingSummary,
  formatTourSummary,
} from '../utils/overviewBuilder';

describe('Overview helpers', () => {
  test('formats flight summary', () => {
    const summary = formatFlightSummary({
      id: 'f1',
      carrier: 'Delta',
      flight_number: 'DL100',
      departure_airport_code: 'JFK',
      arrival_airport_code: 'LAX',
      departure_time: '08:00',
      arrival_time: '11:00',
    });
    expect(summary).toBe('Delta DL100 from JFK to LAX at 08:00 - 11:00');
  });

  test('formats lodging summary', () => {
    const summary = formatLodgingSummary({
      id: 'l1',
      name: 'Hotel Test',
      checkInDate: '2025-04-10',
      checkOutDate: '2025-04-12',
    });
    expect(summary).toBe('Hotel Test at 2025-04-10');
  });

  test('formats tour summary', () => {
    const summary = formatTourSummary({
      id: 't1',
      name: 'City Tour',
      date: '2025-04-10',
      startTime: '10:00',
      startLocation: 'Downtown',
    });
    expect(summary).toBe('City Tour at 10:00 at Downtown');
  });

  test('builds rows for each category in order', () => {
    const rows = buildOverviewRows({
      tripStartDate: '2025-04-10',
      tripMonthLabel: null,
      itineraryDetails: [{ id: 'i1', day: 1, time: '09:00', activity: 'Breakfast' }],
      flights: [
        {
          id: 'f1',
          departure_date: '2025-04-10',
          departure_time: '07:00',
          arrival_time: '09:00',
          carrier: 'Delta',
          flight_number: 'DL100',
          departure_airport_code: 'JFK',
          arrival_airport_code: 'LAX',
          booking_reference: 'ABC',
          cost: 200,
        },
      ],
      lodgings: [
        {
          id: 'l1',
          name: 'Hotel Test',
          checkInDate: '2025-04-10',
          checkOutDate: '2025-04-12',
          rooms: '1',
          refundBy: '',
          totalCost: '200',
          costPerNight: '100',
          address: 'Main St',
        },
      ],
      tours: [
        {
          id: 't1',
          name: 'City Tour',
          date: '2025-04-10',
          startTime: '11:00',
          startLocation: 'Downtown',
          duration: '2h',
          cost: '50',
          freeCancelBy: '',
          bookedOn: '',
          reference: 'REF',
        },
      ],
      rentals: [
        {
          id: 'r1',
          pickupLocation: 'Airport',
          pickupDate: '2025-04-10',
          dropoffLocation: 'Hotel',
          dropoffDate: '2025-04-12',
          vendor: 'Hertz',
          model: 'SUV',
        },
      ],
    });
    const types = rows.map((r) => r.type);
    expect(types).toEqual(['activity', 'flight', 'lodging', 'tour', 'rental', 'rental']);
  });

  test('orders items within a category by time', () => {
    const rows = buildOverviewRows({
      tripStartDate: '2025-04-10',
      tripMonthLabel: null,
      itineraryDetails: [
        { id: 'i1', day: 1, time: '10:00', activity: 'Museum' },
        { id: 'i2', day: 1, time: '08:00', activity: 'Breakfast' },
      ],
      flights: [],
      lodgings: [],
      tours: [],
    });
    expect(rows[0].label).toBe('Breakfast');
    expect(rows[1].label).toBe('Museum');
  });

  test('uses month label when no start date', () => {
    const rows = buildOverviewRows({
      tripStartDate: null,
      tripMonthLabel: 'April 2025',
      itineraryDetails: [{ id: 'i1', day: 1, time: null, activity: 'Check-in' }],
      flights: [],
      lodgings: [],
      tours: [],
    });
    expect(rows[0].dateLabel).toBe('April 2025');
    expect(rows[0].dayLabel).toBe('Day 1');
  });
});
