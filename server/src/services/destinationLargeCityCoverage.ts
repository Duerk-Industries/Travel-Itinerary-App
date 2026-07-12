import axios from 'axios';
import pLimit from 'p-limit';
import { reserveApiUsageOrThrow, ApiLimitExceededError } from '../apis/usageLimiter';

export interface LargeCitySeed {
  name: string;
  state: string;
  city: string;
  officialName?: string;
  population?: number;
  sourceUrls?: string[];
}

export interface LargeCityCountry {
  name: string;
  officialName: string;
  iso2: string;
}

interface CountryNowPopulationCount {
  year?: string;
  value?: string;
  sex?: string;
}

interface CountryNowCityRecord {
  city?: string;
  populationCounts?: CountryNowPopulationCount[];
}

interface CountryNowFilterResponse {
  data?: CountryNowCityRecord[];
}

interface CountryNowCitiesResponse {
  data?: string[];
}

interface GeoNamesCityRecord {
  recordid?: string;
  fields?: {
    name?: string;
    asciiname?: string;
    population?: number;
  };
}

interface GeoNamesSearchResponse {
  records?: GeoNamesCityRecord[];
}

export const LARGE_CITY_POPULATION_THRESHOLD = 1_000_000;

const GEONAMES_DATASET_ID = 'doc-geonames-cities-5000';
const GEONAMES_SEARCH_URL = 'https://documentation-resources.huwise.com/api/records/1.0/search/';
const COUNTRYNOW_CITY_POPULATION_URL = 'https://countriesnow.space/api/v0.1/countries/population/cities/filter';
const COUNTRYNOW_CITY_LIST_URL = 'https://countriesnow.space/api/v0.1/countries/cities';

const DEFAULT_COUNTRYNOW_CONCURRENCY = 2;
const DEFAULT_GEONAMES_CONCURRENCY = 2;
const DEFAULT_COUNTRYNOW_MIN_INTERVAL_MS = 1200;
const DEFAULT_GEONAMES_MIN_INTERVAL_MS = 800;
const MAX_PROVIDER_RETRIES = 4;

function getEnvNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

const countryNowConcurrency = getEnvNumber(
  'DESTINATION_COUNTRYNOW_CONCURRENCY',
  DEFAULT_COUNTRYNOW_CONCURRENCY,
  1,
  8
);
const geonamesConcurrency = getEnvNumber(
  'DESTINATION_GEONAMES_CONCURRENCY',
  DEFAULT_GEONAMES_CONCURRENCY,
  1,
  8
);
const countryNowMinIntervalMs = getEnvNumber(
  'DESTINATION_COUNTRYNOW_MIN_INTERVAL_MS',
  DEFAULT_COUNTRYNOW_MIN_INTERVAL_MS,
  0,
  60000
);
const geonamesMinIntervalMs = getEnvNumber(
  'DESTINATION_GEONAMES_MIN_INTERVAL_MS',
  DEFAULT_GEONAMES_MIN_INTERVAL_MS,
  0,
  60000
);

const countryNowCitySeedCache = new Map<string, LargeCitySeed[]>();
const geonamesMillionCitySeedCache = new Map<string, LargeCitySeed[]>();
const countryNowLimiter = pLimit(countryNowConcurrency);
const geonamesLimiter = pLimit(geonamesConcurrency);
let lastCountryNowRequestAt = 0;
let lastGeoNamesRequestAt = 0;

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelySyntheticName(name: string): boolean {
  const value = name.trim();
  if (!value) return true;
  if (/^administrative zone\b/i.test(value)) return true;
  if (/\(\d+\)/.test(value)) return true;
  if (/^[A-Za-z]{1,4}\d{1,4}\b/.test(value)) return true;
  if (/[/\\]/.test(value) && /[A-Za-z]{1,6}\d/.test(value)) return true;
  return false;
}

