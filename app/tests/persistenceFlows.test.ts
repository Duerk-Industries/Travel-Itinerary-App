import { createFlightForTrip, type FlightCreateDraft } from '../tabs/flights';
import { createLodgingForTrip, saveLodgingApi, type LodgingDraft, type Lodging } from '../tabs/lodging';
import { saveWizardFlights, saveWizardLodgings } from '../utils/wizardSaves';

describe('Persistence flows for flights and lodging', () => {
  const backendUrl = 'http://localhost:4000';
  const headers = { Authorization: 'Bearer token' };

  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('create trip wizard saves flights with resolved member ids', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'member-api-1', email: 'traveler@example.com', status: 'active' },
        ],
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await saveWizardFlights({
      backendUrl,
      headers,
      userToken: 'token',
      groupId: 'group-1',
      tripId: 'trip-1',
      wizardGroupMembers: [{ id: 'wizard-1', email: 'traveler@example.com', status: 'active' }],
      wizardFlights: [
        {
          id: 'flight-1',
          passenger_name: 'Traveler',
          passenger_ids: ['wizard-1'],
          trip_id: 'trip-1',
          departure_date: '2026-05-01',
          arrival_date: '2026-05-01',
          departure_time: '08:00',
          arrival_time: '10:00',
          cost: 100,
          carrier: 'AA',
          flight_number: 'AA100',
          booking_reference: 'REF',
          paidBy: ['wizard-1'],
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const flightCall = fetchMock.mock.calls[1];
    const flightPayload = JSON.parse(flightCall[1].body);
    expect(flightPayload.tripId).toBe('trip-1');
    expect(flightPayload.passengerIds).toEqual(['member-api-1']);
    expect(flightPayload.paidBy).toEqual(['member-api-1']);
  });

  test('create trip wizard saves lodging with resolved member ids', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'member-api-1', email: 'traveler@example.com', status: 'active' },
        ],
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const lodging: Lodging = {
      id: 'lodging-1',
      userId: 'user-1',
      tripId: 'trip-1',
      name: 'Test Hotel',
      checkInDate: '2026-05-01',
      checkOutDate: '2026-05-03',
      rooms: '1',
      refundBy: '',
      totalCost: '200',
      costPerNight: '100',
      address: '123 Test',
      paidBy: ['wizard-1'],
      imageUrl: '',
    };

    const result = await saveWizardLodgings({
      backendUrl,
      headers,
      userToken: 'token',
      groupId: 'group-1',
      tripId: 'trip-1',
      wizardGroupMembers: [{ id: 'wizard-1', email: 'traveler@example.com', status: 'active' }],
      wizardLodgings: [lodging],
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const lodgingCall = fetchMock.mock.calls[1];
    const lodgingPayload = JSON.parse(lodgingCall[1].body);
    expect(lodgingPayload.tripId).toBe('trip-1');
    expect(lodgingPayload.paidBy).toEqual(['member-api-1']);
    expect(lodgingPayload.name).toBe('Test Hotel');
  });

  test('flight tab createFlightForTrip posts a flight', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const draft: FlightCreateDraft = {
      passengerName: 'Traveler',
      passengerIds: ['member-1'],
      departureDate: '2026-06-01',
      arrivalDate: '2026-06-01',
      departureAirportCode: 'JFK',
      departureTime: '08:00',
      arrivalAirportCode: 'LAX',
      arrivalTime: '11:00',
      layoverLocation: '',
      layoverLocationCode: '',
      layoverDuration: '',
      cost: '150',
      carrier: 'AA',
      flightNumber: 'AA200',
      bookingReference: 'REF2',
    };

    const result = await createFlightForTrip({
      backendUrl,
      headers,
      draft,
      tripId: 'trip-1',
      defaultPayerId: 'member-1',
    });

    expect(result.ok).toBe(true);
    const flightCall = fetchMock.mock.calls[0];
    const payload = JSON.parse(flightCall[1].body);
    expect(payload.tripId).toBe('trip-1');
    expect(payload.paidBy).toEqual(['member-1']);
  });

  test('lodging tab createLodgingForTrip posts a lodging', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const draft: LodgingDraft = {
      name: 'Test Hotel',
      checkInDate: '2026-06-01',
      checkOutDate: '2026-06-03',
      rooms: '1',
      refundBy: '',
      totalCost: '200',
      costPerNight: '100',
      address: '123 Test',
      paidBy: [],
      imageUrl: '',
    };

    const result = await createLodgingForTrip({
      backendUrl,
      jsonHeaders: { ...headers },
      draft,
      activeTripId: 'trip-1',
      defaultPayerId: 'member-1',
    });

    expect(result.ok).toBe(true);
    const lodgingCall = fetchMock.mock.calls[0];
    const payload = JSON.parse(lodgingCall[1].body);
    expect(payload.tripId).toBe('trip-1');
    expect(payload.paidBy).toEqual(['member-1']);
  });

  test('overview edit uses PUT when saving lodging changes', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await saveLodgingApi(
      backendUrl,
      { 'Content-Type': 'application/json', ...headers },
      { name: 'Edit Hotel' },
      'lodging-1'
    );

    expect(result.ok).toBe(true);
    const call = fetchMock.mock.calls[0];
    expect(call[1].method).toBe('PUT');
  });
});
