import { getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getEnvValue } from '../env';

export type LocationOption = {
  id: string;
  sourceType: 'country' | 'state' | 'city';
  name: string;
  countryId?: string;
  countryName?: string;
  stateId?: string;
  stateName?: string;
  population?: number;
};

type SearchableOption = LocationOption & {
  searchName: string;
};

type CountryRow = {
  id: number;
  name: string;
  iso2?: string | null;
  region?: string | null;
  subregion?: string | null;
  region_id?: number | null;
  subregion_id?: number | null;
};

type StateRow = {
  id: number;
  name: string;
  country_id: number;
  country_code?: string | null;
  state_code?: string | null;
};

type CityRow = {
  id: number;
  name: string;
  state_id?: number | null;
  country_id: number;
  country_code?: string | null;
  state_code?: string | null;
  population?: number | string | null;
};

type RegionRow = {
  id: number;
  name: string;
};

type SubregionRow = {
  id: number;
  name: string;
  region_id: number;
};

type LocationDataset = {
  loadedAt: number;
  countries: SearchableOption[];
  states: SearchableOption[];
  cities: SearchableOption[];
  countryState: SearchableOption[];
  citiesByCountryId: Map<string, SearchableOption[]>;
  citiesByStateId: Map<string, SearchableOption[]>;
  countryById: Map<number, CountryRow>;
  stateById: Map<number, StateRow>;
  regionById: Map<number, RegionRow>;
  subregionById: Map<number, SubregionRow>;
};

let cache: LocationDataset | null = null;
let cacheLoadPromise: Promise<LocationDataset> | null = null;
let refreshCooldownUntil = 0;
let consecutiveRefreshFailures = 0;
const countryStateQueryCache = new Map<string, { ts: number; results: LocationOption[] }>();
const cityQueryCache = new Map<string, { ts: number; results: LocationOption[] }>();

