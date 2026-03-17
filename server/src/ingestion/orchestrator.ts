import { INGESTION_JOB_TOKEN_BUDGET_USD, INGESTION_LOGIC_VERSION } from './config';
import type { IngestionPayload } from './contracts';
import { extractCandidates } from './extraction';
import type { ExtractionResult } from './contracts';
import { normalizeIngestionPayload } from './normalization';
import { persistReviewQueueItems } from './review_queue';
import { mapErrorToFailureCode } from './shared/audit';
import { buildImportJobIdempotencyKey } from './shared/hashing';
import {
  createImportJob,
  createIngestedDocument,
  findDocumentByNormalizedHash,
  getImportJobByIdempotencyKey,
  getOrCreateIngestionSource,
  markIngestedDocumentRawDeleted,
  updateImportJobState,
} from './shared/repository';
import { deleteTempBytes } from './shared/tempStorage';

export const runIngestionPipeline = async (
  payload: IngestionPayload,
  allowLargeLlm: boolean,
  allowSmallLlm: boolean,
  overrides?: {
    extractFn?: typeof extractCandidates | ((
      doc: Awaited<ReturnType<typeof normalizeIngestionPayload>>,
      config: Parameters<typeof extractCandidates>[1]
    ) => Promise<ExtractionResult>);
    postExtractFn?: (result: ExtractionResult) => Promise<ExtractionResult> | ExtractionResult;
    logicVersion?: string;
  }
) => {
  const idempotencyKey = buildImportJobIdempotencyKey(payload);
  const existingJob = await getImportJobByIdempotencyKey(payload.userId, idempotencyKey);
  if (existingJob) {
    return existingJob;
  }
  const sourceId = await getOrCreateIngestionSource(payload.userId, payload.sourceType);
  const job = await createImportJob({
    userId: payload.userId,
    ingestionSourceId: sourceId,
    sourceType: payload.sourceType,
    idempotencyKey,
    contentHash: payload.contentHash,
    externalMessageId: payload.externalMessageId,
    originalFilename: payload.originalFilename,
    mimeType: payload.mimeType,
    correlationId: payload.correlationId,
    dryRun: payload.dryRun,
  });
  try {
    await updateImportJobState({ jobId: job.id, state: 'RECEIVED' });
    await updateImportJobState({ jobId: job.id, state: 'NORMALIZING' });
    const normalized = await normalizeIngestionPayload(job.id, payload);
    const duplicate = await findDocumentByNormalizedHash(payload.userId, normalized.normalizedContentHash);
    if (duplicate) {
      await updateImportJobState({
        jobId: job.id,
        state: 'DUPLICATE_IGNORED',
        normalizedContentHash: normalized.normalizedContentHash,
        failureCode: 'duplicate_document',
      });
      await deleteTempBytes(payload.contentBytesRef);
      return job;
    }
    const rawDoc = await createIngestedDocument({
      importJobId: job.id,
      userId: payload.userId,
      sourceType: payload.sourceType,
      contentHash: payload.contentHash,
      normalizedContentHash: normalized.normalizedContentHash,
      mimeType: payload.mimeType,
      originalFilename: payload.originalFilename,
      rawSourceReference: normalized.rawSourceReference,
      contentBytesRef: payload.contentBytesRef,
      normalizedText: normalized.normalizedText,
      normalizedHtml: normalized.normalizedHtml ?? null,
      metadata: normalized.metadata,
      virusScanStatus: payload.virusScanStatus,
      virusScannedAt: new Date().toISOString(),
      virusScanProvider: payload.virusScanStatus === 'SKIPPED' ? 'stub' : 'metadata_only',
      deletedRawAt: null,
    });
    await updateImportJobState({ jobId: job.id, state: 'NORMALIZED', normalizedContentHash: normalized.normalizedContentHash });
    await updateImportJobState({ jobId: job.id, state: 'EXTRACTING' });
    const extractionRunner = overrides?.extractFn ?? extractCandidates;
    const extraction = await extractionRunner(normalized, {
      allowLargeLlm,
      allowSmallLlm,
      contentHash: normalized.normalizedContentHash,
      userId: payload.userId,
      importJobId: job.id,
      correlationId: payload.correlationId,
      logicVersion: overrides?.logicVersion ?? INGESTION_LOGIC_VERSION,
    });
    const finalExtraction = overrides?.postExtractFn ? await overrides.postExtractFn(extraction) : extraction;
    if (Number(finalExtraction.usageMetrics.estimatedCostUsd ?? 0) > INGESTION_JOB_TOKEN_BUDGET_USD) {
      throw new Error('Token budget exceeded for import job');
    }
    await persistReviewQueueItems({
      userId: payload.userId,
      importJobId: job.id,
      rawDocId: rawDoc.id,
      extractionResult: finalExtraction,
      logicVersion: overrides?.logicVersion ?? INGESTION_LOGIC_VERSION,
    });
    await updateImportJobState({ jobId: job.id, state: 'AWAITING_REVIEW' });
    await updateImportJobState({ jobId: job.id, state: 'COMPLETED' });
    await markIngestedDocumentRawDeleted(rawDoc.id);
    await deleteTempBytes(payload.contentBytesRef);
    return job;
  } catch (error) {
    await updateImportJobState({
      jobId: job.id,
      state: String((error as Error).message).toLowerCase().includes('budget') ? 'DEAD_LETTERED' : 'FAILED',
      failureCode: mapErrorToFailureCode(error),
      failureReason: String((error as Error).message ?? ''),
      lastErrorCode: mapErrorToFailureCode(error),
    });
    await deleteTempBytes(payload.contentBytesRef);
    throw error;
  }
};
