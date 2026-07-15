import axios from 'axios';
import { getApiCacheSetting } from '../config/apiLimits';
import { getAttractionDurationMetadata, listAttractionDurationMetadataByDestination, upsertAttractionDurationMetadata } from '../db';
import { logError } from '../logger';
import type { ActivityType, AttractionDurationMetadata } from '../types';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { recordProviderRequestCost } from '../apis/providerBudgeting';

export const ACTIVITY_TYPE_DURATION_MINUTES: Record<ActivityType, number> = {
  'Sights & Landmarks': 45,
  'Ticketed Attraction': 150,
  Tour: 180,
  'Outdoor Activity': 90,
  Hike: 150,
  'Day Trip': 480,
  'Food & Drink': 90,
  Shopping: 90,
  Nightlife: 120,
  'Concert/Show': 150,
  Event: 120,
  'Fun & Games': 90,
  Class: 120,
  Reservation: 90,
  'Spa/Wellness': 120,
  'Open Access': 60,
};

const NAME_DURATION_OVERRIDES: Array<{ pattern: RegExp; minutes: number }> = [
  { pattern: /museum/i, minutes: 150 },
  { pattern: /(gallery|aquarium|zoo)/i, minutes: 120 },
  { pattern: /\b(tower|observation deck|lookout)\b/i, minutes: 45 },
  { pattern: /\b(park|square|garden|plaza)\b/i, minutes: 90 },
  { pattern: /\b(tour|excursion)\b/i, minutes: 180 },
];

const PRE_ORDER_NAME_PATTERNS: RegExp[] = [
  /museum/i,
  /\b(tower|observation deck|skydeck|lookout)\b/i,
  /\b(theater|theatre|show|concert)\b/i,
  /\baquarium|zoo\b/i,
  /\bpalace|castle|colosseum\b/i,
];

const PRE_ORDER_ACTIVITY_TYPES: ActivityType[] = ['Ticketed Attraction', 'Tour', 'Concert/Show', 'Event'];

export const estimateAttractionDurationMinutes = (name: string, activityType: ActivityType): number => {
  const override = NAME_DURATION_OVERRIDES.find((entry) => entry.pattern.test(name));
  if (override) return override.minutes;
  return ACTIVITY_TYPE_DURATION_MINUTES[activityType] ?? 90;
};

export const inferRequiresPreOrderTickets = (name: string, activityType: ActivityType): boolean => {
  if (PRE_ORDER_NAME_PATTERNS.some((pattern) => pattern.test(name))) return true;
  return PRE_ORDER_ACTIVITY_TYPES.includes(activityType);
};

const isStale = (metadata: AttractionDurationMetadata | null, refreshDays: number): boolean => {
  if (!metadata) return true;
  const ts = new Date(metadata.updatedAt).getTime();
  if (!Number.isFinite(ts)) return true;
  const thresholdMs = Math.max(1, refreshDays) * 24 * 60 * 60 * 1000;
  return Date.now() - ts > thresholdMs;
};

// Negative-cache entries (a Wikipedia lookup that found no description) use a
// much shorter refresh window than a successful lookup so a transient
// Wikipedia outage or a rate-limit blip doesn't get "permanently" recorded as
// "this attraction has no description" for the full 60-day refresh window.
const negativeCacheIsStale = (metadata: AttractionDurationMetadata | null): boolean => {
  if (!metadata) return true;
  const negativeRefreshDays = Number(getApiCacheSetting('attractions', 'durationMetadataNegativeRefreshDays')) || 1;
  return isStale(metadata, negativeRefreshDays);
};

const WIKIPEDIA_SUMMARY_TIMEOUT_MS = 8000;
const MAX_DESCRIPTION_SENTENCES = 2;

const trimToSentences = (text: string, maxSentences: number): string => {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  return sentences
    .slice(0, maxSentences)
    .map((sentence) => sentence.trim())
    .join(' ')
    .trim();
};

