import {
  buildGetYourGuideActivityLookupKey,
  clearGetYourGuideActivityCachesForTests,
  getGetYourGuideActivitySuggestions,
} from '../src/apis/getYourGuideCallers';
import { searchGetYourGuideActivities } from '../src/apis/getYourGuideApi';
import { GETYOURGUIDE_API_CACHE_PERMISSION_ENV } from '../src/config/getYourGuide';

jest.mock('../src/apis/getYourGuideApi', () => ({ searchGetYourGuideActivities: jest.fn() }));
jest.mock('../src/config/apiLimits', () => ({
  getApiCacheSetting: jest.fn((group: string, setting: string) => ({
    freshTtlMinutes: 1,
    staleTtlHours: 1,
    maxPartnerApiLookupsPerGeneration: 2,
    maxPartnerApiLookupsPerDay: 10,
  } as Record<string, number>)[setting]),
}));

const mockedSearch = searchGetYourGuideActivities as jest.MockedFunction<typeof searchGetYourGuideActivities>;

const lookup = (overrides: Record<string, unknown> = {}) => ({
  query: 'Louvre Museum Tour', destination: 'Paris', country: 'France', date: '2026-09-01', partySize: 2,
  language: 'en', currency: 'USD', budgetTier: 'paid' as const, scopeKey: 'generation-scope', ...overrides,
});

describe('GetYourGuide named callers and SWR cache', () => {
  beforeEach(() => {
    process.env[GETYOURGUIDE_API_CACHE_PERMISSION_ENV] = 'true';
    clearGetYourGuideActivityCachesForTests();
    mockedSearch.mockReset();
    mockedSearch.mockResolvedValue({ products: [{ productId: 'p-1', name: 'Louvre Tour', lastVerifiedAt: '2026-09-01T00:00:00.000Z' }], negative: false, fetchedAt: '2026-09-01T00:00:00.000Z' });
  });

  afterAll(() => { delete process.env[GETYOURGUIDE_API_CACHE_PERMISSION_ENV]; });

  it('uses a normalized privacy-safe key with all relevance dimensions', () => {
    const first = buildGetYourGuideActivityLookupKey(lookup({ query: '  Louvre Museum Tour ', accessibility: ['Step free'] }));
    const equivalent = buildGetYourGuideActivityLookupKey(lookup({ query: 'LOUVRE MUSEUM TOUR', accessibility: ['Step free', 'step free'] }));
    const changed = buildGetYourGuideActivityLookupKey(lookup({ budgetTier: 'premium' }));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('Louvre');
    expect(first).toBe(equivalent);
    expect(first).not.toBe(changed);
  });

  it('deduplicates concurrent lookups and serves fresh cache hits', async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    mockedSearch.mockImplementationOnce(async () => { await wait; return { products: [{ productId: 'p-1', name: 'Louvre Tour', lastVerifiedAt: 'now' }], negative: false, fetchedAt: 'now' }; });
    const one = getGetYourGuideActivitySuggestions(lookup());
    const two = getGetYourGuideActivitySuggestions(lookup());
    release();
    await expect(Promise.all([one, two])).resolves.toHaveLength(2);
    expect(mockedSearch).toHaveBeenCalledTimes(1);
    await getGetYourGuideActivitySuggestions(lookup());
    expect(mockedSearch).toHaveBeenCalledTimes(1);
  });

  it('serves stale data immediately and revalidates in the background', async () => {
    jest.useFakeTimers();
    await getGetYourGuideActivitySuggestions(lookup());
    jest.advanceTimersByTime(61_000);
    mockedSearch.mockResolvedValueOnce({ products: [{ productId: 'p-2', name: 'Updated Tour', lastVerifiedAt: 'later' }], negative: false, fetchedAt: 'later' });
    const stale = await getGetYourGuideActivitySuggestions(lookup());
    expect(stale?.stale).toBe(true);
    await Promise.resolve();
    expect(mockedSearch).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('keeps negative results separate and suppresses calls at the generation budget', async () => {
    mockedSearch.mockResolvedValueOnce({ products: [], negative: true, fetchedAt: 'now' });
    const negative = await getGetYourGuideActivitySuggestions(lookup({ query: 'No Match' }));
    expect(negative).toEqual(expect.objectContaining({ negative: true }));
    await getGetYourGuideActivitySuggestions(lookup({ query: 'No Match' }));
    expect(mockedSearch).toHaveBeenCalledTimes(1);

    await getGetYourGuideActivitySuggestions(lookup({ query: 'Second' }));
    await getGetYourGuideActivitySuggestions(lookup({ query: 'Third' }));
    expect(mockedSearch).toHaveBeenCalledTimes(2);
  });

  it('does not retain partner output when written cache permission is absent', async () => {
    delete process.env[GETYOURGUIDE_API_CACHE_PERMISSION_ENV];
    await getGetYourGuideActivitySuggestions(lookup({ query: 'Transient' }));
    await getGetYourGuideActivitySuggestions(lookup({ query: 'Transient' }));
    expect(mockedSearch).toHaveBeenCalledTimes(2);
  });
});
