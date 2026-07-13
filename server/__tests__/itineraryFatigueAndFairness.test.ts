/// <reference types="jest" />
/// <reference types="node" />
import { generateItineraryViaPromptPlan } from '../src/services/itineraryPromptPlanService';
import { runItineraryPromptStageViaOpenAi } from '../src/apis/openaiCallers';
import * as attractionsCatalogService from '../src/services/attractionsCatalogService';
import axios from 'axios';
import { initDb } from '../src/db';
import { seedEntitlementDefaults } from '../src/services/entitlementService';

jest.mock('axios');
jest.mock('../src/apis/openaiCallers', () => {
  const actual = jest.requireActual('../src/apis/openaiCallers');
  return {
    ...actual,
    runItineraryPromptStageViaOpenAi: jest.fn(async () => {
      const axios = require('axios') as jest.Mocked<typeof import('axios')>;
      const response = await axios.post('/test-itinerary-prompt-stage');
      return {
        text: response.data?.choices?.[0]?.message?.content ?? null,
        promptTokens: response.data?.usage?.prompt_tokens ?? 0,
        completionTokens: response.data?.usage?.completion_tokens ?? 0,
      };
    }),
  };
});
jest.mock('../src/services/attractionsCatalogService', () => {
  const actual = jest.requireActual('../src/services/attractionsCatalogService');
  return {
    ...actual,
    getAttractionPromptBlockForDestinations: jest.fn(),
  };
});

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedAttractionsCatalogService = attractionsCatalogService as jest.Mocked<typeof attractionsCatalogService>;

describe('Itinerary Fatigue Management and Fairness Floor', () => {
  beforeAll(async () => {
    await initDb();
    await seedEntitlementDefaults();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.get.mockResolvedValue({ status: 404, data: {} });
  });

  it('Fairness Floor: injects activities for underserved traveler interests', async () => {
    mockedAttractionsCatalogService.getAttractionPromptBlockForDestinations.mockResolvedValue({
      shortlistByDestination: {
        'Paris': [
          {
            id: 'louvre',
            destinationKey: 'paris',
            destinationDisplayName: 'Paris',
            name: 'Louvre Museum',
            rank: 1,
            activityType: 'Ticketed Attraction',
            interestTags: ['culture'],
            sourceCount: 1,
            budgetTier: 'paid',
            updatedAt: new Date().toISOString(),
          },
          {
            id: 'photo-spot',
            destinationKey: 'paris',
            destinationDisplayName: 'Paris',
            name: 'Trocadero Sunset',
            rank: 2,
            activityType: 'Open Access',
            interestTags: ['photography'],
            sourceCount: 1,
            budgetTier: 'free',
            updatedAt: new Date().toISOString(),
          }
        ],
      },
      promptBlock: 'Paris shortlist',
      attractionPodsByDestination: {},
    });

    const norm = { $: 'norm1', sd: '2026-07-01', ed: '2026-07-02', p: 'B', c: 'M', mob: 'M', car: 'P', w: { culture: 50, photography: 10 }, a: [], is: 'mixed' };
    const route = { $: 'r1', eh: 'CDG', xh: 'CDG', b: [{ l: 'Paris', ci: '2026-07-01', co: '2026-07-03', dn: [] }], x: [], rc: null, w: norm.w, a: [] };
    const itinerary = { $: 'it1', ...route, dy: [
      { d: 1, dt: '2026-07-01', b: 'Paris', it: [['D', 'A', 'Louvre Museum']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [], cf: 'H' },
      { d: 2, dt: '2026-07-02', b: 'Paris', it: [['D', 'O', 'Flexible activity block']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [], cf: 'H' },
    ], cf: 'H' };

    mockedAxios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify(itinerary) } }] } });
    // Override first call for norm
    mockedAxios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify(norm) } }] } });
    // Override second call for route
    mockedAxios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify(route) } }] } });

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      userId: 'user-1',
      destinations: ['Paris'],
      days: 2,
      budgetMin: 1000,
      budgetMax: 2000,
      groupTraits: [{ userId: 'u2', name: 'Photographer', traits: ['Photography'] }],
      tripIdSeed: 'fairness-test',
    });

    const activityNames = result.generatedItems.activities.map(a => a.name);
    expect(activityNames).toContain('Trocadero Sunset');
    expect(activityNames).toContain('Louvre Museum');
  });

  it('Fatigue Management: lightens a day with excessive travel time', async () => {
    mockedAttractionsCatalogService.getAttractionPromptBlockForDestinations.mockResolvedValue({
      shortlistByDestination: {
        'Big City': [
          { id: 'a1', name: 'Far Attraction 1', lat: 40, lon: -70, interestTags: [], activityType: 'O', destinationKey: 'big city' } as any,
          { id: 'a2', name: 'Far Attraction 2', lat: 41, lon: -71, interestTags: [], activityType: 'O', destinationKey: 'big city' } as any,
        ],
      },
      promptBlock: 'Big City shortlist',
      attractionPodsByDestination: {},
    });

    const norm = { $: 'norm1', sd: '2026-08-01', ed: '2026-08-01', p: 'B', c: 'M', mob: 'M', car: 'P', w: {}, a: [], is: 'mixed' };
    const route = { $: 'r1', eh: 'HUB', xh: 'HUB', b: [{ l: 'Big City', ci: '2026-08-01', co: '2026-08-02', dn: [] }], x: [], rc: null, w: norm.w, a: [] };
    const itinerary = { $: 'it1', ...route, dy: [
      { d: 1, dt: '2026-08-01', b: 'Big City', it: [
        ['M', 'O', 'Far Attraction 1'],
        ['D', 'O', 'Far Attraction 2'],
        ['D', 'O', 'Activity 3'],
        ['E', 'O', 'Activity 4'],
        ['E', 'O', 'Activity 5'],
      ], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Big City'", ln: [], cf: 'H' },
    ], cf: 'H' };

    mockedAxios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify(itinerary) } }] } });
    mockedAxios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify(norm) } }] } });
    mockedAxios.post.mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify(route) } }] } });

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      userId: 'user-1',
      destinations: ['Big City'],
      days: 1,
      budgetMin: 1000,
      budgetMax: 2000,
      groupTraits: [],
      tripIdSeed: 'fatigue-test',
    });

    // Distance between (40,-70) and (41,-71) is ~111km, which will result in high transfer minutes.
    // The fatigue management should lighten the day (cap at 3 items if status='lighten' or 2 if 'rest-hub').
    expect(result.itinerary.dy[0].it.length).toBeLessThan(5);
  });
});
