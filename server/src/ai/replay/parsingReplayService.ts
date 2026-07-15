import { getImportJobPayload } from '../../ingestion/shared/repository';
import { normalizeIngestionPayload } from '../../ingestion/normalization';
import { LlmExtractor } from '../../ingestion/extraction/llmExtractor';
import { INGESTION_LOGIC_VERSION } from '../../ingestion/config';
import type { ExtractionResult, IngestionPayload, ParsedItemCandidate } from '../../ingestion/contracts';
import { compareExtractionResults, type ComparisonReport } from '../evaluation/comparisonEngine';
import { getLocalAiCaptureRecord } from '../analytics/captureBrowser';
import { captureAiInteraction } from '../capture/captureService';

// The original source bytes for an intake live only in temp storage (see
// ingestion/shared/tempStorage.ts) and are deleted once the intake finishes
// processing. A replay requested after that window has no raw content to
// re-normalize and re-extract from — surface that plainly instead of
// pretending the replay ran.
export class ReplaySourceUnavailableError extends Error {
  constructor(readonly intakeId: string) {
    super(
      `Original attachment content for intake ${intakeId} is no longer available for replay ` +
        `(temp storage retention window has passed).`
    );
    this.name = 'ReplaySourceUnavailableError';
  }
}

export class ReplayIntakeNotFoundError extends Error {
  constructor(readonly intakeId: string) {
    super(`Import intake not found: ${intakeId}`);
    this.name = 'ReplayIntakeNotFoundError';
  }
}

export type ParsingReplayResult = {
  intakeId: string;
  dryRun: boolean;
  productionItemCount: number;
  llmItemCount: number;
  productionResult: ExtractionResult;
  llmResult: ExtractionResult;
  comparison: ComparisonReport;
  persistedCaptureId: string | null;
};

const toIngestionPayload = (job: NonNullable<Awaited<ReturnType<typeof getImportJobPayload>>>): IngestionPayload => ({
  sourceType: job.sourceType,
  sourceId: job.sourceId,
  userId: job.userId,
  externalMessageId: job.externalMessageId,
  receivedAt: job.receivedAt,
  originalFilename: job.originalFilename,
  mimeType: job.mimeType,
  contentBytesRef: job.contentBytesRef,
  contentHash: job.contentHash,
  metadata: job.metadata,
  correlationId: job.correlationId,
  dryRun: job.dryRun,
  virusScanStatus: job.virusScanStatus,
});

// The capture record only stores a summary of each production-parsed item
// (see parsingCapture.ts) — itemType, providerVendor, confirmationNumber,
// confidenceScore, reviewStatus, extractedFields. compareExtractionResults
// only reads itemType/extractedFields, so this reconstruction is sufficient
// even though several ParsedItemCandidate fields below are placeholders.
const toProductionCandidate = (item: Record<string, unknown>, intakeId: string): ParsedItemCandidate => ({
  itemType: item.itemType as ParsedItemCandidate['itemType'],
  sourceType: 'MANUAL_UPLOAD',
  sourceDate: null,
  providerVendor: (item.providerVendor as string | null) ?? null,
  travelerNames: [],
  confirmationNumber: (item.confirmationNumber as string | null) ?? null,
  startDateTimeUtc: null,
  endDateTimeUtc: null,
  originalTimezone: null,
  timezoneStatus: 'UNKNOWN',
  rawDatetimeString: null,
  timezoneDisplayHint: null,
  rawSourceReference: `replay:${intakeId}`,
  confidenceScore: (item.confidenceScore as number | undefined) ?? 0,
  reviewStatus: (item.reviewStatus as ParsedItemCandidate['reviewStatus']) ?? 'READY_FOR_REVIEW',
  deduplicationFingerprint: `replay:${intakeId}:${String(item.itemType)}`,
  extractedFields: (item.extractedFields as Record<string, unknown>) ?? {},
  editedFields: null,
});

export const replayParsingIntake = async (params: {
  intakeId: string;
  dryRun: boolean;
  aiProvider?: {
    provider?: string;
    model?: string;
  };
}): Promise<ParsingReplayResult> => {
  const { intakeId, dryRun } = params;

  const jobPayload = await getImportJobPayload(intakeId);
  if (!jobPayload) throw new ReplayIntakeNotFoundError(intakeId);

  let doc;
  try {
    doc = await normalizeIngestionPayload(intakeId, toIngestionPayload(jobPayload));
  } catch (err: any) {
    if (err?.code === 'ENOENT') throw new ReplaySourceUnavailableError(intakeId);
    throw err;
  }

  const capture = await getLocalAiCaptureRecord(intakeId);
  const capturedParsedItems = Array.isArray(capture?.payload?.parsedItems) ? (capture!.payload.parsedItems as Record<string, unknown>[]) : [];
  const productionResult: ExtractionResult = {
    parsedItems: capturedParsedItems.map((item) => toProductionCandidate(item, intakeId)),
    usageMetrics: { tokensIn: 0, tokensOut: 0, provider: 'regex', modelName: null, estimatedCostUsd: 0 },
    metadata: {
      logicVersion: INGESTION_LOGIC_VERSION,
      extractedAt: new Date().toISOString(),
      strategyName: 'captured_production',
    },
  };

  const extractor = new LlmExtractor('ReplayLlmExtractor', 1, () => true);
  const llmResult = await extractor.extract(doc, {
    logicVersion: INGESTION_LOGIC_VERSION,
    allowSmallLlm: true,
    allowLargeLlm: true,
    tokenBudgetUsd: 1,
    aiProvider: params.aiProvider,
    contentHash: doc.normalizedContentHash,
    userId: doc.userId,
    importJobId: doc.importJobId,
    correlationId: doc.correlationId,
  });

  const comparison = compareExtractionResults(productionResult, llmResult);

  let persistedCaptureId: string | null = null;
  if (!dryRun) {
    // Distinct featureKey/captureId from the original parsing capture for
    // this intake — a replay must never overwrite it.
    persistedCaptureId = `${intakeId}-replay-${Date.now()}`;
    captureAiInteraction({
      captureSchemaVersion: 1,
      captureId: persistedCaptureId,
      featureKey: 'parsing_replay',
      capturedAt: new Date().toISOString(),
      correlationId: doc.correlationId,
      jobId: doc.importJobId,
      userId: doc.userId,
      provider: llmResult.usageMetrics.provider,
      model: llmResult.usageMetrics.modelName ?? undefined,
      callerId: 'PARSING_EVAL_REPLAY',
      outcome: 'success',
      tokenUsage: {
        promptTokens: llmResult.usageMetrics.tokensIn,
        completionTokens: llmResult.usageMetrics.tokensOut,
        totalTokens: llmResult.usageMetrics.tokensIn + llmResult.usageMetrics.tokensOut,
      },
      payload: { comparison, replayOfIntakeId: intakeId },
    });
  }

  return {
    intakeId,
    dryRun,
    productionItemCount: productionResult.parsedItems.length,
    llmItemCount: llmResult.parsedItems.length,
    productionResult,
    llmResult,
    comparison,
    persistedCaptureId,
  };
};
