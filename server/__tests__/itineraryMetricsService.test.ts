/// <reference types="jest" />

import { persistItineraryGenerationMetrics } from '../src/services/itineraryMetricsService';
import { recordItineraryGenerationMetrics } from '../src/db';

jest.mock('../src/db', () => ({
  recordItineraryGenerationMetrics: jest.fn(async () => undefined),
}));

const save = recordItineraryGenerationMetrics as jest.MockedFunction<typeof recordItineraryGenerationMetrics>;

describe('itinerary metrics persistence', () => {
  beforeEach(() => {
    save.mockClear();
    process.env.ITINERARY_METRICS_CAPTURE = '1';
  });

  afterEach(() => {
    delete process.env.ITINERARY_METRICS_CAPTURE;
  });

  it('writes de-identified stage and token metrics without raw prompts', async () => {
    persistItineraryGenerationMetrics({
      generationId: 'generation-1',
      tripId: 'trip-1',
      userId: 'user-1',
      outcome: 'success',
      tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      stages: [{
        stage: 'p2', callerId: 'caller', startedAt: '', completedAt: '', latencyMs: 12,
        outcome: 'success', promptTokens: 10, completionTokens: 5, responseChars: 20,
        systemPrompt: 'private prompt', userPrompt: 'private user prompt',
      }],
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(save).toHaveBeenCalledTimes(1);
    const metrics = save.mock.calls[0][0];
    expect(metrics.generationId).toBe('generation-1');
    expect(metrics.tokenUsage.totalTokens).toBe(15);
    expect(metrics.stageMetrics[0]).toEqual(expect.objectContaining({ parseFailure: false, latencyMs: 12 }));
    expect(JSON.stringify(metrics)).not.toContain('private prompt');
  });

  it('is disabled when the capture flag is off', () => {
    process.env.ITINERARY_METRICS_CAPTURE = '0';
    persistItineraryGenerationMetrics({
      generationId: 'generation-2', outcome: 'failure', tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, stages: [],
    });
    expect(save).not.toHaveBeenCalled();
  });
});
