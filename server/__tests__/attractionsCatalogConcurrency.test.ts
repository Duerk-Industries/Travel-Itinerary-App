/// <reference types="jest" />
/// <reference types="node" />
import axios from 'axios';
import fs from 'fs';
import {
  getAttractionPromptBlockForDestinations,
  getAttractionShortlistForDestinations,
} from '../src/services/attractionsCatalogService';

jest.mock('axios');
jest.mock('../src/apis/usageLimiter', () => ({ reserveApiUsageOrThrow: jest.fn(async () => undefined) }));
jest.mock('../src/db', () => ({
  listAttractionCatalogEntries: jest.fn(),
  upsertAttractionCatalogEntry: jest.fn(),
  getAttractionShortlistBlob: jest.fn(),
  upsertAttractionShortlistBlob: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedDb = jest.requireMock('../src/db') as {
  listAttractionCatalogEntries: jest.Mock;
  upsertAttractionCatalogEntry: jest.Mock;
  getAttractionShortlistBlob: jest.Mock;
  upsertAttractionShortlistBlob: jest.Mock;
};

describe('attractions shortlist locking and prompt blob reuse', () => {
  const previousSerpKey = process.env.SERPAPI_API_KEY;

  beforeEach(() => {
    mockedAxios.get.mockReset();
    mockedDb.listAttractionCatalogEntries.mockReset();
    mockedDb.upsertAttractionCatalogEntry.mockReset();
    mockedDb.getAttractionShortlistBlob.mockReset();
    mockedDb.upsertAttractionShortlistBlob.mockReset();
    process.env.SERPAPI_API_KEY = 'test-serp-key';
  });

  afterAll(() => {
    if (previousSerpKey === undefined) {
      delete process.env.SERPAPI_API_KEY;
    } else {
      process.env.SERPAPI_API_KEY = previousSerpKey;
    }
  });

  it('coalesces concurrent refreshes per destination', async () => {
    mockedDb.listAttractionCatalogEntries.mockResolvedValue([]);
    mockedDb.upsertAttractionCatalogEntry.mockResolvedValue(null);

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('serpapi.com')) {
        return {
          data: {
            organic_results: [{ title: 'Museo Nacional de Antropologia', link: 'https://example.com/mna' }],
            local_results: { places: [] },
          },
        } as any;
      }
      return {
        data: {
          query: {
            search: [{ title: 'Museo Nacional de Antropologia', snippet: 'Top museum in Mexico City' }],
          },
        },
      } as any;
    });

    await Promise.all([
      getAttractionShortlistForDestinations({
        userId: 'u1',
        destinations: ['Mexico City'],
        limitPerDestination: 10,
      }),
      getAttractionShortlistForDestinations({
        userId: 'u1',
        destinations: ['Mexico City'],
        limitPerDestination: 10,
      }),
    ]);

    // One refresh run calls both discovery sources and the new Wikipedia
    // canonical-page enrichment source once. Concurrent callers still share it.
    expect(mockedAxios.get).toHaveBeenCalledTimes(3);
  });

  it('reuses fresh prompt blob when compact signature matches', async () => {
    const entries = [
      {
        id: 'attr:mexico-city:mna',
        destinationKey: 'mexico city',
        destinationDisplayName: 'Mexico City',
        name: 'Museo Nacional de Antropologia',
        rank: 1,
        activityType: 'Ticketed Attraction',
        interestTags: ['culture'],
        sourceCount: 2,
        budgetTier: 'paid',
        updatedAt: new Date().toISOString(),
      },
    ];
    mockedDb.listAttractionCatalogEntries.mockResolvedValue(entries);
    const compactSignature = JSON.stringify({
      budgetProfile: 'paid',
      items: [
        {
          name: 'Museo Nacional de Antropologia',
          type: 'Ticketed Attraction',
          tags: ['culture'],
          tier: 'paid',
          rank: 1,
        },
      ],
    });
    mockedDb.getAttractionShortlistBlob.mockResolvedValue({
      id: 'attr-blob:mexico-city:2026-03-03',
      destinationKey: 'mexico city',
      destinationDisplayName: 'Mexico City',
      dateKey: '2026-03-03',
      promptBlock:
        'Destination: Mexico City\n1. Museo Nacional de Antropologia | tier=paid | type=Ticketed Attraction | tags=culture',
      compact: compactSignature,
      itemCount: 1,
      updatedAt: new Date().toISOString(),
    });

    const result = await getAttractionPromptBlockForDestinations({
      userId: 'u1',
      destinations: ['Mexico City'],
      dateKey: '2026-03-03',
      budgetMin: 2000,
      budgetMax: 3000,
      limitPerDestination: 1,
      promptItemsPerDestination: 5,
    });

    expect(result.promptBlock).toContain('Destination: Mexico City');
    expect(result.attractionPodsByDestination?.['Mexico City']?.[0]).toMatchObject({
      kind: 'locality-only', distanceGuaranteed: false,
    });
    expect(mockedDb.upsertAttractionShortlistBlob).not.toHaveBeenCalled();
  });

  it('syncs cached destination rows to CSV without forcing discovery refresh', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousCsvPath = process.env.ATTRACTIONS_CSV_LOCAL_PATH;
    const previousE2eMode = process.env.E2E_MODE;
    process.env.NODE_ENV = 'development';
    process.env.E2E_MODE = '1';
    process.env.ATTRACTIONS_CSV_LOCAL_PATH = 'server/data/attractions_catalog.csv';

    const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined as any);

    mockedDb.listAttractionCatalogEntries.mockResolvedValue([
      {
        id: 'attr:mexico-city:mna',
        destinationKey: 'mexico city',
        destinationDisplayName: 'Mexico City',
        name: 'Museo Nacional de Antropologia',
        rank: 1,
        activityType: 'Ticketed Attraction',
        interestTags: ['culture'],
        sourceCount: 2,
        budgetTier: 'paid',
        updatedAt: new Date().toISOString(),
      },
    ]);

    await getAttractionShortlistForDestinations({
      userId: 'u1',
      destinations: ['Mexico City'],
      limitPerDestination: 1,
      refreshDays: 365,
    });

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalled();

    mkdirSpy.mockRestore();
    writeSpy.mockRestore();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousCsvPath === undefined) delete process.env.ATTRACTIONS_CSV_LOCAL_PATH;
    else process.env.ATTRACTIONS_CSV_LOCAL_PATH = previousCsvPath;
    if (previousE2eMode === undefined) delete process.env.E2E_MODE;
    else process.env.E2E_MODE = previousE2eMode;
  });

  it('filters out weakly related cross-city discoveries during refresh', async () => {
    mockedDb.listAttractionCatalogEntries.mockResolvedValue([]);
    mockedDb.upsertAttractionCatalogEntry.mockResolvedValue(null);

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('serpapi.com')) {
        return {
          data: {
            organic_results: [
              {
                title: 'Museo Nacional de Antropologia',
                link: 'https://example.com/mna',
                snippet: 'Top attraction in Mexico City',
              },
              {
                title: 'Cancun Beach Guide',
                link: 'https://example.com/cancun',
                snippet: 'Best beaches in Cancun',
              },
            ],
            local_results: { places: [] },
          },
        } as any;
      }
      return {
        data: {
          query: {
            search: [
              { title: 'Historic center of Mexico City', snippet: 'Main historic district in Mexico City' },
              { title: 'La Quebrada (Acapulco)', snippet: 'Top attraction in Acapulco' },
            ],
          },
        },
      } as any;
    });

    await getAttractionShortlistForDestinations({
      userId: 'u1',
      destinations: ['Mexico City'],
      limitPerDestination: 20,
      refreshDays: 1,
    });

    const upsertedNames = mockedDb.upsertAttractionCatalogEntry.mock.calls
      .map((call) => call[0]?.name)
      .filter(Boolean);
    expect(upsertedNames.length).toBeGreaterThan(0);
    expect(upsertedNames.some((name: string) => /mexico city|museo nacional|historic center/i.test(name))).toBe(true);
    expect(upsertedNames.some((name: string) => /cancun|acapulco/i.test(name))).toBe(false);
  });

  it('preserves curated rows during refresh and prevents overwrite by discovery', async () => {
    const curatedRow = {
      id: 'attr:mexico-city:mna',
      destinationKey: 'mexico city',
      destinationDisplayName: 'Mexico City',
      name: 'Museo Nacional de Antropologia',
      rank: 1,
      activityType: 'Ticketed Attraction',
      interestTags: ['culture', 'iconic_landmarks'],
      sourceUrl: 'https://example.com/curated-mna',
      sourceLabel: 'curated',
      snippet: 'Curated top attraction',
      sourceCount: 3,
      budgetTier: 'paid',
      updatedAt: '2026-02-25T22:20:00.000Z',
    };
    mockedDb.listAttractionCatalogEntries
      .mockResolvedValueOnce([curatedRow])
      .mockResolvedValueOnce([curatedRow])
      .mockResolvedValueOnce([curatedRow]);
    mockedDb.upsertAttractionCatalogEntry.mockResolvedValue(null);

    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('serpapi.com')) {
        return {
          data: {
            organic_results: [
              {
                title: 'Museo Nacional de Antropologia',
                link: 'https://example.com/discovered-mna',
                snippet: 'Discovered source should not override curated row',
              },
              {
                title: 'Palacio de Bellas Artes Mexico City',
                link: 'https://example.com/bellas-artes',
                snippet: 'Iconic attraction in Mexico City',
              },
            ],
            local_results: { places: [] },
          },
        } as any;
      }
      return {
        data: {
          query: {
            search: [{ title: 'Palacio de Bellas Artes', snippet: 'Main attraction in Mexico City' }],
          },
        },
      } as any;
    });

    await getAttractionShortlistForDestinations({
      userId: 'u1',
      destinations: ['Mexico City'],
      limitPerDestination: 5,
      refreshDays: 1,
    });

    const upsertedRows = mockedDb.upsertAttractionCatalogEntry.mock.calls.map((call) => call[0]);
    const curatedUpsert = upsertedRows.find((row: any) => row.id === curatedRow.id);
    expect(curatedUpsert).toBeTruthy();
    expect(curatedUpsert.sourceLabel).toBe('curated');
    expect(curatedUpsert.sourceUrl).toBe(curatedRow.sourceUrl);
    expect(curatedUpsert.snippet).toBe(curatedRow.snippet);
  });
});
