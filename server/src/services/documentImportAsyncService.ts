import { randomUUID } from 'crypto';
import { normalizeIngestionPayload } from '../ingestion/normalization';
import type { IngestionPayload } from '../ingestion/contracts';
import { logError, logInfo } from '../logger';
import { importItineraryDocument, type ImportDocumentResult } from './itineraryDocumentImportService';

// Mirrors the pattern in itineraryAsyncService.ts: normalization (OCR / PDF
// text extraction) and LLM extraction are both slow enough to blow past
// Firebase Hosting's fixed 60s rewrite-to-Cloud-Run timeout (see
// docs/expo-deployment-checklist.md's Firebase Hosting note and the Cloud Run
// logs that motivated this — a single manual test took 121s end-to-end).
// Hosting returns its own 502 to the browser once that timeout trips, even
// though the Cloud Run request is still running server-side. Running the
// work as a background job and having the client poll keeps the initial HTTP
// response well under that ceiling.

type AsyncStatus = 'queued' | 'running' | 'completed' | 'failed';

export type AsyncDocumentImportJob = {
  id: string;
  userId: string;
  tripId: string;
  status: AsyncStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  result?: ImportDocumentResult;
};

type QueueInput = {
  userId: string;
  tripId: string;
  /** Set when the request came in as pasted text; mutually exclusive with `payload`. */
  documentText?: string;
  /** Set when the request came in as an uploaded file; normalization runs in the job. */
  payload?: IngestionPayload;
  sourceFilename: string;
  dryRun: boolean;
  correlationId?: string;
};

const jobs = new Map<string, AsyncDocumentImportJob>();
const jobRuns = new Map<string, Promise<void>>();

// Same retention shape as itineraryAsyncService.ts's job store — this is a
// second, independent in-memory map, not shared with it, so it needs its own
// cap so a burst of document imports can't grow the process unbounded.
const JOB_RETENTION_LIMIT = Number(process.env.DOCUMENT_IMPORT_JOB_RETENTION_LIMIT ?? 2000);
const JOB_RETENTION_TTL_MS = Number(
  process.env.DOCUMENT_IMPORT_JOB_RETENTION_TTL_MS ?? 24 * 60 * 60 * 1000,
);

const pruneStaleJobs = (opts: { limit?: number; ttlMs?: number; now?: number } = {}): void => {
  if (jobs.size === 0) return;
  const limit = opts.limit ?? JOB_RETENTION_LIMIT;
  const ttlMs = opts.ttlMs ?? JOB_RETENTION_TTL_MS;
  const now = opts.now ?? Date.now();

  if (ttlMs > 0) {
    for (const [id, job] of jobs) {
      if (job.status !== 'completed' && job.status !== 'failed') continue;
      const updated = Date.parse(job.updatedAt);
      if (Number.isFinite(updated) && now - updated > ttlMs) {
        jobs.delete(id);
      }
    }
  }

  if (limit > 0 && jobs.size > limit) {
    const sortable: Array<{ id: string; updated: number; terminal: boolean }> = [];
    for (const [id, job] of jobs) {
      sortable.push({
        id,
        updated: Date.parse(job.updatedAt) || 0,
        terminal: job.status === 'completed' || job.status === 'failed',
      });
    }
    sortable.sort((a, b) => {
      if (a.terminal !== b.terminal) return a.terminal ? -1 : 1;
      return a.updated - b.updated;
    });
    while (jobs.size > limit && sortable.length) {
      const victim = sortable.shift();
      if (victim) jobs.delete(victim.id);
    }
  }
};

const nowIso = (): string => new Date().toISOString();

const runJob = async (jobId: string, input: QueueInput): Promise<void> => {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'running';
  job.updatedAt = nowIso();
  jobs.set(jobId, job);

  try {
    let documentText = input.documentText ?? '';
    if (input.payload) {
      const normalized = await normalizeIngestionPayload(jobId, input.payload);
      documentText = normalized.normalizedText;
    }
    if (!documentText.trim()) {
      throw new Error('Document text or a supported file is required');
    }

    const result = await importItineraryDocument({
      tripId: input.tripId,
      userId: input.userId,
      documentText,
      sourceFilename: input.sourceFilename,
      dryRun: input.dryRun,
      correlationId: input.correlationId,
    });

    job.status = 'completed';
    job.result = result;
    job.updatedAt = nowIso();
    jobs.set(jobId, job);
    logInfo(
      `[document-import][async] completed job=${jobId} trip=${input.tripId} added=${result.added.length} dryRun=${result.dryRun}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.error = message;
    job.updatedAt = nowIso();
    jobs.set(jobId, job);
    logError(`[document-import][async] failed job=${jobId} trip=${input.tripId}`, err);
  }
};

export const enqueueAsyncDocumentImportJob = (input: QueueInput): AsyncDocumentImportJob => {
  const id = randomUUID();
  const now = nowIso();
  const job: AsyncDocumentImportJob = {
    id,
    userId: input.userId,
    tripId: input.tripId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);
  pruneStaleJobs();
  logInfo(`[document-import][async] queued job=${id} trip=${input.tripId}`);
  const runPromise = new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      runJob(id, input).then(resolve, reject);
    }, 0);
  });
  jobRuns.set(id, runPromise);
  runPromise
    .finally(() => {
      if (jobRuns.get(id) === runPromise) {
        jobRuns.delete(id);
      }
    })
    .catch(() => undefined);
  return job;
};

export const getAsyncDocumentImportJob = (jobId: string): AsyncDocumentImportJob | null => jobs.get(jobId) ?? null;

const waitForJobForTest = async (jobId: string, timeoutMs = 10000): Promise<AsyncDocumentImportJob | null> => {
  const runPromise = jobRuns.get(jobId);
  if (runPromise) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        runPromise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`Timed out waiting for document import job ${jobId}`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  return getAsyncDocumentImportJob(jobId);
};

// Test-only helper, mirroring itineraryAsyncService.ts's __testing export.
export const __testing = {
  jobs,
  jobRuns,
  waitForJob: waitForJobForTest,
  pruneStaleJobs,
  JOB_RETENTION_LIMIT,
  JOB_RETENTION_TTL_MS,
};
