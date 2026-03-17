import multer from 'multer';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { INGESTION_DEFAULT_FORWARDING_ADDRESS, INGESTION_MAX_FILE_BYTES } from '../config';
import type { IngestionPayload, IngestionSourceType } from '../contracts';
import { sha256 } from '../shared/hashing';
import { normalizeMimeType } from '../shared/parserSelection';
import { writeTempBytes } from '../shared/tempStorage';
import { IngestionError } from '../shared/userFailures';
import { scanDocumentOrStub } from '../shared/virusScan';

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
  const scan = await scanDocumentOrStub();
  if (scan.status === 'FAILED') {
    throw new IngestionError('virus_scan_failed', 400);
  }
  return Promise.all(
    files.map(async (file) => {
      if (!file.buffer || file.size > INGESTION_MAX_FILE_BYTES) {
        throw new IngestionError('file_too_large', 400);
      }
      const contentBytesRef = await writeTempBytes(file.originalname, file.buffer);
      return {
        sourceType: 'MANUAL_UPLOAD' as IngestionSourceType,
        sourceId: randomUUID(),
        userId,
        externalMessageId: `manual:${randomUUID()}`,
        receivedAt: new Date().toISOString(),
        originalFilename: file.originalname,
        mimeType: normalizeMimeType(file.mimetype, file.originalname),
        contentBytesRef,
        contentHash: sha256(file.buffer.toString('base64')),
        metadata: {
          size: file.size,
          originalFieldName: file.fieldname,
          forwardingAddress: INGESTION_DEFAULT_FORWARDING_ADDRESS,
          virusScanProvider: scan.provider,
        },
        correlationId: randomUUID(),
        dryRun: false,
        virusScanStatus: scan.status,
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
  const scan = await scanDocumentOrStub();
  if (scan.status === 'FAILED') {
    throw new IngestionError('virus_scan_failed', 400);
  }
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
      virusScanProvider: scan.provider,
    },
    correlationId: randomUUID(),
    dryRun: Boolean(params.dryRun),
    virusScanStatus: scan.status,
  };
};

export * from './mailgun';
export * from './gmail';
