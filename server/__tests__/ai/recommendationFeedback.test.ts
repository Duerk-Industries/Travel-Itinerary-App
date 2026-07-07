/// <reference types="jest" />

import { expireStaleRecommendations, measureAppliedRecommendationOutcomes } from '../../src/ai/recommendations/feedbackLoop';
import { listAiAbTestMetrics, listAiRecommendations, updateAiRecommendationOutcome, updateAiRecommendationStatus } from '../../src/db';

jest.mock('../../src/db', () => ({
  listAiAbTestMetrics: jest.fn(),
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

  it('computes a real before/after diff for the specific experiment variant, not a global sum', async () => {
    (listAiRecommendations as jest.Mock).mockResolvedValue([
      {
        recommendationId: 'rec-applied',
        respondedAt: '2026-06-15T00:00:00.000Z',
        costDeltaEstimateUsdMonthly: 2,
        supportingEvidenceQuery: { experimentId: 'exp-1', controlVariantId: 'control', proposedVariantId: 'treatment' },
      },
    ]);
    (listAiAbTestMetrics as jest.Mock).mockResolvedValue([
      // Before respondedAt (2026-06-15): treatment averaged quality 70, cost $0.02/request.
      { experimentId: 'exp-1', variantId: 'treatment', day: '2026-06-10', requestCount: 100, successRate: 0.9, avgQualityScore: 70, avgCostUsd: 0.02, updatedAt: '' },
      { experimentId: 'exp-1', variantId: 'treatment', day: '2026-06-12', requestCount: 100, successRate: 0.9, avgQualityScore: 70, avgCostUsd: 0.02, updatedAt: '' },
      // After respondedAt, within the 14-day window (up to 2026-06-29): quality improved to 85, cost rose to $0.03/request at 200 requests/day.
      { experimentId: 'exp-1', variantId: 'treatment', day: '2026-06-20', requestCount: 200, successRate: 0.95, avgQualityScore: 85, avgCostUsd: 0.03, updatedAt: '' },
      { experimentId: 'exp-1', variantId: 'treatment', day: '2026-06-25', requestCount: 200, successRate: 0.95, avgQualityScore: 85, avgCostUsd: 0.03, updatedAt: '' },
      // Different variant — must not leak into the diff.
      { experimentId: 'exp-1', variantId: 'control', day: '2026-06-20', requestCount: 500, successRate: 0.5, avgQualityScore: 10, avgCostUsd: 100, updatedAt: '' },
    ]);

    await expect(measureAppliedRecommendationOutcomes(14, new Date('2026-07-01T00:00:00.000Z'))).resolves.toBe(1);

    expect(updateAiRecommendationOutcome).toHaveBeenCalledWith({
      recommendationId: 'rec-applied',
      outcomeQualityDelta: 15, // 85 - 70
      outcomeCostDeltaUsdMonthly: (0.03 - 0.02) * 200 * 30, // (afterCost - beforeCost) * afterRequestsPerDay * 30 = 60
      measuredAt: '2026-07-01T00:00:00.000Z',
    });
  });

  it('reports null (not a fabricated zero) when the recommendation has no experiment evidence to diff against', async () => {
    (listAiRecommendations as jest.Mock).mockResolvedValue([
      {
        recommendationId: 'rec-no-evidence',
        respondedAt: '2026-06-01T00:00:00.000Z',
        costDeltaEstimateUsdMonthly: 2,
        supportingEvidenceQuery: null,
      },
    ]);

    await expect(measureAppliedRecommendationOutcomes(14, new Date('2026-07-01T00:00:00.000Z'))).resolves.toBe(1);

    expect(listAiAbTestMetrics).not.toHaveBeenCalled();
    expect(updateAiRecommendationOutcome).toHaveBeenCalledWith(expect.objectContaining({
      recommendationId: 'rec-no-evidence',
      outcomeQualityDelta: null,
      outcomeCostDeltaUsdMonthly: null,
    }));
  });

  it('reports null when only a before-window or only an after-window exists', async () => {
    (listAiRecommendations as jest.Mock).mockResolvedValue([
      {
        recommendationId: 'rec-partial',
        respondedAt: '2026-06-15T00:00:00.000Z',
        costDeltaEstimateUsdMonthly: 2,
        supportingEvidenceQuery: { experimentId: 'exp-1', proposedVariantId: 'treatment' },
      },
    ]);
    // Only "before" data exists — no rows fall in the after-window.
    (listAiAbTestMetrics as jest.Mock).mockResolvedValue([
      { experimentId: 'exp-1', variantId: 'treatment', day: '2026-06-10', requestCount: 100, successRate: 0.9, avgQualityScore: 70, avgCostUsd: 0.02, updatedAt: '' },
    ]);

    await expect(measureAppliedRecommendationOutcomes(14, new Date('2026-07-01T00:00:00.000Z'))).resolves.toBe(1);

    expect(updateAiRecommendationOutcome).toHaveBeenCalledWith(expect.objectContaining({
      recommendationId: 'rec-partial',
      outcomeQualityDelta: null,
      outcomeCostDeltaUsdMonthly: null,
    }));
  });
});
