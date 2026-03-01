import axios from 'axios';
import { generateItineraryViaPromptPlan } from '../src/services/itineraryPromptPlanService';
import * as attractionsCatalogService from '../src/services/attractionsCatalogService';

jest.mock('axios');
jest.mock('../src/services/attractionsCatalogService', () => ({
  getAttractionPromptBlockForDestinations: jest.fn(async () => ({ shortlistByDestination: {}, promptBlock: 'none' })),
}));
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedAttractionsCatalogService = attractionsCatalogService as jest.Mocked<typeof attractionsCatalogService>;

describe('itinerary prompt plan service', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
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
    expect(result.profile.mobility).toBe('High');
    expect(result.profile.carPreference).toBe('FullTripRental');
    expect(result.profile.interactionStyle).toBe('Guided');
    expect(result.generatedItems.transfers[0].status).toBe('Needed');
    expect(result.generatedItems.transfers[0].transferType).toBe('Bus');
    expect(result.generatedItems.activities.length).toBeGreaterThanOrEqual(2);
    expect(result.generatedItems.activities[0].status).toBe('Proposed');
    expect(result.generatedItems.activities[1].status).toBe('Proposed');
    expect(result.generatedItems.carRentals[0].status).toBe('Needed');
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
});
