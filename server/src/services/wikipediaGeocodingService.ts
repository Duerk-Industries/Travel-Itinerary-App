import axios from 'axios';
import { logError } from '../logger';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';

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

const keyFor = (name: string, destination?: string): string => `${name}|${destination ?? ''}`.trim().toLowerCase().replace(/\s+/g, ' ');
const finiteCoordinate = (value: unknown, min: number, max: number): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};
const trimSummary = (value: unknown): string | null => {
  const text = String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || /may refer to|disambiguation/i.test(text)) return null;
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  return sentences.slice(0, 2).map((sentence) => sentence.trim()).join(' ').trim();
};

export const parseWikipediaEnrichment = (payload: any): WikipediaEnrichment | null => {
  const pages = payload?.query?.pages && typeof payload.query.pages === 'object' ? Object.values(payload.query.pages) as any[] : [];
  const page = pages.find((candidate) => candidate && !candidate.missing && Number.isFinite(Number(candidate.pageid)));
  if (!page) return null;
  const coordinate = Array.isArray(page.coordinates) ? page.coordinates[0] : null;
  const lat = finiteCoordinate(coordinate?.lat, -90, 90);
  const lon = finiteCoordinate(coordinate?.lon, -180, 180);
  const pageUrl = typeof page?.fullurl === 'string' ? page.fullurl : null;
  return {
    canonicalTitle: String(page.title ?? '').trim(), pageId: Number(page.pageid), lat, lon,
    summary: trimSummary(page.extract), pageUrl,
  };
};

export const fetchWikipediaEnrichment = async (name: string, destination?: string): Promise<WikipediaEnrichment | null> => {
  const cleanName = String(name ?? '').trim();
  if (!cleanName) return null;
  const key = keyFor(cleanName, destination);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const active = inFlight.get(key);
  if (active) return active;
  const task = (async () => {
    try {
      await reserveApiUsageOrThrow({ provider: 'WIKIMEDIA', caller: 'ATTRACTION_WIKIPEDIA_ENRICHMENT' });
      const search = destination ? `${cleanName} ${String(destination).trim()}` : cleanName;
      const response = await axios.get('https://en.wikipedia.org/w/api.php', {
        timeout: 8000,
        headers: { 'User-Agent': USER_AGENT },
        params: {
          action: 'query', generator: 'search', gsrsearch: search, gsrlimit: 1,
          prop: 'coordinates|extracts|info', exintro: 1, explaintext: 1, inprop: 'url', format: 'json', origin: '*',
        },
      });
      const result = parseWikipediaEnrichment(response.data);
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
