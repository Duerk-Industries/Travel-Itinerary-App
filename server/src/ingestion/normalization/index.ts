import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';
import { getEnvFlag } from '../../env';
import { logError, logInfo } from '../../logger';
import { INGESTION_MAX_NORMALIZED_TEXT_BYTES, INGESTION_OCR_MIN_CHAR_COUNT } from '../config';
import type { IngestionPayload, NormalizedDocument, NormalizationQuality } from '../contracts';
import { extractImageTextViaOcr } from './ocr';
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
const debugPreview = (value: string, maxChars = 2000): string =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars)}... [truncated ${value.length - maxChars} chars]`;
let pdfJsModulePromise: Promise<any> | null = null;
let pdfParsePromise: Promise<((dataBuffer: Buffer) => Promise<{ text?: string | null }>)> | null = null;
const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
const requireModule = createRequire(__filename);

const resolvePdfJsSpecifiers = (): string[] => {
  const specifiers = ['pdfjs-dist/legacy/build/pdf.mjs'];
  const bundledPdfJsPath = path.resolve(__dirname, '../../../../app/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  specifiers.push(pathToFileURL(bundledPdfJsPath).href);
  return specifiers;
};

const getPdfJs = async (): Promise<any> => {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = (async () => {
      let lastError: unknown = null;
      for (const specifier of resolvePdfJsSpecifiers()) {
        try {
          return await nativeImport(specifier);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError ?? new Error('Unable to resolve pdfjs-dist.');
    })();
  }
  return pdfJsModulePromise;
};

const getPdfParse = async (): Promise<(dataBuffer: Buffer) => Promise<{ text?: string | null }>> => {
  if (!pdfParsePromise) {
    pdfParsePromise = Promise.resolve(
      requireModule('pdf-parse') as (dataBuffer: Buffer) => Promise<{ text?: string | null }>
    );
  }
  return pdfParsePromise;
};

const extractPdfText = async (bytes: Buffer): Promise<string> => {
  try {
    const pdfParse = await getPdfParse();
    const parsed = await pdfParse(bytes);
    const pdfParseText = String(parsed?.text ?? '').trim();
    if (looksTextLike(pdfParseText)) {
      return pdfParseText;
    }
  } catch {
    // Fall through to the secondary parser below.
  }
  try {
    const pdfjs = await getPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false,
    });
    const pdf = await loadingTask.promise;
    try {
      const pageTexts: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const tokens = (content.items ?? [])
          .map((item: any) => String(item?.str ?? '').trim())
          .filter(Boolean);
        if (tokens.length) {
          pageTexts.push(tokens.join(' '));
        }
      }
      const pdfJsText = pageTexts.join('\n').trim();
      if (looksTextLike(pdfJsText)) {
        return pdfJsText;
      }
    } finally {
      await pdf.destroy?.();
      loadingTask.destroy?.();
    }
  } catch {
    // Fall through to the secondary parser below.
  }
  return '';
};

const looksTextLike = (value: string): boolean => {
  if (!value.trim()) return false;
  const printable = value.split('').filter((char) => char >= ' ' || char === '\n' || char === '\r' || char === '\t').length;
  return printable / Math.max(1, value.length) > 0.9;
};

const hasExpectedImageSignature = (bytes: Buffer, mimeType: string): boolean => {
  if (mimeType === 'image/png') {
    return bytes.length >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a;
  }
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/webp') {
    return bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
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
  if (payload.mimeType === 'application/pdf') {
    const decodedLooksTextLike = looksTextLike(decoded);
    if (decodedLooksTextLike && !decoded.trimStart().startsWith('%PDF-')) {
      return {
        normalizedText: decoded,
        normalizedHtml: null,
        extractedTextSource: 'pdf',
        normalizationQuality: 'STRUCTURAL_EXTRACT',
      };
    }
    try {
      const pdfText = await extractPdfText(bytes);
      if (looksTextLike(pdfText)) {
        return {
          normalizedText: pdfText,
          normalizedHtml: null,
          extractedTextSource: 'pdf',
          normalizationQuality: 'STRUCTURAL_EXTRACT',
        };
      }
    } catch (error) {
      logError(`[ingestion] pdf extraction failed import_job_id=${importJobId}`, error);
    }
    if (decodedLooksTextLike) {
      return {
        normalizedText: decoded,
        normalizedHtml: null,
        extractedTextSource: 'pdf',
        normalizationQuality: 'STRUCTURAL_EXTRACT',
      };
    }
  }
  if (payload.mimeType.startsWith('image/')) {
    if (hasExpectedImageSignature(bytes, payload.mimeType)) {
      try {
        const ocrText = await extractImageTextViaOcr(bytes, payload.mimeType);
        if (looksTextLike(ocrText) && ocrText.length >= INGESTION_OCR_MIN_CHAR_COUNT) {
          return {
            normalizedText: ocrText,
            normalizedHtml: null,
            extractedTextSource: 'ocr',
            normalizationQuality: 'OCR',
          };
        }
        logInfo(
          `[ingestion][ocr] low-yield result import_job_id=${importJobId} mime=${payload.mimeType} chars=${ocrText.length}`
        );
      } catch (error) {
        logError(`[ingestion][ocr] extraction failed import_job_id=${importJobId} mime=${payload.mimeType}`, error);
      }
    } else {
      logInfo(
        `[ingestion][ocr] skipped invalid image signature import_job_id=${importJobId} mime=${payload.mimeType}`
      );
    }
    if (looksTextLike(decoded) && decoded.length >= INGESTION_OCR_MIN_CHAR_COUNT) {
      logInfo(
        `[ingestion][ocr] using byte-decode fallback import_job_id=${importJobId} mime=${payload.mimeType} chars=${decoded.length}`
      );
      return {
        normalizedText: decoded,
        normalizedHtml: null,
        extractedTextSource: 'fallback',
        normalizationQuality: 'FALLBACK_DECODE',
      };
    }
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
  let normalizedText = normalized.normalizedText.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  // Firestore limits a single field to ~1 MB. Truncate oversized text to prevent write failures.
  const byteLength = Buffer.byteLength(normalizedText, 'utf8');
  if (byteLength > INGESTION_MAX_NORMALIZED_TEXT_BYTES) {
    logInfo(
      `[ingestion] normalizedText exceeds limit (${byteLength} bytes), truncating to ${INGESTION_MAX_NORMALIZED_TEXT_BYTES} bytes import_job_id=${importJobId}`
    );
    // Truncate at a safe UTF-8 boundary by encoding, slicing, then decoding
    const buf = Buffer.from(normalizedText, 'utf8');
    normalizedText = buf.subarray(0, INGESTION_MAX_NORMALIZED_TEXT_BYTES).toString('utf8')
      // Remove a potential partial multi-byte character at the end
      .replace(/[\uFFFD]$/, '')
      .trimEnd();
    normalized.normalizationQuality = normalized.normalizationQuality === 'FULL_TEXT'
      ? 'FULL_TEXT' : 'FALLBACK_DECODE';
    await warnLowQualityNormalization(
      importJobId,
      payload.correlationId,
      `normalizedText truncated from ${byteLength} to ${INGESTION_MAX_NORMALIZED_TEXT_BYTES} bytes; content may be incomplete.`
    );
  }

  const signalSummary = classifyDocumentContent(normalizedText);
  if (getEnvFlag('INGESTION_DEBUG_LLM')) {
    logInfo(
      `[ingestion][debug][normalize] job=${importJobId} file="${payload.originalFilename}" mime=${payload.mimeType} source=${normalized.extractedTextSource} quality=${normalized.normalizationQuality} preview=${JSON.stringify(
        debugPreview(normalizedText)
      )}`
    );
  }
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
