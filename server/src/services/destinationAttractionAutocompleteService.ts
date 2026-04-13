import fs from 'fs';
import path from 'path';
import { getEnvValue } from '../env';
import { getApiCacheSetting } from '../config/apiLimits';
import { parseCsvLine } from './destinationsAttractionsCsv';

export type DestinationLocationOption = {
  id: string;
  sourceType: 'destination';
  name: string;
  countryName?: string;
  stateName?: string;
  nearestCity?: string;
};

export type AttractionAutocompleteOption = {
  id: string;
  sourceType: 'attraction';
  name: string;
  destinationId?: string;
  destinationName?: string;
  countryName?: string;
  stateName?: string;
  activityType?: string;
  budgetTier?: string;
};

type DestinationRecord = DestinationLocationOption & {
  destinationKey: string;
  searchText: string;
};

type AttractionRecord = AttractionAutocompleteOption & {
  destinationKey: string;
  searchText: string;
  rank: number;
};

type DestinationDataset = {
  loadedAt: number;
  destinationsMtimeMs: number;
  destinations: DestinationRecord[];
  destinationsById: Map<string, DestinationRecord>;
  destinationsByName: Map<string, DestinationRecord[]>;
  destinationsByCountry: Map<string, DestinationRecord[]>;
  destinationsByState: Map<string, DestinationRecord[]>;
  destinationsByKey: Map<string, DestinationRecord[]>;
};

type AttractionDataset = {
  loadedAt: number;
  attractionsMtimeMs: number;
  attractions: AttractionRecord[];
  attractionsByDestination: Map<string, AttractionRecord[]>;
};

type CachedResult<T> = { ts: number; results: T[] };

const destinationQueryCache = new Map<string, CachedResult<DestinationLocationOption>>();
const attractionQueryCache = new Map<string, CachedResult<AttractionAutocompleteOption>>();
const MAX_QUERY_CACHE_ENTRIES = 200;
let destinationDatasetCache: DestinationDataset | null = null;
let destinationDatasetLoadPromise: Promise<DestinationDataset> | null = null;
let attractionDatasetCache: AttractionDataset | null = null;
let attractionDatasetLoadPromise: Promise<AttractionDataset> | null = null;

const normalizeText = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

const normalizeKey = (value: unknown): string =>
  normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const slugify = (value: unknown): string =>
  normalizeKey(value)
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const resolveDestinationsCsvPath = (): string => {
  const configured = getEnvValue('DESTINATIONS_CSV_LOCAL_PATH');
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, '../../data/destinations.csv');
};

const resolveAttractionsCsvPath = (): string => {
  const configured = getEnvValue('ATTRACTIONS_CSV_LOCAL_PATH');
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, '../../data/attractions_catalog.csv');
};

const datasetTtlMs = (): number => {
  const minutes =
    Number(getApiCacheSetting('locations', 'csvCacheTtlMinutes')) ||
    Number(getEnvValue('LOCATION_CSV_CACHE_TTL_MINUTES', { defaultValue: '60' }));
  if (!Number.isFinite(minutes) || minutes <= 0) return 60 * 60 * 1000;
  return Math.round(minutes * 60 * 1000);
};

const queryTtlMs = (): number => 5 * 60 * 1000;

const purgeExpired = <T>(store: Map<string, CachedResult<T>>, ttlMs: number) => {
  const now = Date.now();
  for (const [key, value] of store.entries()) {
    if (now - value.ts >= ttlMs) store.delete(key);
  }
};

const setCachedResults = <T>(store: Map<string, CachedResult<T>>, key: string, results: T[]): void => {
  store.set(key, { ts: Date.now(), results });
  if (store.size <= MAX_QUERY_CACHE_ENTRIES) return;

  let oldestKey: string | null = null;
  let oldestTs = Number.POSITIVE_INFINITY;
  for (const [entryKey, entry] of store.entries()) {
    if (entry.ts < oldestTs) {
      oldestTs = entry.ts;
      oldestKey = entryKey;
    }
  }
  if (oldestKey) store.delete(oldestKey);
};

const pushMapArray = <T>(map: Map<string, T[]>, key: string, value: T): void => {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
};

const scoreMatch = (name: string, searchText: string, q: string): number => {
  const normalizedName = normalizeKey(name);
  if (normalizedName === q) return 0;
  if (normalizedName.startsWith(q)) return 1;
  if (searchText.startsWith(q)) return 2;
  if (searchText.includes(` ${q}`)) return 3;
  return 4;
};

