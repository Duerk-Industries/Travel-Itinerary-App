import { createHash } from 'crypto';
import type { PersistedParsedItem } from '../contracts';

/** A content precondition, not authorization; permission and matching are checked separately. */
export function reviewItemVersion(item: PersistedParsedItem): string {
  const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, sort(v)])) : value;
  const date = (value: string | null | undefined) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : value ?? null;
  return createHash('sha256').update(JSON.stringify(sort({ id: item.id, owner: item.userId,
    status: item.reviewStatus, itemType: item.itemType, source: item.sourceType, rawDocId: item.rawDocId, importJobId: item.importJobId, fields: item.extractedFields ?? {}, edits: item.editedFields ?? null,
    provider: item.providerVendor ?? null, reference: item.confirmationNumber ?? null, names: item.travelerNames ?? [],
    start: date(item.startDateTimeUtc),
    end: date(item.endDateTimeUtc),
    zone: item.originalTimezone ?? null, timezoneStatus: item.timezoneStatus, confidence: Number(item.confidenceScore),
    duplicate: item.duplicateDisposition ?? null }))).digest('hex');
}
