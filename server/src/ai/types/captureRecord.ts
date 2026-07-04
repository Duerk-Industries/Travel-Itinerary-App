export type CaptureOutcome = 'success' | 'failure' | 'timeout' | 'skipped';

export type CaptureRecord = {
  captureSchemaVersion: 1;
  captureId: string;
  featureKey: string;
  capturedAt: string;
  correlationId?: string;
  requestId?: string;
  jobId?: string;
  userId?: string;
  anonymousUserId?: string;
  provider?: string;
  model?: string;
  callerId?: string;
  outcome: CaptureOutcome;
  latencyMs?: number;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  redactionApplied?: boolean;
  payload: Record<string, unknown>;
};
