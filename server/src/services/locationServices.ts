import fs from 'fs';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getEnvValue } from '../env';
import { getApiCacheSetting } from '../config/apiLimits';
import { logError, logInfo } from '../logger';
import { parseCsvLine } from './destinationsAttractionsCsv';
import { resolveRuntimeDataPath } from '../utils/runtimeDataPath';

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
let countryStateCache: LocationDataset | null = null;
let countryStateCacheLoadPromise: Promise<LocationDataset> | null = null;
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
  const minutes =
    Number(getApiCacheSetting('locations', 'csvCacheTtlMinutes')) ||
    Number(getEnvValue('LOCATION_CSV_CACHE_TTL_MINUTES', { defaultValue: '60' }));
  if (!Number.isFinite(minutes) || minutes <= 0) return 60 * 60 * 1000;
  return minutes * 60 * 1000;
};
const refreshCooldownMs = (): number => {
  const seconds =
    Number(getApiCacheSetting('locations', 'refreshCooldownSeconds')) ||
    Number(getEnvValue('LOCATION_CSV_REFRESH_COOLDOWN_SECONDS', { defaultValue: '15' }));
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
const normalizeSearchText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

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

const loadDatasetFromStorage = async (includeCities = true): Promise<LocationDataset> => {
  const { bucketName, prefix } = resolveStorageConfig();
  ensureFirebaseApp(bucketName);
  const bucket = getStorage().bucket(bucketName);
  const files = includeCities
    ? ['countries.json', 'states.json', 'cities.json', 'regions.json', 'subregions.json']
    : ['countries.json', 'states.json', 'regions.json', 'subregions.json'];
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
  const rawByFile = new Map(files.map((fileName, index) => [fileName, buffers[index]]));
  const countries = parseJson<CountryRow>(rawByFile.get('countries.json') ?? '[]', 'countries.json');
  const states = parseJson<StateRow>(rawByFile.get('states.json') ?? '[]', 'states.json');
  const cities = includeCities
    ? parseJson<CityRow>(rawByFile.get('cities.json') ?? '[]', 'cities.json')
    : [];
  const regions = parseJson<RegionRow>(rawByFile.get('regions.json') ?? '[]', 'regions.json');
  const subregions = parseJson<SubregionRow>(rawByFile.get('subregions.json') ?? '[]', 'subregions.json');

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

const resolveCountryStateCsvPath = (): string => {
  return resolveRuntimeDataPath(
    'locations/countries_and_regions.csv',
    getEnvValue('LOCATION_COUNTRY_STATE_CSV_LOCAL_PATH')
  );
};

const resolveCitiesCsvPath = (): string => {
  return resolveRuntimeDataPath('locations/cities.csv', getEnvValue('LOCATION_CITY_CSV_LOCAL_PATH'));
};

const resolveDestinationsCsvPath = (): string => {
  return resolveRuntimeDataPath('destinations.csv', getEnvValue('DESTINATIONS_CSV_LOCAL_PATH'));
};

const normalizeCsvText = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

const splitStateCountry = (value: string): { stateName: string; countryName?: string } => {
  const parts = value
    .split(',')
    .map((part) => normalizeCsvText(part))
    .filter(Boolean);
  if (parts.length <= 1) return { stateName: value };
  return {
    stateName: parts.slice(0, -1).join(', '),
    countryName: parts[parts.length - 1],
  };
};

const slugify = (value: string): string =>
  normalizeSearchText(value)
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const parseLocalCountryStateCsv = (raw: string): Pick<LocationDataset, 'countries' | 'states' | 'countryState'> => {
  const lines = String(raw ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { countries: [], states: [], countryState: [] };
  }

  const headers = parseCsvLine(lines[0]).map((header) => normalizeCsvText(header));
  const categoryIndex = headers.indexOf('Category');
  const nameIndex = headers.indexOf('Name');
  if (categoryIndex === -1 || nameIndex === -1) {
    return { countries: [], states: [], countryState: [] };
  }

  const countries: SearchableOption[] = [];
  const states: SearchableOption[] = [];
  const countryByName = new Map<string, SearchableOption>();

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const category = normalizeCsvText(values[categoryIndex]);
    const rawName = normalizeCsvText(values[nameIndex]);
    if (!category || !rawName) continue;

    if (category === 'Country') {
      const countryId = normalizeId('country', slugify(rawName) || `country-${i}`);
      const option: SearchableOption = {
        id: countryId,
        sourceType: 'country',
        name: rawName,
        searchName: normalizeSearchText(rawName),
      };
      countries.push(option);
      countryByName.set(normalizeSearchText(rawName), option);
      continue;
    }

    if (category === 'State/Province') {
      const parsed = splitStateCountry(rawName);
      const stateName = normalizeCsvText(parsed.stateName);
      const countryName = normalizeCsvText(parsed.countryName);
      const countryOption = countryByName.get(normalizeSearchText(countryName));
      const stateIdSeed = [stateName, countryName].filter(Boolean).join(' ');
      states.push({
        id: normalizeId('state', slugify(stateIdSeed) || `state-${i}`),
        sourceType: 'state',
        name: stateName || rawName,
        countryId: countryOption?.id,
        countryName: countryOption?.name ?? countryName ?? undefined,
        searchName: normalizeSearchText([stateName || rawName, countryName].filter(Boolean).join(' ')),
      });
    }
  }

  return {
    countries,
    states,
    countryState: [...countries, ...states],
  };
};

const mergeCountryOption = (
  countries: SearchableOption[],
  countryByName: Map<string, SearchableOption>,
  countryName: string
): SearchableOption | null => {
  const normalized = normalizeSearchText(countryName);
  if (!normalized) return null;
  const existing = countryByName.get(normalized);
  if (existing) return existing;
  const option: SearchableOption = {
    id: normalizeId('country', slugify(countryName) || normalized),
    sourceType: 'country',
    name: countryName,
    searchName: normalized,
  };
  countries.push(option);
  countryByName.set(normalized, option);
  return option;
};

const mergeStateOption = (
  states: SearchableOption[],
  stateKeys: Set<string>,
  stateName: string,
  countryOption?: SearchableOption | null
) => {
  const normalizedState = normalizeSearchText(stateName);
  if (!normalizedState) return;
  const key = `${normalizedState}|${countryOption?.id ?? ''}`;
  if (stateKeys.has(key)) return;
  stateKeys.add(key);
  states.push({
    id: normalizeId('state', slugify(`${stateName} ${countryOption?.name ?? ''}`) || key),
    sourceType: 'state',
    name: stateName,
    countryId: countryOption?.id,
    countryName: countryOption?.name,
    searchName: normalizeSearchText([stateName, countryOption?.name].filter(Boolean).join(' ')),
  });
};

const parseDestinationGeoCsv = (raw: string): Pick<LocationDataset, 'countries' | 'states' | 'countryState'> => {
  const lines = String(raw ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { countries: [], states: [], countryState: [] };
  }

  const headers = parseCsvLine(lines[0]).map((header) => normalizeCsvText(header));
  const countryIndex = headers.indexOf('Country');
  const stateIndex = headers.indexOf('State/Provence');
  if (countryIndex === -1) {
    return { countries: [], states: [], countryState: [] };
  }

  const countries: SearchableOption[] = [];
  const states: SearchableOption[] = [];
  const countryByName = new Map<string, SearchableOption>();
  const stateKeys = new Set<string>();

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const countryName = normalizeCsvText(values[countryIndex]);
    const stateName = stateIndex >= 0 ? normalizeCsvText(values[stateIndex]) : '';
    const countryOption = mergeCountryOption(countries, countryByName, countryName);
    if (!countryOption || !stateName || normalizeSearchText(stateName) === normalizeSearchText(countryName)) continue;
    mergeStateOption(states, stateKeys, stateName, countryOption);
  }

  return {
    countries,
    states,
    countryState: [...countries, ...states],
  };
};

