import {
  GetYourGuideApiError,
  normalizeGetYourGuideSearchResponse,
  resetGetYourGuideApiCircuitForTests,
  searchGetYourGuideActivities,
} from '../src/apis/getYourGuideApi';
import { reserveApiUsageOrThrow } from '../src/apis/usageLimiter';
import { recordProviderRequestCost } from '../src/apis/providerBudgeting';
import {
  GETYOURGUIDE_API_BASE_URL_ENV,
  GETYOURGUIDE_API_CACHE_PERMISSION_ENV,
  GETYOURGUIDE_API_TOKEN_ENV,
  GETYOURGUIDE_FEATURE_FLAG,
  GETYOURGUIDE_PARTNER_ID_ENV,
} from '../src/config/getYourGuide';

jest.mock('../src/db', () => ({ getFeatureFlag: jest.fn() }));
jest.mock('../src/apis/usageLimiter', () => ({ reserveApiUsageOrThrow: jest.fn(async () => undefined) }));
jest.mock('../src/apis/providerBudgeting', () => ({ recordProviderRequestCost: jest.fn(async () => undefined) }));

const db = jest.requireMock('../src/db') as { getFeatureFlag: jest.Mock };
const mockedReserve = reserveApiUsageOrThrow as jest.MockedFunction<typeof reserveApiUsageOrThrow>;
const mockedCost = recordProviderRequestCost as jest.MockedFunction<typeof recordProviderRequestCost>;

const originalFetch = global.fetch;
const originalPartner = process.env[GETYOURGUIDE_PARTNER_ID_ENV];
const originalToken = process.env[GETYOURGUIDE_API_TOKEN_ENV];
const originalBase = process.env[GETYOURGUIDE_API_BASE_URL_ENV];
const originalPermission = process.env[GETYOURGUIDE_API_CACHE_PERMISSION_ENV];

const response = (status: number, body: unknown, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers });

