import { describe, expect, test } from '@jest/globals';
import { buildFlightPayloadForCreate, createInitialFlightCreateDraft } from '../tabs/flights';

describe('Flights helpers', () => {
  test('requires an active trip id', () => {
    const draft = createInitialFlightCreateDraft();
    const result = buildFlightPayloadForCreate(draft, null, null);
    expect(result.error).toBe('Select an active trip before adding a flight.');
  });

  test('requires times, carrier, flight number, and booking reference', () => {
    const draft = {
      ...createInitialFlightCreateDraft(),
      departureDate: '2025-04-10',
      departureTime: '',
      arrivalTime: '',
      carrier: '',
      flightNumber: '',
      bookingReference: '',
    };
    const result = buildFlightPayloadForCreate(draft, 'trip-1', null);
    expect(result.error).toBe('Departure and arrival times are required.');
  });

  test('builds payload with defaults and trip id', () => {
    const draft = {
      ...createInitialFlightCreateDraft(),
      passengerName: '',
      departureDate: '2025-04-10',
      departureTime: '08:00',
      arrivalTime: '11:00',
      departureAirportCode: 'JFK',
      arrivalAirportCode: 'LAX',
      carrier: 'Delta',
      flightNumber: 'DL100',
      bookingReference: 'ABC123',
      cost: '200',
    };
    const result = buildFlightPayloadForCreate(draft, 'trip-1', 'payer-1');
    expect(result.payload?.tripId).toBe('trip-1');
    expect(result.payload?.passengerName).toBe('Traveler');
    expect(result.payload?.paidBy).toEqual(['payer-1']);
  });
});
