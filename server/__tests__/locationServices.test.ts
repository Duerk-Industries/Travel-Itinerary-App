import { clearLocationCache, searchCountryStateOptions } from '../src/services/locationServices';

describe('locationServices', () => {
  afterEach(() => {
    clearLocationCache();
  });

  it('falls back to local CSV country data when storage dataset is unavailable', async () => {
    const results = await searchCountryStateOptions('Italy', 5);

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'country',
          name: 'Italy',
        }),
      ])
    );
  });
});
