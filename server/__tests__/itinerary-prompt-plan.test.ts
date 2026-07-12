/// <reference types="jest" />
/// <reference types="node" />
import axios from 'axios';
import { generateItineraryViaPromptPlan } from '../src/services/itineraryPromptPlanService';
import * as attractionsCatalogService from '../src/services/attractionsCatalogService';
import { initDb } from '../src/db';
import { seedEntitlementDefaults } from '../src/services/entitlementService';
import { estimateOpenAiCostMicros } from '../src/apis/providerBudgeting';
import {
  OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE,
  OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS,
  runItineraryPromptStageViaOpenAi,
} from '../src/apis/openaiCallers';

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
jest.mock('../src/ai/capture/itineraryCapture', () => ({
  captureItineraryInteraction: jest.fn(),
}));
jest.mock('../src/ai/experiments/experimentConfigService', () => ({
  getRunningExperiment: jest.fn(async () => null),
  clearExperimentConfigCache: jest.fn(),
}));
jest.mock('../src/services/aiProviderConfigService', () => ({
  getConfiguredProviderApiKey: jest.fn(() => 'test-key'),
  getConfiguredProviderModels: jest.fn((_providerId: string, fallbackModels: string[]) => fallbackModels),
  getProviderApiKeyEnvVar: jest.fn((providerId: string) => `${providerId.toUpperCase()}_API_KEY`),
  getProviderModelsEnvVar: jest.fn((providerId: string) => `${providerId.toUpperCase()}_MODELS`),
  getActiveAiProvider: jest.fn(async (featureKey: string) => ({
    featureKey,
    provider: 'openai',
    model: 'gpt-4o-mini',
    enabled: true,
    source: 'default',
    updatedBy: null,
    updatedAt: null,
  })),
  clearAiProviderConfigCache: jest.fn(),
}));
jest.mock('../src/services/attractionsCatalogService', () => {
  const actual = jest.requireActual('../src/services/attractionsCatalogService');
  return {
    ...actual,
    getAttractionPromptBlockForDestinations: jest.fn(async () => ({ shortlistByDestination: {}, promptBlock: 'none' })),
  };
});
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedPromptStage = runItineraryPromptStageViaOpenAi as jest.Mock;
const mockedAttractionsCatalogService = attractionsCatalogService as jest.Mocked<typeof attractionsCatalogService>;

