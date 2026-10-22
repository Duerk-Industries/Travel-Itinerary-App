import {
  GeocoderError, __resetGeocodersForTests, geocodeAddress, geocoderConfigured, getGeocoder, registerGeocoder, storedCoordinateCredit,
  type GeocoderAdapter,
} from '../src/services/geocoder';
import * as db from '../src/db';

jest.mock('../src/db');

const mockedDb = db as jest.Mocked<typeof db>;
const SECRET = 'super-secret-provider-key';

// A second provider that exists only here, to prove the layer works with any adapter.
const makeAdapter = (overrides: Partial<GeocoderAdapter> = {}): GeocoderAdapter & { geocode: jest.Mock } => ({
  id: 'fakemaps',
  displayName: 'FakeMaps',
  credit: { text: 'Locations by FakeMaps', links: [{ label: 'Powered by FakeMaps', url: 'https://fakemaps.example/' }] },
  isConfigured: () => true,
  geocode: jest.fn().mockResolvedValue({ lat: 10, lng: 20, geoCity: 'Faketown', confidence: 0.9, countryCode: 'fk' }),
  ...overrides,
}) as GeocoderAdapter & { geocode: jest.Mock };

const ENV_KEYS = ['GEOCODER_PROVIDER', 'GEOCODER_PREVIOUS_PROVIDERS', 'GEOCODER_MAX_DAILY_REQUESTS', 'GEOAPIFY_MAX_DAILY_REQUESTS', 'GEOAPIFY_API_KEY'] as const;

