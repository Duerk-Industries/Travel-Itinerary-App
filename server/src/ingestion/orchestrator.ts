import { INGESTION_JOB_TOKEN_BUDGET_USD, INGESTION_LOGIC_VERSION } from './config';
import type { ExtractionResult, IngestionPayload, PersistedImportJob, QueuedImportProcessorConfig } from './contracts';
import { extractCandidates } from './extraction';
import { normalizeIngestionPayload } from './normalization';
import { ensureFutureDatedExtraction } from './intake/gmail';
import { persistReviewQueueItems } from './review_queue';
import { mapErrorToFailureCode } from './shared/audit';
import { buildImportJobIdempotencyKey } from './shared/hashing';
import {
  createImportJob,
  createIngestedDocument,
  findDocumentByNormalizedHash,
  getImportJobById,
  getImportJobByIdempotencyKey,
  getImportJobPayload,
  getOrCreateIngestionSource,
  markIngestedDocumentRawDeleted,
  requeueImportJob,
  saveImportJobPayload,
  updateImportJobState,
} from './shared/repository';
import { deleteTempBytes } from './shared/tempStorage';
import { getJobQueue } from './worker/jobQueue';
import { logError, logInfo } from '../logger';
import { captureParsingInteraction } from '../ai/capture/parsingCapture';

type PipelineOverrides = {
  extractFn?: typeof extractCandidates | ((
    doc: Awaited<ReturnType<typeof normalizeIngestionPayload>>,
    config: Parameters<typeof extractCandidates>[1]
  ) => Promise<ExtractionResult>);
  postExtractFn?: (result: ExtractionResult) => Promise<ExtractionResult> | ExtractionResult;
  logicVersion?: string;
  enforceFutureDated?: boolean;
};

const isTerminalJobState = (state: PersistedImportJob['state']): boolean =>
  ['COMPLETED', 'FAILED', 'DEAD_LETTERED', 'DUPLICATE_IGNORED'].includes(state);

const buildProcessorConfig = (
  allowLargeLlm: boolean,
  allowSmallLlm: boolean,
  overrides?: PipelineOverrides
): QueuedImportProcessorConfig => ({
  allowLargeLlm,
  allowSmallLlm,
  logicVersion: overrides?.logicVersion ?? INGESTION_LOGIC_VERSION,
  enforceFutureDated: Boolean(overrides?.enforceFutureDated),
});

const shouldRetryFailedManualUpload = (job: PersistedImportJob, payload: IngestionPayload): boolean =>
  job.state === 'FAILED' && job.sourceType === 'MANUAL_UPLOAD' && payload.sourceType === 'MANUAL_UPLOAD';