describe('GetYourGuide Partner API', () => {
  beforeEach(() => {
    process.env[GETYOURGUIDE_PARTNER_ID_ENV] = 'test-partner';
    process.env[GETYOURGUIDE_API_TOKEN_ENV] = 'secret-token';
    process.env[GETYOURGUIDE_API_BASE_URL_ENV] = 'https://partner.example.test/v1/activities';
    delete process.env[GETYOURGUIDE_API_CACHE_PERMISSION_ENV];
    db.getFeatureFlag.mockReset();
    db.getFeatureFlag.mockResolvedValue({ key: GETYOURGUIDE_FEATURE_FLAG, enabled: true });
    mockedReserve.mockReset();
    mockedReserve.mockResolvedValue(undefined);
    mockedCost.mockReset();
    mockedCost.mockResolvedValue(undefined);
    resetGetYourGuideApiCircuitForTests();
  });

  afterAll(() => {
    global.fetch = originalFetch;
    for (const [key, value] of [[GETYOURGUIDE_PARTNER_ID_ENV, originalPartner], [GETYOURGUIDE_API_TOKEN_ENV, originalToken], [GETYOURGUIDE_API_BASE_URL_ENV, originalBase], [GETYOURGUIDE_API_CACHE_PERMISSION_ENV, originalPermission]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it('validates and normalizes approved response fields without retaining URLs', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain('query=Louvre+Museum');
      expect(url).toContain('currency=USD');
      expect(url).toContain('cnt_language=en');
      expect(url).not.toContain('secret-token');
      expect((init?.headers as Record<string, string>)['X-ACCESS-TOKEN']).toBe('secret-token');
      return response(200, { products: [{ id: 'p-1', title: 'Louvre Museum Tour', durationMinutes: 120, currency: 'EUR', priceFrom: 45, meetingPoint: 'Main gate', cancellationPolicy: 'Free cancellation', accessibility: ['Step-free'] }] });
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await searchGetYourGuideActivities({ caller: 'GETYOURGUIDE_ITINERARY_ACTIVITY_SUGGESTION', query: 'Louvre Museum', currency: 'USD', language: 'en', maxRetries: 0 });
    expect(result).toEqual(expect.objectContaining({ negative: false, products: [expect.objectContaining({ productId: 'p-1', name: 'Louvre Museum Tour', durationMinutes: 120, priceFrom: 45, currency: 'EUR', lastVerifiedAt: expect.any(String) })] }));
    expect(mockedReserve).toHaveBeenCalledWith({ provider: 'GETYOURGUIDE', caller: 'GETYOURGUIDE_ITINERARY_ACTIVITY_SUGGESTION' });
    expect(mockedCost).toHaveBeenCalledWith({ provider: 'GETYOURGUIDE' });
  });

  it('returns negative results and rejects malformed payloads without retrying', async () => {
    expect(normalizeGetYourGuideSearchResponse({ results: [] }).negative).toBe(true);
    global.fetch = jest.fn(async () => response(200, { results: [{ id: 'missing-name' }] })) as typeof fetch;
    await expect(searchGetYourGuideActivities({ caller: 'GETYOURGUIDE_ACTIVITY_TAB_LOOKUP', query: 'museum', currency: 'USD', language: 'en', maxRetries: 2, retryDelayMs: 0 })).rejects.toMatchObject({ code: 'malformed_response' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries 429/5xx with a bound, but never retries a 4xx response', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response(429, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(response(200, { activities: [] }));
    global.fetch = fetchMock as typeof fetch;
    await expect(searchGetYourGuideActivities({ caller: 'GETYOURGUIDE_ACTIVITY_TAB_LOOKUP', query: 'museum', currency: 'USD', language: 'en', maxRetries: 1, retryDelayMs: 0 })).resolves.toEqual(expect.objectContaining({ negative: true }));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset().mockResolvedValue(response(401, {}));
    await expect(searchGetYourGuideActivities({ caller: 'GETYOURGUIDE_ACTIVITY_TAB_LOOKUP', query: 'museum', currency: 'USD', language: 'en', maxRetries: 2, retryDelayMs: 0 })).rejects.toMatchObject({ code: 'http', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit after repeated provider failures', async () => {
    const fetchMock = jest.fn(async () => response(503, {}));
    global.fetch = fetchMock as typeof fetch;
    for (let i = 0; i < 3; i += 1) {
      await expect(searchGetYourGuideActivities({ caller: 'GETYOURGUIDE_ACTIVITY_TAB_LOOKUP', query: `museum-${i}`, currency: 'USD', language: 'en', maxRetries: 0 })).rejects.toMatchObject({ code: 'http' });
    }
    await expect(searchGetYourGuideActivities({ caller: 'GETYOURGUIDE_ACTIVITY_TAB_LOOKUP', query: 'museum-final', currency: 'USD', language: 'en', maxRetries: 0 })).rejects.toMatchObject({ code: 'circuit_open' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails closed before HTTP when the limiter or cost accounting rejects', async () => {
    const fetchMock = jest.fn(async () => response(200, { products: [] }));
    global.fetch = fetchMock as typeof fetch;
    mockedReserve.mockRejectedValueOnce(new Error('limit'));
    await expect(searchGetYourGuideActivities({ caller: 'GETYOURGUIDE_ACTIVITY_TAB_LOOKUP', query: 'museum', currency: 'USD', language: 'en', maxRetries: 0 })).rejects.toThrow('limit');
    expect(fetchMock).not.toHaveBeenCalled();

    mockedReserve.mockResolvedValue(undefined);
    mockedCost.mockRejectedValueOnce(new Error('cost'));
    await expect(searchGetYourGuideActivities({ caller: 'GETYOURGUIDE_ACTIVITY_TAB_LOOKUP', query: 'museum', currency: 'USD', language: 'en', maxRetries: 0 })).rejects.toThrow('cost');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not retry an aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    global.fetch = jest.fn(async () => response(200, { products: [] })) as typeof fetch;
    await expect(searchGetYourGuideActivities({ caller: 'GETYOURGUIDE_ACTIVITY_TAB_LOOKUP', query: 'museum', currency: 'USD', language: 'en', signal: controller.signal, maxRetries: 2 })).rejects.toMatchObject({ code: 'aborted' } satisfies Partial<GetYourGuideApiError>);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('times out without retrying and fails closed when configuration is missing', async () => {
    global.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted by timeout')), { once: true });
    })) as typeof fetch;
    await expect(searchGetYourGuideActivities({ caller: 'GETYOURGUIDE_ACTIVITY_TAB_LOOKUP', query: 'museum', currency: 'USD', language: 'en', timeoutMs: 100, maxRetries: 2 })).rejects.toMatchObject({ code: 'timeout' });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    delete process.env[GETYOURGUIDE_API_BASE_URL_ENV];
    await expect(searchGetYourGuideActivities({ caller: 'GETYOURGUIDE_ACTIVITY_TAB_LOOKUP', query: 'museum', currency: 'USD', language: 'en', maxRetries: 0 })).rejects.toMatchObject({ code: 'configuration' });
  });
});