function uniqueSeeds(seeds: LargeCitySeed[]): LargeCitySeed[] {
  const seen = new Set<string>();
  const deduped: LargeCitySeed[] = [];

  for (const seed of seeds) {
    const key = normalizeKey(`${seed.name}|${seed.city}|${seed.state}`);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(seed);
  }

  return deduped;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(rawValue: unknown): number | null {
  if (rawValue === undefined || rawValue === null) return null;
  const text = String(rawValue).trim();
  if (!text) return null;

  const asSeconds = Number(text);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.max(1000, Math.round(asSeconds * 1000));
  }

  const asDate = Date.parse(text);
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now();
    if (delta > 0) return Math.max(1000, delta);
  }

  return null;
}

async function withProviderThrottle<T>(
  limiter: ReturnType<typeof pLimit>,
  provider: 'CountryNow' | 'GeoNames',
  minIntervalMs: number,
  fn: () => Promise<T>
): Promise<T> {
  return limiter(async () => {
    const now = Date.now();
    const lastRequestAt = provider === 'CountryNow' ? lastCountryNowRequestAt : lastGeoNamesRequestAt;
    const waitMs = Math.max(0, lastRequestAt + minIntervalMs - now);
    await sleep(waitMs);

    if (provider === 'CountryNow') {
      lastCountryNowRequestAt = Date.now();
    } else {
      lastGeoNamesRequestAt = Date.now();
    }

    return fn();
  });
}

async function postCountryNow<T>(url: string, body: unknown): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_PROVIDER_RETRIES; attempt += 1) {
    try {
      await reserveApiUsageOrThrow({ provider: 'COUNTRY_NOW', caller: 'DESTINATION_LARGE_CITY_COVERAGE' });
      const response = await withProviderThrottle(
        countryNowLimiter,
        'CountryNow',
        countryNowMinIntervalMs,
        () => axios.post<T>(url, body, { timeout: 30000 })
      );
      return response.data;
    } catch (error: any) {
      lastError = error;
      // A blocked reservation means our own rate/budget cap was hit, not a transient upstream
      // failure — retrying would just re-throw the same error and burn the retry budget for no
      // benefit, so fail fast instead of treating it as a retryable network condition.
      if (error instanceof ApiLimitExceededError) break;
      const status = Number(error?.response?.status ?? 0);
      const retryAfterMs = parseRetryAfterMs(error?.response?.headers?.['retry-after']);
      const retryable = status === 0 || status === 403 || status === 429 || status >= 500;
      if (!retryable || attempt === MAX_PROVIDER_RETRIES) break;
      await sleep(retryAfterMs ?? attempt * 1500);
    }
  }

  throw lastError;
}

async function getGeoNames<T>(params: Record<string, string | number>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_PROVIDER_RETRIES; attempt += 1) {
    try {
      await reserveApiUsageOrThrow({ provider: 'GEONAMES', caller: 'DESTINATION_LARGE_CITY_COVERAGE' });
      const response = await withProviderThrottle(
        geonamesLimiter,
        'GeoNames',
        geonamesMinIntervalMs,
        () =>
          axios.get<T>(GEONAMES_SEARCH_URL, {
            timeout: 30000,
            params,
          })
      );
      return response.data;
    } catch (error: any) {
      lastError = error;
      if (error instanceof ApiLimitExceededError) break;
      const status = Number(error?.response?.status ?? 0);
      const retryAfterMs = parseRetryAfterMs(error?.response?.headers?.['retry-after']);
      const retryable = status === 0 || status === 403 || status === 429 || status >= 500;
      if (!retryable || attempt === MAX_PROVIDER_RETRIES) break;
      await sleep(retryAfterMs ?? attempt * 1200);
    }
  }

  throw lastError;
}

export function normalizeSourceMatchKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mergeLargeCitySeedSources(primary: LargeCitySeed, secondary?: LargeCitySeed): LargeCitySeed {
  return {
    ...primary,
    population: Math.max(primary.population ?? 0, secondary?.population ?? 0) || undefined,
    sourceUrls: Array.from(new Set([...(primary.sourceUrls ?? []), ...(secondary?.sourceUrls ?? [])])),
  };
}

