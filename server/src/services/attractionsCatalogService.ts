import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { getEnvValue, isLocalEnv } from '../env';
import { getApiCacheSetting } from '../config/apiLimits';
import { parseDestinationsCsv } from './destinationsAttractionsCsv';
import {
  getAttractionShortlistBlob,
  listAttractionCatalogEntries,
  upsertAttractionCatalogEntry,
  upsertAttractionShortlistBlob,
} from '../db';
import { logError, logInfo } from '../logger';
import type {
  ActivityType,
  AttractionBudgetTier,
  AttractionCatalogEntry,
  AttractionShortlistBlob,
  InterestTag,
} from '../types';

type DiscoveryCandidate = {
  name: string;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  sourceGroup?: string | null;
  snippet?: string | null;
};

type DestinationSignals = {
  normalized: string;
  aliases: string[];
  tokenSets: string[][];
};

type DestinationGeo = {
  country: string | null;
  stateProvince: string | null;
};

const CSV_HEADER = [
  'id',
  'destination_key',
  'destination_display_name',
  'country',
  'state_province',
  'name',
  'rank',
  'activity_type',
  'interest_tags',
  'source_url',
  'source_label',
  'snippet',
  'source_count',
  'budget_tier',
  'updated_at',
  'sitelinks',
  'qid',
  'lat',
  'lon',
] as const;

const destinationRefreshLocks = new Map<string, Promise<AttractionCatalogEntry[]>>();
let destinationGeoCache:
  | {
      filePath: string;
      mtimeMs: number;
      geoByDestinationKey: Map<string, DestinationGeo>;
    }
  | null = null;

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();
// Fold hyphens (and other separators) to spaces so a hyphenated catalog slug
// ("new-york-city") and a typed destination name ("New York City") normalize to
// the same key. slugify() below re-inserts hyphens, so its output is unchanged.
const normalizeTextKey = (value: string): string =>
  normalizeWhitespace(String(value ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' '));
const slugify = (value: string): string =>
  normalizeTextKey(value)
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

export const normalizeDestinationKey = (value: string): string => normalizeTextKey(value).replace(/\s+/g, ' ').trim();

const destinationAliases = (value: string): string[] => {
  const key = normalizeDestinationKey(value);
  if (!key) return [];
  const aliases = new Set<string>([key]);
  if (key === 'mexico city' || key === 'ciudad de mexico' || key === 'cdmx') {
    aliases.add('mexico city');
    aliases.add('ciudad de mexico');
    aliases.add('cdmx');
  }
  return Array.from(aliases);
};

const buildDestinationSignals = (destination: string): DestinationSignals => {
  const aliases = destinationAliases(destination);
  return {
    normalized: normalizeDestinationKey(destination),
    aliases,
    tokenSets: aliases.map((alias) => alias.split(' ').filter(Boolean)).filter((tokens) => tokens.length > 0),
  };
};
const toBudgetTier = (raw: unknown): AttractionBudgetTier => {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'free' || value === 'paid' || value === 'premium') return value;
  return 'paid';
};

const sanitizeCandidateName = (value: string): string => {
  const cleaned = normalizeWhitespace(value)
    .replace(/\s*[-|]\s*Wikipedia.*$/i, '')
    .replace(/\s*\(official site\)\s*$/i, '')
    .trim();
  return cleaned;
};

const shouldExcludeCandidate = (name: string): boolean => {
  const lower = name.toLowerCase();
  if (!lower) return true;
  if (lower.startsWith('list of ')) return true;
  if (lower.startsWith('category:')) return true;
  if (lower.startsWith('template:')) return true;
  if (lower.includes('disambiguation')) return true;
  if (/^(law enforcement|tourism in|history of|economy of|demographics of|geography of|culture of)\b/.test(lower))
    return true;
  if (/\bin mexico\b/.test(lower) && !/\bmexico city\b/.test(lower)) return true;
  return false;
};

const localityRelevanceScore = (candidate: DiscoveryCandidate, signals: DestinationSignals): number => {
  const nameKey = normalizeTextKey(candidate.name || '');
  const snippetKey = normalizeTextKey(candidate.snippet || '');
  const urlKey = normalizeTextKey(candidate.sourceUrl || '');
  if (!nameKey && !snippetKey && !urlKey) return 0;

  let score = 0;
  for (const alias of signals.aliases) {
    if (!alias) continue;
    if (nameKey.includes(alias)) score += 6;
    if (snippetKey.includes(alias)) score += 5;
    if (urlKey.includes(alias.replace(/\s+/g, '-')) || urlKey.includes(alias)) score += 4;
  }
  return score;
};

export const inferActivityType = (name: string, snippet?: string): ActivityType => {
  const text = `${name} ${snippet ?? ''}`.toLowerCase();
  if (/\b(class|workshop|cooking|lesson|masterclass)\b/.test(text)) return 'Class';
  if (/\b(concert|show|theater|theatre|opera|ballet)\b/.test(text)) return 'Concert/Show';
  if (/\b(day trip|excursion|full-day|half-day)\b/.test(text)) return 'Day Trip';
  if (/\b(festival|event|parade)\b/.test(text)) return 'Event';
  if (/\b(restaurant|food|eatery|food hall|tasting)\b/.test(text)) return 'Food & Drink';
  if (/\b(arcade|escape room|amusement|theme park|game)\b/.test(text)) return 'Fun & Games';
  if (/\b(hike|trail|trek|summit)\b/.test(text)) return 'Hike';
  if (/\b(nightlife|bar|club|pub|speakeasy)\b/.test(text)) return 'Nightlife';
  if (/\b(kayak|bike|cycling|snorkel|surf|outdoor)\b/.test(text)) return 'Outdoor Activity';
  if (/\b(reserve|reservation|timed entry)\b/.test(text)) return 'Reservation';
  if (/\b(shop|shopping|mall|boutique|bazaar)\b/.test(text)) return 'Shopping';
  if (/\b(cathedral|landmark|monument|palace|historic|zocalo|old town)\b/.test(text)) return 'Sights & Landmarks';
  if (/\b(spa|wellness|massage|sauna|thermal)\b/.test(text)) return 'Spa/Wellness';
  if (/\b(tour|guided|cruise)\b/.test(text)) return 'Tour';
  if (/\b(museum|museo|pyramid|ruins|site|observatory|gallery)\b/.test(text)) return 'Ticketed Attraction';
  if (/\b(park|street|plaza|market)\b/.test(text)) return 'Open Access';
  return 'Open Access';
};

