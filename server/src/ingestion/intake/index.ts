import multer from 'multer';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { INGESTION_MAX_FILE_BYTES, getIngestionForwardingAddress } from '../config';
import type { IngestionPayload, IngestionSourceType } from '../contracts';
import { sha256 } from '../shared/hashing';
import { isSupportedMimeType, normalizeMimeType } from '../shared/parserSelection';
import { writeTempBytes } from '../shared/tempStorage';
import { IngestionError } from '../shared/userFailures';
import { recordVirusScanResult, scanDocumentOrStub } from '../shared/virusScan';
import { getVirusScanner } from '../virusScanProviders';

const memoryStorage = multer.memoryStorage();

export const manualUploadMiddleware = multer({
  storage: memoryStorage,
  limits: { fileSize: INGESTION_MAX_FILE_BYTES, files: 10 },
});

const ensureFiles = (req: Request): Express.Multer.File[] => {
  const files = ((req.files as Express.Multer.File[]) ?? []) as Express.Multer.File[];
  if (!files.length) {
    throw new IngestionError('unsupported_file_type', 400, undefined, 'At least one file is required.');
  }
  return files;
};

export const buildManualUploadPayloads = async (req: Request, userId: string): Promise<IngestionPayload[]> => {
  const files = ensureFiles(req);

  // Batch-level decision: the stub adapter's `scanBatch` is still the short-
  // circuit for environments that opt out of real per-file scanning. If the
  // batch-level scan returns FAILED we reject the entire upload up-front.
  const batchScan = await scanDocumentOrStub();
  if (batchScan.status === 'FAILED') {
    throw new IngestionError('virus_scan_failed', 400);
  }

  // Per-file scan when the adapter implements it (e.g. the ClamAV HTTP
  // adapter). The stub adapter has no `scanBuffer` method so the optional
  // chain returns undefined and we fall through to the batch-scan result.
  const scanner = getVirusScanner();
  return Promise.all(
    files.map(async (file) => {
      if (!file.buffer || file.size > INGESTION_MAX_FILE_BYTES) {
        throw new IngestionError('file_too_large', 400);
      }
      const mimeType = normalizeMimeType(file.mimetype, file.originalname);
      if (!isSupportedMimeType(mimeType)) {
        throw new IngestionError('unsupported_file_type', 400, undefined, `Unsupported file type: ${file.originalname}`);
      }

      const perFileScan = scanner.scanBuffer
        ? await scanner.scanBuffer(file.buffer, file.originalname)
        : null;
      if (perFileScan) recordVirusScanResult('buffer', perFileScan);
      if (perFileScan?.status === 'FAILED') {
        // Reject infected / unscannable files with the same user-visible
        // failure code as the batch path.
        throw new IngestionError('virus_scan_failed', 400);
      }
      const effectiveScan = perFileScan ?? batchScan;

      const contentBytesRef = await writeTempBytes(file.originalname, file.buffer);
      return {
        sourceType: 'MANUAL_UPLOAD' as IngestionSourceType,
        sourceId: randomUUID(),
        userId,
        externalMessageId: `manual:${randomUUID()}`,
        receivedAt: new Date().toISOString(),
        originalFilename: file.originalname,
        mimeType,
        contentBytesRef,
        contentHash: sha256(file.buffer.toString('base64')),
        metadata: {
          size: file.size,
          originalFieldName: file.fieldname,
          forwardingAddress: getIngestionForwardingAddress(),
          virusScanProvider: effectiveScan.provider,
        },
        correlationId: randomUUID(),
        dryRun: false,
        virusScanStatus: effectiveScan.status,
      };
    })
  );
};

export const buildWebhookPayload = async (params: {
  sourceType: Extract<IngestionSourceType, 'FORWARDED_MAILBOX' | 'GMAIL_IMPORT'>;
  userId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  externalMessageId: string;
  metadata?: Record<string, unknown>;
  dryRun?: boolean;
}): Promise<IngestionPayload> => {
  const batchScan = await scanDocumentOrStub();
  if (batchScan.status === 'FAILED') {
    throw new IngestionError('virus_scan_failed', 400);
  }
  // Per-file scan when the adapter provides it (ClamAV HTTP adapter).
  // Mailgun + Gmail attachments flow through here with real bytes, so this
  // is where real-provider scanning actually kicks in for email sources.
  const scanner = getVirusScanner();
  const perFileScan = scanner.scanBuffer
    ? await scanner.scanBuffer(params.bytes, params.filename)
    : null;
  if (perFileScan) recordVirusScanResult('buffer', perFileScan);
  if (perFileScan?.status === 'FAILED') {
    throw new IngestionError('virus_scan_failed', 400);
  }
  const effectiveScan = perFileScan ?? batchScan;

  const contentBytesRef = await writeTempBytes(params.filename, params.bytes);
  return {
    sourceType: params.sourceType,
    sourceId: randomUUID(),
    userId: params.userId,
    externalMessageId: params.externalMessageId,
    receivedAt: new Date().toISOString(),
    originalFilename: params.filename,
    mimeType: normalizeMimeType(params.mimeType, params.filename),
    contentBytesRef,
    contentHash: sha256(params.bytes.toString('base64')),
    metadata: {
      ...(params.metadata ?? {}),
      virusScanProvider: effectiveScan.provider,
    },
    correlationId: randomUUID(),
    dryRun: Boolean(params.dryRun),
    virusScanStatus: effectiveScan.status,
  };
};

export * from './mailgun';
export * from './gmail';