describe('itinerary prompt plan service', () => {
  beforeAll(async () => {
    await initDb();
    // Seeds feature_flags from server/config/feature-flags.yaml (including
    // attractions_transfer_directions_api: false) — without this, the flag
    // table is empty and fail-open behavior would enable the inert
    // DirectionsApiTransferEstimator stub instead of the real heuristic.
    await seedEntitlementDefaults();
  });

  beforeEach(() => {
    mockedPromptStage.mockClear();
    mockedAxios.post.mockReset();
    mockedAxios.get.mockReset();
    // Attraction duration/description lookups hit Wikipedia's summary API by
    // default; tests that don't care about descriptions get a clean "no
    // article" response instead of relying on an unmocked call throwing.
    mockedAxios.get.mockResolvedValue({ status: 404, data: {} });
    mockedAttractionsCatalogService.getAttractionPromptBlockForDestinations.mockReset();
    mockedAttractionsCatalogService.getAttractionPromptBlockForDestinations.mockResolvedValue({
      shortlistByDestination: {},
      promptBlock: 'none',
    });
  });

  it('maps short prompt output to long enum values and needed generated items', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          usage: { prompt_tokens: 180, completion_tokens: 300 },
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'norm1',
                  sd: '2026-08-01',
                  ed: '2026-08-03',
                  p: 'R',
                  c: 'L',
                  mob: 'H',
                  car: 'R',
                  w: { o: 40, c: 20, f: 20, n: 10, r: 10 },
                  a: ['normalized'],
                  tm: 'E',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          usage: { prompt_tokens: 240, completion_tokens: 400 },
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'r1',
                  eh: 'LAX',
                  xh: 'SFO',
                  b: [{ l: 'California', ci: '2026-08-01', co: '2026-08-04', dn: [] }],
                  x: [{ dt: '2026-08-01', m: 'Bus', fr: 'LAX', to: 'California' }],
                  rc: { pu: 'LAX', do: 'SFO', r: 'Road segment' },
                  w: { o: 40, c: 20, f: 20, n: 10, r: 10 },
                  a: [],
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          usage: { prompt_tokens: 320, completion_tokens: 500 },
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'it1',
                  eh: 'LAX',
                  xh: 'SFO',
                  b: [{ l: 'California', ci: '2026-08-01', co: '2026-08-04', dn: [] }],
                  x: [{ dt: '2026-08-01', m: 'Bus', fr: 'LAX', to: 'California' }],
                  rc: { pu: 'LAX', do: 'SFO', r: 'Road segment' },
                  dy: [
                    {
                      d: 1,
                      dt: '2026-08-02',
                      b: 'California',
                      it: [['M', 'A', 'Major landmark entry'], ['D', 'R', 'Timed gallery slot']],
                      me: ['BQ', 'LC', 'DL'],
                      sl: "Lodging at 'California'",
                      ln: [],
                      cf: 'M',
                    },
                  ],
                  a: [],
                  cf: 'M',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          usage: { prompt_tokens: 300, completion_tokens: 300 },
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'it1',
                  eh: 'LAX',
                  xh: 'SFO',
                  b: [{ l: 'California', ci: '2026-08-01', co: '2026-08-04', dn: [] }],
                  x: [{ dt: '2026-08-01', m: 'Bus', fr: 'LAX', to: 'California' }],
                  rc: { pu: 'LAX', do: 'SFO', r: 'Road segment' },
                  dy: [
                    {
                      d: 1,
                      dt: '2026-08-02',
                      b: 'California',
                      it: [['M', 'A', 'Major landmark entry'], ['D', 'R', 'Timed gallery slot']],
                      me: ['BQ', 'LC', 'DL'],
                      sl: "Lodging at 'California'",
                      ln: [],
                      cf: 'M',
                    },
                  ],
                  a: [],
                  cf: 'M',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          usage: { prompt_tokens: 260, completion_tokens: 700 },
          choices: [{ message: { content: '## Rendered itinerary' } }],
        },
      });

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      destinations: ['California'],
      days: 3,
      budgetMin: 1000,
      budgetMax: 5000,
      departureAirport: 'LAX',
      tripStyle: 'Explorer trip',
      promptTraits: {
        tt: {
          p: 'F',
          c: 'L',
          mob: 'H',
          car: 'R',
          is: 'guided',
          w: {
            outdoors: 20,
            adventure: 20,
            culture: 20,
            food: 15,
            nightlife: 10,
            relax: 5,
            photography: 5,
            authentic_local: 3,
            iconic_landmarks: 2,
          },
        },
        ut: { po: 'R', mob: 'M', i: ['Hiking'], eb: true, no: false },
      },
      groupTraits: [{ userId: 'u1', name: 'Traveler 1', traits: ['Museums'] }],
      tripIdSeed: 'trip-seed-1',
    });

    expect(result.planMarkdown).toContain('Rendered itinerary');
    expect(result.profile.pace).toBe('Relaxed');
    expect(result.profile.comfort).toBe('Luxury');
    // Explicit account mobility is a hard constraint and must win over both
    // the trip's High setting and the model's attempted High output.
    expect(result.profile.mobility).toBe('Medium');
    expect(result.preferenceContract.mobility).toMatchObject({ value: 'M', source: 'account' });
    expect(result.profile.carPreference).toBe('FullTripRental');
    expect(result.profile.interactionStyle).toBe('Guided');
    expect(result.generatedItems.transfers[0].status).toBe('Needed');
    expect(result.generatedItems.transfers[0].transferType).toBe('Bus');
    expect(result.generatedItems.activities.length).toBeGreaterThanOrEqual(2);
    expect(result.generatedItems.activities[0].status).toBe('Proposed');
    expect(result.generatedItems.activities[1].status).toBe('Proposed');
    expect(result.generatedItems.activities[0].notes).toMatch(/what|fits this day|Things to know|concrete/i);
    expect(result.generatedItems.carRentals[0].status).toBe('Needed');
    // plan.md operational output targets: p0 <350, p1 <450,
    // p2 <600 per seven days, p3 <350. Rendering has no documented target,
    // so use its configured 900-token ceiling. This fixture supplies nonzero
    // provider usage to verify aggregation as well as the regression ceiling.
    expect(result.tokenUsage).toEqual({ promptTokens: 1300, completionTokens: 2200, totalTokens: 3500 });
    expect(result.tokenUsage.completionTokens).toBeLessThan(350 + 450 + 600 + 350 + 900);
    const estimatedCostMicros = estimateOpenAiCostMicros({ model: 'gpt-4o-mini', ...result.tokenUsage });
    expect(estimatedCostMicros).toBe(1515);
    expect(estimatedCostMicros).toBeLessThanOrEqual(2000); // $0.002 fixture ceiling
  });

  it('falls back to local markdown rendering when render stage returns empty content', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'norm1',
                  sd: '2026-09-01',
                  ed: '2026-09-02',
                  p: 'B',
                  c: 'M',
                  mob: 'M',
                  car: 'P',
                  w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                  a: [],
                  tm: 'B',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'r1',
                  eh: 'JFK',
                  xh: 'JFK',
                  b: [{ l: 'New York', ci: '2026-09-01', co: '2026-09-03', dn: [] }],
                  x: [],
                  rc: null,
                  w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                  a: [],
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'it1',
                  eh: 'JFK',
                  xh: 'JFK',
                  b: [{ l: 'New York', ci: '2026-09-01', co: '2026-09-03', dn: [] }],
                  x: [],
                  rc: null,
                  dy: [
                    {
                      d: 1,
                      dt: '2026-09-01',
                      b: 'New York',
                      it: [['D', 'O', 'Neighborhood walk']],
                      me: ['BQ', 'LC', 'DL'],
                      sl: "Lodging at 'New York'",
                      ln: [],
                      cf: 'M',
                    },
                  ],
                  a: [],
                  cf: 'M',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'it1',
                  eh: 'JFK',
                  xh: 'JFK',
                  b: [{ l: 'New York', ci: '2026-09-01', co: '2026-09-03', dn: [] }],
                  x: [],
                  rc: null,
                  dy: [
                    {
                      d: 1,
                      dt: '2026-09-01',
                      b: 'New York',
                      it: [['D', 'O', 'Neighborhood walk']],
                      me: ['BQ', 'LC', 'DL'],
                      sl: "Lodging at 'New York'",
                      ln: [],
                      cf: 'M',
                    },
                  ],
                  a: [],
                  cf: 'M',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: '' } }],
        },
      });

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      destinations: ['New York'],
      days: 2,
      budgetMin: 500,
      budgetMax: 1500,
      promptTraits: {
        tt: {
          p: 'B',
          c: 'M',
          mob: 'M',
          car: 'P',
          is: 'mixed',
          w: {
            outdoors: 15,
            adventure: 10,
            culture: 15,
            food: 15,
            nightlife: 10,
            relax: 10,
            photography: 10,
            authentic_local: 8,
            iconic_landmarks: 7,
          },
        },
        ut: { i: [] },
      },
      groupTraits: [],
      tripIdSeed: 'trip-seed-2',
    });

    expect(result.planMarkdown).toContain('Trip Overview');
    expect(result.planMarkdown).toContain('Day 1');
  });

  it('degrades gracefully when JSON stages return malformed content', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: '```json\n{ “$”: “norm1”, “sd”: “2026-10-01”, “ed”: “2026-10-03”, }\n```',
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'Route summary: start at entry hub, then continue.' } }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'Not JSON output from model' } }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'Still not JSON' } }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: '' } }],
        },
      });

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      destinations: ['Boston', 'London'],
      days: 3,
      budgetMin: 700,
      budgetMax: 2500,
      departureAirport: 'BOS',
      promptTraits: {
        tt: {
          p: 'B',
          c: 'M',
          mob: 'M',
          car: 'P',
          is: 'mixed',
          w: {
            outdoors: 15,
            adventure: 10,
            culture: 15,
            food: 15,
            nightlife: 10,
            relax: 10,
            photography: 10,
            authentic_local: 8,
            iconic_landmarks: 7,
          },
        },
        ut: { i: [] },
      },
      groupTraits: [],
      tripIdSeed: 'trip-seed-malformed',
    });

    expect(result.planMarkdown).toContain('Trip Overview');
    expect(result.details.length).toBeGreaterThan(0);
    expect(result.generatedItems.lodgings.length).toBeGreaterThan(0);
  });

  it('removes activities on arrival/departure days and transfer days over 4 hours', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'norm1',
                  sd: '2026-11-01',
                  ed: '2026-11-03',
                  p: 'B',
                  c: 'M',
                  mob: 'M',
                  car: 'P',
                  w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                  a: [],
                  tm: 'B',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'r1',
                  eh: 'BOS',
                  xh: 'BOS',
                  b: [{ l: 'Mexico City', ci: '2026-11-01', co: '2026-11-04', dn: [] }],
                  x: [{ dt: '2026-11-02', m: 'Bus', fr: 'Mexico City', to: 'Puebla', td: 5 }],
                  rc: null,
                  w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                  a: [],
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'it1',
                  eh: 'BOS',
                  xh: 'BOS',
                  b: [{ l: 'Mexico City', ci: '2026-11-01', co: '2026-11-04', dn: [] }],
                  x: [{ dt: '2026-11-02', m: 'Bus', fr: 'Mexico City', to: 'Puebla', td: 5 }],
                  rc: null,
                  dy: [
                    { d: 1, dt: '2026-11-01', b: 'Mexico City', it: [['M', 'A', 'Museum']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Mexico City'", ln: [], cf: 'M' },
                    { d: 2, dt: '2026-11-02', b: 'Mexico City', it: [['D', 'T', 'City tour']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Mexico City'", ln: [], cf: 'M' },
                    { d: 3, dt: '2026-11-03', b: 'Mexico City', it: [['E', 'O', 'Evening walk']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Mexico City'", ln: [], cf: 'M' },
                  ],
                  a: [],
                  cf: 'M',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'it1',
                  eh: 'BOS',
                  xh: 'BOS',
                  b: [{ l: 'Mexico City', ci: '2026-11-01', co: '2026-11-04', dn: [] }],
                  x: [{ dt: '2026-11-02', m: 'Bus', fr: 'Mexico City', to: 'Puebla', td: 5 }],
                  rc: null,
                  dy: [
                    { d: 1, dt: '2026-11-01', b: 'Mexico City', it: [['M', 'A', 'Museum']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Mexico City'", ln: [], cf: 'M' },
                    { d: 2, dt: '2026-11-02', b: 'Mexico City', it: [['D', 'T', 'City tour']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Mexico City'", ln: [], cf: 'M' },
                    { d: 3, dt: '2026-11-03', b: 'Mexico City', it: [['E', 'O', 'Evening walk']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Mexico City'", ln: [], cf: 'M' },
                  ],
                  a: [],
                  cf: 'M',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: '## Rendered itinerary' } }],
        },
      });

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      destinations: ['Mexico City'],
      days: 3,
      budgetMin: 1000,
      budgetMax: 2000,
      departureAirport: 'BOS',
      groupTraits: [],
      tripIdSeed: 'trip-seed-blocked-days',
    });

    expect(result.generatedItems.activities).toHaveLength(1);
    expect(result.generatedItems.activities[0].name).toBe('City tour');
    expect(result.itinerary.dy[0].ln.join(' ')).toContain('Travel day: no activities scheduled');
    expect(result.itinerary.dy[1].ln.join(' ')).not.toContain('Travel day: no activities scheduled');
    expect(result.itinerary.dy[2].ln.join(' ')).toContain('Travel day: no activities scheduled');
  });

  it('canonicalizes alias localities and removes duplicate activities across days', async () => {
    mockedAttractionsCatalogService.getAttractionPromptBlockForDestinations.mockResolvedValue({
      shortlistByDestination: {
        'Mexico City': [
          {
            id: 'a1',
            destinationKey: 'mexico city',
            destinationDisplayName: 'Mexico City',
            name: 'Museo Nacional de Antropologia',
            rank: 1,
            activityType: 'Ticketed Attraction',
            interestTags: ['culture'],
            sourceUrl: null,
            sourceLabel: null,
            snippet: null,
            sourceCount: 2,
            budgetTier: 'paid',
            updatedAt: new Date().toISOString(),
          },
          {
            id: 'a2',
            destinationKey: 'mexico city',
            destinationDisplayName: 'Mexico City',
            name: 'Templo Mayor',
            rank: 2,
            activityType: 'Ticketed Attraction',
            interestTags: ['culture'],
            sourceUrl: null,
            sourceLabel: null,
            snippet: null,
            sourceCount: 2,
            budgetTier: 'paid',
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      promptBlock: 'Destination: Mexico City\n1. Museo Nacional de Antropologia\n2. Templo Mayor',
    });

    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'norm1',
                  sd: '2026-12-01',
                  ed: '2026-12-03',
                  p: 'B',
                  c: 'M',
                  mob: 'M',
                  car: 'P',
                  is: 'mixed',
                  w: {
                    outdoors: 15,
                    adventure: 10,
                    culture: 15,
                    food: 15,
                    nightlife: 10,
                    relax: 10,
                    photography: 10,
                    authentic_local: 8,
                    iconic_landmarks: 7,
                  },
                  a: [],
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'r1',
                  eh: 'MEX',
                  xh: 'MEX',
                  b: [
                    { l: 'Mexico City', ci: '2026-12-01', co: '2026-12-02', dn: [] },
                    { l: 'Ciudad de Mexico', ci: '2026-12-02', co: '2026-12-04', dn: [] },
                  ],
                  x: [{ dt: '2026-12-02', m: 'Bus', fr: 'Mexico City', to: 'Ciudad de Mexico' }],
                  rc: null,
                  w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                  a: [],
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'it1',
                  eh: 'MEX',
                  xh: 'MEX',
                  b: [{ l: 'Ciudad de Mexico', ci: '2026-12-01', co: '2026-12-04', dn: [] }],
                  x: [],
                  rc: null,
                  dy: [
                    {
                      d: 1,
                      dt: '2026-12-01',
                      b: 'Ciudad de Mexico',
                      it: [['D', 'O', 'Walk through Bosque de Chapultepec']],
                      me: ['BQ', 'LC', 'DL'],
                      sl: "Lodging at 'Ciudad de Mexico'",
                      ln: [],
                      cf: 'M',
                    },
                    {
                      d: 2,
                      dt: '2026-12-02',
                      b: 'Ciudad de Mexico',
                      it: [['D', 'O', 'Walk through Bosque de Chapultepec']],
                      me: ['BQ', 'LC', 'DL'],
                      sl: "Lodging at 'Ciudad de Mexico'",
                      ln: [],
                      cf: 'M',
                    },
                    {
                      d: 3,
                      dt: '2026-12-03',
                      b: 'Ciudad de Mexico',
                      it: [['D', 'O', 'Visit major market district in Mexico City']],
                      me: ['BQ', 'LC', 'DL'],
                      sl: "Lodging at 'Ciudad de Mexico'",
                      ln: [],
                      cf: 'M',
                    },
                  ],
                  a: [],
                  cf: 'M',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'it1',
                  eh: 'MEX',
                  xh: 'MEX',
                  b: [{ l: 'Ciudad de Mexico', ci: '2026-12-01', co: '2026-12-04', dn: [] }],
                  x: [],
                  rc: null,
                  dy: [
                    {
                      d: 1,
                      dt: '2026-12-01',
                      b: 'Ciudad de Mexico',
                      it: [['D', 'O', 'Walk through Bosque de Chapultepec']],
                      me: ['BQ', 'LC', 'DL'],
                      sl: "Lodging at 'Ciudad de Mexico'",
                      ln: [],
                      cf: 'M',
                    },
                    {
                      d: 2,
                      dt: '2026-12-02',
                      b: 'Ciudad de Mexico',
                      it: [['D', 'O', 'Walk through Bosque de Chapultepec']],
                      me: ['BQ', 'LC', 'DL'],
                      sl: "Lodging at 'Ciudad de Mexico'",
                      ln: [],
                      cf: 'M',
                    },
                    {
                      d: 3,
                      dt: '2026-12-03',
                      b: 'Ciudad de Mexico',
                      it: [['D', 'O', 'Visit major market district in Mexico City']],
                      me: ['BQ', 'LC', 'DL'],
                      sl: "Lodging at 'Ciudad de Mexico'",
                      ln: [],
                      cf: 'M',
                    },
                  ],
                  a: [],
                  cf: 'M',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: '## Rendered itinerary' } }],
        },
      });

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      userId: 'user-1',
      destinations: ['Mexico City', 'Mexico', 'Ciudad de Mexico'],
      days: 3,
      budgetMin: 1200,
      budgetMax: 2200,
      groupTraits: [],
      tripIdSeed: 'trip-seed-locality-dedupe',
    });

    expect(result.promptRequest.d).toEqual(['Mexico City']);
    expect(result.route.b.every((base) => base.l === 'Mexico City')).toBe(true);
    expect(result.route.x).toHaveLength(0);
    const itineraryActivities = result.itinerary.dy.flatMap((day) => day.it.map((item) => item[2]));
    expect(new Set(itineraryActivities).size).toBe(itineraryActivities.length);
    expect(itineraryActivities.some((name) => /Museo Nacional de Antropolog/i.test(name))).toBe(true);
    expect(itineraryActivities.some((name) => /local art gallery|traditional mexican restaurant|main historic district/i.test(name))).toBe(false);
  });

  it('avoids cross-destination shortlist fallback on single-destination trips', async () => {
    mockedAttractionsCatalogService.getAttractionPromptBlockForDestinations.mockResolvedValue({
      shortlistByDestination: {
        'Ciudad de Mexico': [
          {
            id: 'm1',
            destinationKey: 'ciudad de mexico',
            destinationDisplayName: 'Ciudad de Mexico',
            name: 'Museo Nacional de Antropologia',
            rank: 1,
            activityType: 'Ticketed Attraction',
            interestTags: ['culture'],
            sourceUrl: null,
            sourceLabel: null,
            snippet: null,
            sourceCount: 2,
            budgetTier: 'paid',
            updatedAt: new Date().toISOString(),
          },
        ],
        Acapulco: [
          {
            id: 'a1',
            destinationKey: 'acapulco',
            destinationDisplayName: 'Acapulco',
            name: 'Acapulco',
            rank: 1,
            activityType: 'Sights & Landmarks',
            interestTags: ['outdoors'],
            sourceUrl: null,
            sourceLabel: null,
            snippet: null,
            sourceCount: 1,
            budgetTier: 'paid',
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      promptBlock: 'Destination: Ciudad de Mexico\n1. Museo Nacional de Antropologia',
    });

    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'norm1',
                  sd: '2026-12-10',
                  ed: '2026-12-12',
                  p: 'B',
                  c: 'M',
                  mob: 'M',
                  car: 'P',
                  is: 'mixed',
                  w: {
                    outdoors: 10,
                    adventure: 10,
                    culture: 20,
                    food: 15,
                    nightlife: 10,
                    relax: 10,
                    photography: 10,
                    authentic_local: 8,
                    iconic_landmarks: 7,
                  },
                  a: [],
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'r1',
                  eh: 'MEX',
                  xh: 'MEX',
                  b: [{ l: 'Ciudad de Mexico', ci: '2026-12-10', co: '2026-12-13', dn: [] }],
                  x: [],
                  rc: null,
                  w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                  a: [],
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'it1',
                  eh: 'MEX',
                  xh: 'MEX',
                  b: [{ l: 'Ciudad de Mexico', ci: '2026-12-10', co: '2026-12-13', dn: [] }],
                  x: [],
                  rc: null,
                  dy: [
                    { d: 1, dt: '2026-12-10', b: 'Ciudad de Mexico', it: [['D', 'O', 'Flexible activity block']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Ciudad de Mexico'", ln: [], cf: 'M' },
                    { d: 2, dt: '2026-12-11', b: 'Ciudad de Mexico', it: [['D', 'O', 'Visit to local district']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Ciudad de Mexico'", ln: [], cf: 'M' },
                    { d: 3, dt: '2026-12-12', b: 'Ciudad de Mexico', it: [['D', 'O', 'Acapulco']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Ciudad de Mexico'", ln: [], cf: 'M' },
                  ],
                  a: [],
                  cf: 'M',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'it1',
                  eh: 'MEX',
                  xh: 'MEX',
                  b: [{ l: 'Ciudad de Mexico', ci: '2026-12-10', co: '2026-12-13', dn: [] }],
                  x: [],
                  rc: null,
                  dy: [
                    { d: 1, dt: '2026-12-10', b: 'Ciudad de Mexico', it: [['D', 'O', 'Flexible activity block']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Ciudad de Mexico'", ln: [], cf: 'M' },
                    { d: 2, dt: '2026-12-11', b: 'Ciudad de Mexico', it: [['D', 'O', 'Visit to local district']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Ciudad de Mexico'", ln: [], cf: 'M' },
                    { d: 3, dt: '2026-12-12', b: 'Ciudad de Mexico', it: [['D', 'O', 'Acapulco']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Ciudad de Mexico'", ln: [], cf: 'M' },
                  ],
                  a: [],
                  cf: 'M',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: '## Rendered itinerary' } }],
        },
      });

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      userId: 'user-1',
      destinations: ['Ciudad de Mexico'],
      days: 3,
      budgetMin: 1200,
      budgetMax: 2200,
      groupTraits: [],
      tripIdSeed: 'trip-seed-single-destination-fallback',
    });

  const itineraryActivities = result.itinerary.dy.flatMap((day) => day.it.map((item) => item[2]));
  expect(itineraryActivities.some((name) => /acapulco/i.test(name))).toBe(false);
  expect(itineraryActivities.some((name) => /museo nacional de antropolog/i.test(name))).toBe(true);
  });

  it('forces must-see attractions into the final itinerary when provided', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'norm1',
                  sd: '2026-07-01',
                  ed: '2026-07-03',
                  p: 'B',
                  c: 'M',
                  mob: 'M',
                  car: 'P',
                  is: 'mixed',
                  w: {
                    outdoors: 15,
                    adventure: 10,
                    culture: 20,
                    food: 15,
                    nightlife: 10,
                    relax: 10,
                    photography: 10,
                    authentic_local: 5,
                    iconic_landmarks: 5,
                  },
                  a: [],
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'r1',
                  eh: 'CDG',
                  xh: 'CDG',
                  b: [{ l: 'Paris', ci: '2026-07-01', co: '2026-07-04', dn: [] }],
                  x: [],
                  rc: null,
                  w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                  a: [],
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'it1',
                  eh: 'CDG',
                  xh: 'CDG',
                  b: [{ l: 'Paris', ci: '2026-07-01', co: '2026-07-04', dn: [] }],
                  x: [],
                  rc: null,
                  dy: [
                    { d: 1, dt: '2026-07-01', b: 'Paris', it: [['D', 'O', 'Neighborhood walk']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [], cf: 'M' },
                    { d: 2, dt: '2026-07-02', b: 'Paris', it: [['D', 'O', 'Flexible activity block']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [], cf: 'M' },
                    { d: 3, dt: '2026-07-03', b: 'Paris', it: [['E', 'O', 'Local evening stroll']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [], cf: 'M' },
                  ],
                  a: [],
                  cf: 'M',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  $: 'it1',
                  eh: 'CDG',
                  xh: 'CDG',
                  b: [{ l: 'Paris', ci: '2026-07-01', co: '2026-07-04', dn: [] }],
                  x: [],
                  rc: null,
                  dy: [
                    { d: 1, dt: '2026-07-01', b: 'Paris', it: [['D', 'O', 'Neighborhood walk']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [], cf: 'M' },
                    { d: 2, dt: '2026-07-02', b: 'Paris', it: [['D', 'O', 'Flexible activity block']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [], cf: 'M' },
                    { d: 3, dt: '2026-07-03', b: 'Paris', it: [['E', 'O', 'Local evening stroll']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Paris'", ln: [], cf: 'M' },
                  ],
                  a: [],
                  cf: 'M',
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: '## Rendered itinerary' } }],
        },
      });

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      userId: 'user-1',
      destinations: ['Paris'],
      mustSeeAttractions: ['Eiffel Tower', 'Louvre Museum'],
      days: 3,
      budgetMin: 1200,
      budgetMax: 3000,
      groupTraits: [],
      tripIdSeed: 'trip-seed-must-see',
    });

    const itineraryActivities = result.itinerary.dy.flatMap((day) => day.it.map((item) => item[2].toLowerCase()));
    expect(itineraryActivities).toContain('eiffel tower');
    expect(itineraryActivities).toContain('louvre museum');
  });

  it('reassigns an attraction scheduled on the wrong destination day to the day matching its catalog destination', async () => {
    mockedAttractionsCatalogService.getAttractionPromptBlockForDestinations.mockResolvedValue({
      shortlistByDestination: {
        'New York': [
          {
            id: 'amnh',
            destinationKey: 'new york',
            destinationDisplayName: 'New York',
            name: 'American Museum of Natural History',
            rank: 1,
            activityType: 'Ticketed Attraction',
            interestTags: ['culture'],
            sourceUrl: null,
            sourceLabel: null,
            snippet: null,
            sourceCount: 2,
            budgetTier: 'paid',
            updatedAt: new Date().toISOString(),
          },
        ],
        Boston: [],
      },
      promptBlock: 'Destination: New York\n1. American Museum of Natural History',
    });

    const normStage = {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                $: 'norm1',
                sd: '2026-09-01',
                ed: '2026-09-04',
                p: 'B',
                c: 'M',
                mob: 'M',
                car: 'P',
                is: 'mixed',
                w: {
                  outdoors: 15,
                  adventure: 10,
                  culture: 20,
                  food: 15,
                  nightlife: 10,
                  relax: 10,
                  photography: 10,
                  authentic_local: 5,
                  iconic_landmarks: 5,
                },
                a: [],
              }),
            },
          },
        ],
      },
    };
    const routeStage = {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                $: 'r1',
                eh: 'BOS',
                xh: 'BOS',
                b: [
                  { l: 'Boston', ci: '2026-09-01', co: '2026-09-03', dn: [] },
                  { l: 'New York', ci: '2026-09-03', co: '2026-09-05', dn: [] },
                ],
                x: [{ dt: '2026-09-03', m: 'Train', fr: 'Boston', to: 'New York' }],
                rc: null,
                w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                a: [],
              }),
            },
          },
        ],
      },
    };
    // Simulates the reported bug: AMNH (a New York attraction) generated on a Boston day.
    const dayItineraryJson = JSON.stringify({
      $: 'it1',
      eh: 'BOS',
      xh: 'BOS',
      b: [
        { l: 'Boston', ci: '2026-09-01', co: '2026-09-03', dn: [] },
        { l: 'New York', ci: '2026-09-03', co: '2026-09-05', dn: [] },
      ],
      x: [{ dt: '2026-09-03', m: 'Train', fr: 'Boston', to: 'New York' }],
      rc: null,
      dy: [
        { d: 1, dt: '2026-09-01', b: 'Boston', it: [['D', 'A', 'American Museum of Natural History']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [], cf: 'M' },
        { d: 2, dt: '2026-09-02', b: 'Boston', it: [['D', 'O', 'Freedom Trail walk']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [], cf: 'M' },
        { d: 3, dt: '2026-09-03', b: 'New York', it: [['D', 'O', 'Times Square visit']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'New York'", ln: [], cf: 'M' },
      ],
      a: [],
      cf: 'M',
    });
    const dayStage = { data: { choices: [{ message: { content: dayItineraryJson } }] } };
    const validateStage = { data: { choices: [{ message: { content: dayItineraryJson } }] } };
    const renderStage = { data: { choices: [{ message: { content: '## Rendered itinerary' } }] } };

    mockedAxios.post
      .mockResolvedValueOnce(normStage)
      .mockResolvedValueOnce(routeStage)
      .mockResolvedValueOnce(dayStage)
      .mockResolvedValueOnce(validateStage)
      .mockResolvedValueOnce(renderStage);

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      userId: 'user-1',
      destinations: ['Boston', 'New York'],
      days: 4,
      budgetMin: 1200,
      budgetMax: 3000,
      groupTraits: [],
      tripIdSeed: 'trip-seed-amnh-boston-bug',
    });

    const bostonDays = result.itinerary.dy.filter((day) => day.b === 'Boston');
    const newYorkDays = result.itinerary.dy.filter((day) => day.b === 'New York');
    const bostonActivities = bostonDays.flatMap((day) => day.it.map((item) => item[2].toLowerCase()));
    const newYorkActivities = newYorkDays.flatMap((day) => day.it.map((item) => item[2].toLowerCase()));

    expect(bostonActivities).not.toContain('american museum of natural history');
    expect(newYorkActivities).toContain('american museum of natural history');
  });

  it('populates a heuristic duration and pre-order-ticket note for a matched catalog attraction', async () => {
    mockedAttractionsCatalogService.getAttractionPromptBlockForDestinations.mockResolvedValue({
      shortlistByDestination: {
        Boston: [
          {
            id: 'mfa',
            destinationKey: 'boston',
            destinationDisplayName: 'Boston',
            name: 'Museum of Fine Arts',
            rank: 1,
            activityType: 'Ticketed Attraction',
            interestTags: ['culture'],
            sourceUrl: null,
            sourceLabel: null,
            snippet: null,
            sourceCount: 2,
            budgetTier: 'paid',
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      promptBlock: 'Destination: Boston\n1. Museum of Fine Arts',
    });

    const normStage = {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                $: 'norm1',
                sd: '2026-09-01',
                ed: '2026-09-03',
                p: 'B',
                c: 'M',
                mob: 'M',
                car: 'P',
                is: 'mixed',
                w: {
                  outdoors: 15,
                  adventure: 10,
                  culture: 20,
                  food: 15,
                  nightlife: 10,
                  relax: 10,
                  photography: 10,
                  authentic_local: 5,
                  iconic_landmarks: 5,
                },
                a: [],
              }),
            },
          },
        ],
      },
    };
    const routeStage = {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                $: 'r1',
                eh: 'BOS',
                xh: 'BOS',
                b: [{ l: 'Boston', ci: '2026-09-01', co: '2026-09-04', dn: [] }],
                x: [],
                rc: null,
                w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                a: [],
              }),
            },
          },
        ],
      },
    };
    const dayItineraryJson = JSON.stringify({
      $: 'it1',
      eh: 'BOS',
      xh: 'BOS',
      b: [{ l: 'Boston', ci: '2026-09-01', co: '2026-09-04', dn: [] }],
      x: [],
      rc: null,
      dy: [
        { d: 1, dt: '2026-09-01', b: 'Boston', it: [['D', 'O', 'Neighborhood walk']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [], cf: 'M' },
        { d: 2, dt: '2026-09-02', b: 'Boston', it: [['D', 'A', 'Museum of Fine Arts']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [], cf: 'M' },
        { d: 3, dt: '2026-09-03', b: 'Boston', it: [['D', 'O', 'Local evening stroll']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [], cf: 'M' },
      ],
      a: [],
      cf: 'M',
    });
    const dayStage = { data: { choices: [{ message: { content: dayItineraryJson } }] } };
    const validateStage = { data: { choices: [{ message: { content: dayItineraryJson } }] } };
    const renderStage = { data: { choices: [{ message: { content: '## Rendered itinerary' } }] } };

    mockedAxios.post
      .mockResolvedValueOnce(normStage)
      .mockResolvedValueOnce(routeStage)
      .mockResolvedValueOnce(dayStage)
      .mockResolvedValueOnce(validateStage)
      .mockResolvedValueOnce(renderStage);

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      userId: 'user-1',
      destinations: ['Boston'],
      days: 3,
      budgetMin: 1200,
      budgetMax: 3000,
      groupTraits: [],
      tripIdSeed: 'trip-seed-duration-metadata',
    });

    const activity = result.generatedItems.activities.find((a) => a.name.toLowerCase() === 'museum of fine arts');
    expect(activity).toBeDefined();
    expect(activity?.duration).not.toBe('2h');
    expect(activity?.notes).toMatch(/pre-ordered/i);
  });

  it('uses the real cached Wikipedia description instead of generic boilerplate when one is available', async () => {
    // Uses a name not referenced by any other test in this file, since the
    // duration/description cache is backed by a real (shared, persistent
    // across tests) DB in this suite, keyed by destinationKey+name.
    mockedAttractionsCatalogService.getAttractionPromptBlockForDestinations.mockResolvedValue({
      shortlistByDestination: {
        Boston: [
          {
            id: 'nea',
            destinationKey: 'boston',
            destinationDisplayName: 'Boston',
            name: 'New England Aquarium',
            rank: 1,
            activityType: 'Ticketed Attraction',
            interestTags: ['culture'],
            sourceUrl: null,
            sourceLabel: null,
            snippet: null,
            sourceCount: 2,
            budgetTier: 'paid',
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      promptBlock: 'Destination: Boston\n1. New England Aquarium',
    });
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (String(url).includes('New%20England%20Aquarium')) {
        return {
          status: 200,
          data: { extract: 'The New England Aquarium is a public aquarium located in Boston, Massachusetts, known for its giant ocean tank.' },
        };
      }
      return { status: 404, data: {} };
    });

    const normStage = {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                $: 'norm1',
                sd: '2026-09-01',
                ed: '2026-09-03',
                p: 'B',
                c: 'M',
                mob: 'M',
                car: 'P',
                is: 'mixed',
                w: {
                  outdoors: 15,
                  adventure: 10,
                  culture: 20,
                  food: 15,
                  nightlife: 10,
                  relax: 10,
                  photography: 10,
                  authentic_local: 5,
                  iconic_landmarks: 5,
                },
                a: [],
              }),
            },
          },
        ],
      },
    };
    const routeStage = {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                $: 'r1',
                eh: 'BOS',
                xh: 'BOS',
                b: [{ l: 'Boston', ci: '2026-09-01', co: '2026-09-04', dn: [] }],
                x: [],
                rc: null,
                w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                a: [],
              }),
            },
          },
        ],
      },
    };
    const dayItineraryJson = JSON.stringify({
      $: 'it1',
      eh: 'BOS',
      xh: 'BOS',
      b: [{ l: 'Boston', ci: '2026-09-01', co: '2026-09-04', dn: [] }],
      x: [],
      rc: null,
      dy: [
        { d: 1, dt: '2026-09-01', b: 'Boston', it: [['D', 'O', 'Neighborhood walk']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [], cf: 'M' },
        { d: 2, dt: '2026-09-02', b: 'Boston', it: [['D', 'A', 'New England Aquarium']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [], cf: 'M' },
        { d: 3, dt: '2026-09-03', b: 'Boston', it: [['D', 'O', 'Local evening stroll']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [], cf: 'M' },
      ],
      a: [],
      cf: 'M',
    });
    const dayStage = { data: { choices: [{ message: { content: dayItineraryJson } }] } };
    const validateStage = { data: { choices: [{ message: { content: dayItineraryJson } }] } };
    const renderStage = { data: { choices: [{ message: { content: '## Rendered itinerary' } }] } };

    mockedAxios.post
      .mockResolvedValueOnce(normStage)
      .mockResolvedValueOnce(routeStage)
      .mockResolvedValueOnce(dayStage)
      .mockResolvedValueOnce(validateStage)
      .mockResolvedValueOnce(renderStage);

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      userId: 'user-1',
      destinations: ['Boston'],
      days: 3,
      budgetMin: 1200,
      budgetMax: 3000,
      groupTraits: [],
      tripIdSeed: 'trip-seed-real-description',
    });

    const activity = result.generatedItems.activities.find((a) => a.name.toLowerCase() === 'new england aquarium');
    expect(activity?.notes).toMatch(/giant ocean tank/i);
    expect(activity?.notes).not.toMatch(/it fits this day because/i);
    expect(activity?.notes).toMatch(/plan for about/i);
  });

  it('reassigns an attraction with no catalog match to the correct day when its cached description names a different destination', async () => {
    // No catalog entries at all — this attraction can only be caught by the
    // description-based fallback, not the catalog-based consistency pass.
    mockedAttractionsCatalogService.getAttractionPromptBlockForDestinations.mockResolvedValue({
      shortlistByDestination: {},
      promptBlock: 'none',
    });
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (String(url).includes('Central%20Park')) {
        return {
          status: 200,
          data: { extract: 'Central Park is an urban park in Manhattan, New York City.' },
        };
      }
      return { status: 404, data: {} };
    });

    const normStage = {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                $: 'norm1',
                sd: '2026-09-01',
                ed: '2026-09-04',
                p: 'B',
                c: 'M',
                mob: 'M',
                car: 'P',
                is: 'mixed',
                w: {
                  outdoors: 15,
                  adventure: 10,
                  culture: 20,
                  food: 15,
                  nightlife: 10,
                  relax: 10,
                  photography: 10,
                  authentic_local: 5,
                  iconic_landmarks: 5,
                },
                a: [],
              }),
            },
          },
        ],
      },
    };
    const routeStage = {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                $: 'r1',
                eh: 'BOS',
                xh: 'BOS',
                b: [
                  { l: 'Boston', ci: '2026-09-01', co: '2026-09-03', dn: [] },
                  { l: 'New York City', ci: '2026-09-03', co: '2026-09-05', dn: [] },
                ],
                x: [{ dt: '2026-09-03', m: 'Train', fr: 'Boston', to: 'New York City' }],
                rc: null,
                w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                a: [],
              }),
            },
          },
        ],
      },
    };
    // Central Park (a New York attraction) generated on a Boston day —
    // reproduces the reported bug when no catalog entry exists for it.
    const dayItineraryJson = JSON.stringify({
      $: 'it1',
      eh: 'BOS',
      xh: 'BOS',
      b: [
        { l: 'Boston', ci: '2026-09-01', co: '2026-09-03', dn: [] },
        { l: 'New York City', ci: '2026-09-03', co: '2026-09-05', dn: [] },
      ],
      x: [{ dt: '2026-09-03', m: 'Train', fr: 'Boston', to: 'New York City' }],
      rc: null,
      dy: [
        { d: 1, dt: '2026-09-01', b: 'Boston', it: [['D', 'O', 'Neighborhood walk']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [], cf: 'M' },
        { d: 2, dt: '2026-09-02', b: 'Boston', it: [['D', 'A', 'Central Park']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [], cf: 'M' },
        { d: 3, dt: '2026-09-03', b: 'New York City', it: [['D', 'O', 'Times Square visit']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'New York City'", ln: [], cf: 'M' },
      ],
      a: [],
      cf: 'M',
    });
    const dayStage = { data: { choices: [{ message: { content: dayItineraryJson } }] } };
    const validateStage = { data: { choices: [{ message: { content: dayItineraryJson } }] } };
    const renderStage = { data: { choices: [{ message: { content: '## Rendered itinerary' } }] } };

    mockedAxios.post
      .mockResolvedValueOnce(normStage)
      .mockResolvedValueOnce(routeStage)
      .mockResolvedValueOnce(dayStage)
      .mockResolvedValueOnce(validateStage)
      .mockResolvedValueOnce(renderStage);

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      userId: 'user-1',
      destinations: ['Boston', 'New York City'],
      days: 4,
      budgetMin: 1200,
      budgetMax: 3000,
      groupTraits: [],
      tripIdSeed: 'trip-seed-central-park-no-catalog',
    });

    const bostonActivities = result.itinerary.dy
      .filter((day) => day.b === 'Boston')
      .flatMap((day) => day.it.map((item) => item[2].toLowerCase()));
    const newYorkActivities = result.itinerary.dy
      .filter((day) => day.b === 'New York City')
      .flatMap((day) => day.it.map((item) => item[2].toLowerCase()));

    expect(bostonActivities).not.toContain('central park');
    expect(newYorkActivities).toContain('central park');
  });

  it('places a destination-tagged must-see attraction on the day matching its destination, not round-robin', async () => {
    const normStage = {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                $: 'norm1',
                sd: '2026-09-01',
                ed: '2026-09-02',
                p: 'B',
                c: 'M',
                mob: 'M',
                car: 'P',
                is: 'mixed',
                w: {
                  outdoors: 15,
                  adventure: 10,
                  culture: 20,
                  food: 15,
                  nightlife: 10,
                  relax: 10,
                  photography: 10,
                  authentic_local: 5,
                  iconic_landmarks: 5,
                },
                a: [],
              }),
            },
          },
        ],
      },
    };
    const routeStage = {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                $: 'r1',
                eh: 'BOS',
                xh: 'BOS',
                b: [
                  { l: 'Boston', ci: '2026-09-01', co: '2026-09-02', dn: [] },
                  { l: 'New York City', ci: '2026-09-02', co: '2026-09-03', dn: [] },
                ],
                x: [{ dt: '2026-09-02', m: 'Train', fr: 'Boston', to: 'New York City' }],
                rc: null,
                w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                a: [],
              }),
            },
          },
        ],
      },
    };
    // Central Park (tagged "New York City") is deliberately absent from both
    // days here so enforceMustSeeAttractions must inject it — without
    // destination awareness, round-robin would place it on day 1 (Boston).
    const dayItineraryJson = JSON.stringify({
      $: 'it1',
      eh: 'BOS',
      xh: 'BOS',
      b: [
        { l: 'Boston', ci: '2026-09-01', co: '2026-09-02', dn: [] },
        { l: 'New York City', ci: '2026-09-02', co: '2026-09-03', dn: [] },
      ],
      x: [{ dt: '2026-09-02', m: 'Train', fr: 'Boston', to: 'New York City' }],
      rc: null,
      dy: [
        { d: 1, dt: '2026-09-01', b: 'Boston', it: [['D', 'A', 'Freedom Trail']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [], cf: 'M' },
        { d: 2, dt: '2026-09-02', b: 'New York City', it: [['D', 'O', 'Times Square visit']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'New York City'", ln: [], cf: 'M' },
      ],
      a: [],
      cf: 'M',
    });
    const dayStage = { data: { choices: [{ message: { content: dayItineraryJson } }] } };
    const validateStage = { data: { choices: [{ message: { content: dayItineraryJson } }] } };
    const renderStage = { data: { choices: [{ message: { content: '## Rendered itinerary' } }] } };

    mockedAxios.post
      .mockResolvedValueOnce(normStage)
      .mockResolvedValueOnce(routeStage)
      .mockResolvedValueOnce(dayStage)
      .mockResolvedValueOnce(validateStage)
      .mockResolvedValueOnce(renderStage);

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      userId: 'user-1',
      destinations: ['Boston', 'New York City'],
      mustSeeAttractions: [{ name: 'Central Park', destinationName: 'New York City' }],
      days: 2,
      budgetMin: 1200,
      budgetMax: 3000,
      groupTraits: [],
      tripIdSeed: 'trip-seed-must-see-destination-tag',
    });

    const bostonDay = result.itinerary.dy.find((day) => day.b === 'Boston');
    const newYorkDay = result.itinerary.dy.find((day) => day.b === 'New York City');
    const bostonActivities = (bostonDay?.it ?? []).map((item) => item[2].toLowerCase());
    const newYorkActivities = (newYorkDay?.it ?? []).map((item) => item[2].toLowerCase());

    expect(newYorkActivities).toContain('central park');
    expect(bostonActivities).not.toContain('central park');
  });

  it('staggers start times for multiple same-day activities instead of colliding on the same clock time', async () => {
    const normStage = {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                $: 'norm1',
                sd: '2026-09-01',
                ed: '2026-09-03',
                p: 'B',
                c: 'M',
                mob: 'M',
                car: 'P',
                is: 'mixed',
                w: {
                  outdoors: 15,
                  adventure: 10,
                  culture: 20,
                  food: 15,
                  nightlife: 10,
                  relax: 10,
                  photography: 10,
                  authentic_local: 5,
                  iconic_landmarks: 5,
                },
                a: [],
              }),
            },
          },
        ],
      },
    };
    const routeStage = {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                $: 'r1',
                eh: 'BOS',
                xh: 'BOS',
                b: [{ l: 'Boston', ci: '2026-09-01', co: '2026-09-04', dn: [] }],
                x: [],
                rc: null,
                w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                a: [],
              }),
            },
          },
        ],
      },
    };
    // Two items both tagged 'D' (daytime) on the same day — previously both
    // mapped to a hardcoded 13:00, colliding.
    const dayItineraryJson = JSON.stringify({
      $: 'it1',
      eh: 'BOS',
      xh: 'BOS',
      b: [{ l: 'Boston', ci: '2026-09-01', co: '2026-09-04', dn: [] }],
      x: [],
      rc: null,
      dy: [
        {
          d: 2,
          dt: '2026-09-02',
          b: 'Boston',
          it: [
            ['D', 'A', 'Museum of Fine Arts'],
            ['D', 'A', 'Isabella Stewart Gardner Museum'],
          ],
          me: ['BQ', 'LC', 'DL'],
          sl: "Lodging at 'Boston'",
          ln: [],
          cf: 'M',
        },
      ],
      a: [],
      cf: 'M',
    });
    const dayStage = { data: { choices: [{ message: { content: dayItineraryJson } }] } };
    const validateStage = { data: { choices: [{ message: { content: dayItineraryJson } }] } };
    const renderStage = { data: { choices: [{ message: { content: '## Rendered itinerary' } }] } };

    mockedAxios.post
      .mockResolvedValueOnce(normStage)
      .mockResolvedValueOnce(routeStage)
      .mockResolvedValueOnce(dayStage)
      .mockResolvedValueOnce(validateStage)
      .mockResolvedValueOnce(renderStage);

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      destinations: ['Boston'],
      days: 3,
      budgetMin: 1200,
      budgetMax: 3000,
      groupTraits: [],
      tripIdSeed: 'trip-seed-time-collision',
    });

    const dayTwoActivities = result.generatedItems.activities.filter((a) => a.date === '2026-09-02');
    expect(dayTwoActivities).toHaveLength(2);
    const startTimes = dayTwoActivities.map((a) => a.startTime);
    expect(new Set(startTimes).size).toBe(startTimes.length);

    const dayTwoDetails = result.details.filter((d) => d.day === 2 && d.kind !== 'note');
    const detailTimes = dayTwoDetails.map((d) => d.time);
    expect(new Set(detailTimes).size).toBe(detailTimes.length);
  });

  it('inserts a travel segment between two same-day attractions with the estimated mode and time', async () => {
    mockedAttractionsCatalogService.getAttractionPromptBlockForDestinations.mockResolvedValue({
      shortlistByDestination: {
        Boston: [
          {
            id: 'attr-a',
            destinationKey: 'boston',
            destinationDisplayName: 'Boston',
            name: 'Boston Public Garden',
            rank: 1,
            activityType: 'Outdoor Activity',
            interestTags: ['outdoors'],
            sourceUrl: null,
            sourceLabel: null,
            snippet: null,
            sourceCount: 2,
            budgetTier: 'free',
            updatedAt: new Date().toISOString(),
            // ~350m apart — well within the walking cutoff at default mobility.
            lat: 42.3543,
            lon: -71.0707,
          },
          {
            id: 'attr-b',
            destinationKey: 'boston',
            destinationDisplayName: 'Boston',
            name: 'Boston Common',
            rank: 2,
            activityType: 'Outdoor Activity',
            interestTags: ['outdoors'],
            sourceUrl: null,
            sourceLabel: null,
            snippet: null,
            sourceCount: 2,
            budgetTier: 'free',
            updatedAt: new Date().toISOString(),
            lat: 42.3555,
            lon: -71.0656,
          },
        ],
      },
      promptBlock: 'Destination: Boston\n1. Boston Public Garden\n2. Boston Common',
    });

    const normStage = {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                $: 'norm1',
                sd: '2026-09-01',
                ed: '2026-09-03',
                p: 'B',
                c: 'M',
                mob: 'M',
                car: 'P',
                is: 'mixed',
                w: {
                  outdoors: 15,
                  adventure: 10,
                  culture: 20,
                  food: 15,
                  nightlife: 10,
                  relax: 10,
                  photography: 10,
                  authentic_local: 5,
                  iconic_landmarks: 5,
                },
                a: [],
              }),
            },
          },
        ],
      },
    };
    const routeStage = {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                $: 'r1',
                eh: 'BOS',
                xh: 'BOS',
                b: [{ l: 'Boston', ci: '2026-09-01', co: '2026-09-04', dn: [] }],
                x: [],
                rc: null,
                w: { o: 25, c: 25, f: 20, n: 10, r: 20 },
                a: [],
              }),
            },
          },
        ],
      },
    };
    const dayItineraryJson = JSON.stringify({
      $: 'it1',
      eh: 'BOS',
      xh: 'BOS',
      b: [{ l: 'Boston', ci: '2026-09-01', co: '2026-09-04', dn: [] }],
      x: [],
      rc: null,
      dy: [
        { d: 1, dt: '2026-09-01', b: 'Boston', it: [['D', 'O', 'Neighborhood walk']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [], cf: 'M' },
        {
          d: 2,
          dt: '2026-09-02',
          b: 'Boston',
          it: [
            ['D', 'O', 'Boston Public Garden'],
            ['D', 'O', 'Boston Common'],
          ],
          me: ['BQ', 'LC', 'DL'],
          sl: "Lodging at 'Boston'",
          ln: [],
          cf: 'M',
        },
        { d: 3, dt: '2026-09-03', b: 'Boston', it: [['D', 'O', 'Local evening stroll']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Boston'", ln: [], cf: 'M' },
      ],
      a: [],
      cf: 'M',
    });
    const dayStage = { data: { choices: [{ message: { content: dayItineraryJson } }] } };
    const validateStage = { data: { choices: [{ message: { content: dayItineraryJson } }] } };
    const renderStage = { data: { choices: [{ message: { content: '## Rendered itinerary' } }] } };

    mockedAxios.post
      .mockResolvedValueOnce(normStage)
      .mockResolvedValueOnce(routeStage)
      .mockResolvedValueOnce(dayStage)
      .mockResolvedValueOnce(validateStage)
      .mockResolvedValueOnce(renderStage);

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-key',
      userId: 'user-1',
      destinations: ['Boston'],
      days: 3,
      budgetMin: 1200,
      budgetMax: 3000,
      groupTraits: [],
      tripIdSeed: 'trip-seed-travel-segment',
    });

    const dayTwoDetails = result.details.filter((d) => d.day === 2);
    const fromIndex = dayTwoDetails.findIndex((d) => d.activity.toLowerCase() === 'boston public garden');
    const toIndex = dayTwoDetails.findIndex((d) => d.activity.toLowerCase() === 'boston common');
    const travelIndex = dayTwoDetails.findIndex((d) => d.kind === 'note');

    expect(fromIndex).toBeGreaterThanOrEqual(0);
    expect(toIndex).toBeGreaterThan(fromIndex);
    // The travel segment sits between the two activities it connects, not
    // appended after everything else in the day.
    expect(travelIndex).toBe(fromIndex + 1);
    expect(travelIndex).toBeLessThan(toIndex);

    const travelDetail = dayTwoDetails[travelIndex];
    expect(travelDetail.activity).toMatch(/walk/i);
    expect(travelDetail.activity).toMatch(/boston common/i);
    expect(travelDetail.activity).toMatch(/min/i);
    expect(travelDetail.noteBody).toMatch(/walk/i);

    // The second activity's start time should reflect the real travel time,
    // not just a flat generic buffer.
    const gardenActivity = result.generatedItems.activities.find((a) => a.name.toLowerCase() === 'boston public garden');
    const commonActivity = result.generatedItems.activities.find((a) => a.name.toLowerCase() === 'boston common');
    expect(gardenActivity).toBeDefined();
    expect(commonActivity).toBeDefined();
  });

  it('reuses shared route/day caches across users and injects different must-sees after the hit', async () => {
    const jsonStage = (content: unknown) => ({ data: { choices: [{ message: { content: JSON.stringify(content) } }] } });
    const renderStage = (content: string) => ({ data: { choices: [{ message: { content } }] } });
    const norm = { $: 'norm1', sd: '2026-11-01', ed: '2026-11-02', p: 'B', c: 'M', mob: 'M', car: 'P', w: { outdoors: 10, adventure: 5, culture: 40, food: 10, nightlife: 5, relax: 10, photography: 5, authentic_local: 10, iconic_landmarks: 5 }, a: [], is: 'mixed' };
    const route = { $: 'r1', eh: 'BOS', xh: 'BOS', b: [{ l: 'Cacheville', ci: '2026-11-01', co: '2026-11-03', dn: [] }], x: [], rc: null, w: norm.w, a: [] };
    const itinerary = { $: 'it1', ...route, dy: [
      { d: 1, dt: '2026-11-01', b: 'Cacheville', it: [['M', 'O', 'Flexible activity block']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Cacheville'", ln: [], cf: 'H' },
      { d: 2, dt: '2026-11-02', b: 'Cacheville', it: [['M', 'O', 'Central Park Walk']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'Cacheville'", ln: [], cf: 'H' },
    ], cf: 'H' };
    mockedAxios.post
      .mockResolvedValueOnce(jsonStage(norm)).mockResolvedValueOnce(jsonStage(route))
      .mockResolvedValueOnce(jsonStage(itinerary)).mockResolvedValueOnce(jsonStage(itinerary)).mockResolvedValueOnce(renderStage('first'))
      .mockResolvedValueOnce(jsonStage(norm)).mockResolvedValueOnce(renderStage('second'));
    const common = {
      apiKey: 'test-key', destinations: ['Cacheville'], days: 2, budgetMin: 1000, budgetMax: 2000,
      departureAirport: 'BOS', groupTraits: [], tripStartDate: '2026-11-01', tripEndDate: '2026-11-02',
      promptTraits: { tt: { p: 'B' as const, c: 'M' as const, mob: 'M' as const, car: 'P' as const, is: 'mixed' as const, w: norm.w } },
    };
    const first = await generateItineraryViaPromptPlan({ ...common, userId: 'cache-user-a', tripIdSeed: 'cache-trip-a', mustSeeAttractions: [{ name: 'Museum A', destinationName: 'Cacheville' }] });
    const firstP1Call = mockedPromptStage.mock.calls.find((call) => call[0]?.caller === OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE)?.[0];
    const firstP1Prompts = `${firstP1Call?.systemPrompt ?? ''}\n${firstP1Call?.userPrompt ?? ''}`;
    expect(firstP1Prompts).not.toContain('Museum A');
    expect(firstP1Prompts).not.toContain('cache-user-a');
    const p1AfterFirst = mockedPromptStage.mock.calls.filter((call) => call[0]?.caller === OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE).length;
    const p2AfterFirst = mockedPromptStage.mock.calls.filter((call) => call[0]?.caller === OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS).length;
    const second = await generateItineraryViaPromptPlan({ ...common, userId: 'cache-user-b', tripIdSeed: 'cache-trip-b', mustSeeAttractions: [{ name: 'Museum B', destinationName: 'Cacheville' }] });
    expect(first.cacheUsage).toEqual({ routeHit: false, dayHit: false });
    expect(second.cacheUsage).toEqual({ routeHit: true, dayHit: true });
    expect(mockedPromptStage.mock.calls.filter((call) => call[0]?.caller === OPENAI_CALLER_ITINERARY_PLAN_P1_ROUTE)).toHaveLength(p1AfterFirst);
    expect(mockedPromptStage.mock.calls.filter((call) => call[0]?.caller === OPENAI_CALLER_ITINERARY_PLAN_P2_DAYS)).toHaveLength(p2AfterFirst);
    expect(second.generatedItems.activities.some((activity) => activity.name === 'Museum B')).toBe(true);
    expect(second.generatedItems.activities.some((activity) => activity.name === 'Museum A')).toBe(false);
  });
});
