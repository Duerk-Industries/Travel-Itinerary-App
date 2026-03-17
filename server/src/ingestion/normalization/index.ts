import { readTempBytes } from '../shared/tempStorage';
import { buildNormalizedContentHash } from '../shared/hashing';
import { classifyDocumentContent } from '../shared/parserSelection';
import type { IngestionPayload, NormalizedDocument } from '../contracts';

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

const normalizeFromBytes = async (payload: IngestionPayload): Promise<{ normalizedText: string; normalizedHtml?: string | null; extractedTextSource: NormalizedDocument['extractedTextSource'] }> => {
  const bytes = await readTempBytes(payload.contentBytesRef);
  const decoded = decodeText(bytes);
  if (payload.mimeType === 'text/plain') {
    return { normalizedText: decoded, normalizedHtml: null, extractedTextSource: 'text' };
  }
  if (payload.mimeType === 'text/html') {
    return { normalizedText: stripHtml(decoded), normalizedHtml: decoded, extractedTextSource: 'html' };
  }
  if (looksTextLike(decoded)) {
    return { normalizedText: decoded, normalizedHtml: null, extractedTextSource: payload.mimeType.startsWith('image/') ? 'ocr' : 'pdf' };
  }
  return { normalizedText: decoded || 'Unable to extract text from document', normalizedHtml: null, extractedTextSource: 'fallback' };
};

export const normalizeIngestionPayload = async (importJobId: string, payload: IngestionPayload): Promise<NormalizedDocument> => {
  const normalized = await normalizeFromBytes(payload);
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
      metadata: { ...payload.metadata, signalSummary },
      sourceType: payload.sourceType,
      originalFilename: payload.originalFilename,
    }),
    normalizedText,
    normalizedHtml: normalized.normalizedHtml ?? null,
    extractedTextSource: normalized.extractedTextSource,
    rawSourceReference: `${payload.sourceType}:${payload.externalMessageId}`,
    metadata: {
      ...payload.metadata,
      signalSummary,
      extractedTextSource: normalized.extractedTextSource,
    },
    receivedAt: payload.receivedAt,
    correlationId: payload.correlationId,
  };
};
