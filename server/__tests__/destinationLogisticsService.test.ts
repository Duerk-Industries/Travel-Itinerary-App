import { clearClimatologyCacheForTests } from '../src/services/climatologyDaylightService';
import {
  buildDestinationLogistics,
  calculateTransferBuffer,
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
});
