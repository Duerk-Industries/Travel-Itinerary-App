import { getEnvValue } from '../env';
import { logInfo } from '../logger';
import { getFeatureFlag } from '../db';

export type ExpenseCategory =
  | 'Breakfast'
  | 'Lunch'
  | 'Dinner'
  | 'Other Food'
  | 'Rides'
  | 'Souvenirs'
  | 'Other';

export type MerchantCategoryLookupInput = {
  vendor: string;
  destination?: string | null;
  country?: string | null;
};

export type MerchantCategorySuggestion = {
  category: ExpenseCategory;
  confidence: number;
  provider: 'nominatim';
  providerCategory?: string | null;
  providerType?: string | null;
};

type CacheEntry = {
  value: MerchantCategorySuggestion | null;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
let nextAllowedAt = 0;
let queueDepth = 0;

const normalize = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const cacheKey = (input: MerchantCategoryLookupInput): string =>
  [input.vendor, input.destination, input.country].map(normalize).filter(Boolean).join('|');

export const mapMerchantCategory = (
  providerCategory?: string | null,
  providerType?: string | null,
  vendor?: string | null
): MerchantCategorySuggestion | null => {
  const category = normalize(providerCategory);
  const type = normalize(providerType);
  const text = `${category} ${type} ${normalize(vendor)}`;

  const suggestion = (expenseCategory: ExpenseCategory, confidence: number): MerchantCategorySuggestion => ({
    category: expenseCategory,
    confidence,
    provider: 'nominatim',
    providerCategory: providerCategory ?? null,
    providerType: providerType ?? null,
  });

  if (/\b(cafe|coffee|bakery|breakfast)\b/.test(text)) return suggestion('Breakfast', 0.85);
  if (/\b(restaurant|fast_food|food_court|deli|bar|pub|ice_cream)\b/.test(text)) return suggestion('Other Food', 0.8);
  if (/\b(supermarket|convenience|grocery|greengrocer)\b/.test(text)) return suggestion('Other Food', 0.7);
  if (/\b(fuel|taxi|car_rental|parking|transport|bus_station|train_station)\b/.test(text)) return suggestion('Rides', 0.75);
  if (/\b(souvenir|gift|mall|department_store)\b/.test(text)) return suggestion('Souvenirs', 0.75);
  return null;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitForRateLimit = async (): Promise<boolean> => {
  const maxQueue = Number(getEnvValue('MERCHANT_CATEGORY_LOOKUP_QUEUE_MAX', { defaultValue: '20' })) || 20;
  if (queueDepth >= maxQueue) return false;
  queueDepth += 1;
  try {
    const now = Date.now();
    const delay = Math.max(0, nextAllowedAt - now);
    nextAllowedAt = Math.max(now, nextAllowedAt) + 1000;
    if (delay) await sleep(delay);
    return true;
  } finally {
    queueDepth = Math.max(0, queueDepth - 1);
  }
};

export const lookupMerchantCategory = async (
  input: MerchantCategoryLookupInput
): Promise<MerchantCategorySuggestion | null> => {
  const flag = await getFeatureFlag('merchant_category_lookup');
  if (!flag?.enabled) return null;
  const vendor = String(input.vendor ?? '').trim();
  if (!vendor) return null;

  const key = cacheKey(input);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const allowed = await waitForRateLimit();
  if (!allowed) return null;

  const controller = new AbortController();
  const timeoutMs = Number(getEnvValue('MERCHANT_CATEGORY_LOOKUP_TIMEOUT_MS', { defaultValue: '1500' })) || 1500;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const query = [vendor, input.destination, input.country].map((part) => String(part ?? '').trim()).filter(Boolean).join(' ');
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '0');
    url.searchParams.set('extratags', '1');

    const userAgent =
      getEnvValue('MERCHANT_LOOKUP_USER_AGENT') ??
      `WanderBunniesTravel/1.0 (merchant-category-lookup; ${getEnvValue('MERCHANT_LOOKUP_CONTACT', { defaultValue: 'contact-not-configured' })})`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      cache.set(key, { value: null, expiresAt: Date.now() + 10 * 60 * 1000 });
      return null;
    }
    const data = await res.json().catch(() => []);
    const first = Array.isArray(data) ? data[0] : null;
    const suggestion = mapMerchantCategory(first?.category, first?.type, vendor);
    const ttlMs = suggestion ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    cache.set(key, { value: suggestion, expiresAt: Date.now() + ttlMs });
    logInfo(`[merchant-category] provider=nominatim result=${suggestion ? 'mapped' : 'none'}`);
    return suggestion;
  } catch {
    cache.set(key, { value: null, expiresAt: Date.now() + 10 * 60 * 1000 });
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export const clearMerchantCategoryCacheForTests = (): void => {
  cache.clear();
  nextAllowedAt = 0;
  queueDepth = 0;
};
