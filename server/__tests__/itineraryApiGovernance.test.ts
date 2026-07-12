import path from 'node:path';
import { calculateCostRow, loadCostModelConfig } from '../src/costModel';
import { getApiLimitProviderConfig } from '../src/config/apiLimits';

describe('itinerary external API governance', () => {
  test('registers every attraction and climatology caller in the limiter config', () => {
    expect(getApiLimitProviderConfig('WIKIMEDIA')?.callers).toMatchObject({
      ATTRACTION_DISCOVERY_WIKIPEDIA: expect.any(Number),
      ATTRACTION_WIKIPEDIA_ENRICHMENT: expect.any(Number),
      ATTRACTION_WIKIPEDIA_SUMMARY: expect.any(Number),
      ATTRACTION_WIKIMEDIA_PAGEVIEWS: expect.any(Number),
    });
    expect(getApiLimitProviderConfig('SERPAPI')?.callers.ATTRACTION_DISCOVERY_SEARCH).toBeGreaterThan(0);
    expect(getApiLimitProviderConfig('OPEN_METEO')?.callers.ITINERARY_MONTHLY_CLIMATOLOGY).toBeGreaterThan(0);
  });

  test('includes SerpAPI, Wikimedia, and climatology usage in the production cost model', () => {
    const config = loadCostModelConfig(path.resolve(__dirname, '../config/cost-model.yaml'));
    const row = calculateCostRow(config, 10000);
    expect(row.sourceCostsUsd).toHaveProperty('serp_api');
    expect(row.sourceCostsUsd.serp_api).toBeGreaterThan(0);
    expect(row.sourceCostsUsd).toHaveProperty('wikimedia', 0);
    expect(config.usagePerUser.Basic.openMeteo).toHaveProperty('climatology_requests');
    expect(config.usagePerUser.Premium.openMeteo).toHaveProperty('climatology_requests');
  });
});
