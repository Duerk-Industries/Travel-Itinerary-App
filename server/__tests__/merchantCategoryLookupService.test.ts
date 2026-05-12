import { mapMerchantCategory } from '../src/services/merchantCategoryLookupService';

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