export function applyMillionPlusCoverage(seedList: LargeCitySeed[], millionPlusSeeds: LargeCitySeed[]): LargeCitySeed[] {
  const nextSeedList = [...seedList];
  const seedIndexByName = new Map<string, number>();

  nextSeedList.forEach((seed, index) => {
    const key = normalizeSourceMatchKey(seed.name);
    if (key) seedIndexByName.set(key, index);
  });

  for (const seed of millionPlusSeeds) {
    const seedKey = normalizeSourceMatchKey(seed.name);
    if (!seedKey) continue;

    const existingIndex = seedIndexByName.get(seedKey);
    if (existingIndex !== undefined) {
      nextSeedList[existingIndex] = mergeLargeCitySeedSources(nextSeedList[existingIndex], seed);
      continue;
    }

    nextSeedList.push(seed);
    seedIndexByName.set(seedKey, nextSeedList.length - 1);
  }

  return nextSeedList;
}

export async function fetchCountryNowCitySeeds(countryName: string, targetCount: number): Promise<LargeCitySeed[]> {
  const cacheKey = normalizeKey(countryName);
  if (countryNowCitySeedCache.has(cacheKey)) {
    return countryNowCitySeedCache.get(cacheKey) ?? [];
  }

  try {
    const requestBody = {
      country: countryName,
      order: 'dsc',
      orderBy: 'value',
      limit: Math.min(Math.max(targetCount * 3, 100), 400),
    };

    let populationRecords: CountryNowCityRecord[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const data = await postCountryNow<CountryNowFilterResponse>(COUNTRYNOW_CITY_POPULATION_URL, requestBody);
        populationRecords = Array.isArray(data?.data) ? data.data : [];
        if (populationRecords.length > 0) break;
      } catch (_error) {
        // A blocked reservation means our own rate/budget cap was hit, not a transient upstream
        // failure — stop this outer retry loop too instead of sleeping through 3 more attempts
        // that will just hit the same cap again.
        if (_error instanceof ApiLimitExceededError) break;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }

    const seedsFromPopulation = uniqueSeeds(
      populationRecords
        .filter((record) => {
          const city = (record.city ?? '').trim();
          return city.length > 0 && !isLikelySyntheticName(city);
        })
        .map((record) => {
          const rawName = (record.city ?? '').trim();
          const parenthetical = rawName.match(/\(([^)]+)\)\s*$/);
          const state = parenthetical ? parenthetical[1].trim() : '';
          const cityName = rawName.replace(/\s*\([^)]*\)\s*$/, '').trim();

          const latestCount = (record.populationCounts ?? [])
            .filter((pc) => pc.sex === 'Both Sexes' || !pc.sex)
            .sort((a, b) => Number(b.year ?? 0) - Number(a.year ?? 0))[0];
          const pop = Number(latestCount?.value ?? 0);

          return {
            name: cityName,
            city: cityName,
            state,
            officialName: cityName,
            population: pop > 0 ? pop : undefined,
          };
        })
    );

    let seeds = [...seedsFromPopulation];
    if (seeds.length < targetCount) {
      const data = await postCountryNow<CountryNowCitiesResponse>(COUNTRYNOW_CITY_LIST_URL, { country: countryName });
      const cityNames = Array.isArray(data?.data) ? data.data : [];
      const fallbackSeeds = uniqueSeeds(
        cityNames
          .filter((name) => {
            const city = String(name ?? '').trim();
            return city.length > 0 && !isLikelySyntheticName(city);
          })
          .slice(0, Math.min(1200, targetCount * 20))
          .map((name) => {
            const cityName = String(name).trim();
            return {
              name: cityName,
              city: cityName,
              state: '',
              officialName: cityName,
            };
          })
      );
      seeds = uniqueSeeds([...seeds, ...fallbackSeeds]);
    }

    countryNowCitySeedCache.set(cacheKey, seeds);
    return seeds;
  } catch (_error) {
    countryNowCitySeedCache.set(cacheKey, []);
    return [];
  }
}

