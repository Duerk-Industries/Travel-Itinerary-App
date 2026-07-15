/// <reference types="jest" />
/// <reference types="node" />
// Table-driven audit: every non-token-priced provider call site added in Phase 1 of
// cost-estimator-admin-panel-plan.md must call recordProviderRequestCost right alongside its
// existing reserveApiUsageOrThrow call. This is the same kind of "is every API actually wired in"
// gap found (and fixed) for CountryNow/GeoNames earlier in this effort — don't let it regress.
import axios from 'axios';
import { fetchWikipediaSummary } from '../src/services/attractionDurationEstimationService';
import { getAttractionShortlistForDestinations } from '../src/services/attractionsCatalogService';
import { fetchMillionPlusCitySeeds } from '../src/services/destinationLargeCityCoverage';
import { DirectionsApiTransferEstimator } from '../src/services/transferEstimationService';
import { fetchWikipediaEnrichment, clearWikipediaEnrichmentCacheForTests } from '../src/services/wikipediaGeocodingService';
import { fetchWikipediaPopularityScore, clearWikipediaPageviewCacheForTests } from '../src/services/wikipediaPageviewService';
import { fetchMonthlyClimatology, clearClimatologyCacheForTests } from '../src/services/climatologyDaylightService';
import { fetchAirportDataset } from '../src/apis/airportDatasetApi';
import { fetchFrankfurterExchangeRate, clearFrankfurterRateCache } from '../src/apis/frankfurterApi';
import { fetchOverviewWeather } from '../src/apis/openMeteoWeatherApi';
import { searchUnsplashPhotos, getUnsplashRandomPhoto } from '../src/apis/unsplashApi';
import { sendSmtpMail } from '../src/apis/smtpApi';

