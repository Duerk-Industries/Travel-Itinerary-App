import crypto from 'crypto';
import { logError } from '../../logger';
import { captureAiInteraction } from './captureService';
import type { CaptureRecord } from '../types/captureRecord';

export type ItineraryStageCapture = {
  stage: string;
  callerId: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  outcome: 'success' | 'failure';
  promptTokens: number;
  completionTokens: number;
  responseChars: number;
  parseError?: string;
};

export const captureItineraryInteraction = (params: {
  captureId?: string;
  jobId?: string;
  userId?: string;
  outcome: CaptureRecord['outcome'];
  stages: ItineraryStageCapture[];
  tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  payload: Record<string, unknown>;
}): void => {
  try {
    captureAiInteraction({
      captureSchemaVersion: 1,
      captureId: params.captureId ?? params.jobId ?? crypto.randomUUID(),
      featureKey: 'itinerary_generation',
      capturedAt: new Date().toISOString(),
      jobId: params.jobId,
      userId: params.userId,
      provider: 'openai',
      model: 'gpt-4o-mini',
      outcome: params.outcome,
      tokenUsage: params.tokenUsage,
      payload: {
        ...params.payload,
        stages: params.stages,
      },
    });
  } catch (err) {
    logError('[ai-capture] itinerary capture scheduling failed', err);
  }
};
