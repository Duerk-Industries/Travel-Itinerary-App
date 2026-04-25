export type IngestionSourceType = 'MANUAL_UPLOAD' | 'FORWARDED_MAILBOX' | 'GMAIL_IMPORT';

export type ImportJobState =
  | 'PENDING'
  | 'RECEIVED'
  | 'NORMALIZING'
  | 'NORMALIZED'
  | 'EXTRACTING'
  | 'AWAITING_REVIEW'
  | 'COMPLETED'
  | 'FAILED'
  | 'DEAD_LETTERED'
  | 'DUPLICATE_IGNORED';

export type ParsedItemReviewState =
  | 'NEW'
  | 'LOW_CONFIDENCE'
  | 'READY_FOR_REVIEW'
  | 'ASSIGNED'
  | 'DELETED'
  | 'DUPLICATE_FLAGGED';

export type VirusScanStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'SKIPPED';
export type NormalizationQuality = 'FULL_TEXT' | 'STRUCTURAL_EXTRACT' | 'OCR' | 'FALLBACK_DECODE';

export type UserVisibleFailureCode =
  | 'unsupported_file_type'
  | 'file_too_large'
  | 'duplicate_document'
  | 'parse_failed_try_again'
  | 'low_confidence_review_needed'
  | 'provider_auth_expired'
  | 'gmail_permission_missing'
  | 'quota_exceeded'
  | 'virus_scan_failed'
  | 'mailbox_webhook_temporary_failure';

export type ParsedItemType =
  | 'flight'
  | 'hotel'
  | 'rail'
  | 'ferry_bus_transfer'
  | 'car_rental'
  | 'tour_activity'
  | 'restaurant_reservation'
  | 'event_ticket'
  | 'generic_note';

export type TimezoneStatus = 'RESOLVED' | 'INFERRED' | 'UNKNOWN';

export type DuplicateDisposition = 'ACTIVE_MATCH' | 'ASSIGNED_MATCH' | 'PREVIOUSLY_DELETED';

export type ParseAttemptStage = 'SOURCE_SPECIFIC' | 'REGEX' | 'SMALL_LLM' | 'LARGE_LLM' | 'OCR' | 'CACHE';

export interface IngestionPayload {
  sourceType: IngestionSourceType;
  sourceId: string;
  userId: string;
  externalMessageId: string;
  receivedAt: string;
  originalFilename: string;
  mimeType: string;
  contentBytesRef: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  correlationId: string;
  dryRun: boolean;
  virusScanStatus: VirusScanStatus;
}

export interface NormalizedDocument {
  importJobId: string;
  userId: string;
  sourceType: IngestionSourceType;
  sourceId: string;
  originalFilename: string;
  mimeType: string;
  contentHash: string;
  normalizedContentHash: string;
  normalizedText: string;
  normalizedHtml?: string | null;
  extractedTextSource: 'text' | 'html' | 'pdf' | 'ocr' | 'fallback';
  normalizationQuality: NormalizationQuality;
  rawSourceReference: string;
  metadata: Record<string, unknown>;
  receivedAt: string;
  correlationId: string;
}

export interface UsageMetrics {
  tokensIn: number;
  tokensOut: number;
  provider: string;
  modelName: string | null;
  estimatedCostUsd: number;
}

export interface ExtractionMetadata {
  logicVersion: string;
  extractedAt: string;
  strategyName: string;
}

export interface ParsedItemCandidate {
  itemType: ParsedItemType;
  sourceType: IngestionSourceType;
  sourceDate: string | null;
  providerVendor: string | null;
  travelerNames: string[];
  confirmationNumber: string | null;
  startDateTimeUtc: string | null;
  endDateTimeUtc: string | null;
  originalTimezone: string | null;
  timezoneStatus: TimezoneStatus;
  rawDatetimeString: string | null;
  timezoneDisplayHint: string | null;
  rawSourceReference: string;
  confidenceScore: number;
  reviewStatus: ParsedItemReviewState;
  deduplicationFingerprint: string;
  extractedFields: Record<string, unknown>;
  editedFields?: Record<string, unknown> | null;
  duplicateDisposition?: DuplicateDisposition | null;
  duplicateOfParsedItemId?: string | null;
  duplicateOfTripId?: string | null;
}

export interface ExtractionResult {
  parsedItems: ParsedItemCandidate[];
  usageMetrics: UsageMetrics;
  metadata: ExtractionMetadata;
}

export interface ExtractionConfig {
  logicVersion: string;
  allowSmallLlm: boolean;
  allowLargeLlm: boolean;
  tokenBudgetUsd: number;
  contentHash: string;
  userId: string;
  importJobId: string;
  correlationId: string;
}

export interface PersistedImportJob {
  id: string;
  userId: string;
  ingestionSourceId: string;
  sourceType: IngestionSourceType;
  state: ImportJobState;
  idempotencyKey: string;
  contentHash: string;
  normalizedContentHash?: string | null;
  externalMessageId: string;
  originalFilename: string;
  mimeType: string;
  failureCode?: UserVisibleFailureCode | null;
  failureReason?: string | null;
  correlationId: string;
  dryRun: boolean;
  retryCount: number;
  lastErrorCode?: string | null;
  createdAt: string;
  updatedAt: string;
  stateChangedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  /**
   * Scheduled earliest-retry timestamp populated on FAILED-state transitions.
   * A future scheduler will pick up rows where `state='FAILED' AND
   * next_retry_at <= NOW() AND retry_count < max_attempts`. Column is written
   * today so the data is already there when the scheduler ships.
   */
  nextRetryAt?: string | null;
}

export interface QueuedImportProcessorConfig {
  allowSmallLlm: boolean;
  allowLargeLlm: boolean;
  logicVersion: string;
  enforceFutureDated: boolean;
}

export interface PersistedParsedItem extends ParsedItemCandidate {
  id: string;
  userId: string;
  importJobId: string;
  rawDocId: string;
  logicVersion: string;
  status: ParsedItemReviewState;
  createdAt: string;
  updatedAt: string;
  assignedTripId?: string | null;
  assignmentTransactionId?: string | null;
  previouslyDeletedNotice?: boolean;
}

export interface ProviderConnectionRecord {
  id: string;
  userId: string;
  provider: string;
  status: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiry?: string | null;
  scopes: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RetryPolicyConfigRecord {
  provider: string;
  maxAttempts: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
  alertThresholdPercent: number;
  updatedAt: string;
}

export interface ReviewQueueFilters {
  sourceType?: IngestionSourceType | 'ALL';
  itemType?: ParsedItemType | 'ALL';
  status?: ParsedItemReviewState | 'ALL';
  search?: string;
}

export interface IngestionObservabilitySnapshot {
  ingestionVolumeBySourceAndTier: Array<{ sourceType: string; tierKey: string; count: number }>;
  parseRateByStage: Array<{ stageName: string; successCount: number; failureCount: number }>;
  duplicateRate: { duplicateCount: number; totalCount: number };
  lowConfidenceRate: { lowConfidenceCount: number; totalCount: number };
  averageLatencyByStage: Array<{ stageName: string; averageMs: number }>;
  retryAndDeadLetter: { retryCount: number; deadLetterCount: number };
  llmUsageByModel: Array<{ provider: string; modelName: string; tokensIn: number; tokensOut: number; estimatedCostUsd: number }>;
  quotaByUserTier: Array<{ userId: string; tierKey: string; uploadsUsed: number }>;
  gmailAuthFailures: number;
  webhookSignatureFailures: number;
  costPerUser: Array<{ userId: string; estimatedCostUsd: number }>;
}
