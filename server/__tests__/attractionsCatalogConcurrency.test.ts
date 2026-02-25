import axios from 'axios';
import {
  getAttractionPromptBlockForDestinations,
  getAttractionShortlistForDestinations,
} from '../src/services/attractionsCatalogService';

jest.mock('axios');
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

    // One refresh run should call both discovery sources once each.
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
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
    expect(mockedDb.upsertAttractionShortlistBlob).not.toHaveBeenCalled();
  });
});
