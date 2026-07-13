import { createHash } from 'node:crypto';
import { getApiCacheSetting } from '../config/apiLimits';
import { hasGetYourGuideApiCachePermission } from '../config/getYourGuide';
import { incrementMetric } from '../metrics';
import { recordGetYourGuideCacheEvent, recordGetYourGuideSuppression } from '../services/getYourGuideObservability';
import {
  searchGetYourGuideActivities,
  type GetYourGuideActivityProduct,
  type GetYourGuideSearchResult,
} from './getYourGuideApi';

export const GETYOURGUIDE_CALLER_ITINERARY_ACTIVITY_SUGGESTION = 'GETYOURGUIDE_ITINERARY_ACTIVITY_SUGGESTION';
export const GETYOURGUIDE_CALLER_ACTIVITY_TAB_LOOKUP = 'GETYOURGUIDE_ACTIVITY_TAB_LOOKUP';

export type GetYourGuideActivityLookup = {
  caller?: string;
  query: string;
  destination?: string;
  country?: string;
  date?: string;
  partySize?: number;
  language: string;
  currency: string;
  accessibility?: string[];
  budgetTier?: 'free' | 'paid' | 'premium' | null;
  locationHint?: { lat: number; lon: number };
  /** Opaque request/generation scope; never a user ID. */
  scopeKey?: string;
  signal?: AbortSignal;
};

export type GetYourGuideActivityLookupResult = GetYourGuideSearchResult & { stale: boolean };

type CacheEntry = { result: GetYourGuideActivityLookupResult; freshUntilMs: number; staleUntilMs: number };
const positiveCache = new Map<string, CacheEntry>();
const negativeCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<GetYourGuideActivityLookupResult | null>>();
const generationUsage = new Map<string, { day: string; used: number }>();
let dailyUsage: { day: string; used: number } = { day: '', used: 0 };

