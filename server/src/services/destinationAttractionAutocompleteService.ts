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

type AutocompleteDataset = {
  loadedAt: number;
  destinationsMtimeMs: number;
  attractionsMtimeMs: number;
  destinations: DestinationRecord[];
  destinationsById: Map<string, DestinationRecord>;
  destinationsByCountry: Map<string, DestinationRecord[]>;
  destinationsByState: Map<string, DestinationRecord[]>;
  attractions: AttractionRecord[];
  attractionsByDestination: Map<string, AttractionRecord[]>;
};

type CachedResult<T> = { ts: number; results: T[] };

const destinationQueryCache = new Map<string, CachedResult<DestinationLocationOption>>();
const attractionQueryCache = new Map<string, CachedResult<AttractionAutocompleteOption>>();
let datasetCache: AutocompleteDataset | null = null;
let datasetLoadPromise: Promise<AutocompleteDataset> | null = null;

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

const buildDataset = (): AutocompleteDataset => {
  const destinationsPath = resolveDestinationsCsvPath();
  const attractionsPath = resolveAttractionsCsvPath();
  const destinationsRaw = fs.existsSync(destinationsPath) ? fs.readFileSync(destinationsPath, 'utf8') : '';
  const attractionsRaw = fs.existsSync(attractionsPath) ? fs.readFileSync(attractionsPath, 'utf8') : '';
  const destinations = parseDestinations(destinationsRaw);
  const destinationsById = new Map<string, DestinationRecord>();
  const destinationsByCountry = new Map<string, DestinationRecord[]>();
  const destinationsByState = new Map<string, DestinationRecord[]>();
  const destinationsByKey = new Map<string, DestinationRecord[]>();
  destinations.forEach((record) => {
    destinationsById.set(record.id, record);
    if (record.countryName) {
      const key = normalizeKey(record.countryName);
      const list = destinationsByCountry.get(key) ?? [];
      list.push(record);
      destinationsByCountry.set(key, list);
    }
    if (record.stateName) {
      const key = normalizeKey(record.stateName);
      const list = destinationsByState.get(key) ?? [];
      list.push(record);
      destinationsByState.set(key, list);
    }
    const list = destinationsByKey.get(record.destinationKey) ?? [];
    list.push(record);
    destinationsByKey.set(record.destinationKey, list);
  });
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
  const destinationsMtimeMs = fs.existsSync(destinationsPath) ? fs.statSync(destinationsPath).mtimeMs : 0;
  const attractionsMtimeMs = fs.existsSync(attractionsPath) ? fs.statSync(attractionsPath).mtimeMs : 0;
  return {
    loadedAt: Date.now(),
    destinationsMtimeMs,
    attractionsMtimeMs,
    destinations,
    destinationsById,
    destinationsByCountry,
    destinationsByState,
    attractions,
    attractionsByDestination,
  };
};

const cacheStillFresh = (): boolean => {
  if (!datasetCache) return false;
  const ttl = datasetTtlMs();
  if (Date.now() - datasetCache.loadedAt >= ttl) return false;
  try {
    const destinationsPath = resolveDestinationsCsvPath();
    const attractionsPath = resolveAttractionsCsvPath();
    const destinationMtime = fs.existsSync(destinationsPath) ? fs.statSync(destinationsPath).mtimeMs : 0;
    const attractionMtime = fs.existsSync(attractionsPath) ? fs.statSync(attractionsPath).mtimeMs : 0;
    return (
      destinationMtime === datasetCache.destinationsMtimeMs &&
      attractionMtime === datasetCache.attractionsMtimeMs
    );
  } catch {
    return false;
  }
};

const getDataset = async (): Promise<AutocompleteDataset> => {
  if (cacheStillFresh() && datasetCache) return datasetCache;
  if (datasetLoadPromise) return datasetLoadPromise;
  datasetLoadPromise = (async () => {
    const next = buildDataset();
    datasetCache = next;
    return next;
  })();
  try {
    return await datasetLoadPromise;
  } finally {
    datasetLoadPromise = null;
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
  dataset: AutocompleteDataset,
  selectedLocationIds: string[],
  selectedLocationNames: string[]
): Set<string> => {
  const keys = new Set<string>();
  const normalizedNames = new Set(selectedLocationNames.map((name) => normalizeKey(name)).filter(Boolean));

  for (const id of selectedLocationIds) {
    if (id.startsWith('destination:')) {
      const found = dataset.destinationsById.get(id);
      if (found) keys.add(found.destinationKey);
    }
  }

  for (const destination of dataset.destinations) {
    const destinationName = normalizeKey(destination.name);
    const countryName = normalizeKey(destination.countryName);
    const stateName = normalizeKey(destination.stateName);
    if (destinationName && normalizedNames.has(destinationName)) {
      keys.add(destination.destinationKey);
      continue;
    }
    if (stateName && normalizedNames.has(stateName)) {
      keys.add(destination.destinationKey);
      continue;
    }
    if (countryName && normalizedNames.has(countryName)) {
      keys.add(destination.destinationKey);
      continue;
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

  const dataset = await getDataset();
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
  destinationQueryCache.set(cacheKey, { ts: Date.now(), results });
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

  const dataset = await getDataset();
  const allowedDestinationKeys = resolveDestinationKeysForFilters(dataset, selectedIds, selectedNames);
  if (!allowedDestinationKeys.size) return [];

  const candidates: AttractionRecord[] = [];
  for (const key of allowedDestinationKeys) {
    const group = dataset.attractionsByDestination.get(key);
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
  attractionQueryCache.set(cacheKey, { ts: Date.now(), results });
  return results;
};

export const getDestinationLocationOptionsByIds = async (
  ids: string[]
): Promise<DestinationLocationOption[]> => {
  const normalized = Array.from(new Set((ids ?? []).map((id) => normalizeText(id)).filter(Boolean)));
  if (!normalized.length) return [];
  const dataset = await getDataset();
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
  datasetCache = null;
  datasetLoadPromise = null;
  destinationQueryCache.clear();
  attractionQueryCache.clear();
};

/**
 * Pre-warm the autocomplete dataset cache so the first user request
 * doesn't pay the cost of parsing ~154k CSV rows.
 */
export const prewarmAutocompleteCache = async (): Promise<void> => {
  await getDataset();
};
