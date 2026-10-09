import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import pLimit from 'p-limit';
import { getEnvValue } from '../../env';
import { logInfo } from '../../logger';
import { getAiCaptureBucket, getAiCaptureGcsTarget } from '../capture/gcsClient';
import { isLocalCaptureBackend } from '../capture/captureService';
import type { CaptureRecord } from '../types/captureRecord';

const gunzip = promisify(zlib.gunzip);
// AI_CAPTURE_LOCAL_ROOT lets tests point this at an isolated temp directory instead of the real,
// gitignored logs/ai-capture — a long-running local dev environment accumulates thousands of real
// capture files there, and scanning/gunzipping all of them on every query is both slow and (via
// unbounded concurrent fs reads) prone to sporadic failures that have nothing to do with what the
// test is actually asserting.
const resolveLocalCaptureRoot = (): string =>
  getEnvValue('AI_CAPTURE_LOCAL_ROOT')?.trim() || path.resolve(__dirname, '../../../logs/ai-capture');

export type CaptureBrowserQuery = {
  featureKey?: string;
  captureId?: string;
  correlationId?: string;
  jobId?: string;
  anonymousUserId?: string;
  provider?: string;
  model?: string;
  outcome?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

export type CaptureBrowserItem = {
  captureId: string;
  featureKey: string;
  capturedAt: string;
  correlationId?: string;
  jobId?: string;
  anonymousUserId?: string;
  provider?: string;
  model?: string;
  callerId?: string;
  outcome: string;
  latencyMs?: number;
  tokenUsage?: CaptureRecord['tokenUsage'];
  payloadSummary: Record<string, unknown>;
};

const listFiles = async (dir: string): Promise<string[]> => {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith('.json.gz') && !entry.name.endsWith('.evaluation.json.gz')) {
      return [fullPath];
    }
    return [];
  }));
  return nested.flat();
};

const parseCaptureBuffer = async (buffer: Buffer): Promise<CaptureRecord | null> => {
  try {
    // Objects are stored gzipped; GCS may already have decompressed them in transit
    // (decompressive transcoding), so only gunzip when the gzip magic bytes are present.
    const isGzip = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
    const text = (isGzip ? await gunzip(buffer) : buffer).toString('utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as CaptureRecord : null;
  } catch {
    return null;
  }
};

const readCapture = async (filePath: string): Promise<CaptureRecord | null> => {
  try {
    return await parseCaptureBuffer(await fs.readFile(filePath));
  } catch {
    return null;
  }
};

const inRange = (capturedAt: string, query: CaptureBrowserQuery): boolean => {
  const day = new Date(capturedAt).toISOString().slice(0, 10);
  if (query.dateFrom && day < query.dateFrom) return false;
  if (query.dateTo && day > query.dateTo) return false;
  return true;
};

const matches = (record: CaptureRecord, query: CaptureBrowserQuery): boolean => {
  if (query.featureKey && record.featureKey !== query.featureKey) return false;
  if (query.captureId && record.captureId !== query.captureId) return false;
  if (query.correlationId && record.correlationId !== query.correlationId) return false;
  if (query.jobId && record.jobId !== query.jobId) return false;
  if (query.anonymousUserId && record.anonymousUserId !== query.anonymousUserId) return false;
  if (query.provider && record.provider !== query.provider) return false;
  if (query.model && record.model !== query.model) return false;
  if (query.outcome && record.outcome !== query.outcome) return false;
  return inRange(record.capturedAt, query);
};

const payloadSummary = (payload: Record<string, unknown>): Record<string, unknown> => ({
  sourceType: payload.sourceType,
  strategyName: payload.strategyName,
  logicVersion: payload.logicVersion,
  estimatedCostUsd: payload.estimatedCostUsd,
  parsedItemCount: Array.isArray(payload.parsedItems) ? payload.parsedItems.length : undefined,
  comparison: payload.comparison,
});

export const listLocalAiCaptures = async (query: CaptureBrowserQuery = {}): Promise<CaptureBrowserItem[]> => {
  const limit = Math.max(1, Math.min(Number(query.limit ?? 50), 250));
  const files = await listFiles(resolveLocalCaptureRoot());
  const records = (await Promise.all(files.map(readCapture)))
    .filter((record): record is CaptureRecord => Boolean(record))
    .filter((record) => matches(record, query))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .slice(0, limit);

  return records.map((record) => ({
    captureId: record.captureId,
    featureKey: record.featureKey,
    capturedAt: record.capturedAt,
    correlationId: record.correlationId,
    jobId: record.jobId,
    anonymousUserId: record.anonymousUserId,
    provider: record.provider,
    model: record.model,
    callerId: record.callerId,
    outcome: record.outcome,
    latencyMs: record.latencyMs,
    tokenUsage: record.tokenUsage,
    payloadSummary: payloadSummary(record.payload ?? {}),
  }));
};

export const getLocalAiCaptureRecord = async (captureId: string): Promise<CaptureRecord | null> => {
  const files = await listFiles(resolveLocalCaptureRoot());
  for (const file of files) {
    const record = await readCapture(file);
    if (record?.captureId === captureId) return record;
  }
  return null;
};

/** Upper bound on objects read per day so one run's cost and memory stay bounded. */
export const MAX_GCS_CAPTURES_PER_DAY = 5_000;
const GCS_READ_CONCURRENCY = 8;

/**
 * Reads one UTC day's captures from the configured Cloud Storage bucket. Objects are
 * written as `{prefix}{featureKey}/{YYYY-MM-DD}/{captureId}.json.gz`, so the day is
 * selected by glob rather than by listing the whole bucket; evaluation sidecars are skipped.
 */
export const readGcsAiCaptureRecordsForDay = async (day: string): Promise<CaptureRecord[]> => {
  const { objectPrefix } = getAiCaptureGcsTarget();
  const [files] = await getAiCaptureBucket().getFiles({
    prefix: objectPrefix || undefined,
    matchGlob: `${objectPrefix}*/${day}/*.json.gz`,
  });
  const captures = files.filter((file) => !file.name.endsWith('.evaluation.json.gz'));
  if (captures.length > MAX_GCS_CAPTURES_PER_DAY) {
    logInfo(`[ai-analytics] capture read truncated day=${day} available=${captures.length} read=${MAX_GCS_CAPTURES_PER_DAY}`);
  }
  const limit = pLimit(GCS_READ_CONCURRENCY);
  const records = await Promise.all(
    captures.slice(0, MAX_GCS_CAPTURES_PER_DAY).map((file) =>
      limit(async () => {
        try {
          const [contents] = await file.download();
          return await parseCaptureBuffer(contents);
        } catch {
          return null;
        }
      }),
    ),
  );
  return records
    .filter((record): record is CaptureRecord => Boolean(record))
    .filter((record) => new Date(record.capturedAt).toISOString().slice(0, 10) === day);
};

/** Reads a day's captures from wherever captureService writes them (local disk or Cloud Storage). */
export const readAiCaptureRecordsForDay = async (day: string): Promise<CaptureRecord[]> =>
  isLocalCaptureBackend() ? readLocalAiCaptureRecordsForDay(day) : readGcsAiCaptureRecordsForDay(day);

export const readLocalAiCaptureRecordsForDay = async (day: string): Promise<CaptureRecord[]> => {
  const files = await listFiles(resolveLocalCaptureRoot());
  const records = await Promise.all(files.map(readCapture));
  return records
    .filter((record): record is CaptureRecord => Boolean(record))
    .filter((record) => new Date(record.capturedAt).toISOString().slice(0, 10) === day);
};