const ensureImportJob = async (
  payload: IngestionPayload,
  processorConfig: QueuedImportProcessorConfig
): Promise<{ job: PersistedImportJob; created: boolean }> => {
  const idempotencyKey = buildImportJobIdempotencyKey(payload);
  const existingJob = await getImportJobByIdempotencyKey(payload.userId, idempotencyKey);
  if (existingJob) {
    if (shouldRetryFailedManualUpload(existingJob, payload)) {
      await saveImportJobPayload({
        jobId: existingJob.id,
        sourceId: payload.sourceId,
        userId: payload.userId,
        sourceType: payload.sourceType,
        externalMessageId: payload.externalMessageId,
        receivedAt: payload.receivedAt,
        originalFilename: payload.originalFilename,
        mimeType: payload.mimeType,
        contentBytesRef: payload.contentBytesRef,
        contentHash: payload.contentHash,
        metadata: payload.metadata,
        correlationId: payload.correlationId,
        dryRun: payload.dryRun,
        virusScanStatus: payload.virusScanStatus,
        processorConfig,
      });
      const retriedJob = await requeueImportJob(existingJob.id);
      logInfo(
        `[ingestion][orchestrator] retrying failed manual upload job=${existingJob.id} previous_state=${existingJob.state} user=${payload.userId} file="${payload.originalFilename}"`
      );
      return { job: retriedJob ?? existingJob, created: true };
    }
    logInfo(
      `[ingestion][orchestrator] reusing existing job=${existingJob.id} state=${existingJob.state} source=${payload.sourceType} user=${payload.userId} file="${payload.originalFilename}"`
    );
    return { job: existingJob, created: false };
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
  await saveImportJobPayload({
    jobId: job.id,
    sourceId: payload.sourceId,
    userId: payload.userId,
    sourceType: payload.sourceType,
    externalMessageId: payload.externalMessageId,
    receivedAt: payload.receivedAt,
    originalFilename: payload.originalFilename,
    mimeType: payload.mimeType,
    contentBytesRef: payload.contentBytesRef,
    contentHash: payload.contentHash,
    metadata: payload.metadata,
    correlationId: payload.correlationId,
    dryRun: payload.dryRun,
    virusScanStatus: payload.virusScanStatus,
    processorConfig,
  });
  logInfo(
    `[ingestion][orchestrator] created job=${job.id} source=${payload.sourceType} user=${payload.userId} file="${payload.originalFilename}" correlation=${payload.correlationId}`
  );
  return { job, created: true };
};

const toIngestionPayload = (record: NonNullable<Awaited<ReturnType<typeof getImportJobPayload>>>): IngestionPayload => ({
  sourceType: record.sourceType,
  sourceId: record.sourceId,
  userId: record.userId,
  externalMessageId: record.externalMessageId,
  receivedAt: record.receivedAt,
  originalFilename: record.originalFilename,
  mimeType: record.mimeType,
  contentBytesRef: record.contentBytesRef,
  contentHash: record.contentHash,
  metadata: record.metadata,
  correlationId: record.correlationId,
  dryRun: record.dryRun,
  virusScanStatus: record.virusScanStatus,
});

const processExistingImportJob = async (
  job: PersistedImportJob,
  payloadRecord: NonNullable<Awaited<ReturnType<typeof getImportJobPayload>>>,
  overrides?: PipelineOverrides
): Promise<PersistedImportJob> => {
  if (isTerminalJobState(job.state)) {
    return job;
  }

  const payload = toIngestionPayload(payloadRecord);
  const processorConfig = payloadRecord.processorConfig;

  try {
    logInfo(
      `[ingestion][orchestrator] processing job=${job.id} state=${job.state} source=${payload.sourceType} user=${payload.userId} file="${payload.originalFilename}"`
    );
    await updateImportJobState({ jobId: job.id, state: 'RECEIVED' });
    await updateImportJobState({ jobId: job.id, state: 'NORMALIZING' });
    const normalized = await normalizeIngestionPayload(job.id, payload);
    const duplicate = await findDocumentByNormalizedHash(payload.userId, normalized.normalizedContentHash);
    const reusableRawDoc = duplicate?.importJobId === job.id ? duplicate : null;
    if (duplicate && !reusableRawDoc) {
      await updateImportJobState({
        jobId: job.id,
        state: 'DUPLICATE_IGNORED',
        normalizedContentHash: normalized.normalizedContentHash,
        failureCode: 'duplicate_document',
      });
      logInfo(`[ingestion][orchestrator] duplicate job=${job.id} normalized_hash=${normalized.normalizedContentHash}`);
      await deleteTempBytes(payload.contentBytesRef);
      return (await getImportJobById(job.id)) ?? job;
    }

    const rawDoc = reusableRawDoc ?? (await createIngestedDocument({
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
      normalizationQuality: normalized.normalizationQuality,
      metadata: normalized.metadata,
      virusScanStatus: payload.virusScanStatus,
      virusScannedAt: new Date().toISOString(),
      virusScanProvider: String(payload.metadata.virusScanProvider ?? (payload.virusScanStatus === 'SKIPPED' ? 'stub' : 'metadata_only')),
      deletedRawAt: null,
    }));

    await updateImportJobState({ jobId: job.id, state: 'NORMALIZED', normalizedContentHash: normalized.normalizedContentHash });
    await updateImportJobState({ jobId: job.id, state: 'EXTRACTING' });

    const extractionRunner = overrides?.extractFn ?? extractCandidates;
    const extraction = await extractionRunner(normalized, {
      allowLargeLlm: processorConfig.allowLargeLlm,
      allowSmallLlm: processorConfig.allowSmallLlm,
      contentHash: normalized.normalizedContentHash,
      userId: payload.userId,
      importJobId: job.id,
      correlationId: payload.correlationId,
      logicVersion: processorConfig.logicVersion,
    });

    const futureFilteredExtraction = processorConfig.enforceFutureDated
      ? ensureFutureDatedExtraction(new Date().toISOString().slice(0, 10))(extraction)
      : extraction;
    const finalExtraction = overrides?.postExtractFn ? await overrides.postExtractFn(futureFilteredExtraction) : futureFilteredExtraction;

    captureParsingInteraction({
      intakeId: job.id,
      doc: normalized,
      result: finalExtraction,
      outcome: 'success',
    });

    if (Number(finalExtraction.usageMetrics.estimatedCostUsd ?? 0) > INGESTION_JOB_TOKEN_BUDGET_USD) {
      throw new Error('Token budget exceeded for import job');
    }

    await persistReviewQueueItems({
      userId: payload.userId,
      importJobId: job.id,
      rawDocId: rawDoc.id,
      extractionResult: finalExtraction,
      logicVersion: processorConfig.logicVersion,
    });
    logInfo(
      `[ingestion][orchestrator] extracted job=${job.id} items=${finalExtraction.parsedItems.length} strategy=${finalExtraction.metadata.strategyName}`
    );
    await updateImportJobState({ jobId: job.id, state: 'AWAITING_REVIEW' });
    await updateImportJobState({ jobId: job.id, state: 'COMPLETED' });
    await markIngestedDocumentRawDeleted(rawDoc.id);
    await deleteTempBytes(payload.contentBytesRef);
    logInfo(`[ingestion][orchestrator] completed job=${job.id}`);
    return (await getImportJobById(job.id)) ?? job;
  } catch (error) {
    logError(`[ingestion][orchestrator] failed job=${job.id}`, error);
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

export const processImportJob = async (jobId: string, overrides?: PipelineOverrides): Promise<PersistedImportJob> => {
  const job = await getImportJobById(jobId);
  if (!job) {
    throw new Error(`Import job not found: ${jobId}`);
  }
  const payloadRecord = await getImportJobPayload(jobId);
  if (!payloadRecord) {
    await updateImportJobState({
      jobId,
      state: 'FAILED',
      failureCode: 'parse_failed_try_again',
      failureReason: 'Missing import job payload.',
      lastErrorCode: 'parse_failed_try_again',
    });
    throw new Error(`Import job payload not found: ${jobId}`);
  }
  return processExistingImportJob(job, payloadRecord, overrides);
};

export const enqueueIngestionPipelineJob = async (
  payload: IngestionPayload,
  allowLargeLlm: boolean,
  allowSmallLlm: boolean,
  overrides?: PipelineOverrides
): Promise<PersistedImportJob> => {
  const processorConfig = buildProcessorConfig(allowLargeLlm, allowSmallLlm, overrides);
  const { job, created } = await ensureImportJob(payload, processorConfig);
  if (!created) {
    return job;
  }
  try {
    logInfo(`[ingestion][orchestrator] enqueueing job=${job.id}`);
    await getJobQueue().enqueue(job.id);
    logInfo(`[ingestion][orchestrator] enqueued job=${job.id}`);
    return (await getImportJobById(job.id)) ?? job;
  } catch (error) {
    logError(`[ingestion][orchestrator] enqueue failed job=${job.id}`, error);
    await updateImportJobState({
      jobId: job.id,
      state: 'FAILED',
      failureCode: 'parse_failed_try_again',
      failureReason: 'Unable to enqueue import job.',
      lastErrorCode: 'parse_failed_try_again',
    });
    throw error;
  }
};

export const runIngestionPipeline = async (
  payload: IngestionPayload,
  allowLargeLlm: boolean,
  allowSmallLlm: boolean,
  overrides?: PipelineOverrides
): Promise<PersistedImportJob> => {
  const processorConfig = buildProcessorConfig(allowLargeLlm, allowSmallLlm, overrides);
  const { job } = await ensureImportJob(payload, processorConfig);
  return processImportJob(job.id, overrides);
};

export const requeueDeadLetterImportJob = async (jobId: string): Promise<PersistedImportJob> => {
  const job = await requeueImportJob(jobId);
  if (!job) {
    throw new Error(`Import job not found: ${jobId}`);
  }
  logInfo(`[ingestion][orchestrator] requeueing dead-lettered job=${job.id}`);
  await getJobQueue().enqueue(job.id);
  return job;
};
