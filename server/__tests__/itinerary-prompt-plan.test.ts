import axios from 'axios';
import { generateItineraryViaPromptPlan } from '../src/services/itineraryPromptPlanService';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('itinerary prompt plan service', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
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
        tt: { p: 'F', c: 'L', mob: 'H', car: 'R', w: { o: 40, c: 20, f: 20, n: 10, r: 10 }, tm: 'E' },
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
    expect(result.profile.tripMode).toBe('Explorer');
    expect(result.generatedItems.transfers[0].status).toBe('Needed');
    expect(result.generatedItems.transfers[0].transferType).toBe('Bus');
    expect(result.generatedItems.activities[0].activityType).toBe('Ticketed Attraction');
    expect(result.generatedItems.activities[1].activityType).toBe('Reservation');
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
        tt: { p: 'B', c: 'M', mob: 'M', car: 'P', w: { o: 25, c: 25, f: 20, n: 10, r: 20 }, tm: 'B' },
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
        tt: { p: 'B', c: 'M', mob: 'M', car: 'P', w: { o: 25, c: 25, f: 20, n: 10, r: 20 }, tm: 'B' },
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

    expect(result.generatedItems.activities).toHaveLength(0);
    expect(result.itinerary.dy[0].ln.join(' ')).toContain('Travel day: no activities scheduled');
    expect(result.itinerary.dy[1].ln.join(' ')).toContain('Travel day: no activities scheduled');
    expect(result.itinerary.dy[2].ln.join(' ')).toContain('Travel day: no activities scheduled');
  });
});