const parseLocalCitiesCsv = (raw: string): Pick<LocationDataset, 'cities' | 'citiesByCountryId' | 'citiesByStateId'> => {
  const lines = String(raw ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return {
      cities: [],
      citiesByCountryId: new Map<string, SearchableOption[]>(),
      citiesByStateId: new Map<string, SearchableOption[]>(),
    };
  }

  return {
    cities: [],
    citiesByCountryId: new Map<string, SearchableOption[]>(),
    citiesByStateId: new Map<string, SearchableOption[]>(),
  };
};

const loadDatasetFromLocalCsv = async (): Promise<LocationDataset> => {
  const countryStatePath = resolveCountryStateCsvPath();
  const citiesPath = resolveCitiesCsvPath();
  const destinationsPath = resolveDestinationsCsvPath();
  const countryStateRaw = fs.existsSync(countryStatePath) ? fs.readFileSync(countryStatePath, 'utf8') : '';
  const citiesRaw = fs.existsSync(citiesPath) ? fs.readFileSync(citiesPath, 'utf8') : '';
  const destinationsRaw = fs.existsSync(destinationsPath) ? fs.readFileSync(destinationsPath, 'utf8') : '';
  const countryState = parseLocalCountryStateCsv(countryStateRaw);
  const destinationGeo = parseDestinationGeoCsv(destinationsRaw);
  const mergedCountries = [...countryState.countries];
  const mergedStates = [...countryState.states];
  const mergedCountryByName = new Map(mergedCountries.map((country) => [normalizeSearchText(country.name), country]));
  const mergedStateKeys = new Set(
    mergedStates.map((state) => `${normalizeSearchText(state.name)}|${state.countryId ?? ''}`)
  );
  destinationGeo.countries.forEach((country) => {
    mergeCountryOption(mergedCountries, mergedCountryByName, country.name);
  });
  destinationGeo.states.forEach((state) => {
    const countryOption = state.countryName ? mergeCountryOption(mergedCountries, mergedCountryByName, state.countryName) : null;
    mergeStateOption(mergedStates, mergedStateKeys, state.name, countryOption);
  });
  const cityData = parseLocalCitiesCsv(citiesRaw);
  return {
    loadedAt: Date.now(),
    countries: mergedCountries,
    states: mergedStates,
    cities: cityData.cities,
    countryState: [...mergedCountries, ...mergedStates],
    citiesByCountryId: cityData.citiesByCountryId,
    citiesByStateId: cityData.citiesByStateId,
    countryById: new Map<number, CountryRow>(),
    stateById: new Map<number, StateRow>(),
    regionById: new Map<number, RegionRow>(),
    subregionById: new Map<number, SubregionRow>(),
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
      let dataset: LocationDataset;
      try {
        dataset = await loadDatasetFromStorage(true);
      } catch (storageErr) {
        logInfo('[locationServices] Storage dataset unavailable, falling back to local CSV');
        try {
          dataset = await loadDatasetFromLocalCsv();
        } catch (localCsvErr) {
          logError('[locationServices] Local CSV fallback also failed', localCsvErr);
          throw storageErr;
        }
        if (dataset.countryState.length === 0 && dataset.cities.length === 0) {
          logError('[locationServices] Local CSV fallback returned no data', storageErr);
          throw storageErr;
        }
      }
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

/**
 * Country/state autocomplete must not load the full city catalog. The city
 * JSON is intentionally large and is only needed after the user has selected
 * a country or state. Keeping a separate cache prevents a lightweight search
 * from exhausting the Cloud Run Node.js heap.
 */
const getCachedCountryStateDataset = async (): Promise<LocationDataset> => {
  const now = Date.now();
  if (cache) return cache;
  if (countryStateCache && now - countryStateCache.loadedAt < cacheTtlMs()) {
    return countryStateCache;
  }
  if (countryStateCacheLoadPromise) return countryStateCacheLoadPromise;

  countryStateCacheLoadPromise = (async () => {
    try {
      let dataset: LocationDataset;
      try {
        dataset = await loadDatasetFromStorage(false);
      } catch (storageErr) {
        logInfo('[locationServices] Country/state storage dataset unavailable, falling back to local CSV');
        try {
          dataset = await loadDatasetFromLocalCsv();
        } catch (localCsvErr) {
          logError('[locationServices] Country/state local CSV fallback also failed', localCsvErr);
          throw storageErr;
        }
        if (dataset.countryState.length === 0) {
          logError('[locationServices] Country/state local CSV fallback returned no data', storageErr);
          throw storageErr;
        }
      }
      countryStateCache = dataset;
      return dataset;
    } finally {
      countryStateCacheLoadPromise = null;
    }
  })();

  return countryStateCacheLoadPromise;
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

  const dataset = await getCachedCountryStateDataset();
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
  countryStateCache = null;
  countryStateCacheLoadPromise = null;
  countryStateQueryCache.clear();
  cityQueryCache.clear();
};

export const getLocationOptionsByIds = async (ids: string[]): Promise<LocationOption[]> => {
  const normalized = Array.from(new Set((ids ?? []).map((id) => String(id).trim()).filter(Boolean)));
  if (!normalized.length) return [];
  // Batch resolution is commonly used for country/state trip locations. Do
  // not load the heavyweight city catalog just to resolve those IDs; city
  // IDs that are not already present in the application database are handled
  // by the route's stable ID-label fallback.
  const dataset = await getCachedCountryStateDataset();
  const byId = new Map<string, LocationOption>();
  [...dataset.countries, ...dataset.states].forEach(({ searchName, ...rest }) => {
    byId.set(rest.id, rest);
  });
  return normalized.map((id) => byId.get(id)).filter(Boolean) as LocationOption[];
};
