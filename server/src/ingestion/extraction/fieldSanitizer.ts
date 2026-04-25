import type { ExtractionResult, ParsedItemCandidate } from '../contracts';
import { buildParsedItemFingerprint } from '../shared/hashing';

const NUMERIC_FIELD_NAMES = new Set([
  'cost',
  'totalCost',
  'costPerNight',
  'tax',
  'fees',
  'price',
  'amount',
]);

const TEXTUAL_LOCATION_FIELDS = new Set([
  'address',
  'location',
  'startLocation',
  'departureLocation',
  'arrivalLocation',
  'pickupLocation',
  'dropoffLocation',
  'venue',
]);

const GENERIC_TEXT_FIELDS = new Set([
  'summary',
  'name',
  'reference',
  'confirmationNumber',
  'providerVendor',
  'notes',
  'roomType',
  'vehicleType',
  'model',
]);

const stripUrlsAndMarkup = (value: string): string => {
  const withoutMarkdownLinks = value.replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, '$1');
  const withoutHtml = withoutMarkdownLinks.replace(/<[^>]+>/g, ' ');
  const withoutUrls = withoutHtml.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ');
  const withoutMailto = withoutUrls.replace(/\bmailto:\S+/gi, ' ');
  return withoutMailto;
};

const normalizeWhitespace = (value: string): string =>
  value
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const sanitizeText = (value: unknown): string | null => {
  const text = normalizeWhitespace(stripUrlsAndMarkup(String(value ?? '')));
  return text || null;
};

const sanitizeNumeric = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = sanitizeText(value);
  if (!text) return null;
  const match = text.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
};

const sanitizeAddressLike = (value: unknown): string | null => {
  const text = sanitizeText(value);
  if (!text) return null;
  const cleaned = text
    .replace(/\b(?:click here|view map|open in maps|directions|website|more info)\b/gi, ' ')
    .replace(/\s+[-|:]\s+$/g, '')
    .replace(/[|]{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || null;
};

const sanitizeFieldValue = (fieldName: string, value: unknown): unknown => {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => sanitizeFieldValue(fieldName, entry))
      .filter((entry) => entry !== null && entry !== '');
    return entries;
  }
  if (typeof value === 'object') {
    return value;
  }
  if (NUMERIC_FIELD_NAMES.has(fieldName)) {
    return sanitizeNumeric(value);
  }
  if (TEXTUAL_LOCATION_FIELDS.has(fieldName)) {
    return sanitizeAddressLike(value);
  }
  if (GENERIC_TEXT_FIELDS.has(fieldName)) {
    return sanitizeText(value);
  }
  if (typeof value === 'string') {
    return sanitizeText(value);
  }
  return value;
};

const sanitizeTravelerNames = (travelerNames: string[]): string[] =>
  Array.from(
    new Set(
      travelerNames
        .map((name) => sanitizeText(name))
        .filter(Boolean) as string[]
    )
  );

export const sanitizeParsedItemCandidate = (candidate: ParsedItemCandidate): ParsedItemCandidate => {
  const extractedFields = Object.entries(candidate.extractedFields ?? {}).reduce<Record<string, unknown>>((acc, [fieldName, value]) => {
    const sanitizedValue = sanitizeFieldValue(fieldName, value);
    if (sanitizedValue == null) return acc;
    if (Array.isArray(sanitizedValue) && sanitizedValue.length === 0) return acc;
    if (sanitizedValue === '') return acc;
    acc[fieldName] = sanitizedValue;
    return acc;
  }, {});

  const sanitized: ParsedItemCandidate = {
    ...candidate,
    providerVendor: sanitizeText(candidate.providerVendor),
    confirmationNumber: sanitizeText(candidate.confirmationNumber),
    travelerNames: sanitizeTravelerNames(candidate.travelerNames),
    rawSourceReference: sanitizeText(candidate.rawSourceReference) ?? '',
    extractedFields,
  };

  sanitized.deduplicationFingerprint = buildParsedItemFingerprint(sanitized);
  return sanitized;
};

export const sanitizeExtractionResult = (result: ExtractionResult): ExtractionResult => ({
  ...result,
  parsedItems: result.parsedItems.map((candidate) => sanitizeParsedItemCandidate(candidate)),
});
