import axios from 'axios';
import {
  clearWikipediaEnrichmentCacheForTests,
  fetchWikipediaEnrichment,
  parseWikipediaEnrichment,
} from '../src/services/wikipediaGeocodingService';
import {
  clearWikipediaPageviewCacheForTests,
  fetchWikipediaPopularityScore,
  normalizePopularityScore,
} from '../src/services/wikipediaPageviewService';

jest.mock('axios');
jest.mock('../src/apis/usageLimiter', () => ({ reserveApiUsageOrThrow: jest.fn(async () => undefined) }));
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedReserve = jest.requireMock('../src/apis/usageLimiter').reserveApiUsageOrThrow as jest.Mock;

describe('Wikipedia Phase 1 enrichment', () => {
  beforeEach(() => { mockedAxios.get.mockReset(); mockedReserve.mockClear(); clearWikipediaEnrichmentCacheForTests(); clearWikipediaPageviewCacheForTests(); });

  test('parses canonical identity, coordinates, URL, and a bounded summary', () => {
    const result = parseWikipediaEnrichment({ query: { pages: { '123': {
      pageid: 123, title: 'Louvre Museum', coordinates: [{ lat: 48.8606, lon: 2.3376 }],
      extract: 'The Louvre is a national art museum. It is located in Paris. A third sentence is omitted.',
      fullurl: 'https://en.wikipedia.org/wiki/Louvre',
    } } } });
    expect(result).toMatchObject({ pageId: 123, canonicalTitle: 'Louvre Museum', lat: 48.8606, lon: 2.3376 });
    expect(result?.summary).toBe('The Louvre is a national art museum. It is located in Paris.');
  });

  test('coalesces and caches duplicate enrichment requests', async () => {
    mockedAxios.get.mockResolvedValue({ data: { query: { pages: { '1': { pageid: 1, title: 'Louvre Museum', coordinates: [{ lat: 48.86, lon: 2.34 }] } } } } } as any);
    const [first, second] = await Promise.all([
      fetchWikipediaEnrichment('Louvre', 'Paris'), fetchWikipediaEnrichment('Louvre', 'Paris'),
    ]);
    expect(first).toEqual(second);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedReserve).toHaveBeenCalledWith({ provider: 'WIKIMEDIA', caller: 'ATTRACTION_WIKIPEDIA_ENRICHMENT' });
    await fetchWikipediaEnrichment('Louvre', 'Paris');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  test('converts monthly pageviews to a bounded score and caches it', async () => {
    mockedAxios.get.mockResolvedValue({ data: { items: [{ views: 1000 }, { views: 9000 }] } } as any);
    const score = await fetchWikipediaPopularityScore('Louvre Museum', new Date('2026-07-12T00:00:00Z'));
    expect(score).toBe(normalizePopularityScore(10000));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(mockedReserve).toHaveBeenCalledWith({ provider: 'WIKIMEDIA', caller: 'ATTRACTION_WIKIMEDIA_PAGEVIEWS' });
    await fetchWikipediaPopularityScore('Louvre Museum');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});