export async function fetchGeoNamesMillionPlusCitySeeds(country: LargeCityCountry): Promise<LargeCitySeed[]> {
  const cacheKey = country.iso2.toUpperCase();
  if (geonamesMillionCitySeedCache.has(cacheKey)) {
    return geonamesMillionCitySeedCache.get(cacheKey) ?? [];
  }

  try {
    const data = await getGeoNames<GeoNamesSearchResponse>({
      dataset: GEONAMES_DATASET_ID,
      rows: 500,
      format: 'json',
      sort: 'population',
      'refine.country_code': country.iso2,
    });

    const geonamesSeeds: LargeCitySeed[] = [];
    for (const record of Array.isArray(data?.records) ? data.records : []) {
      const fields = record.fields ?? {};
      const population = Number(fields.population ?? 0);
      const cityName = String(fields.name ?? fields.asciiname ?? '').trim();
      if (!cityName || population < LARGE_CITY_POPULATION_THRESHOLD || isLikelySyntheticName(cityName)) {
        continue;
      }

      const geonamesRecordUrl = record.recordid
        ? `https://documentation-resources.huwise.com/api/datasets/1.0/${GEONAMES_DATASET_ID}/records/${record.recordid}`
        : GEONAMES_SEARCH_URL;

      geonamesSeeds.push({
        name: cityName,
        city: cityName,
        state: '',
        officialName: cityName,
        population,
        sourceUrls: [geonamesRecordUrl],
      });
    }

    const seeds = uniqueSeeds(geonamesSeeds);
    geonamesMillionCitySeedCache.set(cacheKey, seeds);
    return seeds;
  } catch (_error) {
    geonamesMillionCitySeedCache.set(cacheKey, []);
    return [];
  }
}

export async function fetchMillionPlusCitySeeds(
  country: LargeCityCountry,
  countryCandidates: string[]
): Promise<LargeCitySeed[]> {
  const countryNowSeedsByKey = new Map<string, LargeCitySeed>();

  for (const candidate of countryCandidates) {
    const seeds = await fetchCountryNowCitySeeds(candidate, 400);
    for (const seed of seeds) {
      if ((seed.population ?? 0) < LARGE_CITY_POPULATION_THRESHOLD) continue;
      const key = normalizeSourceMatchKey(seed.name);
      if (!key) continue;
      const sourceSeed: LargeCitySeed = {
        ...seed,
        sourceUrls: [COUNTRYNOW_CITY_POPULATION_URL],
      };
      const existing = countryNowSeedsByKey.get(key);
      countryNowSeedsByKey.set(key, existing ? mergeLargeCitySeedSources(existing, sourceSeed) : sourceSeed);
    }
    if (countryNowSeedsByKey.size > 0) break;
  }

  const geonamesSeeds = await fetchGeoNamesMillionPlusCitySeeds(country);
  const mergedByKey = new Map<string, LargeCitySeed>();

  for (const seed of geonamesSeeds) {
    const key = normalizeSourceMatchKey(seed.name);
    if (!key) continue;
    mergedByKey.set(key, seed);
  }

  for (const [key, seed] of countryNowSeedsByKey.entries()) {
    const existing = mergedByKey.get(key);
    mergedByKey.set(key, existing ? mergeLargeCitySeedSources(existing, seed) : seed);
  }

  return uniqueSeeds(
    Array.from(mergedByKey.values()).sort((a, b) => {
      const popDiff = (b.population ?? 0) - (a.population ?? 0);
      if (popDiff !== 0) return popDiff;
      return a.name.localeCompare(b.name);
    })
  );
}