const splitCsvRows = (raw: string): Array<Record<string, string>> => {
  const lines = String(raw ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => normalizeText(header));
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = String(values[idx] ?? '');
    });
    rows.push(row);
  }
  return rows;
};

const parseDestinations = (raw: string): DestinationRecord[] => {
  const rows = splitCsvRows(raw);
  const seenIds = new Set<string>();
  const records: DestinationRecord[] = [];
  for (const row of rows) {
    const name = normalizeText(row['Destination English Name']);
    if (!name) continue;
    const countryName = normalizeText(row['Country']);
    const stateName = normalizeText(row['State/Provence']);
    const nearestCity = normalizeText(row['Nearest City']);
    const destinationKey = normalizeKey(name);
    const idSeed = [name, countryName, stateName].filter(Boolean).join('|');
    const id = `destination:${slugify(idSeed || name)}`;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    const searchText = normalizeKey([name, countryName, stateName, nearestCity].filter(Boolean).join(' '));
    records.push({
      id,
      sourceType: 'destination',
      name,
      countryName: countryName || undefined,
      stateName: stateName || undefined,
      nearestCity: nearestCity || undefined,
      destinationKey,
      searchText,
    });
  }
  return records;
};

const parseAttractions = (
  raw: string,
  destinationsByKey: Map<string, DestinationRecord[]>
): AttractionRecord[] => {
  const rows = splitCsvRows(raw);
  const records: AttractionRecord[] = [];
  for (const row of rows) {
    const id = normalizeText(row.id);
    const destinationKey = normalizeKey(row.destination_key || row.destination_display_name);
    const destinationName = normalizeText(row.destination_display_name);
    const name = normalizeText(row.name);
    if (!id || !destinationKey || !name) continue;
    const rank = Number(row.rank);
    const destinationCandidates = destinationsByKey.get(destinationKey) ?? [];
    const destinationId = destinationCandidates[0]?.id;
    const countryName = normalizeText(row.country) || destinationCandidates[0]?.countryName;
    const stateName = normalizeText(row.state_province) || destinationCandidates[0]?.stateName;
    const searchText = normalizeKey([name, destinationName, countryName, stateName].filter(Boolean).join(' '));
    records.push({
      id,
      sourceType: 'attraction',
      name,
      destinationId,
      destinationName: destinationName || destinationCandidates[0]?.name,
      countryName,
      stateName,
      activityType: normalizeText(row.activity_type) || undefined,
      budgetTier: normalizeText(row.budget_tier) || undefined,
      destinationKey,
      searchText,
      rank: Number.isFinite(rank) ? rank : 9999,
    });
  }
  return records;
};

const buildDestinationDataset = (): DestinationDataset => {
  const destinationsPath = resolveDestinationsCsvPath();
  const destinationsRaw = fs.existsSync(destinationsPath) ? fs.readFileSync(destinationsPath, 'utf8') : '';
  const destinations = parseDestinations(destinationsRaw);
  const destinationsById = new Map<string, DestinationRecord>();
  const destinationsByName = new Map<string, DestinationRecord[]>();
  const destinationsByCountry = new Map<string, DestinationRecord[]>();
  const destinationsByState = new Map<string, DestinationRecord[]>();
  const destinationsByKey = new Map<string, DestinationRecord[]>();
  destinations.forEach((record) => {
    destinationsById.set(record.id, record);
    pushMapArray(destinationsByName, record.destinationKey, record);
    if (record.countryName) pushMapArray(destinationsByCountry, normalizeKey(record.countryName), record);
    if (record.stateName) pushMapArray(destinationsByState, normalizeKey(record.stateName), record);
    pushMapArray(destinationsByKey, record.destinationKey, record);
  });
  const destinationsMtimeMs = fs.existsSync(destinationsPath) ? fs.statSync(destinationsPath).mtimeMs : 0;
  return {
    loadedAt: Date.now(),
    destinationsMtimeMs,
    destinations,
    destinationsById,
    destinationsByName,
    destinationsByCountry,
    destinationsByState,
    destinationsByKey,
  };
};

