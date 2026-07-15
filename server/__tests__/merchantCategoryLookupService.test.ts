/// <reference types="jest" />
/// <reference types="node" />
import { mapMerchantCategory, lookupMerchantCategory, clearMerchantCategoryCacheForTests } from '../src/services/merchantCategoryLookupService';
import { getFeatureFlag } from '../src/db';
import { reserveApiUsageOrThrow } from '../src/apis/usageLimiter';
import { recordProviderRequestCost } from '../src/apis/providerBudgeting';

jest.mock('../src/db', () => ({
  getFeatureFlag: jest.fn(),
}));

jest.mock('../src/apis/usageLimiter', () => ({
  reserveApiUsageOrThrow: jest.fn(async () => undefined),
}));

jest.mock('../src/apis/providerBudgeting', () => ({
  recordProviderRequestCost: jest.fn(async () => undefined),
}));

describe('merchant category lookup mapping', () => {
  it('maps common provider categories to daily expense categories', () => {
    expect(mapMerchantCategory('amenity', 'cafe', 'Blue Bottle')?.category).toBe('Breakfast');
    expect(mapMerchantCategory('amenity', 'restaurant', 'Bistro')?.category).toBe('Other Food');
    expect(mapMerchantCategory('shop', 'gift', 'Museum Store')?.category).toBe('Souvenirs');
    expect(mapMerchantCategory('amenity', 'taxi', 'Airport Taxi')?.category).toBe('Rides');
  });

  it('returns null when provider data cannot be mapped', () => {
    expect(mapMerchantCategory('office', 'company', 'Acme')).toBeNull();
  });
});

describe('merchant category lookup service', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    clearMerchantCategoryCacheForTests();
    originalFetch = global.fetch;
    (getFeatureFlag as jest.Mock).mockResolvedValue({ enabled: true });
    process.env.MERCHANT_CATEGORY_LOOKUP_TIMEOUT_MS = '1500';
    process.env.MERCHANT_CATEGORY_LOOKUP_QUEUE_MAX = '20';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.MERCHANT_CATEGORY_LOOKUP_TIMEOUT_MS;
    delete process.env.MERCHANT_CATEGORY_LOOKUP_QUEUE_MAX;
  });

  it('returns null when provider is disabled', async () => {
    (getFeatureFlag as jest.Mock).mockResolvedValue({ enabled: false });
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const result = await lookupMerchantCategory({ vendor: 'Starbucks' });
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate limiter prevents more than one provider call per second', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ category: 'amenity', type: 'cafe' }]
    });
    global.fetch = fetchMock;

    const start = Date.now();
    
    const [res1, res2] = await Promise.all([
      lookupMerchantCategory({ vendor: 'Starbucks1' }),
      lookupMerchantCategory({ vendor: 'Starbucks2' })
    ]);
    
    const duration = Date.now() - start;
    
    expect(res1?.category).toBe('Breakfast');
    expect(res2?.category).toBe('Breakfast');
    
    // The second call should wait roughly 1000ms
    expect(duration).toBeGreaterThanOrEqual(950);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reserveApiUsageOrThrow).toHaveBeenCalledTimes(2);
    expect(reserveApiUsageOrThrow).toHaveBeenCalledWith({ provider: 'NOMINATIM', caller: 'MERCHANT_CATEGORY_LOOKUP' });
    expect(recordProviderRequestCost).toHaveBeenCalledTimes(2);
  });

  it('timeout returns null', async () => {
    process.env.MERCHANT_CATEGORY_LOOKUP_TIMEOUT_MS = '50';
    const fetchMock = jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
    global.fetch = fetchMock;

    const result = await lookupMerchantCategory({ vendor: 'Slow Coffee' });
    
    expect(result).toBeNull();
  });

  it('429 returns null and writes short error cache', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 429
    });
    global.fetch = fetchMock;

    const result1 = await lookupMerchantCategory({ vendor: 'Too Many Requests' });
    expect(result1).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Should hit the short cache
    const result2 = await lookupMerchantCategory({ vendor: 'Too Many Requests' });
    expect(result2).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