export const inferInterestTags = (name: string, snippet?: string): InterestTag[] => {
  const text = `${name} ${snippet ?? ''}`.toLowerCase();
  const tags = new Set<InterestTag>();
  if (/\b(park|trail|hike|lake|beach|outdoor|garden)\b/.test(text)) tags.add('outdoors');
  if (/\b(museum|historic|cathedral|temple|archaeolog|gallery|palace)\b/.test(text)) tags.add('culture');
  if (/\b(food|market|restaurant|cuisine|street food|taco|wine|coffee|cooking)\b/.test(text)) tags.add('food');
  if (/\b(bar|club|nightlife|cantina|music venue|pub)\b/.test(text)) tags.add('nightlife');
  if (/\b(spa|retreat|scenic|boat ride|sunset)\b/.test(text)) tags.add('relax');
  if (/\b(shop|mall|bazaar|market)\b/.test(text)) tags.add('shopping');
  if (/\b(day trip|excursion|nearby town|puebla|teotihuacan)\b/.test(text)) tags.add('day trips');
  if (/\b(festival|event|concert|seasonal)\b/.test(text)) tags.add('events');
  if (/\b(class|workshop|lesson|cooking class)\b/.test(text)) tags.add('classes');
  if (!tags.size) tags.add('culture');
  return Array.from(tags);
};

export const inferBudgetTier = (name: string, snippet: string | undefined, activityType: ActivityType): AttractionBudgetTier => {
  const text = `${name} ${snippet ?? ''}`.toLowerCase();
  if (/\b(luxury|michelin|private tour|vip|fine dining|exclusive|five-star)\b/.test(text)) return 'premium';
  if (/\b(free|public park|plaza|walking street|self-guided|street market)\b/.test(text)) return 'free';
  if (activityType === 'Open Access' && !/\b(ticket|reservation|paid|entry fee)\b/.test(text)) return 'free';
  if (activityType === 'Tour' || activityType === 'Reservation' || activityType === 'Event') return 'paid';
  if (activityType === 'Ticketed Attraction') return 'paid';
  return 'paid';
};

const parseSerpApiCandidates = (payload: any, limit: number): DiscoveryCandidate[] => {
  const organic = Array.isArray(payload?.organic_results) ? payload.organic_results : [];
  const local = Array.isArray(payload?.local_results?.places) ? payload.local_results.places : [];
  const combined: DiscoveryCandidate[] = [];
  organic.forEach((item: any) => {
    combined.push({
      name: String(item?.title ?? ''),
      sourceUrl: typeof item?.link === 'string' ? item.link : null,
      sourceLabel: 'serpapi',
      sourceGroup: 'serpapi',
      snippet: typeof item?.snippet === 'string' ? item.snippet : null,
    });
  });
  local.forEach((item: any) => {
    combined.push({
      name: String(item?.title ?? item?.name ?? ''),
      sourceUrl: typeof item?.website === 'string' ? item.website : null,
      sourceLabel: 'serpapi-local',
      sourceGroup: 'serpapi',
      snippet: typeof item?.type === 'string' ? item.type : null,
    });
  });
  return combined.slice(0, Math.max(limit * 2, 20));
};

const discoverViaSerpApi = async (destination: string, limit: number): Promise<DiscoveryCandidate[]> => {
  const apiKey = getEnvValue('SERPAPI_API_KEY');
  if (!apiKey) return [];
  const query = `top attractions in ${destination}`;
  const response = await axios.get('https://serpapi.com/search.json', {
    params: {
      engine: 'google',
      q: query,
      num: Math.max(20, limit),
      api_key: apiKey,
    },
    timeout: 12000,
  });
  return parseSerpApiCandidates(response.data, limit);
};

const discoverViaWikipedia = async (destination: string, limit: number): Promise<DiscoveryCandidate[]> => {
  const wikipediaHeaders = {
    'User-Agent':
      getEnvValue('ATTRACTIONS_WIKIPEDIA_USER_AGENT') ||
      'SharedTripPlanner/1.0 (attractions discovery; contact: admin@local)',
    Accept: 'application/json',
  };
  const query = `${destination} tourist attractions`;
  try {
    const response = await axios.get('https://en.wikipedia.org/w/api.php', {
      params: {
        action: 'query',
        list: 'search',
        srsearch: query,
        srlimit: Math.max(30, limit * 2),
        format: 'json',
        utf8: 1,
      },
      headers: wikipediaHeaders,
      timeout: 12000,
    });
    const items = Array.isArray(response.data?.query?.search) ? response.data.query.search : [];
    return items.map((item: any) => ({
      name: String(item?.title ?? ''),
      sourceUrl:
        typeof item?.title === 'string'
          ? `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s+/g, '_'))}`
          : null,
      sourceLabel: 'wikipedia',
      sourceGroup: 'wikipedia',
      snippet: typeof item?.snippet === 'string' ? String(item.snippet).replace(/<[^>]+>/g, '') : null,
    }));
  } catch {
    const fallback = await axios.get('https://en.wikipedia.org/w/rest.php/v1/search/title', {
      params: {
        q: query,
        limit: Math.max(20, limit),
      },
      headers: wikipediaHeaders,
      timeout: 12000,
    });
    const pages = Array.isArray(fallback.data?.pages) ? fallback.data.pages : [];
    return pages.map((item: any) => ({
      name: String(item?.title ?? ''),
      sourceUrl:
        typeof item?.key === 'string' ? `https://en.wikipedia.org/wiki/${encodeURIComponent(item.key)}` : null,
      sourceLabel: 'wikipedia-rest',
      sourceGroup: 'wikipedia',
      snippet: typeof item?.description === 'string' ? item.description : null,
    }));
  }
};

