import {
  addGeneratedItemsToTrip,
  getGeneratedItineraryDetails,
  type ItineraryGenerationResponse,
} from '../utils/itineraryGeneration';

describe('itineraryGeneration utils', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('prefers structured details from itinerary response', () => {
    const response: ItineraryGenerationResponse = {
      plan: 'Day 1\n- Ignore markdown parser fallback',
      details: [
        { day: 1, activity: 'Museum block', cost: null },
        { day: 2, activity: 'Street food walk', cost: null },
      ],
    };

    const details = getGeneratedItineraryDetails(response);
    expect(details).toEqual([
      { day: 1, activity: 'Museum block', cost: null },
      { day: 2, activity: 'Street food walk', cost: null },
    ]);
  });

  test('falls back to markdown parsing when structured details are missing', () => {
    const response: ItineraryGenerationResponse = {
      plan: 'Day 1\n- River walk\nDay 2\n- Market visit',
    };

    const details = getGeneratedItineraryDetails(response);
    expect(details).toEqual([
      { day: 1, activity: 'River walk', cost: null },
      { day: 2, activity: 'Market visit', cost: null },
    ]);
  });

  test('adds generated transfers, lodgings, activities, and car rentals with Needed status', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ preferredAirport: '' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await addGeneratedItemsToTrip({
      backendUrl: 'http://localhost:4000',
      headers: { Authorization: 'Bearer token' },
      tripId: 'trip-1',
      generatedItems: {
        transfers: [{ transferType: 'Train', departureDate: '2026-07-01', departureLocation: 'A', arrivalLocation: 'B' }],
        lodgings: [{ name: 'Suggested base', checkInDate: '2026-07-01', checkOutDate: '2026-07-03' }],
        activities: [{ activityType: 'Tour', date: '2026-07-02', name: 'Guided old town walk' }],
        carRentals: [{ pickupLocation: 'A Station', pickupDate: '2026-07-01', dropoffLocation: 'B Station', dropoffDate: '2026-07-03' }],
      },
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const transferCall = fetchMock.mock.calls.find((call) => call[0] === 'http://localhost:4000/api/transfers');
    expect(transferCall).toBeTruthy();
    const transferPayload = JSON.parse(String(transferCall?.[1]?.body ?? '{}'));
    expect(transferPayload.status).toBe('Needed');
    expect(transferPayload.tripId).toBe('trip-1');
    expect(transferPayload.transferType).toBe('Train');

    const lodgingCall = fetchMock.mock.calls.find((call) => call[0] === 'http://localhost:4000/api/lodgings');
    expect(lodgingCall).toBeTruthy();
    const lodgingPayload = JSON.parse(String(lodgingCall?.[1]?.body ?? '{}'));
    expect(lodgingPayload.status).toBe('Needed');
    expect(lodgingPayload.tripId).toBe('trip-1');

    const activityCall = fetchMock.mock.calls.find((call) => call[0] === 'http://localhost:4000/api/activities');
    expect(activityCall).toBeTruthy();
    const activityPayload = JSON.parse(String(activityCall?.[1]?.body ?? '{}'));
    expect(activityPayload.status).toBe('Proposed');
    expect(activityPayload.tripId).toBe('trip-1');

    const carCall = fetchMock.mock.calls.find((call) => call[0] === 'http://localhost:4000/api/car-rentals');
    expect(carCall).toBeTruthy();
    const carPayload = JSON.parse(String(carCall?.[1]?.body ?? '{}'));
    expect(carPayload.status).toBe('Needed');
    expect(carPayload.tripId).toBe('trip-1');
  });

  test('adds grouped first and last needed flights by preferred airport with creator fallback', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'm-owner', preferredAirport: 'Austin, TX (AUS)', isGroupOwner: true, status: 'active' },
          { id: 'm-lax', preferredAirport: 'LAX', isGroupOwner: false, status: 'active' },
          { id: 'm-aus-2', preferredAirport: 'AUS', isGroupOwner: false, status: 'active' },
          { id: 'm-no-pref-1', preferredAirport: '', isGroupOwner: false, status: 'active' },
          { id: 'm-no-pref-2', preferredAirport: null, isGroupOwner: false, status: 'active' },
        ],
      })
      .mockResolvedValue({ ok: true, json: async () => ({}) });

    const result = await addGeneratedItemsToTrip({
      backendUrl: 'http://localhost:4000',
      headers: { Authorization: 'Bearer token' },
      tripId: 'trip-1',
      generatedItems: {
        lodgings: [
          { name: 'Paris Base', address: 'Paris', checkInDate: '2026-07-01', checkOutDate: '2026-07-03' },
          { name: 'Rome Base', address: 'Rome', checkInDate: '2026-07-03', checkOutDate: '2026-07-06' },
        ],
      },
    });

    expect(result.ok).toBe(true);
    const transferPosts = fetchMock.mock.calls
      .filter((call) => call[0] === 'http://localhost:4000/api/transfers')
      .map((call) => JSON.parse(String(call[1]?.body ?? '{}')));
    expect(transferPosts).toHaveLength(4);

    const firstAUS = transferPosts.find((p) => p.departureLocation === 'AUS' && p.arrivalLocation === 'Paris');
    expect(firstAUS?.passengerIds).toEqual(['m-owner', 'm-aus-2', 'm-no-pref-1', 'm-no-pref-2']);
    const firstLAX = transferPosts.find((p) => p.departureLocation === 'LAX' && p.arrivalLocation === 'Paris');
    expect(firstLAX?.passengerIds).toEqual(['m-lax']);

    const lastAUS = transferPosts.find((p) => p.departureLocation === 'Rome' && p.arrivalLocation === 'AUS');
    expect(lastAUS?.passengerIds).toEqual(['m-owner', 'm-aus-2', 'm-no-pref-1', 'm-no-pref-2']);
    const lastLAX = transferPosts.find((p) => p.departureLocation === 'Rome' && p.arrivalLocation === 'LAX');
    expect(lastLAX?.passengerIds).toEqual(['m-lax']);
  });

  test('does not add terminal preferred-airport transfers when no preferred airport is available', async () => {
    const fetchMock = (global as any).fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 'm-1', preferredAirport: '', isGroupOwner: true, status: 'active' },
          { id: 'm-2', preferredAirport: null, isGroupOwner: false, status: 'active' },
        ],
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ preferredAirport: '' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const result = await addGeneratedItemsToTrip({
      backendUrl: 'http://localhost:4000',
      headers: { Authorization: 'Bearer token' },
      tripId: 'trip-1',
      generatedItems: {
        transfers: [{ transferType: 'Train', departureDate: '2026-07-01', departureLocation: 'A', arrivalLocation: 'B' }],
      },
    });

    expect(result.ok).toBe(true);
    const transferPosts = fetchMock.mock.calls
      .filter((call) => call[0] === 'http://localhost:4000/api/transfers')
      .map((call) => JSON.parse(String(call[1]?.body ?? '{}')));
    expect(transferPosts).toHaveLength(1);
    expect(transferPosts[0].departureLocation).toBe('A');
    expect(transferPosts[0].arrivalLocation).toBe('B');
  });
});
