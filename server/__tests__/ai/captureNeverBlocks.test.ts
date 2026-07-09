/// <reference types="jest" />
/// <reference types="node" />

import axios from 'axios';
import { generateItineraryViaPromptPlan } from '../../src/services/itineraryPromptPlanService';
import { captureAiInteraction } from '../../src/ai/capture/captureService';

jest.mock('axios');
jest.mock('../../src/apis/openaiCallers', () => {
  const actual = jest.requireActual('../../src/apis/openaiCallers');
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
jest.mock('../../src/services/attractionsCatalogService', () => ({
  getAttractionPromptBlockForDestinations: jest.fn(async () => ({
    shortlistByDestination: {},
    promptBlock: 'none',
  })),
}));
jest.mock('../../src/ai/capture/captureService', () => ({
  captureAiInteraction: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedCaptureAiInteraction = captureAiInteraction as jest.MockedFunction<typeof captureAiInteraction>;

const jsonResponse = (content: unknown) => ({
  data: {
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  },
});

describe('AI capture never blocks user-facing work', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
    mockedCaptureAiInteraction.mockReset();
  });

  it('still completes itinerary generation when capture scheduling throws', async () => {
    mockedCaptureAiInteraction.mockImplementation(() => {
      throw new Error('capture failed');
    });
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

  it('captures completed stages when a later stage throws mid-pipeline', async () => {
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
      .mockRejectedValueOnce(new Error('network blip'));

    await expect(
      generateItineraryViaPromptPlan({
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
      })
    ).rejects.toThrow('network blip');

    expect(mockedCaptureAiInteraction).toHaveBeenCalledTimes(1);
    const record = mockedCaptureAiInteraction.mock.calls[0][0];
    expect(record.outcome).toBe('failure');
    const stages = (record.payload as { stages?: unknown[] }).stages;
    expect(Array.isArray(stages)).toBe(true);
    // The P0 norm stage succeeded before the P1 route stage's network error —
    // that completed stage must still show up in the failure capture.
    expect((stages as any[]).length).toBeGreaterThanOrEqual(1);
    expect((record.payload as { error?: string }).error).toContain('network blip');
  });
});