type RankedDiscoveryCandidate = DiscoveryCandidate & { sourceCount: number };

const dedupeAndRankCandidates = (
  candidates: DiscoveryCandidate[],
  destination: string,
  limit: number,
  minDistinctSources: number,
  minResultsAfterFilter: number
): RankedDiscoveryCandidate[] => {
  const destinationSignals = buildDestinationSignals(destination);
  const merged = new Map<
    string,
    {
      candidate: DiscoveryCandidate;
      sourceGroups: Set<string>;
      sourceLabels: Set<string>;
      sourceUrls: Set<string>;
    }
  >();
  for (const raw of candidates) {
    const name = sanitizeCandidateName(raw.name);
    if (shouldExcludeCandidate(name)) continue;
    if (normalizeDestinationKey(name) === destinationSignals.normalized) continue;
    const key = normalizeTextKey(name);
    if (!key) continue;
    const existing = merged.get(key) ?? {
      candidate: { ...raw, name },
      sourceGroups: new Set<string>(),
      sourceLabels: new Set<string>(),
      sourceUrls: new Set<string>(),
    };
    existing.candidate = {
      ...existing.candidate,
      name,
      sourceUrl: existing.candidate.sourceUrl ?? raw.sourceUrl ?? null,
      sourceLabel: existing.candidate.sourceLabel ?? raw.sourceLabel ?? null,
      sourceGroup: existing.candidate.sourceGroup ?? raw.sourceGroup ?? null,
      snippet: existing.candidate.snippet ?? raw.snippet ?? null,
    };
    const group = String(raw.sourceGroup ?? raw.sourceLabel ?? '').trim().toLowerCase();
    if (group) existing.sourceGroups.add(group);
    const label = String(raw.sourceLabel ?? '').trim().toLowerCase();
    if (label) existing.sourceLabels.add(label);
    const url = String(raw.sourceUrl ?? '').trim().toLowerCase();
    if (url) existing.sourceUrls.add(url);
    merged.set(key, existing);
  }

  const ranked = Array.from(merged.values())
    .map((item) => ({
      ...item.candidate,
      sourceCount: Math.max(item.sourceGroups.size, item.sourceLabels.size > 0 ? 1 : 0),
      localityScore: localityRelevanceScore(item.candidate, destinationSignals),
    }))
    .filter((item) => item.localityScore >= 5 || (item.localityScore >= 4 && item.sourceCount >= 2))
    .sort((a, b) => (b.sourceCount !== a.sourceCount ? b.sourceCount - a.sourceCount : a.name.localeCompare(b.name)));

  const strictThreshold = Math.max(1, minDistinctSources);
  const strict = ranked.filter((item) => item.sourceCount >= strictThreshold);
  if (strict.length >= Math.max(1, minResultsAfterFilter)) {
    return strict.slice(0, Math.max(limit, 1));
  }
  const relaxed = ranked.filter((item) => item.sourceCount >= 1).slice(0, Math.max(limit, 1));
  if (strictThreshold > 1) {
    logInfo(
      `[attractions] confidence filter relaxed minDistinct=${strictThreshold} strictCount=${strict.length} relaxedCount=${relaxed.length}`
    );
  }
  return relaxed;
};

const discoverTopAttractions = async (
  destination: string,
  limit: number,
  minDistinctSources: number,
  minResultsAfterFilter: number
): Promise<RankedDiscoveryCandidate[]> => {
  const discoveryPool: DiscoveryCandidate[] = [];
  let serpCount = 0;
  let wikiCount = 0;
  try {
    const serp = await discoverViaSerpApi(destination, limit);
    serpCount = serp.length;
    discoveryPool.push(...serp);
  } catch (err) {
    logInfo(`[attractions] SerpAPI lookup failed destination="${destination}", falling back`);
  }
  try {
    const wiki = await discoverViaWikipedia(destination, limit);
    wikiCount = wiki.length;
    discoveryPool.push(...wiki);
  } catch (err) {
    logError(`[attractions] Wikipedia lookup failed destination="${destination}"`, err);
  }
  const ranked = dedupeAndRankCandidates(discoveryPool, destination, limit, minDistinctSources, minResultsAfterFilter);
  logInfo(
    `[attractions] discovery destination="${destination}" serp=${serpCount} wiki=${wikiCount} deduped=${ranked.length}`
  );
  return ranked;
};

const resolveCsvFilePath = (): string => {
  const configured = getEnvValue('ATTRACTIONS_CSV_LOCAL_PATH');
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, '../../data/attractions_catalog.csv');
};

const resolveDestinationsCsvPath = (): string => {
  const configured = getEnvValue('DESTINATIONS_CSV_LOCAL_PATH');
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, '../../data/destinations.csv');
};

const loadDestinationGeoMap = (): Map<string, DestinationGeo> => {
  const filePath = resolveDestinationsCsvPath();
  if (!fs.existsSync(filePath)) return new Map<string, DestinationGeo>();
  const mtimeMs = fs.statSync(filePath).mtimeMs;
  if (
    destinationGeoCache &&
    destinationGeoCache.filePath === filePath &&
    destinationGeoCache.mtimeMs === mtimeMs
  ) {
    return destinationGeoCache.geoByDestinationKey;
  }
  const parsed = parseDestinationsCsv(filePath);
  const geoByDestinationKey = new Map<string, DestinationGeo>();
  for (const row of parsed.rows) {
    const destinationName = normalizeWhitespace(String(row.data['Destination English Name'] ?? ''));
    const officialName = normalizeWhitespace(String(row.data['Destination Official Name'] ?? ''));
    const country = normalizeWhitespace(String(row.data.Country ?? '')) || null;
    const stateProvince = normalizeWhitespace(String(row.data['State/Provence'] ?? '')) || null;
    const geo: DestinationGeo = { country, stateProvince };
    const destinationKey = normalizeDestinationKey(destinationName);
    if (destinationKey) geoByDestinationKey.set(destinationKey, geo);
    const officialKey = normalizeDestinationKey(officialName);
    if (officialKey) geoByDestinationKey.set(officialKey, geo);
  }
  destinationGeoCache = {
    filePath,
    mtimeMs,
    geoByDestinationKey,
  };
  return geoByDestinationKey;
};

