import crypto from 'crypto';
import { anonymizeUserId } from '../capture/anonymize';
import type { AiCallContext } from '../types/aiChat';

type AiCallContextInput = {
  correlationId?: string;
  requestId?: string;
  jobId?: string;
  featureKey: string;
  userId: string;
  tier?: string;
  role?: string;
  provider: string;
  model: string;
  callerId: string;
};

export const createAiCallContext = (input: AiCallContextInput): AiCallContext => ({
  correlationId: input.correlationId ?? crypto.randomUUID(),
  requestId: input.requestId ?? crypto.randomUUID(),
  jobId: input.jobId,
  featureKey: input.featureKey,
  userId: input.userId,
  anonymousUserId: anonymizeUserId(input.userId),
  tier: input.tier ?? 'unknown',
  role: input.role ?? 'unknown',
  provider: input.provider,
  model: input.model,
  callerId: input.callerId,
});
