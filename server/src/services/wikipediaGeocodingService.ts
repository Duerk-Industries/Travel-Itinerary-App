import axios from 'axios';
import { logError } from '../logger';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { recordProviderRequestCost } from '../apis/providerBudgeting';
import { trimToSentences } from '../utils/sentenceTrim';

export type WikipediaEnrichment = {
  canonicalTitle: string;
  pageId: number;
  lat: number | null;
  lon: number | null;
  summary: string | null;
  pageUrl: string | null;
};

type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<WikipediaEnrichment | null>>();
const inFlight = new Map<string, Promise<WikipediaEnrichment | null>>();
const SUCCESS_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 15 * 24 * 60 * 60 * 1000;
const USER_AGENT = 'WanderBunnies-Itinerary-Generator/1.0 (contact: support@wanderbunnies.app)';

const DEFAULT_MAX_SENTENCES = 2;
// Sentence count is part of the cache key — without it, whichever caller happened to fetch a
// given name/destination pair first would silently pin every later caller (including one asking
// for a longer, catalog-verified extract) to that first sentence count for the full 1-year TTL.
const keyFor = (name: string, destination: string | undefined, maxSentences: number): string =>
  `${name}|${destination ?? ''}|${maxSentences}`.trim().toLowerCase().replace(/\s+/g, ' ');
const finiteCoordinate = (value: unknown, min: number, max: number): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};
const trimSummary = (value: unknown, maxSentences: number): string | null => {
  const text = String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || /may refer to|disambiguation/i.test(text)) return null;
  return trimToSentences(text, maxSentences);
};

const PLAUSIBILITY_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'at', 'and', 'or', 'to', 'for', 'on', 'near', 'from', 'with', 'around', 'through', 'into', 'toward',
]);
const tokenizeForPlausibility = (value: string): string[] =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !PLAUSIBILITY_STOPWORDS.has(token));

// `gsrsearch` with `gsrlimit=1` blindly trusts Wikipedia's top full-text-search hit — and that
// search reliably returns a *confident but topically unrelated* result for short, generic
// activity-name-plus-destination queries (see the extensive callouts in
// itineraryPromptPlanService.ts's looksLikeSearchableAttractionName/extractAttractionSearchPhrase
// for prior real examples: Norway House, a WWII naval raid, the 2011 Oslo attacks, a queen
// consort's biography). Concretely reproduced here: searching "Surf Lesson Monteverde" returns
// "Peruvian political crisis (2016–present)" as the #1 hit — sharing zero words with either the
// activity name or the destination. Rather than chase each new bad phrase with another blocklist
// entry, reject any result whose title+summary shares none of the query's significant words —
// this is the last line of defense regardless of what specificity heuristics upstream missed.
const isPlausibleMatch = (result: WikipediaEnrichment, queryName: string, destination?: string): boolean => {
  const queryTokens = [...tokenizeForPlausibility(queryName), ...tokenizeForPlausibility(destination ?? '')];
  if (!queryTokens.length) return true;
  const haystack = tokenizeForPlausibility(`${result.canonicalTitle} ${result.summary ?? ''}`).join(' ');
  return queryTokens.some((token) => haystack.includes(token));
};

export const parseWikipediaEnrichment = (payload: any, maxSentences: number = DEFAULT_MAX_SENTENCES): WikipediaEnrichment | null => {
  const pages = payload?.query?.pages && typeof payload.query.pages === 'object' ? Object.values(payload.query.pages) as any[] : [];
  const page = pages.find((candidate) => candidate && !candidate.missing && Number.isFinite(Number(candidate.pageid)));
  if (!page) return null;
  const coordinate = Array.isArray(page.coordinates) ? page.coordinates[0] : null;
  const lat = finiteCoordinate(coordinate?.lat, -90, 90);
  const lon = finiteCoordinate(coordinate?.lon, -180, 180);
  const pageUrl = typeof page?.fullurl === 'string' ? page.fullurl : null;
  return {
    canonicalTitle: String(page.title ?? '').trim(), pageId: Number(page.pageid), lat, lon,
    summary: trimSummary(page.extract, maxSentences), pageUrl,
  };
};

export const fetchWikipediaEnrichment = async (
  name: string,
  destination?: string,
  maxSentences: number = DEFAULT_MAX_SENTENCES
): Promise<WikipediaEnrichment | null> => {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) return null;
  const key = keyFor(cleanName, destination, maxSentences);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const active = inFlight.get(key);
  if (active) return active;
  const task = (async () => {
    try {
      await reserveApiUsageOrThrow({ provider: 'WIKIMEDIA', caller: 'ATTRACTION_WIKIPEDIA_ENRICHMENT' });
      await recordProviderRequestCost({ provider: 'WIKIMEDIA' });
      const search = destination ? `${cleanName} ${String(destination).trim()}` : cleanName;
      const response = await axios.get('https://en.wikipedia.org/w/api.php', {
        timeout: 8000,
        headers: { 'User-Agent': USER_AGENT },
        params: {
          action: 'query', generator: 'search', gsrsearch: search, gsrlimit: 1,
          prop: 'coordinates|extracts|info', exintro: 1, explaintext: 1, inprop: 'url', format: 'json', origin: '*',
        },
      });
      const parsed = parseWikipediaEnrichment(response.data, maxSentences);
      const plausible = parsed ? isPlausibleMatch(parsed, cleanName, destination) : false;
      if (parsed && !plausible) {
        logError(`[attractions] wikipedia enrichment rejected implausible match "${parsed.canonicalTitle}" for query "${search}"`);
      }
      const result = plausible ? parsed : null;
      cache.set(key, { value: result, expiresAt: Date.now() + (result ? SUCCESS_TTL_MS : NEGATIVE_TTL_MS) });
      return result;
    } catch (error) {
      logError(`[attractions] wikipedia enrichment failed for "${cleanName}"`, error);
      cache.set(key, { value: null, expiresAt: Date.now() + NEGATIVE_TTL_MS });
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return task;
};

export const clearWikipediaEnrichmentCacheForTests = (): void => { cache.clear(); inFlight.clear(); };