const resolveDestinationGeo = (destinationKey: string, destinationDisplayName: string): DestinationGeo | null => {
  const geoByDestinationKey = loadDestinationGeoMap();
  if (!geoByDestinationKey.size) return null;
  const byKey = geoByDestinationKey.get(normalizeDestinationKey(destinationKey));
  if (byKey) return byKey;
  const byDisplay = geoByDestinationKey.get(normalizeDestinationKey(destinationDisplayName));
  if (byDisplay) return byDisplay;
  return null;
};

const fillEntryGeo = (
  row: AttractionCatalogEntry,
  destinationGeo: DestinationGeo | null
): AttractionCatalogEntry => {
  if (!destinationGeo) return row;
  const country = normalizeWhitespace(String(row.country ?? '')) || destinationGeo.country;
  const stateProvince =
    normalizeWhitespace(String(row.stateProvince ?? '')) ||
    destinationGeo.stateProvince ||
    country;
  return {
    ...row,
    country: country || null,
    stateProvince: stateProvince || null,
  };
};

const fillRowsGeo = (
  rows: AttractionCatalogEntry[],
  destinationGeo: DestinationGeo | null
): AttractionCatalogEntry[] => rows.map((row) => fillEntryGeo(row, destinationGeo));

const upsertGeoBackfilledRows = async (
  before: AttractionCatalogEntry[],
  after: AttractionCatalogEntry[]
): Promise<void> => {
  const beforeById = new Map(before.map((row) => [row.id, row]));
  const changed = after.filter((row) => {
    const existing = beforeById.get(row.id);
    if (!existing) return false;
    return (
      String(existing.country ?? '') !== String(row.country ?? '') ||
      String(existing.stateProvince ?? '') !== String(row.stateProvince ?? '')
    );
  });
  for (const row of changed) {
    await upsertAttractionCatalogEntry(row);
  }
};

const resolveCsvBucketPath = (): string => {
  return String(getEnvValue('ATTRACTIONS_CSV_PATH', { defaultValue: 'locations/attractions_catalog.csv' }) || 'locations/attractions_catalog.csv')
    .replace(/^\/+/, '');
};

const normalizeBucketName = (value?: string): string | undefined => {
  if (!value) return undefined;
  let normalized = value.trim();
  normalized = normalized.replace(/^gs:\/\//i, '').replace(/\/+$/, '');
  if (normalized.includes('/')) normalized = normalized.split('/')[0];
  return normalized || undefined;
};

const resolveBucketName = (): string | null => {
  const explicit = normalizeBucketName(getEnvValue('LOCATION_BUCKET') || getEnvValue('FIREBASE_STORAGE_BUCKET'));
  if (explicit) return explicit;
  const projectId = getEnvValue('GCLOUD_PROJECT_ID') || getEnvValue('GOOGLE_CLOUD_PROJECT') || getEnvValue('FIREBASE_PROJECT_ID');
  return projectId ? `${projectId}.appspot.com` : null;
};

const ensureFirebaseStorageApp = (bucketName: string): void => {
  if (getApps().length > 0) return;
  const projectId = getEnvValue('GCLOUD_PROJECT_ID') || getEnvValue('GOOGLE_CLOUD_PROJECT') || getEnvValue('FIREBASE_PROJECT_ID');
  initializeApp({ projectId, storageBucket: bucketName });
};

const csvEscape = (value: unknown): string => {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
};

export const stringifyAttractionCatalogCsv = (rows: AttractionCatalogEntry[]): string => {
  const lines = [CSV_HEADER.join(',')];
  const ordered = [...rows].sort((a, b) => {
    if (a.destinationKey !== b.destinationKey) return a.destinationKey.localeCompare(b.destinationKey);
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.name.localeCompare(b.name);
  });
  ordered.forEach((row) => {
    lines.push(
      [
        row.id,
        row.destinationKey,
        row.destinationDisplayName,
        row.country ?? '',
        row.stateProvince ?? '',
        row.name,
        String(row.rank),
        row.activityType,
        row.interestTags.join('|'),
        row.sourceUrl ?? '',
        row.sourceLabel ?? '',
        row.snippet ?? '',
        String(Number(row.sourceCount) || 1),
        row.budgetTier ?? 'paid',
        row.updatedAt,
        row.sitelinks == null ? '' : String(Number(row.sitelinks) || ''),
        row.qid ?? '',
        row.lat == null ? '' : String(row.lat),
        row.lon == null ? '' : String(row.lon),
      ]
        .map(csvEscape)
        .join(',')
    );
  });
  return `${lines.join('\n')}\n`;
};

const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
};

