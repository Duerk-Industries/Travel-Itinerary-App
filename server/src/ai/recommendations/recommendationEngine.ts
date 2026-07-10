import {
  getAdminSetting,
  listAiAbTestMetrics,
  listAiExperiments,
  listAiRecommendations,
  upsertAiRecommendation,
} from '../../db';
import type { AiAbTestMetric, AiExperiment } from '../../types';
import {
  computeRecommendationValue,
  confidenceFromSampleSize,
  RECOMMENDATION_ENGINE_VERSION,
} from './computeRecommendationValue';
import { renderRecommendationRationale } from './rationaleTemplates';

const parseSettingNumber = async (key: string, fallback: number): Promise<number> => {
  const row = await getAdminSetting(key);
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const latestByVariant = (metrics: AiAbTestMetric[]): Map<string, AiAbTestMetric> => {
  const out = new Map<string, AiAbTestMetric>();
  for (const metric of metrics) {
    const existing = out.get(metric.variantId);
    if (!existing || metric.day > existing.day) out.set(metric.variantId, metric);
  }
  return out;
};

const buildRecommendationForExperiment = async (experiment: AiExperiment): Promise<boolean> => {
  const metrics = latestByVariant(await listAiAbTestMetrics({ experimentId: experiment.experimentId, limit: 500 }));
  const controlId = experiment.controlVariantId ?? experiment.variants[0]?.variantId;
  const control = controlId ? metrics.get(controlId) : undefined;
  if (!control) return false;
  const existing = await listAiRecommendations({ status: 'proposed', limit: 500 });
  if (existing.some((rec) => rec.supportingEvidenceRef === `experiment:${experiment.experimentId}`)) return false;

  const weightQuality = await parseSettingNumber(`recommendation_weight_quality_${experiment.featureKey}`, 0.7);
  const weightCost = await parseSettingNumber(`recommendation_weight_cost_${experiment.featureKey}`, 0.3);
  const minDelta = await parseSettingNumber('recommendation_min_delta_threshold', 0.05);

  let best: { variantId: string; metric: AiAbTestMetric; delta: number; value: number } | null = null;
  for (const variant of experiment.variants) {
    if (variant.variantId === controlId) continue;
    const metric = metrics.get(variant.variantId);
    if (!metric) continue;
    const controlValue = computeRecommendationValue({
      qualityScore: control.avgQualityScore,
      projectedMonthlyCost: control.avgCostUsd || 0,
      currentMonthlyCost: control.avgCostUsd || 1,
      sampleSize: control.requestCount,
    }, { quality: weightQuality, cost: weightCost });
    const variantValue = computeRecommendationValue({
      qualityScore: metric.avgQualityScore,
      projectedMonthlyCost: metric.avgCostUsd || 0,
      currentMonthlyCost: control.avgCostUsd || 1,
      sampleSize: metric.requestCount,
    }, { quality: weightQuality, cost: weightCost });
    const delta = variantValue - controlValue;
    if (delta <= minDelta) continue;
    if (!best || delta > best.delta) best = { variantId: variant.variantId, metric, delta, value: variantValue };
  }
  if (!best) return false;

  const variant = experiment.variants.find((item) => item.variantId === best!.variantId);
  await upsertAiRecommendation({
    recommendationType: variant?.provider ? 'switch_provider' : 'promote_prompt',
    featureKey: experiment.featureKey,
    subjectCurrent: { experimentId: experiment.experimentId, variantId: controlId },
    subjectProposed: { experimentId: experiment.experimentId, variantId: best.variantId, provider: variant?.provider, model: variant?.model },
    rationale: renderRecommendationRationale(variant?.provider ? 'switch_provider' : 'promote_prompt', {
      proposedProvider: variant?.provider ?? best.variantId,
      qualityDelta: Number((best.metric.avgQualityScore - control.avgQualityScore).toFixed(2)),
      costDeltaUsdMonthly: Number((best.metric.avgCostUsd - control.avgCostUsd).toFixed(2)),
      confidence: confidenceFromSampleSize(best.metric.requestCount),
    }),
    qualityDeltaEstimate: best.metric.avgQualityScore - control.avgQualityScore,
    costDeltaEstimateUsdMonthly: best.metric.avgCostUsd - control.avgCostUsd,
    confidence: confidenceFromSampleSize(best.metric.requestCount),
    supportingEvidenceRef: `experiment:${experiment.experimentId}`,
    supportingEvidenceQuery: { experimentId: experiment.experimentId, controlVariantId: controlId, proposedVariantId: best.variantId },
    engineVersion: RECOMMENDATION_ENGINE_VERSION,
  });
  return true;
};

export const generateAiRecommendationsFromExperimentMetrics = async (): Promise<number> => {
  const experiments = await listAiExperiments({ status: 'completed', limit: 500 });
  let created = 0;
  for (const experiment of experiments) {
    if (await buildRecommendationForExperiment(experiment)) created += 1;
  }
  return created;
};