describe('geocoder layer (provider-neutral)', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    jest.resetAllMocks();
    for (const key of ENV_KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
    __resetGeocodersForTests();
    mockedDb.atomicIncrementApiUsageIfUnderLimit.mockResolvedValue({ allowed: true, newCount: 1 } as never);
  });
  afterEach(() => {
    for (const key of ENV_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    __resetGeocodersForTests();
    jest.useRealTimers();
  });

  describe('choosing a provider', () => {
    it('defaults to Geoapify, and is configured only when its key is set', () => {
      expect(getGeocoder()?.id).toBe('geoapify');
      expect(geocoderConfigured()).toBe(false);
      process.env.GEOAPIFY_API_KEY = 'k';
      expect(geocoderConfigured()).toBe(true);
    });

    it('switches provider with GEOCODER_PROVIDER, without touching the callers', async () => {
      const fake = makeAdapter();
      registerGeocoder(fake);
      process.env.GEOCODER_PROVIDER = 'FakeMaps';
      expect(getGeocoder()).toBe(fake);
      expect(geocoderConfigured()).toBe(true);
      expect(await geocodeAddress('1 Fake Street')).toEqual({ lat: 10, lng: 20, geoCity: 'Faketown', confidence: 0.9, countryCode: 'fk' });
      expect(fake.geocode).toHaveBeenCalledWith('1 Fake Street', expect.objectContaining({ language: 'en', signal: expect.any(AbortSignal) }));
    });

    it('treats an unknown provider id as not configured and never falls back silently', async () => {
      process.env.GEOCODER_PROVIDER = 'typo-maps';
      process.env.GEOAPIFY_API_KEY = 'k';
      expect(getGeocoder()).toBeNull();
      expect(geocoderConfigured()).toBe(false);
      await expect(geocodeAddress('x')).rejects.toMatchObject({ code: 'not-configured' });
    });

    it('does not call a provider that reports itself unconfigured', async () => {
      const fake = makeAdapter({ isConfigured: () => false });
      registerGeocoder(fake);
      process.env.GEOCODER_PROVIDER = 'fakemaps';
      await expect(geocodeAddress('x')).rejects.toMatchObject({ code: 'not-configured' });
      expect(fake.geocode).not.toHaveBeenCalled();
    });
  });

  describe('rules every provider gets', () => {
    let fake: ReturnType<typeof makeAdapter>;
    beforeEach(() => { fake = makeAdapter(); registerGeocoder(fake); process.env.GEOCODER_PROVIDER = 'fakemaps'; });

    it('rejects confident coarse hotel matches but accepts building and amenity matches', async () => {
      for (const resultType of ['city', 'street', 'postcode', 'country']) {
        fake.geocode.mockResolvedValueOnce({ lat: 10, lng: 20, geoCity: 'City', confidence: 1, countryCode: 'jp', resultType });
        expect(await geocodeAddress('Hotel address', { requirePreciseMatch: true })).toBeNull();
      }
      for (const resultType of ['building', 'amenity']) {
        fake.geocode.mockResolvedValueOnce({ lat: 10, lng: 20, geoCity: 'City', confidence: 0.95, countryCode: 'jp', resultType });
        expect(await geocodeAddress('Hotel address', { requirePreciseMatch: true })).toMatchObject({ resultType });
      }
      fake.geocode.mockResolvedValueOnce({ lat: 10, lng: 20, geoCity: 'City', confidence: 1, countryCode: 'jp', resultType: 'building', matchType: 'match_by_city_or_disrict' });
      expect(await geocodeAddress('Hotel address', { requirePreciseMatch: true })).toBeNull();
    });

    it('strict hotel country filtering rejects a high-confidence wrong-country result', async () => {
      expect(await geocodeAddress('Hotel address', { countryCode: 'jp', strictCountry: true })).toBeNull();
      expect(fake.geocode).toHaveBeenCalledWith('Hotel address', expect.objectContaining({ countryCode: 'jp' }));
      expect(fake.geocode).toHaveBeenCalledTimes(1);
    });

    it('normalizes and bounds the query before any provider call', async () => {
      await geocodeAddress('  1   Fake Street  ');
      expect(fake.geocode.mock.calls[0][0]).toBe('1 Fake Street');
      await expect(geocodeAddress('   ')).rejects.toMatchObject({ code: 'invalid-query' });
      await expect(geocodeAddress('a'.repeat(301))).rejects.toMatchObject({ code: 'invalid-query' });
      expect(fake.geocode).toHaveBeenCalledTimes(1);
    });

    it('enforces a per-provider daily cap and stops before calling out', async () => {
      mockedDb.atomicIncrementApiUsageIfUnderLimit.mockResolvedValue({ allowed: false, newCount: 501 } as never);
      await expect(geocodeAddress('x')).rejects.toMatchObject({ code: 'quota' });
      expect(fake.geocode).not.toHaveBeenCalled();
      expect(mockedDb.atomicIncrementApiUsageIfUnderLimit).toHaveBeenCalledWith(expect.objectContaining({ provider: 'GEOCODER_FAKEMAPS', caller: 'ITEM_LOCATE', limit: 500, scope: 'caller' }));
    });

    it('reads the cap from GEOCODER_MAX_DAILY_REQUESTS, still honors the old Geoapify name, and 0 turns lookups off', async () => {
      process.env.GEOAPIFY_MAX_DAILY_REQUESTS = '25';
      await geocodeAddress('x');
      expect(mockedDb.atomicIncrementApiUsageIfUnderLimit).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 25 }));
      process.env.GEOCODER_MAX_DAILY_REQUESTS = '60';
      await geocodeAddress('x');
      expect(mockedDb.atomicIncrementApiUsageIfUnderLimit).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 60 }));
      process.env.GEOCODER_MAX_DAILY_REQUESTS = '0';
      await expect(geocodeAddress('x')).rejects.toMatchObject({ code: 'quota' });
    });

    it('turns a weak match into "not found", never a pin, and passes a confident or unscored one through', async () => {
      fake.geocode.mockResolvedValueOnce({ lat: 1, lng: 2, geoCity: null, confidence: 0.3, countryCode: null });
      expect(await geocodeAddress('vague')).toBeNull();
      fake.geocode.mockResolvedValueOnce({ lat: 1, lng: 2, geoCity: null, confidence: 0.5, countryCode: null });
      expect(await geocodeAddress('ok')).toEqual(expect.objectContaining({ lat: 1, lng: 2 }));
      fake.geocode.mockResolvedValueOnce({ lat: 1, lng: 2, geoCity: null, confidence: null, countryCode: null });
      expect(await geocodeAddress('unscored')).toEqual(expect.objectContaining({ lat: 1 }));
      fake.geocode.mockResolvedValueOnce(null);
      expect(await geocodeAddress('none')).toBeNull();
    });

    it('rejects impossible coordinates from a misbehaving adapter', async () => {
      fake.geocode.mockResolvedValueOnce({ lat: 120, lng: 2, geoCity: null, confidence: 1, countryCode: null });
      await expect(geocodeAddress('x')).rejects.toMatchObject({ code: 'invalid-response' });
      fake.geocode.mockResolvedValueOnce({ lat: Number.NaN, lng: 2, geoCity: null, confidence: 1, countryCode: null });
      await expect(geocodeAddress('x')).rejects.toMatchObject({ code: 'invalid-response' });
    });

    describe('keeping a stop in the trip\'s country', () => {
      const result = (countryCode: string | null, confidence: number | null, lat = 1) => ({ lat, lng: 2, geoCity: null, confidence, countryCode });

      it('looks up once when the match is in the trip\'s country, or when no country is known', async () => {
        fake.geocode.mockResolvedValue(result('jp', 0.9));
        await geocodeAddress('a', { countryCode: 'jp' });
        await geocodeAddress('a', { countryCode: 'JP' });
        await geocodeAddress('a');
        await geocodeAddress('a', { countryCode: 'not-a-code' });
        expect(fake.geocode).toHaveBeenCalledTimes(4);
      });

      it('trusts a strong match in another country (a stop outside the trip\'s country)', async () => {
        fake.geocode.mockResolvedValueOnce(result('kr', 0.9));
        expect(await geocodeAddress('Seoul hotel', { countryCode: 'jp' })).toEqual(expect.objectContaining({ countryCode: 'kr' }));
        expect(fake.geocode).toHaveBeenCalledTimes(1);
      });

      it('repeats a doubtful out-of-country match inside the trip\'s country and keeps only a confident answer', async () => {
        fake.geocode.mockResolvedValueOnce(result('dk', 0.62, 55.7)).mockResolvedValueOnce(result('jp', 0.76, 35.7));
        expect(await geocodeAddress('Richmond Hotel Premier Asakusa International, Tokyo, Japan', { countryCode: 'jp' })).toEqual(expect.objectContaining({ lat: 35.7, countryCode: 'jp' }));
        expect(fake.geocode).toHaveBeenCalledTimes(2);
        expect(fake.geocode.mock.calls[0][1].countryCode).toBeUndefined();
        expect(fake.geocode.mock.calls[1][1].countryCode).toBe('jp');
      });

      it('gives no pin when the retry inside the country is weak or empty', async () => {
        fake.geocode.mockResolvedValueOnce(result('dk', 0.62)).mockResolvedValueOnce(result('jp', 0.2));
        expect(await geocodeAddress('x', { countryCode: 'jp' })).toBeNull();
        fake.geocode.mockResolvedValueOnce(result('dk', 0.62)).mockResolvedValueOnce(null);
        expect(await geocodeAddress('x', { countryCode: 'jp' })).toBeNull();
      });

      it('does not retry a weak match, and counts every provider request against the daily cap', async () => {
        fake.geocode.mockResolvedValueOnce(result('jp', 0.3));
        expect(await geocodeAddress('x', { countryCode: 'jp' })).toBeNull();
        expect(fake.geocode).toHaveBeenCalledTimes(1);
        mockedDb.atomicIncrementApiUsageIfUnderLimit.mockClear();
        fake.geocode.mockResolvedValueOnce(result('dk', 0.62)).mockResolvedValueOnce(result('jp', 0.9));
        await geocodeAddress('x', { countryCode: 'jp' });
        expect(mockedDb.atomicIncrementApiUsageIfUnderLimit).toHaveBeenCalledTimes(2);
      });

      it('stops with a quota error if the cap is reached before the retry', async () => {
        fake.geocode.mockResolvedValueOnce(result('dk', 0.62));
        mockedDb.atomicIncrementApiUsageIfUnderLimit
          .mockResolvedValueOnce({ allowed: true, newCount: 1 } as never)
          .mockResolvedValueOnce({ allowed: false, newCount: 501 } as never);
        await expect(geocodeAddress('x', { countryCode: 'jp' })).rejects.toMatchObject({ code: 'quota' });
        expect(fake.geocode).toHaveBeenCalledTimes(1);
      });
    });

    it('passes an adapter\'s own failure codes through unchanged', async () => {
      fake.geocode.mockRejectedValueOnce(new GeocoderError('rate-limit'));
      await expect(geocodeAddress('x')).rejects.toMatchObject({ code: 'rate-limit' });
    });

    it('reduces any other error to a code, so a leaked URL or key can never travel', async () => {
      fake.geocode.mockRejectedValueOnce(new Error(`request to https://fakemaps.example/?apiKey=${SECRET} failed`));
      const error = await geocodeAddress('x').then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(GeocoderError);
      expect(JSON.stringify(error)).not.toContain(SECRET);
      expect((error as Error).message).not.toContain(SECRET);
      expect((error as GeocoderError).code).toBe('provider');
    });

    it('enforces the timeout by aborting a provider that never answers', async () => {
      jest.useFakeTimers();
      fake.geocode.mockImplementation((_query: string, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }));
      const pending = geocodeAddress('slow').then(() => 'resolved', (error: GeocoderError) => error.code);
      await jest.advanceTimersByTimeAsync(8_100);
      expect(await pending).toBe('timeout');
    });
  });

  describe('credit for stored coordinates', () => {
    it('is the active provider\'s credit and links', () => {
      expect(storedCoordinateCredit()).toEqual({
        text: 'Locations by Geoapify · © OpenStreetMap contributors', provider: 'geoapify',
        links: [{ label: 'Powered by Geoapify', url: 'https://www.geoapify.com/' }],
      });
    });

    it('keeps an earlier provider\'s credit after switching, while its results are still stored', () => {
      registerGeocoder(makeAdapter());
      process.env.GEOCODER_PROVIDER = 'fakemaps';
      expect(storedCoordinateCredit()).toEqual(expect.objectContaining({ provider: 'fakemaps', text: 'Locations by FakeMaps', links: [{ label: 'Powered by FakeMaps', url: 'https://fakemaps.example/' }] }));
      process.env.GEOCODER_PREVIOUS_PROVIDERS = 'geoapify, unknown-one, fakemaps';
      const credit = storedCoordinateCredit()!;
      expect(credit.provider).toBe('fakemaps');
      expect(credit.text).toBe('Locations by FakeMaps · Locations by Geoapify · © OpenStreetMap contributors');
      expect(credit.links.map((link) => link.label)).toEqual(['Powered by FakeMaps', 'Powered by Geoapify']);
    });

    it('is null when the selected provider does not exist', () => {
      process.env.GEOCODER_PROVIDER = 'nope';
      expect(storedCoordinateCredit()).toBeNull();
    });
  });
});