export const parseAttractionCatalogCsv = (raw: string): AttractionCatalogEntry[] => {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];
  const headers = splitCsvLine(lines[0]).map((header) => String(header ?? '').trim().toLowerCase());
  const indexOf = (name: string): number => headers.indexOf(name.toLowerCase());
  const iId = indexOf('id');
  const iDestinationKey = indexOf('destination_key');
  const iDestinationDisplay = indexOf('destination_display_name');
  const iCountry = indexOf('country');
  const iStateProvince = indexOf('state_province');
  const iName = indexOf('name');
  const iRank = indexOf('rank');
  const iActivityType = indexOf('activity_type');
  const iInterestTags = indexOf('interest_tags');
  const iSourceUrl = indexOf('source_url');
  const iSourceLabel = indexOf('source_label');
  const iSnippet = indexOf('snippet');
  const iSourceCount = indexOf('source_count');
  const iBudgetTier = indexOf('budget_tier');
  const iUpdatedAt = indexOf('updated_at');
  const iSitelinks = indexOf('sitelinks');
  const iQid = indexOf('qid');
  const iLat = indexOf('lat');
  const iLon = indexOf('lon');

  const read = (cols: string[], idx: number): string => (idx >= 0 && idx < cols.length ? String(cols[idx] ?? '') : '');
  const toNumberOrNull = (value: string): number | null => {
    const parsed = Number(String(value ?? '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  };
  const rows: AttractionCatalogEntry[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 11) continue;
    const tags = String(read(cols, iInterestTags >= 0 ? iInterestTags : 6) ?? '')
      .split('|')
      .map((tag) => tag.trim())
      .filter(Boolean) as InterestTag[];
    const legacyHasBudget = iBudgetTier >= 0;
    const legacyHasUpdated = iUpdatedAt >= 0;
    rows.push({
      id: read(cols, iId >= 0 ? iId : 0),
      destinationKey: read(cols, iDestinationKey >= 0 ? iDestinationKey : 1),
      destinationDisplayName: read(cols, iDestinationDisplay >= 0 ? iDestinationDisplay : 2),
      country: read(cols, iCountry) || null,
      stateProvince: read(cols, iStateProvince) || null,
      name: read(cols, iName >= 0 ? iName : 3),
      rank: Number(read(cols, iRank >= 0 ? iRank : 4)) || 999,
      activityType: (read(cols, iActivityType >= 0 ? iActivityType : 5) as ActivityType) || 'Tour',
      interestTags: tags,
      sourceUrl: read(cols, iSourceUrl >= 0 ? iSourceUrl : 7) || null,
      sourceLabel: read(cols, iSourceLabel >= 0 ? iSourceLabel : 8) || null,
      snippet: read(cols, iSnippet >= 0 ? iSnippet : 9) || null,
      sourceCount: Number(read(cols, iSourceCount >= 0 ? iSourceCount : 10)) || 1,
      budgetTier: legacyHasBudget ? toBudgetTier(read(cols, iBudgetTier)) : 'paid',
      updatedAt: legacyHasUpdated ? read(cols, iUpdatedAt) || new Date().toISOString() : new Date().toISOString(),
      sitelinks: toNumberOrNull(read(cols, iSitelinks)),
      qid: read(cols, iQid) || null,
      lat: toNumberOrNull(read(cols, iLat)),
      lon: toNumberOrNull(read(cols, iLon)),
    });
  }
  return rows;
};

const readCatalogCsv = async (): Promise<AttractionCatalogEntry[]> => {
  const useLocal = isLocalEnv() && !process.env.K_SERVICE;
  if (useLocal) {
    const filePath = resolveCsvFilePath();
    if (!fs.existsSync(filePath)) return [];
    return parseAttractionCatalogCsv(fs.readFileSync(filePath, 'utf8'));
  }

  const bucketName = resolveBucketName();
  if (!bucketName) return [];
  ensureFirebaseStorageApp(bucketName);
  const storage = getStorage().bucket(bucketName);
  const csvPath = resolveCsvBucketPath();
  const file = storage.file(csvPath);
  const [exists] = await file.exists();
  if (!exists) return [];
  const [buffer] = await file.download();
  return parseAttractionCatalogCsv(buffer.toString('utf8'));
};

const writeCatalogCsv = async (rows: AttractionCatalogEntry[]): Promise<void> => {
  const csv = stringifyAttractionCatalogCsv(rows);
  const useLocal = isLocalEnv() && !process.env.K_SERVICE;
  if (useLocal) {
    const filePath = resolveCsvFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, csv, 'utf8');
    return;
  }

  const bucketName = resolveBucketName();
  if (!bucketName) return;
  ensureFirebaseStorageApp(bucketName);
  const storage = getStorage().bucket(bucketName);
  const csvPath = resolveCsvBucketPath();
  await storage.file(csvPath).save(Buffer.from(csv, 'utf8'), {
    contentType: 'text/csv; charset=utf-8',
    resumable: false,
  });
};

const mergeCatalogRows = (existing: AttractionCatalogEntry[], incoming: AttractionCatalogEntry[]): AttractionCatalogEntry[] => {
  const map = new Map<string, AttractionCatalogEntry>();
  existing.forEach((row) => map.set(row.id, row));
  incoming.forEach((row) => map.set(row.id, row));
  return Array.from(map.values());
};

const isCuratedRow = (row: AttractionCatalogEntry): boolean =>
  String(row.sourceLabel ?? '')
    .trim()
    .toLowerCase() === 'curated';

const mergeCuratedWithDiscovered = (
  current: AttractionCatalogEntry[],
  discovered: AttractionCatalogEntry[],
  limit: number,
  destinationKey: string,
  destinationDisplayName: string,
  timestamp: string
): AttractionCatalogEntry[] => {
  const curated = current
    .filter(isCuratedRow)
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.name.localeCompare(b.name)));
  const curatedIdSet = new Set(curated.map((row) => row.id));
  const curatedNameSet = new Set(curated.map((row) => normalizeTextKey(row.name)));
  const discoveredFiltered = discovered.filter(
    (row) => !curatedIdSet.has(row.id) && !curatedNameSet.has(normalizeTextKey(row.name))
  );
  const combined = [...curated, ...discoveredFiltered].slice(0, Math.max(1, limit));
  return combined.map((row, idx) => ({
    ...row,
    destinationKey,
    destinationDisplayName,
    rank: idx + 1,
    sourceLabel: isCuratedRow(row) ? 'curated' : row.sourceLabel ?? null,
    updatedAt: isCuratedRow(row) ? row.updatedAt : timestamp,
  }));
};