const normalize = (value: unknown): string => String(value ?? '').trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
const normalizeList = (values: string[] | undefined): string[] => Array.from(new Set((values ?? []).map(normalize).filter(Boolean))).sort();
const dateBucket = (value: string | undefined): string => {
  const raw = normalize(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : raw.slice(0, 7);
};
const partyBucket = (value: number | undefined): string => {
  const size = Math.max(0, Math.floor(Number(value) || 0));
  return size <= 1 ? '1' : size === 2 ? '2' : size <= 4 ? '3-4' : '5+';
};
const roundCoordinate = (value: number): string => Number.isFinite(value) ? Number(value).toFixed(2) : '';

export const buildGetYourGuideActivityLookupKey = (params: GetYourGuideActivityLookup): string => {
  const canonical = {
    v: 1,
    destination: normalize(params.destination),
    country: normalize(params.country),
    concept: normalize(params.query),
    date: dateBucket(params.date),
    party: partyBucket(params.partySize),
    language: normalize(params.language),
    accessibility: normalizeList(params.accessibility),
    budget: normalize(params.budgetTier),
    lat: params.locationHint ? roundCoordinate(params.locationHint.lat) : '',
    lon: params.locationHint ? roundCoordinate(params.locationHint.lon) : '',
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
};

const cacheTtls = (): { freshMs: number; staleMs: number } => {
  const freshMinutes = Math.max(1, Math.floor(getApiCacheSetting('getYourGuide', 'freshTtlMinutes') ?? 15));
  const staleHours = Math.max(1, Math.floor(getApiCacheSetting('getYourGuide', 'staleTtlHours') ?? 24));
  return { freshMs: freshMinutes * 60_000, staleMs: staleHours * 60 * 60_000 };
};

const today = (): string => new Date().toISOString().slice(0, 10);
const maxPerGeneration = (): number => Math.max(0, Math.floor(getApiCacheSetting('getYourGuide', 'maxPartnerApiLookupsPerGeneration') ?? 0));
const maxPerDay = (): number => Math.max(0, Math.floor(getApiCacheSetting('getYourGuide', 'maxPartnerApiLookupsPerDay') ?? 0));

const reserveLookupBudget = (scopeKey: string): boolean => {
  const day = today();
  if (dailyUsage.day !== day) dailyUsage = { day, used: 0 };
  const generation = generationUsage.get(scopeKey);
  const currentGeneration = generation?.day === day ? generation : { day, used: 0 };
  if (maxPerGeneration() <= 0 || maxPerDay() <= 0) return false;
  if (currentGeneration.used >= maxPerGeneration() || dailyUsage.used >= maxPerDay()) return false;
  currentGeneration.used += 1;
  dailyUsage.used += 1;
  generationUsage.set(scopeKey, currentGeneration);
  return true;
};

const findEntry = (key: string): { entry: CacheEntry; negative: boolean } | null => {
  const now = Date.now();
  for (const [map, negative] of [[positiveCache, false], [negativeCache, true]] as const) {
    const entry = map.get(key);
    if (!entry) continue;
    if (entry.staleUntilMs <= now) { map.delete(key); continue; }
    return { entry, negative };
  }
  return null;
};

const writeCache = (key: string, result: GetYourGuideSearchResult): GetYourGuideActivityLookupResult => {
  const { freshMs, staleMs } = cacheTtls();
  const cached: GetYourGuideActivityLookupResult = { ...result, stale: false };
  const entry = { result: cached, freshUntilMs: Date.now() + freshMs, staleUntilMs: Date.now() + staleMs };
  const target = result.negative ? negativeCache : positiveCache;
  const other = result.negative ? positiveCache : negativeCache;
  other.delete(key);
  target.set(key, entry);
  incrementMetric(result.negative ? 'getyourguide.partner_cache_negative_write' : 'getyourguide.partner_cache_write');
  return cached;
};

const fetchAndCache = async (params: GetYourGuideActivityLookup, key: string, scopeKey: string): Promise<GetYourGuideActivityLookupResult | null> => {
  if (!reserveLookupBudget(scopeKey)) {
    incrementMetric('getyourguide.partner_lookup_suppressed', { reason: 'budget' });
    recordGetYourGuideSuppression('budget');
    return null;
  }
  const result = await searchGetYourGuideActivities({
    caller: params.caller ?? GETYOURGUIDE_CALLER_ITINERARY_ACTIVITY_SUGGESTION,
    query: params.query,
    destination: params.destination,
    country: params.country,
    locationHint: params.locationHint,
    date: params.date,
    currency: params.currency,
    language: params.language,
    signal: params.signal,
  });
  return hasGetYourGuideApiCachePermission() ? writeCache(key, result) : { ...result, stale: false };
};

const startFetch = (params: GetYourGuideActivityLookup, key: string, scopeKey: string): Promise<GetYourGuideActivityLookupResult | null> => {
  const existing = inFlight.get(`${scopeKey}:${key}`);
  if (existing) return existing;
  const promise = fetchAndCache(params, key, scopeKey)
    .catch((error) => {
      incrementMetric('getyourguide.partner_lookup_failed', { reason: error?.code ?? 'error' });
      return null;
    })
    .finally(() => inFlight.delete(`${scopeKey}:${key}`));
  inFlight.set(`${scopeKey}:${key}`, promise);
  return promise;
};

export const getGetYourGuideActivitySuggestions = async (params: GetYourGuideActivityLookup): Promise<GetYourGuideActivityLookupResult | null> => {
  if (!normalize(params.query) || !normalize(params.language) || !normalize(params.currency)) return null;
  const key = buildGetYourGuideActivityLookupKey(params);
  const requestScope = normalize(params.scopeKey) || 'request';
  const cachePermission = hasGetYourGuideApiCachePermission();
  if (!cachePermission && (positiveCache.size > 0 || negativeCache.size > 0)) {
    // Do not retain content in memory after an operator revokes written
    // caching permission at runtime.
    positiveCache.clear();
    negativeCache.clear();
  }
  if (cachePermission) {
    const found = findEntry(key);
    if (found) {
      const stale = found.entry.freshUntilMs <= Date.now();
      if (found.negative) recordGetYourGuideCacheEvent('negative');
      else recordGetYourGuideCacheEvent(stale ? 'stale' : 'fresh');
      if (found.negative && stale) recordGetYourGuideCacheEvent('stale');
      incrementMetric(found.negative ? (stale ? 'getyourguide.partner_cache_negative_stale' : 'getyourguide.partner_cache_negative_hit') : (stale ? 'getyourguide.partner_cache_stale' : 'getyourguide.partner_cache_hit'));
      if (stale) void startFetch(params, key, requestScope);
      return { ...found.entry.result, stale };
    }
  }
  if (!cachePermission) {
    // With no written permission, only the in-flight promise exists; the
    // response itself is never retained after this request completes.
    recordGetYourGuideCacheEvent('miss');
    return startFetch(params, key, requestScope);
  }
  recordGetYourGuideCacheEvent('miss');
  return startFetch(params, key, requestScope);
};

export const clearGetYourGuideActivityCachesForTests = (): void => {
  positiveCache.clear();
  negativeCache.clear();
  inFlight.clear();
  generationUsage.clear();
  dailyUsage = { day: '', used: 0 };
};

export type { GetYourGuideActivityProduct };
