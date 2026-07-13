/// <reference types="jest" />
import { HeuristicTransferEstimator } from '../src/services/transferEstimationService';

describe('HeuristicTransferEstimator with group size', () => {
  const estimator = new HeuristicTransferEstimator();
  const from = { lat: 42.3601, lon: -71.0589 }; // Boston
  const to = { lat: 42.3555, lon: -71.0656 };   // Boston Common (~600m)

  it('scales walk time by group size', async () => {
    const size2 = await estimator.estimate({ from, to, mobility: 'M', groupSize: 2 });
    const size8 = await estimator.estimate({ from, to, mobility: 'M', groupSize: 8 });

    expect(size2).toBeDefined();
    expect(size8).toBeDefined();
    if (size2 && size8) {
      expect(size8.minutes).toBeGreaterThan(size2.minutes);
      // Two travelers are the baseline; six additional travelers add 30%.
      expect(size8.minutes / size2.minutes).toBeCloseTo(1.3, 1);
    }
  });

  it('scales transit time by group size', async () => {
    const farTo = { lat: 42.4, lon: -71.1 }; // ~5km
    const size2 = await estimator.estimate({ from, to: farTo, mobility: 'M', groupSize: 2 });
    const size8 = await estimator.estimate({ from, to: farTo, mobility: 'M', groupSize: 8 });

    if (size2 && size8) {
      expect(size8.minutes).toBeGreaterThan(size2.minutes);
    }
  });
});
