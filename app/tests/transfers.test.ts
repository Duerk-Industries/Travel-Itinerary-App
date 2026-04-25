import { describe, expect, test } from '@jest/globals';
import { buildFlightPayloadForCreate, createInitialFlightCreateDraft, filterAirportOptionLabels, normalizeFlightFromApi } from '../tabs/transfers';

describe('Flights helpers', () => {
  test('requires an active trip id', () => {
    const draft = createInitialFlightCreateDraft();
    const result = buildFlightPayloadForCreate(draft, null, null);
    expect(result.error).toBe('Select an active trip before adding a transfer.');
  });

  test('requires times and at least one passenger', () => {
    const draft = {
      ...createInitialFlightCreateDraft(),
      status: 'Booked' as const,
      departureDate: '2025-04-10',
      departureTime: '',
      arrivalTime: '',
      passengerIds: [],
      paidBy: [],
    };
    const result = buildFlightPayloadForCreate(draft, 'trip-1', null);
    expect(result.error).toBe('Departure and arrival times are required.');
  });

  test('builds payload with optional carrier/flight/booking and passengers', () => {
    const draft = {
      ...createInitialFlightCreateDraft(),
      status: 'Booked' as const,
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
      paidBy: [],
    };
    const result = buildFlightPayloadForCreate(draft, 'trip-1', 'payer-1');
    expect(result.payload?.tripId).toBe('trip-1');
    expect(result.payload?.transferType).toBe('Flight');
    expect(result.payload?.passengerName).toBe('Traveler');
    expect(result.payload?.passengerIds).toEqual(['p1', 'p2']);
    expect(result.payload?.carrier).toBe('');
    expect(result.payload?.flightNumber).toBe('');
    expect(result.payload?.bookingReference).toBe('');
    expect(result.payload?.paidBy).toEqual(['payer-1']);
  });

  test('normalizes am/pm ingestion times for web flight editing and saves', () => {
    const draft = {
      ...createInitialFlightCreateDraft(),
      status: 'Booked' as const,
      passengerIds: ['p1'],
      paidBy: [],
      departureDate: '2026-09-05',
      departureTime: '10:55 AM',
      arrivalTime: '02:05 PM',
      departureAirportCode: 'BGY',
      arrivalAirportCode: 'OTP',
    };
    const result = buildFlightPayloadForCreate(draft, 'trip-1', null);
    expect(result.error).toBeUndefined();
    expect(result.payload?.departureTime).toBe('10:55');
    expect(result.payload?.arrivalTime).toBe('14:05');
  });

  test('fails when no passengers selected', () => {
    const draft = {
      ...createInitialFlightCreateDraft(),
      status: 'Booked' as const,
      departureDate: '2025-04-10',
      departureTime: '08:00',
      arrivalTime: '11:00',
      passengerIds: [],
      paidBy: [],
    };
    const result = buildFlightPayloadForCreate(draft, 'trip-1', null);
    expect(result.error).toBe('Select at least one passenger');
  });

  test('normalizes firestore flights to table fields', () => {
    const apiFlight = {
      id: 'f1',
      passengerName: 'Member',
      passengerIds: ['m1'],
      departureDate: '2026-05-15',
      arrivalDate: '2026-05-15',
      departureLocation: 'ATL',
      arrivalLocation: 'ORD',
      departureTime: '08:00',
      arrivalTime: '10:00',
      carrier: '',
      flightNumber: '',
      bookingReference: '',
      paidBy: ['m1'],
      status: 'Booked' as const,
      transferType: 'Train' as const,
    };
    const normalized = normalizeFlightFromApi(apiFlight);
    expect(normalized.passenger_ids).toEqual(['m1']);
    expect(normalized.departure_location).toBe('ATL');
    expect(normalized.arrival_location).toBe('ORD');
    expect(normalized.flight_number).toBe('');
    expect(normalized.booking_reference).toBe('');
    expect(normalized.paid_by).toEqual(['m1']);
    expect(normalized.status).toBe('Booked');
    expect(normalized.transfer_type).toBe('Train');
    expect(normalized.transferType).toBe('Train');
  });

  test('allows missing business fields when status is Needed', () => {
    const draft = {
      ...createInitialFlightCreateDraft(),
      status: 'Needed' as const,
      departureDate: '',
      departureTime: '',
      arrivalTime: '',
      passengerIds: [],
      paidBy: [],
    };
    const result = buildFlightPayloadForCreate(draft, 'trip-1', null);
    expect(result.error).toBeUndefined();
  });

  test('defaults missing legacy status to Booked', () => {
    const normalized = normalizeFlightFromApi({
      id: 'f2',
      departureDate: '2026-05-15',
      arrivalDate: '2026-05-15',
      departureTime: '08:00',
      arrivalTime: '10:00',
    });
    expect(normalized.status).toBe('Booked');
  });

  test('normalizes api flights with am/pm times into 24-hour values', () => {
    const normalized = normalizeFlightFromApi({
      id: 'f-ampm',
      departureDate: '2026-09-05',
      arrivalDate: '2026-09-05',
      departureTime: '10:55 AM',
      arrivalTime: '02:05 PM',
    });
    expect(normalized.departure_time).toBe('10:55');
    expect(normalized.arrival_time).toBe('14:05');
  });

  test('filters airport labels by query for transfer autocomplete', () => {
    const labels = [
      'Boston (BOS)',
      'Bucharest (OTP)',
      'Milan Bergamo (BGY)',
    ];
    expect(filterAirportOptionLabels(labels, 'buch')).toEqual(['Bucharest (OTP)']);
    expect(filterAirportOptionLabels(labels, 'bg')).toEqual(['Milan Bergamo (BGY)']);
  });
});