jest.mock('axios');
jest.mock('../src/apis/usageLimiter', () => ({
  ...jest.requireActual('../src/apis/usageLimiter'),
  reserveApiUsageOrThrow: jest.fn(async () => undefined),
}));
jest.mock('../src/apis/providerBudgeting', () => ({
  ...jest.requireActual('../src/apis/providerBudgeting'),
  recordProviderRequestCost: jest.fn(async () => undefined),
}));
jest.mock('../src/db', () => ({
  listAttractionCatalogEntries: jest.fn(async () => []),
  upsertAttractionCatalogEntry: jest.fn(async () => null),
  getAttractionShortlistBlob: jest.fn(async () => null),
  upsertAttractionShortlistBlob: jest.fn(async () => undefined),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedRecordCost = jest.requireMock('../src/apis/providerBudgeting').recordProviderRequestCost as jest.Mock;

const jsonResponse = (body: unknown, ok = true): Response =>
  ({ ok, status: ok ? 200 : 500, json: async () => body }) as unknown as Response;

describe('non-token API request-cost wiring (Phase 1 audit)', () => {
  const originalFetch = global.fetch;
  const originalSerpKey = process.env.SERPAPI_API_KEY;
  const originalRoutesKey = process.env.GOOGLE_ROUTES_API_KEY;

  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedAxios.post.mockReset();
    mockedRecordCost.mockClear();
    global.fetch = jest.fn() as unknown as typeof fetch;
    process.env.SERPAPI_API_KEY = 'test-serp-key';
    process.env.GOOGLE_ROUTES_API_KEY = 'test-routes-key';
    clearWikipediaEnrichmentCacheForTests();
    clearWikipediaPageviewCacheForTests();
    clearClimatologyCacheForTests();
    clearFrankfurterRateCache();
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (originalSerpKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = originalSerpKey;
    if (originalRoutesKey === undefined) delete process.env.GOOGLE_ROUTES_API_KEY;
    else process.env.GOOGLE_ROUTES_API_KEY = originalRoutesKey;
  });

  it('SerpAPI + Wikipedia discovery (attractionsCatalogService.ts, 3 sites)', async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('serpapi.com')) {
        return { data: { organic_results: [{ title: 'Museo X', link: 'https://example.com/x' }], local_results: { places: [] } } };
      }
      return { data: { query: { search: [{ title: 'Museo X', snippet: 'A museum' }] } } };
    });

    await getAttractionShortlistForDestinations({ userId: 'u1', destinations: ['Testville'] });

    expect(mockedRecordCost).toHaveBeenCalledWith({ provider: 'SERPAPI' });
    expect(mockedRecordCost).toHaveBeenCalledWith({ provider: 'WIKIMEDIA' });
  });

  it('Wikipedia discovery falls back and still records cost on the fallback branch', async () => {
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('serpapi.com')) return { data: { organic_results: [], local_results: { places: [] } } };
      if (url.includes('/w/api.php')) throw new Error('primary search failed');
      return { data: { pages: [{ title: 'Museo X', key: 'Museo_X' }] } };
    });

    await getAttractionShortlistForDestinations({ userId: 'u1', destinations: ['Fallbackville'] });

    // Both the primary and the catch-block fallback WIKIMEDIA call must record cost.
    const wikimediaCalls = mockedRecordCost.mock.calls.filter(([arg]) => arg.provider === 'WIKIMEDIA');
    expect(wikimediaCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('Wikipedia attraction summary (attractionDurationEstimationService.ts)', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: { extract: 'A great museum.' } });

    await fetchWikipediaSummary('Museo X');

    expect(mockedRecordCost).toHaveBeenCalledWith({ provider: 'WIKIMEDIA' });
  });

  it('Wikipedia geocoding enrichment (wikipediaGeocodingService.ts)', async () => {
    mockedAxios.get.mockResolvedValue({ data: { query: { pages: { '1': { pageid: 1, title: 'Museo X' } } } } });

    await fetchWikipediaEnrichment('Museo X', 'Testville');

    expect(mockedRecordCost).toHaveBeenCalledWith({ provider: 'WIKIMEDIA' });
  });

  it('Wikipedia pageview popularity (wikipediaPageviewService.ts)', async () => {
    mockedAxios.get.mockResolvedValue({ data: { items: [{ views: 100 }] } });

    await fetchWikipediaPopularityScore('Museo X');

    expect(mockedRecordCost).toHaveBeenCalledWith({ provider: 'WIKIMEDIA' });
  });

  it('Google Routes transfer matrix (transferEstimationService.ts)', async () => {
    mockedAxios.post.mockResolvedValue({
      data: [{ originIndex: 0, destinationIndex: 0, duration: '300s', distanceMeters: 1000, condition: 'ROUTE_EXISTS' }],
    });
    const estimator = new DirectionsApiTransferEstimator();

    await estimator.estimate({ from: { lat: 40.78, lon: -73.97 }, to: { lat: 40.75, lon: -73.98 }, mobility: 'M' });

    expect(mockedRecordCost).toHaveBeenCalledWith({ provider: 'GOOGLE_ROUTES' });
  });

  it('Unsplash search + random photo (unsplashApi.ts, 2 sites)', async () => {
    mockedAxios.get.mockResolvedValue({ data: {} });

    await searchUnsplashPhotos({ caller: 'IMAGE_SERVICE_LOCATION_IMAGE', accessKey: 'key', query: 'Paris' });
    await getUnsplashRandomPhoto({ caller: 'IMAGE_SERVICE_ITINERARY_IMAGE', accessKey: 'key' });

    expect(mockedRecordCost).toHaveBeenCalledWith({ provider: 'UNSPLASH' });
    expect(mockedRecordCost.mock.calls.filter(([arg]) => arg.provider === 'UNSPLASH').length).toBe(2);
  });

  it('SMTP send (smtpApi.ts)', async () => {
    const transporter = { sendMail: jest.fn(async () => undefined) } as any;

    await sendSmtpMail({ caller: 'SHARE_EMAIL', transporter, message: { to: 'a@b.com', subject: 's', text: 't' } });

    expect(mockedRecordCost).toHaveBeenCalledWith({ provider: 'SMTP' });
  });

  it('CountryNow + GeoNames large-city coverage (destinationLargeCityCoverage.ts, 2 sites)', async () => {
    mockedAxios.post.mockResolvedValue({ data: { data: [] } });
    mockedAxios.get.mockResolvedValue({ data: { records: [] } });

    await fetchMillionPlusCitySeeds(
      { name: 'Testlandia', officialName: 'Republic of Testlandia', iso2: 'TL', iso3: 'TLD', capital: ['Test City'], areaKm2: 1, population: 1 },
      ['Testlandia']
    );

    expect(mockedRecordCost).toHaveBeenCalledWith({ provider: 'COUNTRY_NOW' });
    expect(mockedRecordCost).toHaveBeenCalledWith({ provider: 'GEONAMES' });
  });

  it('Airport dataset fetch (airportDatasetApi.ts)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse([]));

    await fetchAirportDataset({ caller: 'DAILY_REFRESH', url: 'https://example.com/airports.json' });

    expect(mockedRecordCost).toHaveBeenCalledWith({ provider: 'AIRPORT_DATASET' });
  });

  it('Frankfurter exchange rate (frankfurterApi.ts)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ rates: { EUR: 0.9 } }));

    await fetchFrankfurterExchangeRate({ caller: 'INGESTION_ASSIGNMENT_FX', fromCurrency: 'USD', toCurrency: 'EUR', date: '2026-01-01' });

    expect(mockedRecordCost).toHaveBeenCalledWith({ provider: 'FRANKFURTER' });
  });

  it('Open-Meteo geocode + forecast (openMeteoWeatherApi.ts, 2 sites)', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (String(url).includes('geocoding-api')) {
        return jsonResponse({ results: [{ latitude: 40.7, longitude: -74.0, name: 'Testville' }] });
      }
      return jsonResponse({ daily: { time: ['2026-01-01'], weather_code: [1], temperature_2m_max: [20] } });
    });

    await fetchOverviewWeather([{ date: '2026-01-01', location: 'Testville' }]);

    expect(mockedRecordCost.mock.calls.filter(([arg]) => arg.provider === 'OPEN_METEO').length).toBe(2);
  });

  it('Open-Meteo monthly climatology (climatologyDaylightService.ts)', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ daily: { time: ['2026-07-01'], temperature_2m_max: [30], temperature_2m_min: [20], precipitation_sum: [0] } })
    );

    await fetchMonthlyClimatology({ lat: 40.7, lon: -74.0, month: 7, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(mockedRecordCost).toHaveBeenCalledWith({ provider: 'OPEN_METEO' });
  });
});