const normalizeBucketName = (value?: string): string | undefined => {
  if (!value) return undefined;
  let normalized = value.trim();
  if (!normalized) return undefined;
  normalized = normalized.replace(/^gs:\/\//i, '');
  normalized = normalized.replace(/^https?:\/\/storage.googleapis.com\//i, '');
  normalized = normalized.split('?')[0].split('#')[0];
  normalized = normalized.replace(/\/+$/, '');
  if (normalized.includes('/')) {
    normalized = normalized.split('/')[0];
  }
  return normalized || undefined;
};

const ensurePrefix = (value: string): string => {
  const trimmed = value.replace(/^\/+/, '').trim();
  if (!trimmed) return 'locations/';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
};

const resolveStorageConfig = (): { bucketName: string; prefix: string } => {
  const projectId =
    getEnvValue('GCLOUD_PROJECT_ID') ||
    getEnvValue('GOOGLE_CLOUD_PROJECT') ||
    getEnvValue('FIREBASE_PROJECT_ID');
  const bucketName =
    normalizeBucketName(getEnvValue('LOCATION_BUCKET') || getEnvValue('FIREBASE_STORAGE_BUCKET')) ||
    (projectId ? `${projectId}.appspot.com` : '');
  if (!bucketName) {
    throw new Error('Storage bucket is not configured for location JSON loading.');
  }
  const prefix = ensurePrefix(getEnvValue('LOCATION_RAW_CSV_PREFIX', { defaultValue: 'locations/' }) as string);
  return { bucketName, prefix };
};

const cacheTtlMs = (): number => {
  const minutes = Number(getEnvValue('LOCATION_CSV_CACHE_TTL_MINUTES', { defaultValue: '60' }));
  if (!Number.isFinite(minutes) || minutes <= 0) return 60 * 60 * 1000;
  return minutes * 60 * 1000;
};
const refreshCooldownMs = (): number => {
  const seconds = Number(getEnvValue('LOCATION_CSV_REFRESH_COOLDOWN_SECONDS', { defaultValue: '15' }));
  if (!Number.isFinite(seconds) || seconds <= 0) return 15_000;
  return Math.min(Math.floor(seconds * 1000), 120_000);
};

const ensureFirebaseApp = (bucketName: string) => {
  if (!getApps().length) {
    const projectId = getEnvValue('GCLOUD_PROJECT_ID') || getEnvValue('GOOGLE_CLOUD_PROJECT');
    initializeApp({ projectId, storageBucket: bucketName });
  }
};

const safeLower = (value: string) => value.toLowerCase();
const normalizeQuery = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isTransientNetworkError = (err: unknown): boolean => {
  const code = String((err as any)?.code ?? '').toUpperCase();
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'EAI_AGAIN';
};

const normalizeId = (prefix: string, id: number | string) => `${prefix}:${id}`;

const toNumber = (value: unknown): number | undefined => {
  if (value == null) return undefined;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(numeric) ? numeric : undefined;
};

const parseJson = <T>(raw: string, label: string): T[] => {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as T[];
    throw new Error(`Expected array for ${label}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${label}: ${message}`);
  }
};

const applyLimit = (items: SearchableOption[], limit?: number) => {
  const max = Number.isFinite(limit) && (limit as number) > 0 ? Math.min(limit as number, 50) : 10;
  return items.slice(0, max).map(({ searchName, ...rest }) => rest);
};

const purgeExpired = <T>(store: Map<string, { ts: number; results: T[] }>, ttlMs: number) => {
  const now = Date.now();
  for (const [key, value] of store.entries()) {
    if (now - value.ts >= ttlMs) {
      store.delete(key);
    }
  }
};

const scoreOption = (item: SearchableOption, q: string): number => {
  const nameLower = item.name.toLowerCase();
  if (nameLower === q) return 0;
  if (nameLower.startsWith(q)) return 1;
  if (item.searchName.split(' ').some((token) => token.startsWith(q))) return 2;
  return 3;
};

const compareCountryState = (a: SearchableOption, b: SearchableOption, q: string): number => {
  const scoreA = scoreOption(a, q);
  const scoreB = scoreOption(b, q);
  if (scoreA !== scoreB) return scoreA - scoreB;
  if (a.sourceType !== b.sourceType) {
    return a.sourceType === 'country' ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
};

const compareCity = (a: SearchableOption, b: SearchableOption, q: string): number => {
  const scoreA = scoreOption(a, q);
  const scoreB = scoreOption(b, q);
  if (scoreA !== scoreB) return scoreA - scoreB;
  const popA = a.population ?? 0;
  const popB = b.population ?? 0;
  if (popA !== popB) return popB - popA;
  return a.name.localeCompare(b.name);
};

const loadDatasetFromStorage = async (): Promise<LocationDataset> => {
  const { bucketName, prefix } = resolveStorageConfig();
  ensureFirebaseApp(bucketName);
  const bucket = getStorage().bucket(bucketName);
  const files = ['countries.json', 'states.json', 'cities.json', 'regions.json', 'subregions.json'];
  const downloadWithRetry = async (fileName: string): Promise<string> => {
    const filePath = `${prefix}${fileName}`;
    const attempts = 3;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const [buffer] = await bucket.file(filePath).download();
        return buffer.toString('utf8');
      } catch (err) {
        if (!isTransientNetworkError(err) || attempt === attempts) {
          throw err;
        }
        await sleep(150 * attempt);
      }
    }
    throw new Error(`Unable to download ${filePath}`);
  };
  const buffers = await Promise.all(files.map((fileName) => downloadWithRetry(fileName)));

  const countries = parseJson<CountryRow>(buffers[0], 'countries.json');
  const states = parseJson<StateRow>(buffers[1], 'states.json');
  const cities = parseJson<CityRow>(buffers[2], 'cities.json');
  const regions = parseJson<RegionRow>(buffers[3], 'regions.json');
  const subregions = parseJson<SubregionRow>(buffers[4], 'subregions.json');

  const countryById = new Map<number, CountryRow>();
  const stateById = new Map<number, StateRow>();
  const regionById = new Map<number, RegionRow>();
  const subregionById = new Map<number, SubregionRow>();

  regions.forEach((region) => {
    regionById.set(region.id, region);
  });
  subregions.forEach((subregion) => {
    subregionById.set(subregion.id, subregion);
  });

  countries.forEach((country) => {
    countryById.set(country.id, country);
  });
  states.forEach((state) => {
    stateById.set(state.id, state);
  });

  const countryOptions: SearchableOption[] = countries.map((country) => {
    const id = normalizeId('country', country.id);
    const name = country.name;
    const searchName = safeLower(name);
    return {
      id,
      sourceType: 'country',
      name,
      searchName,
    };
  });

  const stateOptions: SearchableOption[] = states.map((state) => {
    const country = countryById.get(state.country_id);
    const id = normalizeId('state', state.id);
    const name = state.name;
    const countryId = country ? normalizeId('country', country.id) : undefined;
    const countryName = country?.name;
    const searchName = safeLower([name, countryName].filter(Boolean).join(' '));
    return {
      id,
      sourceType: 'state',
      name,
      countryId,
      countryName,
      searchName,
    };
  });

  const cityOptions: SearchableOption[] = cities.map((city) => {
    const country = countryById.get(city.country_id);
    const state = city.state_id ? stateById.get(city.state_id) : undefined;
    const id = normalizeId('city', city.id);
    const name = city.name;
    const countryId = country ? normalizeId('country', country.id) : undefined;
    const stateId = state ? normalizeId('state', state.id) : undefined;
    const countryName = country?.name;
    const stateName = state?.name;
    const searchName = safeLower([name, stateName, countryName].filter(Boolean).join(' '));
    const population = toNumber(city.population);
    return {
      id,
      sourceType: 'city',
      name,
      countryId,
      countryName,
      stateId,
      stateName,
      population,
      searchName,
    };
  });

  const citiesByCountryId = new Map<string, SearchableOption[]>();
  const citiesByStateId = new Map<string, SearchableOption[]>();
  cityOptions.forEach((city) => {
    if (city.countryId) {
      const next = citiesByCountryId.get(city.countryId) ?? [];
      next.push(city);
      citiesByCountryId.set(city.countryId, next);
    }
    if (city.stateId) {
      const next = citiesByStateId.get(city.stateId) ?? [];
      next.push(city);
      citiesByStateId.set(city.stateId, next);
    }
  });

  return {
    loadedAt: Date.now(),
    countries: countryOptions,
    states: stateOptions,
    cities: cityOptions,
    countryState: [...countryOptions, ...stateOptions],
    citiesByCountryId,
    citiesByStateId,
    countryById,
    stateById,
    regionById,
    subregionById,
  };
};

