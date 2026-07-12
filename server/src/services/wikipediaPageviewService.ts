import axios from 'axios';
import { logError } from '../logger';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';

const cache = new Map<string, { value: number | null; expiresAt: number }>();
const DAY_MS = 24 * 60 * 60 * 1000;

const dateKey = (date: Date): string => date.toISOString().slice(0, 10).replace(/-/g, '');
export const normalizePopularityScore = (views: number): number => Math.max(0, Math.min(100, Math.round(Math.log10(Math.max(0, views) + 1) * 20)));

export const fetchWikipediaPopularityScore = async (title: string, now = new Date()): Promise<number | null> => {
  const clean = String(title ?? '').trim().replace(/ /g, '_');
  if (!clean) return null;
  const key = clean.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  try {
    await reserveApiUsageOrThrow({ provider: 'WIKIMEDIA', caller: 'ATTRACTION_WIKIMEDIA_PAGEVIEWS' });
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(clean)}/daily/${dateKey(start)}/${dateKey(end)}`;
    const response = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'WanderBunnies-Itinerary-Generator/1.0 (contact: support@wanderbunnies.app)' } });
    const views = (Array.isArray(response.data?.items) ? response.data.items : []).reduce((sum: number, item: any) => sum + Math.max(0, Number(item?.views) || 0), 0);
    const score = normalizePopularityScore(views);
    cache.set(key, { value: score, expiresAt: Date.now() + 30 * DAY_MS });
    return score;
  } catch (error) {
    logError(`[attractions] wikipedia pageviews failed for "${title}"`, error);
    cache.set(key, { value: null, expiresAt: Date.now() + DAY_MS });
    return null;
  }
};

export const clearWikipediaPageviewCacheForTests = (): void => cache.clear();