const buildAttractionDataset = (destinationsByKey: Map<string, DestinationRecord[]>): AttractionDataset => {
  const attractionsPath = resolveAttractionsCsvPath();
  const attractionsRaw = fs.existsSync(attractionsPath) ? fs.readFileSync(attractionsPath, 'utf8') : '';
  const attractions = parseAttractions(attractionsRaw, destinationsByKey);
  const attractionsByDestination = new Map<string, AttractionRecord[]>();
  for (const attr of attractions) {
    const list = attractionsByDestination.get(attr.destinationKey);
    if (list) {
      list.push(attr);
    } else {
      attractionsByDestination.set(attr.destinationKey, [attr]);
    }
  }
  const attractionsMtimeMs = fs.existsSync(attractionsPath) ? fs.statSync(attractionsPath).mtimeMs : 0;
  return {
    loadedAt: Date.now(),
    attractionsMtimeMs,
    attractions,
    attractionsByDestination,
  };
};

const destinationCacheStillFresh = (): boolean => {
  if (!destinationDatasetCache) return false;
  const ttl = datasetTtlMs();
  if (Date.now() - destinationDatasetCache.loadedAt >= ttl) return false;
  try {
    const destinationsPath = resolveDestinationsCsvPath();
    const destinationMtime = fs.existsSync(destinationsPath) ? fs.statSync(destinationsPath).mtimeMs : 0;
    return destinationMtime === destinationDatasetCache.destinationsMtimeMs;
  } catch {
    return false;
  }
};

const attractionCacheStillFresh = (): boolean => {
  if (!attractionDatasetCache) return false;
  const ttl = datasetTtlMs();
  if (Date.now() - attractionDatasetCache.loadedAt >= ttl) return false;
  try {
    const attractionsPath = resolveAttractionsCsvPath();
    const attractionMtime = fs.existsSync(attractionsPath) ? fs.statSync(attractionsPath).mtimeMs : 0;
    return attractionMtime === attractionDatasetCache.attractionsMtimeMs;
  } catch {
    return false;
  }
};

const getDestinationDataset = async (): Promise<DestinationDataset> => {
  if (destinationCacheStillFresh() && destinationDatasetCache) return destinationDatasetCache;
  if (destinationDatasetLoadPromise) return destinationDatasetLoadPromise;
  destinationDatasetLoadPromise = (async () => {
    const next = buildDestinationDataset();
    destinationDatasetCache = next;
    destinationQueryCache.clear();
    attractionQueryCache.clear();
    return next;
  })();
  try {
    return await destinationDatasetLoadPromise;
  } finally {
    destinationDatasetLoadPromise = null;
  }
};

const getAttractionDataset = async (): Promise<AttractionDataset> => {
  if (attractionCacheStillFresh() && attractionDatasetCache) return attractionDatasetCache;
  if (attractionDatasetLoadPromise) return attractionDatasetLoadPromise;
  attractionDatasetLoadPromise = (async () => {
    const destinationDataset = await getDestinationDataset();
    const next = buildAttractionDataset(destinationDataset.destinationsByKey);
    attractionDatasetCache = next;
    attractionQueryCache.clear();
    return next;
  })();
  try {
    return await attractionDatasetLoadPromise;
  } finally {
    attractionDatasetLoadPromise = null;
  }
};

const applyLimit = <T>(items: T[], limit?: number): T[] => {
  const max = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 1), 50) : 10;
  return items.slice(0, max);
};

const parseDelimitedValues = (value: unknown, delimiter: string): string[] =>
  String(value ?? '')
    .split(delimiter)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);

const resolveDestinationKeysForFilters = (
  dataset: DestinationDataset,
  selectedLocationIds: string[],
  selectedLocationNames: string[]
): Set<string> => {
  const keys = new Set<string>();

  for (const id of selectedLocationIds) {
    if (id.startsWith('destination:')) {
      const found = dataset.destinationsById.get(id);
      if (found) keys.add(found.destinationKey);
    }
  }

  for (const normalizedName of selectedLocationNames.map((name) => normalizeKey(name)).filter(Boolean)) {
    for (const match of dataset.destinationsByName.get(normalizedName) ?? []) {
      keys.add(match.destinationKey);
    }
    for (const match of dataset.destinationsByState.get(normalizedName) ?? []) {
      keys.add(match.destinationKey);
    }
    for (const match of dataset.destinationsByCountry.get(normalizedName) ?? []) {
      keys.add(match.destinationKey);
    }
  }

  return keys;
};

