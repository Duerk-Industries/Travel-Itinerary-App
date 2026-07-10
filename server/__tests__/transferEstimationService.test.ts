/// <reference types="jest" />
/// <reference types="node" />
import { HeuristicTransferEstimator, getTransferEstimator, DirectionsApiTransferEstimator } from '../src/services/transferEstimationService';

jest.mock('../src/services/entitlementService', () => ({
  isFeatureEnabled: jest.fn(),
}));

const mockedEntitlement = jest.requireMock('../src/services/entitlementService') as {
  isFeatureEnabled: jest.Mock;
};

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

  it('returns the (inert) directions-api estimator when the flag is on, and its estimate() rejects safely', async () => {
    mockedEntitlement.isFeatureEnabled.mockResolvedValue(true);
    const estimator = await getTransferEstimator();
    expect(estimator).toBeInstanceOf(DirectionsApiTransferEstimator);
    // The stub is unimplemented; callers (attachAttractionMetadata) must catch this per-call
    // so a prematurely-flipped flag can't crash generation.
    await expect(estimator.estimate({} as any)).rejects.toThrow();
  });
});
