/// <reference types="jest" />

import { getAiExecutiveSummary } from '../../src/ai/analytics/executiveSummary';
import { listAiAbTestMetrics, listAiAnalyticsMetrics, listAiRecommendations } from '../../src/db';

jest.mock('../../src/db', () => ({
  listAiAnalyticsMetrics: jest.fn(),
  listAiAbTestMetrics: jest.fn(),
  listAiRecommendations: jest.fn(),
}));

describe('AI executive summary', () => {
  it('summarizes aggregate metrics without raw capture data', async () => {
    (listAiAnalyticsMetrics as jest.Mock).mockResolvedValue([
      {
        table: 'ai_cost_metrics',
        periodStart: '2026-07-01',
        periodType: 'day',
        dimensions: { provider: 'openai', model: 'gpt-4o-mini' },
        metricKey: 'estimated_cost_usd',
        metricValue: 3,
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
      {
        table: 'ai_daily_metrics',
        periodStart: '2026-07-01',
        periodType: 'day',
        dimensions: { featureKey: 'parsing' },
        metricKey: 'captures_total',
        metricValue: 10,
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ]);
    (listAiAbTestMetrics as jest.Mock).mockResolvedValue([{ avgQualityScore: 88 }]);
    (listAiRecommendations as jest.Mock).mockResolvedValue([{ status: 'proposed' }, { status: 'applied' }]);

    const summary = await getAiExecutiveSummary();

    expect(summary.spend.estimatedUsd).toBe(3);
    expect(summary.throughput.captures).toBe(10);
    expect(summary.quality.avgExperimentQuality).toBe(88);
    expect(JSON.stringify(summary)).not.toMatch(/raw|email|passport/i);
  });
});
