/// <reference types="jest" />
/// <reference types="node" />
import axios from 'axios';
import { HeuristicTransferEstimator, getTransferEstimator, DirectionsApiTransferEstimator } from '../src/services/transferEstimationService';
import { ApiLimitExceededError } from '../src/apis/usageLimiter';

jest.mock('../src/services/entitlementService', () => ({
  isFeatureEnabled: jest.fn(),
}));
jest.mock('axios');
jest.mock('../src/apis/usageLimiter', () => {
  const actual = jest.requireActual('../src/apis/usageLimiter');
  return { ...actual, reserveApiUsageOrThrow: jest.fn(async () => undefined) };
});

const mockedEntitlement = jest.requireMock('../src/services/entitlementService') as {
  isFeatureEnabled: jest.Mock;
};
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedReserve = jest.requireMock('../src/apis/usageLimiter').reserveApiUsageOrThrow as jest.Mock;

describe('HeuristicTransferEstimator', () => {
  const estimator = new HeuristicTransferEstimator();

  it('returns null when coordinates are missing', async () => {
    const result = await estimator.estimate({
      from: { lat: NaN, lon: NaN },
      to: { lat: 40.78, lon: -73.97 },
      mobility: 'M',
    });
    expect(result).toBeNull();
  });

  it('recommends walking for a short distance', async () => {
    const result = await estimator.estimate({
      from: { lat: 40.7813, lon: -73.9737 },
      to: { lat: 40.7794, lon: -73.9632 },
      mobility: 'M',
    });
    expect(result?.mode).toBe('walk');
    expect(result?.source).toBe('heuristic');
  });

  it('recommends transit for a mid-range distance', async () => {
    const result = await estimator.estimate({
      from: { lat: 40.7813, lon: -73.9737 },
      to: { lat: 40.7484, lon: -73.9857 },
      mobility: 'M',
    });
    expect(result?.mode).toBe('transit');
  });

  it('recommends taxi for a longer distance', async () => {
    const result = await estimator.estimate({
      from: { lat: 40.7813, lon: -73.9737 },
      to: { lat: 40.6892, lon: -74.0445 },
      mobility: 'M',
    });
    expect(result?.mode).toBe('taxi');
  });

  it('recommends rideshare for a very long distance', async () => {
    const result = await estimator.estimate({
      from: { lat: 40.7813, lon: -73.9737 },
      to: { lat: 40.6413, lon: -73.7781 },
      mobility: 'M',
    });
    expect(result?.mode).toBe('rideshare');
  });

  it('adjusts the walk cutoff by mobility (same ~1.4km distance walks for High, not for Low)', async () => {
    // ~1.4km apart (same longitude, ~0.0126 deg latitude delta).
    const from = { lat: 40.7813, lon: -73.9737 };
    const to = { lat: 40.7939, lon: -73.9737 };
    const highMobility = await estimator.estimate({ from, to, mobility: 'H' });
    const lowMobility = await estimator.estimate({ from, to, mobility: 'L' });
    expect(highMobility?.mode).toBe('walk');
    expect(lowMobility?.mode).not.toBe('walk');
  });
});

describe('getTransferEstimator', () => {
  beforeEach(() => {
    mockedEntitlement.isFeatureEnabled.mockReset();
  });

  it('returns the heuristic estimator when the directions-api flag is off', async () => {
    mockedEntitlement.isFeatureEnabled.mockResolvedValue(false);
    const estimator = await getTransferEstimator();
    expect(estimator).toBeInstanceOf(HeuristicTransferEstimator);
  });

  it('returns the directions-api estimator when the flag is on', async () => {
    mockedEntitlement.isFeatureEnabled.mockResolvedValue(true);
    const estimator = await getTransferEstimator();
    expect(estimator).toBeInstanceOf(DirectionsApiTransferEstimator);
  });
});

describe('DirectionsApiTransferEstimator', () => {
  const from = { lat: 40.7813, lon: -73.9737 };
  const to = { lat: 40.7484, lon: -73.9857 }; // ~4km apart -> heuristic picks 'transit'
  const estimator = new DirectionsApiTransferEstimator();
  const originalKey = process.env.GOOGLE_ROUTES_API_KEY;

  beforeEach(() => {
    mockedAxios.post.mockReset();
    mockedReserve.mockReset();
    mockedReserve.mockResolvedValue(undefined);
    process.env.GOOGLE_ROUTES_API_KEY = 'test-key';
  });

  afterAll(() => {
    process.env.GOOGLE_ROUTES_API_KEY = originalKey;
  });

  it('returns the heuristic estimate without a network call when no API key is configured', async () => {
    delete process.env.GOOGLE_ROUTES_API_KEY;
    const result = await estimator.estimate({ from, to, mobility: 'M' });
    expect(result?.source).toBe('heuristic');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('uses the mocked Directions/Routes API response when available', async () => {
    mockedAxios.post.mockResolvedValue({
      data: [{ originIndex: 0, destinationIndex: 0, duration: '900s', distanceMeters: 4200, condition: 'ROUTE_EXISTS' }],
    } as any);
    const result = await estimator.estimate({ from, to, mobility: 'M' });
    expect(result).toEqual({ mode: 'transit', minutes: 15, distanceKm: 4.2, source: 'directions_api' });
    expect(mockedReserve).toHaveBeenCalledWith({ provider: 'GOOGLE_ROUTES', caller: 'ATTRACTION_TRANSFER_MATRIX' });
    const [, body] = mockedAxios.post.mock.calls[0];
    expect((body as any).travelMode).toBe('TRANSIT');
  });

  it('falls back to the heuristic estimate when the API call fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('network error'));
    const result = await estimator.estimate({ from, to, mobility: 'M' });
    expect(result?.source).toBe('heuristic');
  });

  it('falls back to the heuristic estimate, without calling the network, once the rate limit is reached', async () => {
    mockedReserve.mockRejectedValue(
      new ApiLimitExceededError({ provider: 'GOOGLE_ROUTES', caller: 'ATTRACTION_TRANSFER_MATRIX', scope: 'overall', limit: 200, used: 200 })
    );
    const result = await estimator.estimate({ from, to, mobility: 'M' });
    expect(result?.source).toBe('heuristic');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('returns null when coordinates are missing, without reserving usage', async () => {
    const result = await estimator.estimate({ from: { lat: NaN, lon: NaN }, to, mobility: 'M' });
    expect(result).toBeNull();
    expect(mockedReserve).not.toHaveBeenCalled();
  });
});
