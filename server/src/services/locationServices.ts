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
  countryById: Map<number, CountryRow>;
  stateById: Map<number, StateRow>;
  regionById: Map<number, RegionRow>;
  subregionById: Map<number, SubregionRow>;
};

let cache: LocationDataset | null = null;

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

const ensureFirebaseApp = (bucketName: string) => {
  if (!getApps().length) {
    const projectId = getEnvValue('GCLOUD_PROJECT_ID') || getEnvValue('GOOGLE_CLOUD_PROJECT');
    initializeApp({ projectId, storageBucket: bucketName });
  }
};

const safeLower = (value: string) => value.toLowerCase();

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

const loadDatasetFromStorage = async (): Promise<LocationDataset> => {
  const { bucketName, prefix } = resolveStorageConfig();
  ensureFirebaseApp(bucketName);
  const bucket = getStorage().bucket(bucketName);
  const files = ['countries.json', 'states.json', 'cities.json', 'regions.json', 'subregions.json'];
  const buffers = await Promise.all(
    files.map(async (fileName) => {
      const [buffer] = await bucket.file(`${prefix}${fileName}`).download();
      return buffer.toString('utf8');
    })
  );

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

  return {
    loadedAt: Date.now(),
    countries: countryOptions,
    states: stateOptions,
    cities: cityOptions,
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
  const dataset = await loadDatasetFromStorage();
  cache = dataset;
  return dataset;
};

const applyLimit = (items: SearchableOption[], limit?: number) => {
  const max = Number.isFinite(limit) && (limit as number) > 0 ? Math.min(limit as number, 50) : 10;
  return items.slice(0, max).map(({ searchName, ...rest }) => rest);
};

export const searchCountryStateOptions = async (query: string, limit = 10): Promise<LocationOption[]> => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const dataset = await getCachedDataset();
  const combined = [...dataset.countries, ...dataset.states];
  const filtered = combined.filter((item) => item.searchName.includes(q));
  return applyLimit(filtered, limit);
};

export const searchCityOptions = async (
  query: string,
  filters: { countryIds?: string[]; stateIds?: string[]; limit?: number }
): Promise<LocationOption[]> => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const dataset = await getCachedDataset();
  const allowedCountries = new Set((filters.countryIds ?? []).map((id) => id.trim()).filter(Boolean));
  const allowedStates = new Set((filters.stateIds ?? []).map((id) => id.trim()).filter(Boolean));
  if (allowedCountries.size === 0 && allowedStates.size === 0) {
    return [];
  }
  const filtered = dataset.cities.filter((city) => {
    if (!city.searchName.includes(q)) return false;
    if (allowedStates.size > 0 && city.stateId) {
      if (allowedStates.has(city.stateId)) return true;
    }
    if (allowedCountries.size > 0 && city.countryId) {
      if (allowedCountries.has(city.countryId)) return true;
    }
    return false;
  });
  filtered.sort((a, b) => {
    const popA = a.population ?? 0;
    const popB = b.population ?? 0;
    if (popA !== popB) return popB - popA;
    return a.name.localeCompare(b.name);
  });
  return applyLimit(filtered, filters.limit);
};

export const clearLocationCache = () => {
  cache = null;
};
