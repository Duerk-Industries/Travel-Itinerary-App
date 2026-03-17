import { logError } from '../../logger';
import { INGESTION_OCR_MIN_CHAR_COUNT } from '../config';
import type { IngestionPayload, NormalizedDocument, NormalizationQuality } from '../contracts';
import { buildNormalizedContentHash } from '../shared/hashing';
import { classifyDocumentContent } from '../shared/parserSelection';
import { recordParseStageLog } from '../shared/repository';
import { readTempBytes } from '../shared/tempStorage';

const stripHtml = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();

const decodeText = (bytes: Buffer): string => bytes.toString('utf8').replace(/\u0000/g, ' ').trim();

const looksTextLike = (value: string): boolean => {
  if (!value.trim()) return false;
  const printable = value.split('').filter((char) => char >= ' ' || char === '\n' || char === '\r' || char === '\t').length;
  return printable / Math.max(1, value.length) > 0.9;
};

const warnLowQualityNormalization = async (
  importJobId: string,
  correlationId: string,
  piiSafeMessage: string
): Promise<void> => {
  const startedAt = new Date().toISOString();
  await recordParseStageLog({
    importJobId,
    stageName: 'NORMALIZATION',
    stageStatus: 'SUCCEEDED',
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: 0,
    extractorName: 'NormalizationFallback',
    logicVersion: null,
    costEstimate: 0,
    errorCode: null,
    errorClass: 'LOW_QUALITY',
    piiSafeMessage,
    correlationId,
  });
  logError(`[ingestion] normalization fallback import_job_id=${importJobId} message=${piiSafeMessage}`);
};

const normalizeFromBytes = async (
  importJobId: string,
  payload: IngestionPayload
): Promise<{
  normalizedText: string;
  normalizedHtml?: string | null;
  extractedTextSource: NormalizedDocument['extractedTextSource'];
  normalizationQuality: NormalizationQuality;
}> => {
  const bytes = await readTempBytes(payload.contentBytesRef);
  const decoded = decodeText(bytes);
  if (payload.mimeType === 'text/plain') {
    return { normalizedText: decoded, normalizedHtml: null, extractedTextSource: 'text', normalizationQuality: 'FULL_TEXT' };
  }
  if (payload.mimeType === 'text/html') {
    return { normalizedText: stripHtml(decoded), normalizedHtml: decoded, extractedTextSource: 'html', normalizationQuality: 'FULL_TEXT' };
  }
  if (payload.mimeType === 'application/pdf' && looksTextLike(decoded)) {
    return {
      normalizedText: decoded,
      normalizedHtml: null,
      extractedTextSource: 'pdf',
      normalizationQuality: 'STRUCTURAL_EXTRACT',
    };
  }
  if (payload.mimeType.startsWith('image/') && looksTextLike(decoded) && decoded.length >= INGESTION_OCR_MIN_CHAR_COUNT) {
    return {
      normalizedText: decoded,
      normalizedHtml: null,
      extractedTextSource: 'ocr',
      normalizationQuality: 'OCR',
    };
  }
  await warnLowQualityNormalization(
    importJobId,
    payload.correlationId,
    `Fallback byte decode used for ${payload.mimeType}; normalization quality marked LOW.`
  );
  return {
    normalizedText: decoded || 'Unable to extract text from document',
    normalizedHtml: null,
    extractedTextSource: 'fallback',
    normalizationQuality: 'FALLBACK_DECODE',
  };
};

export const normalizeIngestionPayload = async (importJobId: string, payload: IngestionPayload): Promise<NormalizedDocument> => {
  const normalized = await normalizeFromBytes(importJobId, payload);
  const normalizedText = normalized.normalizedText.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const signalSummary = classifyDocumentContent(normalizedText);
  return {
    importJobId,
    userId: payload.userId,
    sourceType: payload.sourceType,
    sourceId: payload.sourceId,
    originalFilename: payload.originalFilename,
    mimeType: payload.mimeType,
    contentHash: payload.contentHash,
    normalizedContentHash: buildNormalizedContentHash({
      normalizedText,
      metadata: { ...payload.metadata, signalSummary, normalizationQuality: normalized.normalizationQuality },
      sourceType: payload.sourceType,
      originalFilename: payload.originalFilename,
    }),
    normalizedText,
    normalizedHtml: normalized.normalizedHtml ?? null,
    extractedTextSource: normalized.extractedTextSource,
    normalizationQuality: normalized.normalizationQuality,
    rawSourceReference: `${payload.sourceType}:${payload.externalMessageId}`,
    metadata: {
      ...payload.metadata,
      signalSummary,
      extractedTextSource: normalized.extractedTextSource,
      normalizationQuality: normalized.normalizationQuality,
    },
    receivedAt: payload.receivedAt,
    correlationId: payload.correlationId,
  };
};
