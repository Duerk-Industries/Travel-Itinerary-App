import { clearClimatologyCacheForTests } from '../src/services/climatologyDaylightService';
import {
  buildDestinationLogistics,
  calculateTransferBuffer,
  compareOpenJawLogistics,
  resolveCoarseHomeRegion,
} from '../src/services/destinationLogisticsService';

jest.mock('../src/apis/usageLimiter', () => ({ reserveApiUsageOrThrow: jest.fn(async () => undefined) }));
const mockedReserve = jest.requireMock('../src/apis/usageLimiter').reserveApiUsageOrThrow as jest.Mock;

describe('Phase 1 destination logistics', () => {
  beforeEach(() => { clearClimatologyCacheForTests(); mockedReserve.mockClear(); });

  test('Paris in July can be labeled peak summer heat and long-haul from New York', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ daily: {
        time: ['2016-01-15', '2016-07-15', '2017-07-15', '2017-12-15'],
        temperature_2m_max: [5, 27, 28, 4], temperature_2m_min: [1, 17, 18, 0], precipitation_sum: [8, 2, 0, 9],
      } }),
    })) as unknown as typeof fetch;
    const result = await buildDestinationLogistics({
      destination: { lat: 48.8566, lon: 2.3522 }, home: { lat: 40.7128, lon: -74.006 },
      year: 2026, month: 7, fetchImpl,
    });
    expect(result.climatology?.label).toBe('Peak Summer Heat');
    expect(result.isLongHaul).toBe(true);
    expect(result.estimatedFlightHours).toBeGreaterThanOrEqual(7);
    expect(result.daylight.daylightHours).toBeGreaterThan(15);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mockedReserve).toHaveBeenCalledWith({ provider: 'OPEN_METEO', caller: 'ITINERARY_MONTHLY_CLIMATOLOGY' });
  });

  test('transfer buffer grows with group size and restrictive mobility', () => {
    const soloHigh = calculateTransferBuffer(5, 1, 'H');
    const groupLow = calculateTransferBuffer(5, 8, 'L');
    expect(groupLow).toBeGreaterThan(soloHigh);
    expect(groupLow).toBeLessThanOrEqual(90);
  });

  test('compares round-trip and open-jaw legs from a coarse airport anchor', () => {
    const result = compareOpenJawLogistics({
      home: { coordinates: { lat: 40.6413, lon: -73.7781 }, airportCode: 'JFK' },
      entry: { lat: 48.8566, lon: 2.3522 },
      exit: { lat: 51.4700, lon: -0.4543 },
      entryAirport: 'CDG',
      exitAirport: 'LHR',
    });
    expect(result.recommended).toBe('open_jaw');
    expect(result.distanceSavingsKm).toBeGreaterThan(250);
    expect(result.rationale).toMatch(/open-jaw/i);
  });

  test('resolves a bundled airport without accepting an exact home address', () => {
    const result = resolveCoarseHomeRegion({ airportCode: 'JFK', region: 'New York' });
    expect(result.label).toBe('JFK');
    expect(result.coordinates).toEqual(expect.objectContaining({ lat: expect.any(Number), lon: expect.any(Number) }));
    expect(resolveCoarseHomeRegion({ region: 'New York', airportCode: 'not-an-airport' }).coordinates).toBeNull();
  });
});
