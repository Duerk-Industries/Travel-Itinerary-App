import { describe, expect, test } from '@jest/globals';
import { buildFlightPayloadForCreate, createInitialFlightCreateDraft } from '../tabs/flights';

describe('Flights helpers', () => {
  test('requires an active trip id', () => {
    const draft = createInitialFlightCreateDraft();
    const result = buildFlightPayloadForCreate(draft, null, null);
    expect(result.error).toBe('Select an active trip before adding a flight.');
  });

  test('requires times and at least one passenger', () => {
    const draft = {
      ...createInitialFlightCreateDraft(),
      departureDate: '2025-04-10',
      departureTime: '',
      arrivalTime: '',
      passengerIds: [],
    };
    const result = buildFlightPayloadForCreate(draft, 'trip-1', null);
    expect(result.error).toBe('Departure and arrival times are required.');
  });

  test('builds payload with optional carrier/flight/booking and passengers', () => {
    const draft = {
      ...createInitialFlightCreateDraft(),
      passengerName: '',
      passengerIds: ['p1', 'p2'],
      departureDate: '2025-04-10',
      departureTime: '08:00',
      arrivalTime: '11:00',
      departureAirportCode: 'JFK',
      arrivalAirportCode: 'LAX',
      carrier: '',
      flightNumber: '',
      bookingReference: '',
      cost: '200',
    };
    const result = buildFlightPayloadForCreate(draft, 'trip-1', 'payer-1');
    expect(result.payload?.tripId).toBe('trip-1');
    expect(result.payload?.passengerName).toBe('Traveler');
    expect(result.payload?.passengerIds).toEqual(['p1', 'p2']);
    expect(result.payload?.carrier).toBe('');
    expect(result.payload?.flightNumber).toBe('');
    expect(result.payload?.bookingReference).toBe('');
    expect(result.payload?.paidBy).toEqual(['payer-1']);
  });

  test('fails when no passengers selected', () => {
    const draft = {
      ...createInitialFlightCreateDraft(),
      departureDate: '2025-04-10',
      departureTime: '08:00',
      arrivalTime: '11:00',
      passengerIds: [],
    };
    const result = buildFlightPayloadForCreate(draft, 'trip-1', null);
    expect(result.error).toBe('Select at least one passenger');
  });
});
