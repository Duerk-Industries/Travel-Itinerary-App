/// <reference types="jest" />
/// <reference types="node" />

import axios from 'axios';
import { generateItineraryViaPromptPlan } from '../../src/services/itineraryPromptPlanService';

jest.mock('axios');
jest.mock('../../src/services/attractionsCatalogService', () => ({
  getAttractionPromptBlockForDestinations: jest.fn(async () => ({
    shortlistByDestination: {},
    promptBlock: 'none',
  })),
}));
jest.mock('../../src/ai/capture/captureService', () => ({
  captureAiInteraction: jest.fn(() => {
    throw new Error('capture failed');
  }),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

const jsonResponse = (content: unknown) => ({
  data: {
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  },
});

describe('AI capture never blocks user-facing work', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
  });

  it('still completes itinerary generation when capture scheduling throws', async () => {
    mockedAxios.post
      .mockResolvedValueOnce(jsonResponse({
        $: 'norm1',
        sd: '2026-09-01',
        ed: '2026-09-02',
        p: 'B',
        c: 'M',
        mob: 'M',
        car: 'P',
        w: { outdoors: 15, adventure: 10, culture: 15, food: 15, nightlife: 10, relax: 10, photography: 10, authentic_local: 8, iconic_landmarks: 7 },
        a: [],
        is: 'mixed',
      }))
      .mockResolvedValueOnce(jsonResponse({
        $: 'r1',
        eh: 'JFK',
        xh: 'JFK',
        b: [{ l: 'New York', ci: '2026-09-01', co: '2026-09-03', dn: [] }],
        x: [],
        rc: null,
        w: { outdoors: 15, adventure: 10, culture: 15, food: 15, nightlife: 10, relax: 10, photography: 10, authentic_local: 8, iconic_landmarks: 7 },
        a: [],
      }))
      .mockResolvedValueOnce(jsonResponse({
        $: 'it1',
        eh: 'JFK',
        xh: 'JFK',
        b: [{ l: 'New York', ci: '2026-09-01', co: '2026-09-03', dn: [] }],
        x: [],
        rc: null,
        dy: [{ d: 1, dt: '2026-09-01', b: 'New York', it: [['D', 'O', 'Central Park walk']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'New York'", ln: [], cf: 'M' }],
        a: [],
        cf: 'M',
      }))
      .mockResolvedValueOnce(jsonResponse({
        $: 'it1',
        eh: 'JFK',
        xh: 'JFK',
        b: [{ l: 'New York', ci: '2026-09-01', co: '2026-09-03', dn: [] }],
        x: [],
        rc: null,
        dy: [{ d: 1, dt: '2026-09-01', b: 'New York', it: [['D', 'O', 'Central Park walk']], me: ['BQ', 'LC', 'DL'], sl: "Lodging at 'New York'", ln: [], cf: 'M' }],
        a: [],
        cf: 'M',
      }))
      .mockResolvedValueOnce(jsonResponse('## Captured itinerary result'));

    const result = await generateItineraryViaPromptPlan({
      apiKey: 'test-openai-key',
      userId: 'user-1',
      usageWindowKey: '2026-09',
      destinations: ['New York'],
      days: 2,
      budgetMin: 100,
      budgetMax: 500,
      groupTraits: [],
      tripIdSeed: 'trip-1',
      captureId: 'job-1',
    });

    expect(result.planMarkdown).toContain('Captured itinerary result');
    expect(result.details.length).toBeGreaterThan(0);
  });
});