const replaceDestinationRows = (
  existing: AttractionCatalogEntry[],
  destinationKey: string,
  incoming: AttractionCatalogEntry[]
): AttractionCatalogEntry[] => {
  const key = normalizeDestinationKey(destinationKey);
  const retained = existing.filter((row) => normalizeDestinationKey(row.destinationKey) !== key);
  return [...retained, ...incoming];
};

const catalogRowsEquivalent = (left: AttractionCatalogEntry[], right: AttractionCatalogEntry[]): boolean => {
  if (left.length !== right.length) return false;
  const toMap = (rows: AttractionCatalogEntry[]) =>
    new Map(
      rows.map((row) => [
        row.id,
        JSON.stringify({
          id: row.id,
          destinationKey: row.destinationKey,
          destinationDisplayName: row.destinationDisplayName,
          country: row.country ?? null,
          stateProvince: row.stateProvince ?? null,
          name: row.name,
          rank: row.rank,
          activityType: row.activityType,
          interestTags: row.interestTags,
          sourceUrl: row.sourceUrl ?? null,
          sourceLabel: row.sourceLabel ?? null,
          snippet: row.snippet ?? null,
          sourceCount: Number(row.sourceCount) || 1,
          budgetTier: row.budgetTier ?? 'paid',
          sitelinks: row.sitelinks ?? null,
          qid: row.qid ?? null,
          lat: row.lat ?? null,
          lon: row.lon ?? null,
          updatedAt: row.updatedAt,
        }),
      ])
    );
  const a = toMap(left);
  const b = toMap(right);
  if (a.size !== b.size) return false;
  for (const [id, payload] of a.entries()) {
    if (b.get(id) !== payload) return false;
  }
  return true;
};

const persistCatalogRowsToCsv = async (rows: AttractionCatalogEntry[]): Promise<void> => {
  if (!rows.length) return;
  if (process.env.NODE_ENV === 'test') return;
  const existing = await readCatalogCsv();
  const merged = mergeCatalogRows(existing, rows);
  if (catalogRowsEquivalent(existing, merged)) return;
  await writeCatalogCsv(merged);
};

const persistDestinationCatalogRowsToCsv = async (
  destinationKey: string,
  rows: AttractionCatalogEntry[]
): Promise<void> => {
  if (!rows.length) return;
  if (process.env.NODE_ENV === 'test') return;
  const existing = await readCatalogCsv();
  const replaced = replaceDestinationRows(existing, destinationKey, rows);
  if (catalogRowsEquivalent(existing, replaced)) return;
  await writeCatalogCsv(replaced);
};

const isStale = (rows: AttractionCatalogEntry[], refreshDays: number): boolean => {
  if (!rows.length) return true;
  const newestMs = rows.reduce((max, row) => {
    const ts = new Date(row.updatedAt).getTime();
    return Number.isFinite(ts) && ts > max ? ts : max;
  }, 0);
  if (!newestMs) return true;
  const thresholdMs = Math.max(1, refreshDays) * 24 * 60 * 60 * 1000;
  return Date.now() - newestMs > thresholdMs;
};

const buildCatalogEntryId = (destinationKey: string, attractionName: string): string =>
  `attr:${slugify(destinationKey)}:${slugify(attractionName)}`.slice(0, 180);

const buildPromptBlobId = (destinationKey: string, dateKey: string): string =>
  `attr-blob:${slugify(destinationKey)}:${slugify(dateKey)}`.slice(0, 180);

const normalizeDateKey = (value?: string): string => {
  const raw = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
};

const withDestinationRefreshLock = async (
  destinationKey: string,
  action: () => Promise<AttractionCatalogEntry[]>
): Promise<AttractionCatalogEntry[]> => {
  const existing = destinationRefreshLocks.get(destinationKey);
  if (existing) return existing;
  const promise = action().finally(() => {
    if (destinationRefreshLocks.get(destinationKey) === promise) {
      destinationRefreshLocks.delete(destinationKey);
    }
  });
  destinationRefreshLocks.set(destinationKey, promise);
  return promise;
};

type BudgetProfile = 'free' | 'paid' | 'premium';

const chooseBudgetProfile = (budgetMin?: number, budgetMax?: number): BudgetProfile => {
  const max = Number(budgetMax);
  const min = Number(budgetMin);
  const effective = Number.isFinite(max) && max > 0 ? max : Number.isFinite(min) && min > 0 ? min : 0;
  if (effective > 5000) return 'premium';
  if (effective > 1800) return 'paid';
  return 'free';
};

type CompactPromptItem = {
  name: string;
  type: ActivityType;
  tags: InterestTag[];
  tier: AttractionBudgetTier;
  rank: number;
};

const buildCompactPromptItems = (entries: AttractionCatalogEntry[]): CompactPromptItem[] =>
  entries.map((entry) => ({
    name: entry.name,
    type: entry.activityType,
    tags: entry.interestTags,
    tier: entry.budgetTier ?? 'paid',
    rank: entry.rank,
  }));

const buildPromptBlockFromCompact = (
  destination: string,
  compact: CompactPromptItem[],
  maxPerDestination: number,
  budgetMin?: number,
  budgetMax?: number
): string => {
  const limit = Math.max(1, maxPerDestination);
  const profile = chooseBudgetProfile(budgetMin, budgetMax);
  const preferredOrder: AttractionBudgetTier[] =
    profile === 'premium' ? ['premium', 'paid', 'free'] : profile === 'paid' ? ['paid', 'premium', 'free'] : ['free', 'paid', 'premium'];
  const byTier = new Map<AttractionBudgetTier, CompactPromptItem[]>();
  compact.forEach((item) => {
    const list = byTier.get(item.tier) ?? [];
    list.push(item);
    byTier.set(item.tier, list);
  });
  const selected: CompactPromptItem[] = [];
  for (const tier of preferredOrder) {
    const list = (byTier.get(tier) ?? []).sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.name.localeCompare(b.name)));
    for (const item of list) {
      selected.push(item);
      if (selected.length >= limit) break;
    }
    if (selected.length >= limit) break;
  }
  if (!selected.length) return '';
  const lines = [`Destination: ${destination}`];
  selected.forEach((entry, idx) => {
    lines.push(`${idx + 1}. ${entry.name} | tier=${entry.tier} | type=${entry.type} | tags=${entry.tags.join('/') || 'culture'}`);
  });
  return lines.join('\n');
};

