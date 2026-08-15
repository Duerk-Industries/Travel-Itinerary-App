import { randomUUID } from 'crypto';
import { recordItineraryGenerationMetrics } from '../db';
import { getEnvFlag } from '../env';
import { logError } from '../logger';
import type { ItineraryGenerationMetrics } from '../types';
import type { ItineraryBaselineMetrics } from './itineraryEvaluationService';
import type { ItineraryStageCapture } from '../ai/capture/itineraryCapture';
import { estimateAiCostMicros } from '../apis/providerBudgeting';

/**
 * Persist de-identified itinerary telemetry off the request's critical path.
 * The database write is deliberately best-effort: telemetry failure must never
 * turn a usable itinerary into a user-facing error.
 */
export const persistItineraryGenerationMetrics = (input: {
  generationId?: string;
  tripId?: string | null;
  userId?: string | null;
  provider?: string;
  model?: string;
  outcome: ItineraryGenerationMetrics['outcome'];
  tokenUsage: ItineraryGenerationMetrics['tokenUsage'];
  stages: ItineraryStageCapture[];
  evaluation?: ItineraryBaselineMetrics | null;
  cacheUsage?: Record<string, unknown> | null;
  fallbackUsed?: boolean;
  avoidedInference?: {
    promptTokens: number;
    completionTokens: number;
    baselineProvider: string;
    baselineModel: string;
  } | null;
}): void => {
  if (!getEnvFlag('ITINERARY_METRICS_CAPTURE', { defaultValue: process.env.NODE_ENV !== 'test' })) return;
  const provider = input.provider ?? 'openai';
  const model = input.model ?? 'gpt-4o-mini';
  // Reuse the shared pricing tables (providerBudgeting.ts) rather than reimplementing
  // per-model pricing here; returns null when the provider/model has no configured rate.
  let estimatedCostMicros: number | null = null;
  try {
    estimatedCostMicros = estimateAiCostMicros({
      provider,
      model,
      promptTokens: input.tokenUsage.promptTokens,
      completionTokens: input.tokenUsage.completionTokens,
    });
  } catch (err) {
    logError('[itinerary-metrics] cost estimation failed; continuing without estimate', err);
  }

  let avoidedInferenceMetrics: ItineraryGenerationMetrics['avoidedInference'] = null;
  if (input.avoidedInference) {
    const { promptTokens, completionTokens, baselineProvider, baselineModel } = input.avoidedInference;
    let avoidedCostMicros: number | null = null;
    try {
      avoidedCostMicros = estimateAiCostMicros({
        provider: baselineProvider,
        model: baselineModel,
        promptTokens,
        completionTokens,
      });
    } catch {
      // ignore
    }
    avoidedInferenceMetrics = {
      promptTokens,
      completionTokens,
      estimatedCostMicros: avoidedCostMicros,
    };
  }

  const metrics: ItineraryGenerationMetrics = {
    generationId: input.generationId ?? randomUUID(),
    tripId: input.tripId ?? null,
    userId: input.userId ?? null,
    provider,
    model,
    outcome: input.outcome,
    tokenUsage: input.tokenUsage,
    estimatedCostMicros,
    stageMetrics: input.stages.map((stage) => ({
      stage: stage.stage,
      callerId: stage.callerId,
      latencyMs: stage.latencyMs,
      promptTokens: stage.promptTokens,
      completionTokens: stage.completionTokens,
      outcome: stage.outcome,
      parseFailure: Boolean(stage.parseError),
    })),
    evaluation: input.evaluation ? { ...input.evaluation } : null,
    cacheUsage: input.cacheUsage ?? null,
    avoidedInference: avoidedInferenceMetrics,
    fallbackUsed: Boolean(input.fallbackUsed),
    createdAt: new Date().toISOString(),
  };
  void recordItineraryGenerationMetrics(metrics).catch((err) => {
    logError('[itinerary-metrics] persistence failed; continuing', err);
  });
};
