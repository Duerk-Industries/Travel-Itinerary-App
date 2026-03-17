import { createHash, randomUUID } from 'crypto';
import type { IngestionPayload, ParsedItemCandidate } from '../contracts';

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const createCorrelationId = (): string => randomUUID();

export const buildImportJobIdempotencyKey = (payload: IngestionPayload): string => {
  if (payload.sourceType === 'FORWARDED_MAILBOX' || payload.sourceType === 'GMAIL_IMPORT') {
    return sha256([payload.sourceType, payload.externalMessageId, payload.userId].join('::'));
  }
  return sha256([payload.sourceType, payload.contentHash, payload.userId, payload.originalFilename].join('::'));
};

export const buildNormalizedContentHash = (value: {
  normalizedText: string;
  metadata?: Record<string, unknown>;
  sourceType: string;
  originalFilename: string;
}): string =>
  sha256(
    stableJson({
      normalizedText: value.normalizedText.replace(/\s+/g, ' ').trim(),
      metadata: value.metadata ?? {},
      sourceType: value.sourceType,
      originalFilename: value.originalFilename,
    })
  );

export const buildParsedItemFingerprint = (candidate: Pick<
  ParsedItemCandidate,
  | 'itemType'
  | 'providerVendor'
  | 'confirmationNumber'
  | 'travelerNames'
  | 'startDateTimeUtc'
  | 'endDateTimeUtc'
  | 'extractedFields'
>) =>
  sha256(
    stableJson({
      itemType: candidate.itemType,
      providerVendor: candidate.providerVendor ?? null,
      confirmationNumber: candidate.confirmationNumber ?? null,
      travelerNames: [...candidate.travelerNames].map((name) => name.trim().toLowerCase()).sort(),
      startDateTimeUtc: candidate.startDateTimeUtc ?? null,
      endDateTimeUtc: candidate.endDateTimeUtc ?? null,
      route:
        (candidate.extractedFields.route as unknown) ??
        {
          from: candidate.extractedFields.departureLocation ?? null,
          to: candidate.extractedFields.arrivalLocation ?? null,
        },
    })
  );

export const buildDocumentDeletionHash = (contentHash: string, userId: string): string =>
  sha256(`document-delete::${contentHash}::${userId}`);
