/// <reference types="jest" />

import { generateAiRecommendationsFromExperimentMetrics } from '../../src/ai/recommendations/recommendationEngine';
import {
  getAdminSetting,
  listAiAbTestMetrics,
  listAiExperiments,
  listAiRecommendations,
  upsertAiRecommendation,
} from '../../src/db';

jest.mock('../../src/db', () => ({
  getAdminSetting: jest.fn(),
  listAiAbTestMetrics: jest.fn(),
  listAiExperiments: jest.fn(),
  listAiRecommendations: jest.fn(),
  upsertAiRecommendation: jest.fn(),
}));

describe('recommendation engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAdminSetting as jest.Mock).mockResolvedValue(null);
    (listAiRecommendations as jest.Mock).mockResolvedValue([]);
  });

  it('creates a recommendation when a completed experiment has a better variant', async () => {
    (listAiExperiments as jest.Mock).mockResolvedValue([
      {
        experimentId: 'exp-1',
        featureKey: 'ingestion_llm_extract',
        status: 'completed',
        controlVariantId: 'control',
        variants: [
          { variantId: 'control', trafficPercent: 80 },
          { variantId: 'llm', trafficPercent: 20, provider: 'openai', model: 'gpt-4o-mini' },
        ],
      },
    ]);
    (listAiAbTestMetrics as jest.Mock).mockResolvedValue([
      { variantId: 'control', day: '2026-07-01', requestCount: 250, avgQualityScore: 70, avgCostUsd: 1 },
      { variantId: 'llm', day: '2026-07-01', requestCount: 250, avgQualityScore: 90, avgCostUsd: 1 },
    ]);
    (upsertAiRecommendation as jest.Mock).mockResolvedValue({});

    await expect(generateAiRecommendationsFromExperimentMetrics()).resolves.toBe(1);
    expect(upsertAiRecommendation).toHaveBeenCalledWith(expect.objectContaining({
      recommendationType: 'switch_provider',
      featureKey: 'ingestion_llm_extract',
      supportingEvidenceRef: 'experiment:exp-1',
    }));
  });
});
