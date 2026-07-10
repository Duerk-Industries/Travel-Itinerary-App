import type { CaptureRecord } from '../types/captureRecord';
import { anonymizeUserId } from './anonymize';
import { redactAllowedFreeText } from './redact';

export type CaptureAllowlist = {
  payload?: Record<string, true | CaptureAllowlist>;
};

const COMMON_PAYLOAD_ALLOWLIST: Record<string, true | CaptureAllowlist> = {
  stages: {
    payload: {
      stage: true,
      callerId: true,
      startedAt: true,
      completedAt: true,
      latencyMs: true,
      outcome: true,
      promptTokens: true,
      completionTokens: true,
      responseChars: true,
      parseError: true,
    },
  },
};

export const CAPTURE_ALLOWLISTS: Record<string, CaptureAllowlist> = {
  itinerary_generation: {
    payload: {
      destinationCount: true,
      days: true,
      detailCount: true,
      transfersCount: true,
      lodgingsCount: true,
      activitiesCount: true,
      carRentalsCount: true,
      usedRenderFallback: true,
      ...COMMON_PAYLOAD_ALLOWLIST,
    },
  },
  parsing: {
    payload: {
      sourceType: true,
      normalizationQuality: true,
      extractedTextSource: true,
      strategyName: true,
      logicVersion: true,
      estimatedCostUsd: true,
      parsedItems: {
        payload: {
          itemType: true,
          confidenceScore: true,
          reviewStatus: true,
        },
      },
    },
  },
  shadow_parse: {
    payload: {
      comparison: {
        payload: {
          productionItemCount: true,
          llmItemCount: true,
          agreementRate: true,
          itemComparisons: {
            payload: {
              itemType: true,
              agreementRate: true,
            },
          },
        },
      },
    },
  },
};

const copyAllowed = (value: unknown, allowlist?: Record<string, true | CaptureAllowlist>): unknown => {
  if (!allowlist || value == null) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => copyAllowed(item, allowlist));
  }
  if (typeof value !== 'object') return undefined;

  const output: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(allowlist)) {
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined) continue;
    if (rule === true) {
      output[key] = child;
    } else {
      const nested = copyAllowed(child, rule.payload);
      if (nested !== undefined) output[key] = nested;
    }
  }
  return output;
};

export const serializeForProduction = (
  record: CaptureRecord,
  allowlist: CaptureAllowlist = CAPTURE_ALLOWLISTS[record.featureKey] ?? {}
): CaptureRecord => {
  const anonymousUserId = record.anonymousUserId ?? (record.userId ? anonymizeUserId(record.userId) : undefined);
  const allowedPayload = copyAllowed(record.payload, allowlist.payload);
  const redacted = redactAllowedFreeText((allowedPayload && typeof allowedPayload === 'object' ? allowedPayload : {}) as Record<string, unknown>);

  return {
    captureSchemaVersion: record.captureSchemaVersion,
    captureId: record.captureId,
    featureKey: record.featureKey,
    capturedAt: record.capturedAt,
    correlationId: record.correlationId,
    requestId: record.requestId,
    jobId: record.jobId,
    anonymousUserId,
    provider: record.provider,
    model: record.model,
    callerId: record.callerId,
    outcome: record.outcome,
    latencyMs: record.latencyMs,
    tokenUsage: record.tokenUsage,
    redactionApplied: redacted.redactionApplied,
    payload: redacted.value,
  };
};