const ensureDestinationCatalog = async (params: {
  userId: string;
  destination: string;
  limit: number;
  refreshDays: number;
  minDistinctSourcesPerAttraction: number;
  minAttractionsAfterConfidenceFilter: number;
  allowDiscovery?: boolean;
}): Promise<AttractionCatalogEntry[]> => {
  const destinationDisplayName = normalizeWhitespace(params.destination);
  const destinationKey = normalizeDestinationKey(destinationDisplayName);
  if (!destinationKey) return [];
  const destinationGeo = resolveDestinationGeo(destinationKey, destinationDisplayName);

  const existingBase = await listAttractionCatalogEntries(params.userId, destinationKey, params.limit);
  const existing = fillRowsGeo(existingBase, destinationGeo);
  if (existing.length >= params.limit && !isStale(existing, params.refreshDays)) {
    await upsertGeoBackfilledRows(existingBase, existing);
    await persistCatalogRowsToCsv(existing.slice(0, params.limit));
    return existing.slice(0, params.limit);
  }
  if (params.allowDiscovery === false) {
    if (existing.length) {
      await upsertGeoBackfilledRows(existingBase, existing);
      await persistCatalogRowsToCsv(existing.slice(0, params.limit));
      return existing.slice(0, params.limit);
    }
    logInfo(`[attractions] discovery disabled for destination="${destinationDisplayName}"`);
    return [];
  }

  return withDestinationRefreshLock(destinationKey, async () => {
    const currentBase = await listAttractionCatalogEntries(params.userId, destinationKey, params.limit);
    const current = fillRowsGeo(currentBase, destinationGeo);
    if (current.length >= params.limit && !isStale(current, params.refreshDays)) {
      await upsertGeoBackfilledRows(currentBase, current);
      await persistCatalogRowsToCsv(current.slice(0, params.limit));
      return current.slice(0, params.limit);
    }
    if (params.allowDiscovery === false) {
      if (current.length) {
        await upsertGeoBackfilledRows(currentBase, current);
        await persistCatalogRowsToCsv(current.slice(0, params.limit));
        return current.slice(0, params.limit);
      }
      logInfo(`[attractions] discovery disabled for destination="${destinationDisplayName}"`);
      return [];
    }

    const discovered = await discoverTopAttractions(
      destinationDisplayName,
      params.limit,
      params.minDistinctSourcesPerAttraction,
      params.minAttractionsAfterConfidenceFilter
    );
    const timestamp = new Date().toISOString();
    const entries: AttractionCatalogEntry[] = discovered.map((item, idx) => {
      const activityType = inferActivityType(item.name, item.snippet ?? undefined);
      return {
        id: buildCatalogEntryId(destinationKey, item.name),
        destinationKey,
        destinationDisplayName,
        country: destinationGeo?.country ?? null,
        stateProvince: destinationGeo?.stateProvince ?? null,
        name: item.name,
        rank: idx + 1,
        activityType,
        interestTags: inferInterestTags(item.name, item.snippet ?? undefined),
        sourceUrl: item.sourceUrl ?? null,
        sourceLabel: item.sourceLabel ?? null,
        snippet: item.snippet ?? null,
        sourceCount: item.sourceCount,
        budgetTier: inferBudgetTier(item.name, item.snippet ?? undefined, activityType),
        updatedAt: timestamp,
      };
    });

    const finalEntries = fillRowsGeo(
      mergeCuratedWithDiscovered(
        current,
        entries,
        params.limit,
        destinationKey,
        destinationDisplayName,
        timestamp
      ),
      destinationGeo
    );
    if (!finalEntries.length) return current.slice(0, params.limit);
    for (const entry of finalEntries) {
      await upsertAttractionCatalogEntry(entry);
    }
    await persistDestinationCatalogRowsToCsv(destinationKey, finalEntries);
    logInfo(
      `[attractions] refreshed destination="${destinationDisplayName}" discovered=${entries.length} final=${finalEntries.length} curatedKept=${finalEntries.filter(isCuratedRow).length} key=${destinationKey}`
    );
    return listAttractionCatalogEntries(params.userId, destinationKey, params.limit);
  });
};

export const getAttractionShortlistForDestinations = async (params: {
  userId: string;
  destinations: string[];
  limitPerDestination?: number;
  refreshDays?: number;
  allowDiscovery?: boolean;
}): Promise<Record<string, AttractionCatalogEntry[]>> => {
  const configuredLimit =
    Number(getApiCacheSetting('attractions', 'limitPerDestination')) ||
    Number(getEnvValue('ATTRACTIONS_LIMIT_PER_DESTINATION', { defaultValue: '20' }) || 20);
  const configuredRefreshDays =
    Number(getApiCacheSetting('attractions', 'refreshDays')) ||
    Number(getEnvValue('ATTRACTIONS_REFRESH_DAYS', { defaultValue: '365' }) || 365);
  const minDistinctSourcesPerAttraction =
    Number(getApiCacheSetting('attractions', 'minDistinctSourcesPerAttraction')) || 2;
  const minAttractionsAfterConfidenceFilter =
    Number(getApiCacheSetting('attractions', 'minAttractionsAfterConfidenceFilter')) || 6;
  const limitPerDestination = Math.min(Math.max(Number(params.limitPerDestination) || configuredLimit, 1), 50);
  const refreshDays = Math.min(Math.max(Number(params.refreshDays) || configuredRefreshDays, 1), 365);
  const destinations = Array.from(
    new Set((params.destinations ?? []).map((item) => normalizeWhitespace(String(item ?? ''))).filter(Boolean))
  );
  const out: Record<string, AttractionCatalogEntry[]> = {};
  for (const destination of destinations) {
    try {
      out[destination] = await ensureDestinationCatalog({
        userId: params.userId,
        destination,
        limit: limitPerDestination,
        refreshDays,
        minDistinctSourcesPerAttraction,
        minAttractionsAfterConfidenceFilter,
        allowDiscovery: params.allowDiscovery,
      });
    } catch (err) {
      logError(`[attractions] failed destination="${destination}"`, err);
      out[destination] = [];
    }
  }
  return out;
};

