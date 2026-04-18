import { INGESTION_SUPPORTED_MIME_TYPES } from '../config';

export const isSupportedMimeType = (mimeType: string): boolean =>
  INGESTION_SUPPORTED_MIME_TYPES.includes(mimeType.toLowerCase() as (typeof INGESTION_SUPPORTED_MIME_TYPES)[number]);

export const normalizeMimeType = (mimeType: string, filename: string): string => {
  const normalized = String(mimeType ?? '').trim().toLowerCase();
  const lowerName = filename.toLowerCase();
  const inferFromFilename = (): string => {
    if (lowerName.endsWith('.txt')) return 'text/plain';
    if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) return 'text/html';
    if (lowerName.endsWith('.pdf')) return 'application/pdf';
    if (lowerName.endsWith('.png')) return 'image/png';
    if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
    if (lowerName.endsWith('.webp')) return 'image/webp';
    return normalized || 'application/octet-stream';
  };
  if (normalized && normalized !== 'application/octet-stream') return normalized;
  return inferFromFilename();
};

export const classifyDocumentContent = (text: string): {
  likelyTravelRelated: boolean;
  containsFlightSignals: boolean;
  containsLodgingSignals: boolean;
} => {
  const normalized = text.toLowerCase();
  const containsFlightSignals =
    /\b(flight|boarding|departure|arrival|airline|ticket|reservation code|pnr)\b/.test(normalized);
  const containsLodgingSignals =
    /\b(hotel|lodging|check-in|check-out|reservation|stay|room)\b/.test(normalized);
  const likelyTravelRelated =
    containsFlightSignals ||
    containsLodgingSignals ||
    /\b(itinerary|route|confirmation|boarding pass|car rental|restaurant reservation|event ticket)\b/.test(normalized);
  return { likelyTravelRelated, containsFlightSignals, containsLodgingSignals };
};
