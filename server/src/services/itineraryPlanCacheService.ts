import { createHash } from 'node:crypto';
import { getItineraryPlanCacheEntry, upsertItineraryPlanCacheEntry } from '../db';
import type { AttractionCatalogEntry, ItineraryPlanCacheEntry } from '../types';

export const ITINERARY_CACHE_SCHEMA_VERSION = 'itinerary-cache-v1';

/**
 * Convert cache payloads to the small set of values accepted by every DB
 * adapter. Firestore rejects undefined values and arbitrary class instances
 * nested inside an entity (for example a Date-like SDK object, Map, or a
 * provider response wrapper). Itinerary caches are JSON-shaped, so preserve
 * Dates, recurse through arrays/plain objects, and serialize any other
 * object through toJSON/string rather than sending an invalid nested entity.
 */
export const stripUndefinedDeep = <T>(value: T): T => {
  if (value === undefined) return null as T;
  if (typeof value === 'bigint') return String(value) as T;
  if (typeof value === 'number' && !Number.isFinite(value)) return null as T;
  if (Array.isArray(value)) return value.map((item) => stripUndefinedDeep(item)) as T;
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      const toJSON = (value as any).toJSON;
      if (typeof toJSON === 'function') return stripUndefinedDeep(toJSON.call(value)) as T;
      return String(value) as T;
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefinedDeep(item)])
    ) as T;
  }
  return value;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
};
export const stableHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');

export type TripSignatureInput = {
  destinations: string[]; duration: number; pace: string; comfort: string; mobility: string;
  car: string; interactionStyle: string; budgetMin: number; budgetMax: number; startDate: string; endDate: string;
  weights?: Record<string, number>;
  startHub?: string | null;
  endHub?: string | null;
};

export const buildTripSignature = (input: TripSignatureInput, includeWeights = false): string => stableHash({
  version: ITINERARY_CACHE_SCHEMA_VERSION,
  destinations: input.destinations.map((value) => value.trim().toLowerCase()), duration: input.duration,
  pace: input.pace, comfort: input.comfort, mobility: input.mobility, car: input.car,
  interactionStyle: input.interactionStyle, budgetMin: Math.round(input.budgetMin / 100) * 100,
  budgetMax: Math.round(input.budgetMax / 100) * 100, startDate: input.startDate, endDate: input.endDate,
  ...(includeWeights ? { weights: input.weights ?? {} } : {}),
  startHub: String(input.startHub ?? '').trim().toLowerCase(), endHub: String(input.endHub ?? '').trim().toLowerCase(),
});

export const buildCatalogFingerprint = (byDestination: Record<string, AttractionCatalogEntry[]>): string => stableHash(
  Object.entries(byDestination).sort(([a], [b]) => a.localeCompare(b)).map(([destination, entries]) => ({
    destination: destination.toLowerCase(), entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)).map((entry) => ({
      id: entry.id,
      name: entry.name,
      rank: entry.rank,
      activityType: entry.activityType,
      interestTags: [...entry.interestTags].sort(),
      budgetTier: entry.budgetTier ?? null,
      lat: entry.lat ?? null,
      lon: entry.lon ?? null,
      primaryTag: entry.primaryTag ?? null,
      popularityScore: entry.popularityScore ?? null,
      wikipediaTitle: entry.wikipediaTitle ?? null,
      wikipediaSummary: entry.wikipediaSummary ?? null,
    })),
  }))
);

export const buildPromptFingerprint = (templates: unknown): string => stableHash(templates);
export const buildCacheKey = (stage: 'route' | 'day', signature: string, dependencyFingerprint: string): string =>
  `it-plan:${stage}:${stableHash({ signature, dependencyFingerprint }).slice(0, 40)}`;

export const readItineraryPlanCache = async <T>(params: { stage: 'route' | 'day'; signature: string; dependencyFingerprint: string; now?: Date }): Promise<T | null> => {
  const cacheKey = buildCacheKey(params.stage, params.signature, params.dependencyFingerprint);
  const entry = await getItineraryPlanCacheEntry(cacheKey);
  if (!entry || entry.signature !== params.signature || entry.dependencyFingerprint !== params.dependencyFingerprint) return null;
  if (!entry.expiresAt || new Date(entry.expiresAt).getTime() <= (params.now ?? new Date()).getTime()) return null;
  return entry.payload as T;
};

export const writeItineraryPlanCache = async <T>(params: { stage: 'route' | 'day'; signature: string; dependencyFingerprint: string; payload: T; ttlDays: number; fragments?: unknown[]; now?: Date }): Promise<ItineraryPlanCacheEntry> => {
  const now = params.now ?? new Date();
  const cacheKey = buildCacheKey(params.stage, params.signature, params.dependencyFingerprint);
  return upsertItineraryPlanCacheEntry({
    id: cacheKey, cacheKey, stage: params.stage, signature: params.signature,
    dependencyFingerprint: params.dependencyFingerprint, payload: stripUndefinedDeep(params.payload),
    fragments: stripUndefinedDeep(params.fragments ?? []),
    expiresAt: new Date(now.getTime() + Math.max(1, params.ttlDays) * 86400000).toISOString(), updatedAt: now.toISOString(),
  });
};

export const buildDayFragments = <T>(days: T[], size = 3): T[][] => {
  const fragments: T[][] = [];
  for (let index = 0; index < days.length; index += Math.max(1, size)) fragments.push(days.slice(index, index + Math.max(1, size)));
  return fragments;
};
