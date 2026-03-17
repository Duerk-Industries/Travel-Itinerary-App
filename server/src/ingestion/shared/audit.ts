import { logError, logInfo } from '../../logger';
import type { ParseAttemptStage, UserVisibleFailureCode } from '../contracts';

export type SafeStageLogInput = {
  importJobId: string;
  stageName: string;
  stageStatus: 'STARTED' | 'SUCCEEDED' | 'FAILED';
  extractorName?: string | null;
  logicVersion?: string | null;
  costEstimateUsd?: number;
  errorCode?: string | null;
  errorClass?: string | null;
  piiSafeMessage: string;
  correlationId: string;
  startedAt: string;
  completedAt?: string;
};

export const logParseStage = (entry: SafeStageLogInput): void => {
  const payload = JSON.stringify(entry);
  if (entry.stageStatus === 'FAILED') {
    logError(`[ingestion] parse-stage ${payload}`);
    return;
  }
  logInfo(`[ingestion] parse-stage ${payload}`);
};

export const mapErrorToFailureCode = (error: unknown): UserVisibleFailureCode => {
  const message = String((error as Error)?.message ?? '').toLowerCase();
  if (message.includes('quota')) return 'quota_exceeded';
  if (message.includes('virus')) return 'virus_scan_failed';
  if (message.includes('large')) return 'file_too_large';
  if (message.includes('unsupported')) return 'unsupported_file_type';
  if (message.includes('duplicate')) return 'duplicate_document';
  return 'parse_failed_try_again';
};

export const summarizeAttemptOutcome = (stage: ParseAttemptStage, success: boolean): string =>
  success ? `${stage.toLowerCase()}_succeeded` : `${stage.toLowerCase()}_failed`;