export const buildAttractionShortlistPromptBlock = (
  byDestination: Record<string, AttractionCatalogEntry[]>,
  maxPerDestination = 8
): string => {
  const lines: string[] = [];
  const destinations = Object.keys(byDestination);
  if (!destinations.length) return 'none';
  for (const destination of destinations) {
    const shortlist = (byDestination[destination] ?? []).slice(0, Math.max(1, maxPerDestination));
    if (!shortlist.length) continue;
    lines.push(`Destination: ${destination}`);
    shortlist.forEach((entry) => {
      lines.push(
        `${entry.rank}. ${entry.name} | tier=${entry.budgetTier ?? 'paid'} | type=${entry.activityType} | tags=${entry.interestTags.join('/') || 'culture'}`
      );
    });
  }
  return lines.length ? lines.join('\n') : 'none';
};

export const getAttractionPromptBlockForDestinations = async (params: {
  userId: string;
  destinations: string[];
  dateKey?: string;
  budgetMin?: number;
  budgetMax?: number;
  limitPerDestination?: number;
  promptItemsPerDestination?: number;
  refreshDays?: number;
  allowDiscovery?: boolean;
}): Promise<{ shortlistByDestination: Record<string, AttractionCatalogEntry[]>; promptBlock: string }> => {
  const shortlistPromptItemsPerDestination =
    Math.min(
      Math.max(
        Number(params.promptItemsPerDestination) ||
          Number(getApiCacheSetting('attractions', 'shortlistPromptItemsPerDestination')) ||
          8,
        1
      ),
      20
    );
  const destinations = Array.from(
    new Set((params.destinations ?? []).map((item) => normalizeWhitespace(String(item ?? ''))).filter(Boolean))
  );
  if (!destinations.length) {
    return { shortlistByDestination: {}, promptBlock: 'none' };
  }
  const normalizedDateKey = normalizeDateKey(params.dateKey);
  const refreshDays =
    Math.min(
      Math.max(
        Number(params.refreshDays) || Number(getApiCacheSetting('attractions', 'promptBlobRefreshDays')) || 30,
        1
      ),
      365
    );
  const shortlistByDestination = await getAttractionShortlistForDestinations({
    userId: params.userId,
    destinations,
    limitPerDestination: params.limitPerDestination,
    refreshDays: params.refreshDays,
    allowDiscovery: params.allowDiscovery,
  });
  const budgetProfile = chooseBudgetProfile(params.budgetMin, params.budgetMax);

  const blocks: string[] = [];
  for (const destination of destinations) {
    const destinationKey = normalizeDestinationKey(destination);
    const blobId = buildPromptBlobId(destinationKey, normalizedDateKey);
    const existingBlob = await getAttractionShortlistBlob(params.userId, destinationKey, normalizedDateKey);
    const blobUpdatedMs = existingBlob?.updatedAt ? new Date(existingBlob.updatedAt).getTime() : 0;
    const isBlobFresh =
      Number.isFinite(blobUpdatedMs) &&
      blobUpdatedMs > 0 &&
      Date.now() - blobUpdatedMs <= Math.max(1, refreshDays) * 24 * 60 * 60 * 1000;
    const catalogRows = shortlistByDestination[destination] ?? [];
    const compactItems = buildCompactPromptItems(catalogRows);
    const compactSignature = JSON.stringify({ budgetProfile, items: compactItems });
    const computedBlock = buildPromptBlockFromCompact(
      destination,
      compactItems,
      shortlistPromptItemsPerDestination,
      params.budgetMin,
      params.budgetMax
    );
    if (!computedBlock) continue;

    if (isBlobFresh && existingBlob?.compact === compactSignature) {
      blocks.push(existingBlob.promptBlock);
      continue;
    }

    const blob: AttractionShortlistBlob = {
      id: blobId,
      destinationKey,
      destinationDisplayName: destination,
      dateKey: normalizedDateKey,
      promptBlock: computedBlock,
      compact: compactSignature,
      itemCount: compactItems.length,
      updatedAt: new Date().toISOString(),
    };
    await upsertAttractionShortlistBlob(blob);
    blocks.push(computedBlock);
  }

  return {
    shortlistByDestination,
    promptBlock: blocks.length ? blocks.join('\n') : 'none',
  };
};

export const syncAttractionsCatalogFromCsvToDbOnStartup = async (): Promise<void> => {
  try {
    const rows = await readCatalogCsv();
    if (!rows.length) {
      logInfo('[attractions] startup CSV import skipped (no rows)');
      return;
    }
    for (const row of rows) {
      // Canonicalize the destination key to the same space-separated form the
      // lookup uses (normalizeDestinationKey). The CSV stores hyphenated slugs
      // like "new-york-city"; storing them verbatim meant queries for
      // "New York City" -> "new york city" never matched. Single-word cities
      // (e.g. "boston") were unaffected, which is why only those worked.
      await upsertAttractionCatalogEntry({
        ...row,
        destinationKey: normalizeDestinationKey(row.destinationKey) || row.destinationKey,
      });
    }
    logInfo(`[attractions] startup CSV import completed rows=${rows.length}`);
  } catch (err) {
    logError('[attractions] startup CSV import failed', err);
  }
};
