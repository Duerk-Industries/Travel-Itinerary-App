/// <reference types="jest" />

import { expireStaleRecommendations, measureAppliedRecommendationOutcomes } from '../../src/ai/recommendations/feedbackLoop';
import { listAiAnalyticsMetrics, listAiRecommendations, updateAiRecommendationOutcome, updateAiRecommendationStatus } from '../../src/db';

jest.mock('../../src/db', () => ({
  listAiAnalyticsMetrics: jest.fn(),
  listAiRecommendations: jest.fn(),
  updateAiRecommendationOutcome: jest.fn(),
  updateAiRecommendationStatus: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

describe('recommendation feedback loop', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('expires stale proposed recommendations', async () => {
    (listAiRecommendations as jest.Mock).mockResolvedValue([
      { recommendationId: 'rec-old', createdAt: '2026-05-01T00:00:00.000Z' },
      { recommendationId: 'rec-new', createdAt: new Date().toISOString() },
    ]);

    await expect(expireStaleRecommendations(30)).resolves.toBe(1);
    expect(updateAiRecommendationStatus).toHaveBeenCalledWith({
      recommendationId: 'rec-old',
      status: 'expired',
      respondedBy: null,
    });
  });

  it('measures applied recommendations after the waiting period', async () => {
    (listAiRecommendations as jest.Mock).mockResolvedValue([
      {
        recommendationId: 'rec-applied',
        respondedAt: '2026-06-01T00:00:00.000Z',
        costDeltaEstimateUsdMonthly: 2,
      },
    ]);
    (listAiAnalyticsMetrics as jest.Mock).mockResolvedValue([
      { table: 'ai_cost_metrics', metricKey: 'estimated_cost_usd', metricValue: 5 },
    ]);

    await expect(measureAppliedRecommendationOutcomes(14, new Date('2026-07-01T00:00:00.000Z'))).resolves.toBe(1);
    expect(updateAiRecommendationOutcome).toHaveBeenCalledWith(expect.objectContaining({
      recommendationId: 'rec-applied',
      outcomeCostDeltaUsdMonthly: 3,
    }));
  });
});