export const searchDestinationLocationOptions = async (
  query: string,
  limit = 10
): Promise<DestinationLocationOption[]> => {
  const q = normalizeKey(query);
  if (!q) return [];
  const max = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 1), 50) : 10;
  const ttl = queryTtlMs();
  purgeExpired(destinationQueryCache, ttl);
  const cacheKey = `${q}|${max}`;
  const cached = destinationQueryCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ttl) return cached.results;

  const dataset = await getDestinationDataset();
  const filtered = dataset.destinations
    .filter((item) => item.searchText.includes(q))
    .sort((a, b) => {
      const scoreA = scoreMatch(a.name, a.searchText, q);
      const scoreB = scoreMatch(b.name, b.searchText, q);
      if (scoreA !== scoreB) return scoreA - scoreB;
      if (a.countryName !== b.countryName) return String(a.countryName ?? '').localeCompare(String(b.countryName ?? ''));
      return a.name.localeCompare(b.name);
    });
  const results = applyLimit(
    filtered.map(({ destinationKey, searchText, ...rest }) => rest),
    max
  );
  setCachedResults(destinationQueryCache, cacheKey, results);
  return results;
};

export const searchAttractionOptionsForSelectedLocations = async (params: {
  query: string;
  selectedLocationIds?: string[];
  selectedLocationNames?: string[];
  limit?: number;
}): Promise<AttractionAutocompleteOption[]> => {
  const q = normalizeKey(params.query);
  if (!q) return [];
  const selectedIds = Array.from(new Set((params.selectedLocationIds ?? []).map((id) => normalizeText(id)).filter(Boolean)));
  const selectedNames = Array.from(
    new Set((params.selectedLocationNames ?? []).map((name) => normalizeText(name)).filter(Boolean))
  );
  const max = Number.isFinite(params.limit) ? Math.min(Math.max(Number(params.limit), 1), 50) : 12;
  const ttl = queryTtlMs();
  purgeExpired(attractionQueryCache, ttl);
  const cacheKey = `${q}|${selectedIds.join(',')}|${selectedNames.join('|')}|${max}`;
  const cached = attractionQueryCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ttl) return cached.results;

  const destinationDataset = await getDestinationDataset();
  const allowedDestinationKeys = resolveDestinationKeysForFilters(destinationDataset, selectedIds, selectedNames);
  if (!allowedDestinationKeys.size) return [];
  const attractionDataset = await getAttractionDataset();

  const candidates: AttractionRecord[] = [];
  for (const key of allowedDestinationKeys) {
    const group = attractionDataset.attractionsByDestination.get(key);
    if (group) candidates.push(...group);
  }

  const seenNames = new Set<string>();
  const filtered = candidates
    .filter((item) => item.searchText.includes(q))
    .sort((a, b) => {
      const scoreA = scoreMatch(a.name, a.searchText, q);
      const scoreB = scoreMatch(b.name, b.searchText, q);
      if (scoreA !== scoreB) return scoreA - scoreB;
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.destinationName !== b.destinationName) return String(a.destinationName ?? '').localeCompare(String(b.destinationName ?? ''));
      return a.name.localeCompare(b.name);
    })
    .filter((item) => {
      const key = normalizeKey(item.name);
      if (!key || seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    });

  const results = applyLimit(
    filtered.map(({ destinationKey, searchText, rank, ...rest }) => rest),
    max
  );
  setCachedResults(attractionQueryCache, cacheKey, results);
  return results;
};

export const getDestinationLocationOptionsByIds = async (
  ids: string[]
): Promise<DestinationLocationOption[]> => {
  const normalized = Array.from(new Set((ids ?? []).map((id) => normalizeText(id)).filter(Boolean)));
  if (!normalized.length) return [];
  const dataset = await getDestinationDataset();
  const out: DestinationLocationOption[] = [];
  normalized.forEach((id) => {
    const item = dataset.destinationsById.get(id);
    if (!item) return;
    const { destinationKey, searchText, ...rest } = item;
    out.push(rest);
  });
  return out;
};

export const splitSelectedLocationNames = (raw: unknown): string[] => parseDelimitedValues(raw, '|');
export const splitSelectedLocationIds = (raw: unknown): string[] => parseDelimitedValues(raw, ',');

export const clearDestinationAttractionAutocompleteCache = (): void => {
  destinationDatasetCache = null;
  destinationDatasetLoadPromise = null;
  attractionDatasetCache = null;
  attractionDatasetLoadPromise = null;
  destinationQueryCache.clear();
  attractionQueryCache.clear();
};

/**
 * Pre-warm the autocomplete dataset cache so the first user request
 * doesn't pay the cost of parsing ~154k CSV rows.
 */
export const prewarmAutocompleteCache = async (): Promise<void> => {
  await Promise.all([getDestinationDataset(), getAttractionDataset()]);
};
