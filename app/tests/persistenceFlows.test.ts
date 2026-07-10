/// <reference types="jest" />
/// <reference types="node" />
import { createFlightForTrip, removeFlightApi, type FlightCreateDraft } from '../tabs/transfers';
import { createLodgingForTrip, removeLodgingApi, saveLodgingApi, type LodgingDraft, type Lodging } from '../tabs/lodging';
import { createActivityForTrip, removeActivityApi, type TourDraft } from '../tabs/activities';
import { saveWizardCarRentals, saveWizardFlights, saveWizardLodgings } from '../utils/wizardSaves';

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
          status: 'Booked',
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
      status: 'Booked',
      name: 'Test Hotel',
      checkInDate: '2026-05-01',
      checkOutDate: '2026-05-03',
      rooms: '1',
      refundBy: '',
      totalCost: '200',
      costPerNight: '100',
      address: '123 Test',
      paidBy: ['wizard-1'],
      travelerIds: ['wizard-1'],
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

  test('create trip wizard saves car rentals with resolved member ids', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'member-api-1', email: 'traveler@example.com', status: 'active' },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'car-api-1',
          tripId: 'trip-1',
          status: 'Booked',
          pickupLocation: 'Airport',
          pickupDate: '2026-05-01',
          dropoffLocation: 'Airport',
          dropoffDate: '2026-05-05',
          vendor: 'Hertz',
          cost: 250,
          paidBy: ['member-api-1'],
          travelerIds: ['member-api-1'],
        }),
      });

    const result = await saveWizardCarRentals({
      backendUrl,
      headers,
      userToken: 'token',
      groupId: 'group-1',
      tripId: 'trip-1',
      wizardGroupMembers: [{ id: 'wizard-1', email: 'traveler@example.com', status: 'active' }],
      wizardCarRentals: [
        {
          id: 'car-1',
          tripId: '',
          status: 'Booked',
          pickupLocation: 'Airport',
          pickupDate: '2026-05-01',
          dropoffLocation: 'Airport',
          dropoffDate: '2026-05-05',
          reference: 'REF',
          vendor: 'Hertz',
          prepaid: 'Yes',
          cost: '250',
          model: 'SUV',
          notes: '',
          paidBy: ['wizard-1'],
          travelerIds: ['wizard-1'],
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const carCall = fetchMock.mock.calls[1];
    expect(carCall[0]).toBe(`${backendUrl}/api/car-rentals`);
    const carPayload = JSON.parse(carCall[1].body);
    expect(carPayload.tripId).toBe('trip-1');
    expect(carPayload.paidBy).toEqual(['member-api-1']);
    expect(carPayload.travelerIds).toEqual(['member-api-1']);
    expect(carPayload.cost).toBe(250);
    expect(result.carRentals?.[0].id).toBe('car-api-1');
  });

  test('flight tab createFlightForTrip posts a flight', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const draft: FlightCreateDraft = {
      status: 'Booked',
      transferType: 'Flight',
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
      status: 'Booked',
      name: 'Test Hotel',
      checkInDate: '2026-06-01',
      checkOutDate: '2026-06-03',
      rooms: '1',
      refundBy: '',
      totalCost: '200',
      costPerNight: '100',
      address: '123 Test',
      paidBy: [],
      travelerIds: [],
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

  test('flight delete uses DELETE /api/transfers/:id', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await removeFlightApi(backendUrl, headers, 'flight-1');
    expect(result.ok).toBe(true);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe(`${backendUrl}/api/transfers/flight-1`);
    expect(call[1].method).toBe('DELETE');
  });

  test('lodging delete uses DELETE /api/lodgings/:id', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await removeLodgingApi(backendUrl, headers, 'lodging-1');
    expect(result.ok).toBe(true);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe(`${backendUrl}/api/lodgings/lodging-1`);
    expect(call[1].method).toBe('DELETE');
  });

  test('tour tab createActivityForTrip posts a tour', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const draft: TourDraft = {
      status: 'Booked',
      activityType: 'Tour',
      name: 'Test Tour',
      date: '2026-06-01',
      startLocation: 'Test',
      startTime: '10:00',
      duration: '2h',
      cost: '50',
      freeCancelBy: '',
      bookedOn: '',
      reference: '',
      notes: 'Call ahead for accessibility.',
      paidBy: [],
      travelerIds: [],
    };

    const result = await createActivityForTrip({
      backendUrl,
      jsonHeaders: { 'Content-Type': 'application/json', ...headers },
      draft,
      activeTripId: 'trip-1',
      defaultPayerId: 'member-1',
    });

    expect(result.ok).toBe(true);
    const call = fetchMock.mock.calls[0];
    const payload = JSON.parse(call[1].body);
    expect(payload.tripId).toBe('trip-1');
    expect(payload.paidBy).toEqual(['member-1']);
    expect(payload.notes).toBe('Call ahead for accessibility.');
  });

  test('tour delete uses DELETE /api/activities/:id', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await removeActivityApi(backendUrl, headers, 'tour-1');
    expect(result.ok).toBe(true);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe(`${backendUrl}/api/activities/tour-1`);
    expect(call[1].method).toBe('DELETE');
  });
});


