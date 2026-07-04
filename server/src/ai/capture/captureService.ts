import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import { isLocalEnv } from '../../env';
import { logError } from '../../logger';
import { incrementMetric } from '../../metrics';
import type { CaptureRecord } from '../types/captureRecord';
import { getAiCaptureBucket, getAiCaptureGcsTarget } from './gcsClient';

const gzip = promisify(zlib.gzip);
const LOCAL_CAPTURE_ROOT = path.resolve(__dirname, '../../../data/ai-capture');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const safePathPart = (value: string): string =>
  String(value || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'unknown';

const captureDate = (record: CaptureRecord): string => {
  const parsed = new Date(record.capturedAt);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
};

const captureObjectPath = (record: CaptureRecord): string =>
  `${safePathPart(record.featureKey)}/${captureDate(record)}/${safePathPart(record.captureId)}.json.gz`;

const serializeRecord = async (record: CaptureRecord): Promise<Buffer> =>
  gzip(Buffer.from(JSON.stringify(record, null, 2), 'utf8'));

const persistLocalCapture = async (record: CaptureRecord): Promise<void> => {
  const relativePath = captureObjectPath(record);
  const targetPath = path.join(LOCAL_CAPTURE_ROOT, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, await serializeRecord(record));
};

const persistGcsCapture = async (record: CaptureRecord): Promise<void> => {
  const target = getAiCaptureGcsTarget();
  const objectName = `${target.objectPrefix}${captureObjectPath(record)}`;
  await getAiCaptureBucket()
    .file(objectName)
    .save(await serializeRecord(record), {
      resumable: false,
      metadata: {
        contentType: 'application/json',
        contentEncoding: 'gzip',
      },
    });
};

const persistCaptureRecord = async (record: CaptureRecord): Promise<void> => {
  if (isLocalEnv() || process.env.NODE_ENV === 'test') {
    await persistLocalCapture(record);
    return;
  }
  await persistGcsCapture(record);
};

const persistWithRetries = async (record: CaptureRecord): Promise<void> => {
  const delays = [0, 0, 200];
  let lastError: unknown;
  for (const delayMs of delays) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      await persistCaptureRecord(record);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  incrementMetric('ai_capture.drop', { featureKey: record.featureKey });
  logError('[ai-capture] capture write failed after retries', {
    captureId: record.captureId,
    featureKey: record.featureKey,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
};

export const captureAiInteraction = (record: CaptureRecord): void => {
  void persistWithRetries(record);
};

export const __persistCaptureRecordForTests = persistCaptureRecord;