// Fetches a clean, real plain-text summary for an attraction from Wikipedia's
// REST summary endpoint (distinct from the search-snippet/tagline text
// already used for catalog discovery, which is too fragmentary to show
// directly to users as "what is this place"). Best-effort: returns null on
// any failure, disambiguation page, or missing article rather than throwing,
// since a missing description should fall back to no blurb rather than break
// generation.
export const fetchWikipediaSummary = async (name: string): Promise<string | null> => {
  const trimmedName = name.trim();
  if (!trimmedName) return null;
  try {
    await reserveApiUsageOrThrow({ provider: 'WIKIMEDIA', caller: 'ATTRACTION_WIKIPEDIA_SUMMARY' });
    await recordProviderRequestCost({ provider: 'WIKIMEDIA' });
    const response = await axios.get(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(trimmedName)}`,
      {
        timeout: WIKIPEDIA_SUMMARY_TIMEOUT_MS,
        headers: { 'User-Agent': 'WanderBunnies-Itinerary-Generator/1.0 (contact: support@wanderbunnies.app)' },
        validateStatus: (status) => status === 200 || status === 404,
      }
    );
    if (response.status !== 200) return null;
    const extract = typeof response.data?.extract === 'string' ? response.data.extract.trim() : '';
    if (!extract) return null;
    if (/may refer to|disambiguation/i.test(extract)) return null;
    return trimToSentences(extract, MAX_DESCRIPTION_SENTENCES);
  } catch (err) {
    logError(`[attractions] wikipedia summary lookup failed for "${trimmedName}"`, err);
    return null;
  }
};

export const getOrCreateAttractionDurationMetadata = async (params: {
  userId: string;
  destinationKey: string;
  destinationDisplayName: string;
  name: string;
  activityType: ActivityType;
  cachedWikipediaSummary?: string | null;
}): Promise<AttractionDurationMetadata> => {
  const refreshDays = Number(getApiCacheSetting('attractions', 'durationMetadataRefreshDays')) || 60;
  const existing = await getAttractionDurationMetadata(params.userId, params.destinationKey, params.name);
  const isNegativeCacheEntry = !!existing && !existing.description;
  const stale = isNegativeCacheEntry ? negativeCacheIsStale(existing) : isStale(existing, refreshDays);
  if (!stale) return existing as AttractionDurationMetadata;

  const estimatedDurationMinutes = estimateAttractionDurationMinutes(params.name, params.activityType);
  const requiresPreOrderTickets = inferRequiresPreOrderTickets(params.name, params.activityType);
  const description = String(params.cachedWikipediaSummary ?? '').trim() || await fetchWikipediaSummary(params.name);
  const entry: AttractionDurationMetadata = {
    id: '',
    destinationKey: params.destinationKey,
    destinationDisplayName: params.destinationDisplayName,
    name: params.name,
    activityType: params.activityType,
    estimatedDurationMinutes,
    durationSource: 'heuristic',
    requiresPreOrderTickets,
    preOrderNotes: null,
    description,
    descriptionSource: description ? 'wikipedia' : null,
    updatedAt: new Date().toISOString(),
  };
  return upsertAttractionDurationMetadata(entry);
};

// Batched by destination: a single `listAttractionDurationMetadataByDestination`
// read covers every attraction in this destination in one query instead of one
// `getAttractionDurationMetadata` read per attraction (per plan §2C
// "enrichment lookups must be batched — one query for all attraction IDs in a
// trip, not N+1 per activity"). Only cache misses/stale rows fall through to
// an individual fetch-and-upsert, since a Wikipedia lookup is inherently
// per-attraction and cannot itself be batched.
export const getAttractionDurationMetadataBatch = async (params: {
  userId: string;
  destinationKey: string;
  destinationDisplayName: string;
  entries: Array<{ name: string; activityType: ActivityType; cachedWikipediaSummary?: string | null }>;
}): Promise<Map<string, AttractionDurationMetadata>> => {
  const result = new Map<string, AttractionDurationMetadata>();
  const dedupedEntries: Array<{ name: string; activityType: ActivityType; cachedWikipediaSummary?: string | null }> = [];
  const seen = new Set<string>();
  for (const entry of params.entries) {
    const key = entry.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dedupedEntries.push(entry);
  }
  if (!dedupedEntries.length) return result;

  let cachedByName = new Map<string, AttractionDurationMetadata>();
  try {
    const cached = await listAttractionDurationMetadataByDestination(params.userId, params.destinationKey);
    cachedByName = new Map(cached.map((metadata) => [metadata.name.trim().toLowerCase(), metadata]));
  } catch (err) {
    logError(`[attractions] batched duration metadata lookup failed for destination="${params.destinationDisplayName}"; falling back to per-attraction reads`, err);
  }

  const refreshDays = Number(getApiCacheSetting('attractions', 'durationMetadataRefreshDays')) || 60;
  for (const entry of dedupedEntries) {
    const key = entry.name.trim().toLowerCase();
    const existing = cachedByName.get(key) ?? null;
    const isNegativeCacheEntry = !!existing && !existing.description;
    const stale = isNegativeCacheEntry ? negativeCacheIsStale(existing) : isStale(existing, refreshDays);
    if (existing && !stale) {
      result.set(key, existing);
      continue;
    }
    const metadata = await getOrCreateAttractionDurationMetadata({
      userId: params.userId,
      destinationKey: params.destinationKey,
      destinationDisplayName: params.destinationDisplayName,
      name: entry.name,
      activityType: entry.activityType,
      cachedWikipediaSummary: entry.cachedWikipediaSummary,
    });
    result.set(key, metadata);
  }
  return result;
};

export const formatMinutesAsDuration = (minutes: number): string => {
  const safeMinutes = Math.max(1, Math.round(Number(minutes) || 0));
  if (safeMinutes % 60 === 0) return `${safeMinutes / 60}h`;
  if (safeMinutes < 60) return `${safeMinutes}m`;
  const hours = safeMinutes / 60;
  return `${Math.round(hours * 10) / 10}h`;
};
