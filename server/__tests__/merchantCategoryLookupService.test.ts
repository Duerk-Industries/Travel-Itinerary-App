/// <reference types="jest" />
/// <reference types="node" />
import { mapMerchantCategory, lookupMerchantCategory, clearMerchantCategoryCacheForTests } from '../src/services/merchantCategoryLookupService';
import { getFeatureFlag } from '../src/db';
import { reserveApiUsageOrThrow } from '../src/apis/usageLimiter';
import { recordProviderRequestCost } from '../src/apis/providerBudgeting';

jest.mock('../src/db', () => ({
  getFeatureFlag: jest.fn(),
  listAttractionCatalogEntries: jest.fn(),
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

jest.mock('../src/services/geocodingService', () => ({ resolveCatalogCoordinates: jest.fn() }));
import { resolveCatalogCoordinates } from '../src/services/geocodingService';
import { listAttractionCatalogEntries } from '../src/db';

describe('merchant category lookup public input policy', () => {
  beforeEach(() => { jest.clearAllMocks(); (getFeatureFlag as jest.Mock).mockResolvedValue({ enabled: true }); });
  it('does not submit arbitrary merchant names or private destinations', async () => {
    (listAttractionCatalogEntries as jest.Mock).mockResolvedValue([]);
    expect(await lookupMerchantCategory({ vendor: 'Home address' })).toBeNull();
    expect(await lookupMerchantCategory({ vendor: 'Private host', destination: 'Paris' })).toBeNull();
    expect(resolveCatalogCoordinates).not.toHaveBeenCalled();
  });
  it('uses only the exact catalog record and the shared durable provider cache', async () => {
    const entry = { id: 'public-cafe', name: 'Museum Cafe' };
    (listAttractionCatalogEntries as jest.Mock).mockResolvedValue([entry]);
    (resolveCatalogCoordinates as jest.Mock).mockResolvedValue({ providerCategory: 'amenity', providerType: 'cafe' });
    expect((await lookupMerchantCategory({ vendor: 'Museum Cafe', destination: 'Paris' }))?.category).toBe('Breakfast');
    expect(resolveCatalogCoordinates).toHaveBeenCalledWith(entry);
  });
  it('keeps lookup optional when the flag or provider is unavailable', async () => {
    (getFeatureFlag as jest.Mock).mockResolvedValue({ enabled: false });
    expect(await lookupMerchantCategory({ vendor: 'Museum Cafe', destination: 'Paris' })).toBeNull();
    expect(resolveCatalogCoordinates).not.toHaveBeenCalled();
  });
});