const getCachedDataset = async (): Promise<LocationDataset> => {
  const now = Date.now();
  if (cache && now - cache.loadedAt < cacheTtlMs()) {
    return cache;
  }
  if (now < refreshCooldownUntil) {
    if (cache) return cache;
    throw new Error('Location dataset refresh is temporarily in cooldown after repeated failures.');
  }
  if (cacheLoadPromise) {
    return cacheLoadPromise;
  }
  cacheLoadPromise = (async () => {
    try {
      const dataset = await loadDatasetFromStorage();
      cache = dataset;
      consecutiveRefreshFailures = 0;
      refreshCooldownUntil = 0;
      return dataset;
    } catch (err) {
      consecutiveRefreshFailures += 1;
      if (consecutiveRefreshFailures >= 2 && isTransientNetworkError(err)) {
        refreshCooldownUntil = Date.now() + refreshCooldownMs();
      }
      // If refresh fails (for example transient network reset), keep serving stale cache.
      if (cache) {
        return cache;
      }
      throw err;
    }
  })();
  try {
    return await cacheLoadPromise;
  } finally {
    cacheLoadPromise = null;
  }
};

export const searchCountryStateOptions = async (query: string, limit = 10): Promise<LocationOption[]> => {
  const q = normalizeQuery(query);
  if (!q) return [];
  const max = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 1), 50) : 10;
  const ttlMs = cacheTtlMs();
  purgeExpired(countryStateQueryCache, ttlMs);
  const cacheKey = `${q}|${max}`;
  const cached = countryStateQueryCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ttlMs) {
    return cached.results;
  }

  const dataset = await getCachedDataset();
  const filtered = dataset.countryState.filter((item) => item.searchName.includes(q));
  filtered.sort((a, b) => compareCountryState(a, b, q));
  const results = applyLimit(filtered, max);
  countryStateQueryCache.set(cacheKey, { ts: Date.now(), results });
  return results;
};

export const searchCityOptions = async (
  query: string,
  filters: { countryIds?: string[]; stateIds?: string[]; limit?: number }
): Promise<LocationOption[]> => {
  const q = normalizeQuery(query);
  if (!q) return [];
  const allowedCountries = new Set((filters.countryIds ?? []).map((id) => id.trim()).filter(Boolean));
  const allowedStates = new Set((filters.stateIds ?? []).map((id) => id.trim()).filter(Boolean));
  if (allowedCountries.size === 0 && allowedStates.size === 0) {
    return [];
  }
  const max = Number.isFinite(filters.limit) ? Math.min(Math.max(Number(filters.limit), 1), 50) : 10;
  const ttlMs = cacheTtlMs();
  purgeExpired(cityQueryCache, ttlMs);
  const cacheKey = `${q}|${[...allowedCountries].sort().join(',')}|${[...allowedStates].sort().join(',')}|${max}`;
  const cached = cityQueryCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ttlMs) {
    return cached.results;
  }

  const dataset = await getCachedDataset();
  const candidates: SearchableOption[] = [];
  const seen = new Set<string>();
  for (const stateId of allowedStates) {
    const stateCities = dataset.citiesByStateId.get(stateId) ?? [];
    stateCities.forEach((city) => {
      if (!seen.has(city.id)) {
        candidates.push(city);
        seen.add(city.id);
      }
    });
  }
  for (const countryId of allowedCountries) {
    const countryCities = dataset.citiesByCountryId.get(countryId) ?? [];
    countryCities.forEach((city) => {
      if (!seen.has(city.id)) {
        candidates.push(city);
        seen.add(city.id);
      }
    });
  }

  const filtered = candidates.filter((city) => city.searchName.includes(q));
  filtered.sort((a, b) => compareCity(a, b, q));
  const results = applyLimit(filtered, max);
  cityQueryCache.set(cacheKey, { ts: Date.now(), results });
  return results;
};

export const clearLocationCache = () => {
  cache = null;
  cacheLoadPromise = null;
  countryStateQueryCache.clear();
  cityQueryCache.clear();
};

export const getLocationOptionsByIds = async (ids: string[]): Promise<LocationOption[]> => {
  const normalized = Array.from(new Set((ids ?? []).map((id) => String(id).trim()).filter(Boolean)));
  if (!normalized.length) return [];
  const dataset = await getCachedDataset();
  const byId = new Map<string, LocationOption>();
  [...dataset.countries, ...dataset.states, ...dataset.cities].forEach(({ searchName, ...rest }) => {
    byId.set(rest.id, rest);
  });
  return normalized.map((id) => byId.get(id)).filter(Boolean) as LocationOption[];
};
