import { describe, expect, test } from '@jest/globals';
import {
  buildOverviewRows,
  formatFlightSummary,
  formatLodgingSummary,
  formatTourSummary,
} from '../utils/overviewBuilder';
import {
  buildFlightDraftFromRow,
  buildRentalDraftFromRow,
  buildTourDraftFromRow,
} from '../utils/overviewEditing';

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

  test('builds editing drafts from rows', () => {
    const flight = {
      id: 'f2',
      passenger_name: 'Claire',
      departure_date: '2026-05-01',
      departure_airport_code: 'SFO',
      departure_time: '09:00',
      arrival_airport_code: 'SEA',
      arrival_time: '11:00',
      layover_location: 'PDX',
      layover_location_code: 'PDX',
      layover_duration: '1h',
      cost: 120,
      carrier: 'Alaska',
      flight_number: 'AS200',
      booking_reference: 'REF200',
    };
    const flightDraft = buildFlightDraftFromRow(flight as any);
    expect(flightDraft.carrier).toBe('Alaska');
    expect(flightDraft.cost).toBe('120');
    const tour = {
      id: 'tour-1',
      date: '2026-05-02',
      name: 'Harbor Cruise',
      startLocation: 'Pier 55',
      startTime: '14:00',
      duration: '2h',
      cost: '80',
      freeCancelBy: '2026-04-30',
      bookedOn: '2026-04-15',
      reference: 'HC-01',
      paidBy: ['payer-1'],
    };
    const tourDraft = buildTourDraftFromRow(tour as any);
    expect(tourDraft.reference).toBe('HC-01');
    const rental = {
      id: 'car-1',
      pickupLocation: 'Airport',
      pickupDate: '2026-05-02',
      dropoffLocation: 'Hotel',
      dropoffDate: '2026-05-04',
      reference: 'CR-01',
      vendor: 'Hertz',
      prepaid: 'Yes',
      cost: '200',
      model: 'Sedan',
      notes: 'WiFi included',
      paidBy: ['payer-1'],
    };
    const rentalDraft = buildRentalDraftFromRow(rental as any);
    expect(rentalDraft.vendor).toBe('Hertz');
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
    expect(types).toEqual(['activity', 'flight', 'lodging', 'tour', 'rental', 'activity', 'rental']);
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
