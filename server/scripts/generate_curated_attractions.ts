import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  getAttractionTarget,
  isLikelySyntheticAttractionName,
  passAttractionQualityGates,
  validateAttractionsCsv,
} from '../src/services/curatedGenerationHeuristics';

interface Destination {
  'Destination English Name': string;
  Country: string;
  'State/Provence': string;
  'Nearest City': string;
  'Destination Official Name': string;
  'Attractions Updated'?: string;
}

interface ParsedDestinationsCsv {
  headers: string[];
  rows: Array<{ data: Destination; lineIndex: number }>;
  lines: string[];
  eol: '\n' | '\r\n';
}

interface DestinationSource {
  destination: string;
  country: string;
  sources: string[];
}

interface CountryMetrics {
  iso3: string;
  areaKm2: number;
  population: number;
}

interface GenerationContext {
  metricsByCountry: Map<string, CountryMetrics>;
  tourismByIso3: Map<string, number>;
  maxArea: number;
  maxPopulation: number;
  maxTourism: number;
}

import { AxiosRequestConfig } from 'axios';

// NEW INTERFACES

interface WikidataAttractionCandidate {
  attraction: {
    type: 'uri';
    value: string;
  };
  attractionLabel: {
    'xml:lang': 'en' | 'en-us';
    type: 'literal';
    value: string;
  };
  sitelinks: {
    type: 'literal';
    datatype: 'http://www.w3.org/2001/XMLSchema#integer';
    value: string;
  };
  article?: {
    type: 'uri';
    value: string;
  };
  coordinates?: {
    type: 'literal';
    value: string;
  };
}

interface AttractionCandidate {
  name: string;
  snippet: string;
  url:string;
  distanceMeters: number; // Will be set to 0 for Wikidata results, but kept for compatibility
  sitelinks: number;
  qid: string;
  coordinates?: { lat: number; lon: number };
  source: 'wikidata' | 'geosearch';
}

interface CachedAttractionList {
  fetchedAt: string;
  items: AttractionCandidate[];
  source: 'wikidata' | 'geosearch';
}

interface WikidataQidCache {
  [key: string]: string;
}

interface PageviewCacheEntry {
  views: number;
  fetchedAt: string;
}

interface PageviewCache {
  [articleTitle: string]: PageviewCacheEntry;
}

interface DestinationContext {
  qid: string;
  wikipediaTitle: string | null;
  coordinates?: { lat: number; lon: number };
}

const COUNTRY_ALIASES: Record<string, string> = {
  'united states of america': 'united states',
  usa: 'united states',
  uk: 'united kingdom',
  'great britain': 'united kingdom',
  'russian federation': 'russia',
  'czech republic': 'czechia',
  'lao peoples democratic republic': 'laos',
  "lao people's democratic republic": 'laos',
  'korea, republic of': 'south korea',
  'republic of korea': 'south korea',
  'viet nam': 'vietnam',
};

const WEB_HEADERS = {
  'User-Agent': 'TravelItineraryAppBot/1.0 (contact: local-dev)',
};

const WIKIDATA_MIN_INTERVAL_MS = 5000;
let lastWikidataRequestAtMs = 0;

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldThrottleWikidataRequest(url: string | undefined): boolean {
  if (!url) return false;
  return /(^https?:\/\/)?([^.]+\.)?wikidata\.org(\/|$)/i.test(url);
}

async function waitForWikidataInterval(): Promise<void> {
  const now = Date.now();
  const earliestNext = lastWikidataRequestAtMs + WIKIDATA_MIN_INTERVAL_MS;
  const waitMs = Math.max(0, earliestNext - now);
  await sleep(waitMs);
  lastWikidataRequestAtMs = Date.now();
}

async function wikidataApiRequest<T>(config: AxiosRequestConfig): Promise<T | null> {
  const maxAttempts = 6;

  const getRetryAfterMs = (error: any): number | null => {
    const rawValue = error?.response?.headers?.['retry-after'];
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
  };

  const getRetryDelayMs = (error: any, attempt: number): number => {
    const status = Number(error?.response?.status ?? 0);
    const retryAfterMs = getRetryAfterMs(error);
    if (status === 429 && retryAfterMs !== null) {
      return Math.min(120000, retryAfterMs);
    }

    const baseDelayMs = status === 429 ? 2500 : 1000;
    const exponentialDelayMs = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
    const jitterMs = Math.floor(Math.random() * 600);
    return Math.min(60000, exponentialDelayMs + jitterMs);
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (shouldThrottleWikidataRequest(config.url)) {
        await waitForWikidataInterval();
      }
      const response = await axios<T>(config);
      return response.data;
    } catch (error: any) {
      const status = Number(error?.response?.status ?? 0);
      const retryable = status === 429 || status >= 500 || status === 0 || status === 403;
      if (!retryable || attempt === maxAttempts) {
        console.error(`Wikidata API request failed after ${attempt} attempt(s) with status ${status}.`);
        return null;
      }

      const delayMs = getRetryDelayMs(error, attempt);
      console.log(
        `Wikidata API request attempt ${attempt} failed with status ${status}. Waiting ${delayMs}ms before retrying.`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

function loadQidCache(cachePath: string): WikidataQidCache {
  if (!fs.existsSync(cachePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as WikidataQidCache;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function loadPageviewCache(cachePath: string): PageviewCache {
  if (!fs.existsSync(cachePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as PageviewCache;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function shouldRefreshPageviewCache(entry: PageviewCacheEntry | undefined): boolean {
  if (!entry) return true;
  const fetchedAt = Date.parse(entry.fetchedAt ?? '');
  if (!Number.isFinite(fetchedAt)) return true;
  const ageDays = (Date.now() - fetchedAt) / (1000 * 60 * 60 * 24);
  return ageDays > 45;
}

async function getDestinationQid(
  destinationName: string,
  countryName: string,
  cache: WikidataQidCache
): Promise<string | null> {
  const cacheKey = `${destinationName}::${countryName}`;
  if (cache[cacheKey]) {
    return cache[cacheKey];
  }

  const searchData = await wikiApiGet({
    action: 'query',
    format: 'json',
    list: 'search',
    srsearch: `${destinationName} ${countryName}`,
    srlimit: 1,
    srprop: '',
  });

  const pageTitle = searchData?.query?.search?.[0]?.title;
  if (!pageTitle) return null;

  const propsData = await wikiApiGet({
    action: 'query',
    format: 'json',
    prop: 'pageprops',
    titles: pageTitle,
    ppprop: 'wikibase_item',
  });

  const pages = propsData?.query?.pages;
  const pageId = pages ? Object.keys(pages)[0] : null;
  const qid = pageId ? pages[pageId]?.pageprops?.wikibase_item : null;

  if (qid && typeof qid === 'string') {
    cache[cacheKey] = qid;
    return qid;
  }
  return null;
}

async function getDestinationContext(destinationQid: string): Promise<DestinationContext | null> {
  const response = await wikidataApiRequest<any>({
    url: 'https://www.wikidata.org/w/api.php',
    method: 'GET',
    headers: WEB_HEADERS,
    params: {
      action: 'wbgetentities',
      format: 'json',
      ids: destinationQid,
      props: 'sitelinks|claims',
      languages: 'en',
    },
  });
  const entity = response?.entities?.[destinationQid];
  if (!entity) return null;

  const wikipediaTitle =
    typeof entity?.sitelinks?.enwiki?.title === 'string' ? entity.sitelinks.enwiki.title.replace(/_/g, ' ').trim() : null;

  let coordinates: { lat: number; lon: number } | undefined;
  const p625 = Array.isArray(entity?.claims?.P625) ? entity.claims.P625 : [];
  const first = p625[0]?.mainsnak?.datavalue?.value;
  if (first && Number.isFinite(Number(first.latitude)) && Number.isFinite(Number(first.longitude))) {
    coordinates = { lat: Number(first.latitude), lon: Number(first.longitude) };
  }

  return {
    qid: destinationQid,
    wikipediaTitle,
    coordinates,
  };
}

function wikipediaArticleFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/en\.wikipedia\.org$/i.test(parsed.hostname)) return null;
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2 || pathParts[0] !== 'wiki') return null;
    const title = decodeURIComponent(pathParts.slice(1).join('/')).replace(/_/g, ' ').trim();
    return title || null;
  } catch {
    return null;
  }
}

function toPageviewsEncodedTitle(title: string): string {
  return encodeURIComponent(title.replace(/\s+/g, '_'));
}

function pageviewRangeLast12Months(): { start: string; end: string } {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 12, 1));
  const fmt = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}0100`;
  return { start: fmt(start), end: fmt(end) };
}

async function fetchWikipediaPageviews(
  articleTitle: string,
  cache: PageviewCache
): Promise<number> {
  const key = articleTitle.trim();
  if (!key) return 0;
  if (!shouldRefreshPageviewCache(cache[key])) {
    return Math.max(0, Number(cache[key]?.views ?? 0));
  }

  const { start, end } = pageviewRangeLast12Months();
  const encodedTitle = toPageviewsEncodedTitle(key);
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodedTitle}/monthly/${start}/${end}`;
  const response = await wikidataApiRequest<any>({
    url,
    method: 'GET',
    headers: { ...WEB_HEADERS, Accept: 'application/json' },
  });
  const items = Array.isArray(response?.items) ? response.items : [];
  const views = items.reduce((sum: number, item: any) => sum + (Number(item?.views) || 0), 0);
  cache[key] = { views, fetchedAt: new Date().toISOString() };
  return views;
}

async function fetchTopAttractionsFromWikidata(
  destinationQid: string,
  limit: number
): Promise<AttractionCandidate[]> {
  const sparqlQuery = `
    SELECT ?attraction ?attractionLabel ?sitelinks ?article (SAMPLE(?coords) as ?coordinates) WHERE {
      VALUES ?city { wd:${destinationQid} }
      VALUES ?type {
        wd:Q570116 # tourist attraction
        wd:Q197523 # tourist destination
        wd:Q394637 # museum
        wd:Q839954 # park
        wd:Q16560  # palace
        wd:Q2977   # cathedral
        wd:Q445398 # temple
        wd:Q12518  # fortification
        wd:Q178561 # place of worship
        wd:Q483110 # square
        wd:Q33506 # monument
        wd:Q483453 # fountain
        wd:Q641226 # amphitheatre
        wd:Q811979 # architectural structure
        wd:Q839954 # national park
        wd:Q23712  # historical monument
      }

      ?attraction (wdt:P131|wdt:P276)* ?city.
      ?attraction wdt:P31/wdt:P279* ?type.
      FILTER(?attraction != ?city)

      ?attraction wikibase:sitelinks ?sitelinks.

      OPTIONAL {
        ?article schema:about ?attraction .
        ?article schema:inLanguage "en" .
        ?article schema:isPartOf <https://en.wikipedia.org/>.
      }
      OPTIONAL { ?attraction wdt:P625 ?coords. }

      SERVICE wikibase:label {
        bd:serviceParam wikibase:language "en-us,en".
      }
    }
    GROUP BY ?attraction ?attractionLabel ?sitelinks ?article
    ORDER BY DESC(?sitelinks)
    LIMIT ${limit}
  `;

  const response = await wikidataApiRequest<{ results: { bindings: WikidataAttractionCandidate[] } }>({
    url: 'https://query.wikidata.org/sparql',
    method: 'GET',
    headers: { ...WEB_HEADERS, Accept: 'application/json' },
    params: { query: sparqlQuery },
  });

  if (!response?.results?.bindings) {
    return [];
  }

  const candidates: AttractionCandidate[] = response.results.bindings.map((item) => {
    const qid = item.attraction.value.split('/').pop()!;
    const name = item.attractionLabel.value;
    const url = item.article?.value ?? `https://www.wikidata.org/wiki/${qid}`;
    const sitelinks = parseInt(item.sitelinks.value, 10);
    
    let coordinates: { lat: number, lon: number } | undefined;
    if (item.coordinates?.value) {
      const match = item.coordinates.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
      if (match) {
        const lon = parseFloat(match[1]);
        const lat = parseFloat(match[2]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          coordinates = { lat, lon };
        }
      }
    }

    return {
      qid,
      name,
      url,
      sitelinks,
      snippet: '', // Will be populated later if needed
      distanceMeters: 0,
      coordinates,
      source: 'wikidata',
    };
  });

  return candidates;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

export const DESTINATIONS_ATTRACTIONS_UPDATED_HEADER = 'Attractions Updated';

export function parseDestinationsCsv(filePath: string): ParsedDestinationsCsv {
  const csvData = fs.readFileSync(filePath, 'utf8');
  const eol: '\n' | '\r\n' = csvData.includes('\r\n') ? '\r\n' : '\n';
  const rawLines = csvData.split(/\r?\n/);
  const lines = rawLines.filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [], lines: [], eol };
  }

  const headers = parseCsvLine(lines[0]);
  const rows: Array<{ data: Destination; lineIndex: number }> = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    if (values.length !== headers.length) continue;
    const destination = {} as Destination;
    headers.forEach((header, index) => {
      destination[header as keyof Destination] = values[index];
    });
    rows.push({ data: destination, lineIndex: i });
  }

  return { headers, rows, lines, eol };
}

function destinationRowToCsv(headers: string[], destination: Destination): string {
  return headers.map((header) => escapeCsv(String(destination[header as keyof Destination] ?? ''))).join(',');
}

export function serializeDestinationsCsv(doc: ParsedDestinationsCsv): string {
  const out: string[] = [];
  out.push(doc.headers.map((h) => escapeCsv(h)).join(','));
  for (const row of doc.rows) {
    out.push(destinationRowToCsv(doc.headers, row.data));
  }
  return `${out.join(doc.eol)}${doc.eol}`;
}

function toYmd(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function parseYmdUtc(value: string | undefined): Date | null {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

export function shouldRefreshDestinationAttractions(
  lastUpdatedYmd: string | undefined,
  todayYmd: string,
  minDaysBetweenRefreshes = 45
): boolean {
  const today = parseYmdUtc(todayYmd);
  if (!today) return true;
  const lastUpdated = parseYmdUtc(lastUpdatedYmd);
  if (!lastUpdated) return true;
  const ageDays = Math.floor((today.getTime() - lastUpdated.getTime()) / (24 * 60 * 60 * 1000));
  return ageDays >= minDaysBetweenRefreshes;
}

export function ensureAttractionsUpdatedColumnAndBackfill(doc: ParsedDestinationsCsv, todayYmd: string): boolean {
  let changed = false;
  if (!doc.headers.includes(DESTINATIONS_ATTRACTIONS_UPDATED_HEADER)) {
    doc.headers.push(DESTINATIONS_ATTRACTIONS_UPDATED_HEADER);
    changed = true;
  }

  for (const row of doc.rows) {
    const current = String(row.data[DESTINATIONS_ATTRACTIONS_UPDATED_HEADER as keyof Destination] ?? '').trim();
    if (!current) {
      row.data[DESTINATIONS_ATTRACTIONS_UPDATED_HEADER as keyof Destination] = todayYmd;
      changed = true;
    }
    doc.lines[row.lineIndex] = destinationRowToCsv(doc.headers, row.data);
  }
  doc.lines[0] = doc.headers.map((h) => escapeCsv(h)).join(',');
  return changed;
}

export function writeDestinationsCsvLineUpdates(
  filePath: string,
  originalRaw: string,
  eol: '\n' | '\r\n',
  doc: ParsedDestinationsCsv,
  lineIndexes: Set<number>
): void {
  if (lineIndexes.size === 0) return;
  const segments = originalRaw.match(/.*(?:\r\n|\n|$)/g)?.filter((s) => s.length > 0) ?? [];
  if (segments.length === 0) {
    fs.writeFileSync(filePath, serializeDestinationsCsv(doc), 'utf8');
    return;
  }
  const normalizedSegments = segments.map((segment) => {
    if (segment.endsWith('\r\n')) return { body: segment.slice(0, -2), nl: '\r\n' };
    if (segment.endsWith('\n')) return { body: segment.slice(0, -1), nl: '\n' };
    return { body: segment, nl: '' };
  });

  const ordered = Array.from(lineIndexes).sort((a, b) => a - b);
  const sameLength = ordered.every((idx) => {
    if (idx < 0 || idx >= normalizedSegments.length || idx >= doc.lines.length) return false;
    return Buffer.byteLength(normalizedSegments[idx].body, 'utf8') === Buffer.byteLength(doc.lines[idx], 'utf8');
  });

  if (!sameLength) {
    fs.writeFileSync(filePath, serializeDestinationsCsv(doc), 'utf8');
    return;
  }

  const fd = fs.openSync(filePath, 'r+');
  try {
    let offset = 0;
    let pointer = 0;
    for (const idx of ordered) {
      while (pointer < idx) {
        const seg = normalizedSegments[pointer];
        offset += Buffer.byteLength(seg.body, 'utf8') + Buffer.byteLength(seg.nl, 'utf8');
        pointer += 1;
      }
      const next = Buffer.from(doc.lines[idx], 'utf8');
      fs.writeSync(fd, next, 0, next.length, offset);
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function loadExistingAttractionsRowsByDestination(filePath: string): {
  header: string;
  rowsByDestination: Map<string, string[]>;
} {
  if (!fs.existsSync(filePath)) {
    return {
      header:
        'id,destination_key,destination_display_name,country,state_province,name,rank,activity_type,interest_tags,source_url,source_label,snippet,source_count,budget_tier,updated_at,sitelinks,qid,lat,lon',
      rowsByDestination: new Map(),
    };
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) {
    return {
      header:
        'id,destination_key,destination_display_name,country,state_province,name,rank,activity_type,interest_tags,source_url,source_label,snippet,source_count,budget_tier,updated_at,sitelinks,qid,lat,lon',
      rowsByDestination: new Map(),
    };
  }
  const header = lines[0];
  const headers = parseCsvLine(header);
  const destinationIndex = headers.indexOf('destination_display_name');
  const rowsByDestination = new Map<string, string[]>();
  if (destinationIndex === -1) {
    return { header, rowsByDestination };
  }
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    if (values.length !== headers.length) continue;
    const destination = values[destinationIndex];
    const existing = rowsByDestination.get(destination) ?? [];
    existing.push(lines[i]);
    rowsByDestination.set(destination, existing);
  }
  return { header, rowsByDestination };
}

function inferActivityType(name: string, snippet: string): string {
  const lower = `${name} ${snippet}`.toLowerCase();
  if (/(park|mount|falls|reef|gorge|trail|lake|bay|forest|canyon|beach)/.test(lower)) {
    return 'Outdoor Activity';
  }
  if (/(museum|gallery|palace|cathedral|temple|fort|castle|theater|opera)/.test(lower)) {
    return 'Ticketed Attraction';
  }
  if (/(market|food|street food|night market)/.test(lower)) {
    return 'Food & Drink';
  }
  return 'Sights & Landmarks';
}

function inferTags(name: string, snippet: string): string[] {
  const lower = `${name} ${snippet}`.toLowerCase();
  const tags = new Set<string>();

  if (/(park|mount|falls|reef|gorge|trail|lake|forest|canyon|beach|wildlife)/.test(lower)) {
    tags.add('outdoors');
    tags.add('photography');
  }
  if (/(museum|gallery|palace|cathedral|temple|fort|castle|history|heritage)/.test(lower)) {
    tags.add('culture');
    tags.add('iconic_landmarks');
  }
  if (/(market|food|street food|night market)/.test(lower)) {
    tags.add('food');
    tags.add('authentic_local');
  }

  if (tags.size === 0) {
    tags.add('culture');
    tags.add('iconic_landmarks');
    tags.add('authentic_local');
  }

  return Array.from(tags).slice(0, 4);
}

function inferBudgetTier(name: string, snippet: string): string {
  const lower = `${name} ${snippet}`.toLowerCase();
  if (/(park|beach|trail|walk|viewpoint|old town|market square)/.test(lower)) return 'free';
  return 'paid';
}

function isLikelyNonAttractionGeoPage(name: string, destinationName: string): boolean {
  const normalized = normalizeKey(name);
  const destinationKey = normalizeKey(destinationName);
  if (!normalized) return true;
  if (normalized === destinationKey) return true;
  if (/^(history of|geography of|demographics of|economy of)\b/.test(normalized)) return true;
  if (/\b(metropolitan city|municipality|district|province|region|county|ward|arrondissement|commune)\b/.test(normalized))
    return true;
  if (/\b(university|college|school|faculty)\b/.test(normalized)) return true;
  return false;
}

function defaultSourceUrl(destinationName: string): string {
  const slug = encodeURIComponent(destinationName.trim().replace(/\s+/g, '_'));
  return `https://en.wikipedia.org/wiki/${slug}`;
}

async function wikiApiGet(params: Record<string, string | number>): Promise<any | null> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await axios.get('https://en.wikipedia.org/w/api.php', {
        timeout: 15000,
        headers: WEB_HEADERS,
        params,
      });
      return response.data;
    } catch (error: any) {
      const status = Number(error?.response?.status ?? 0);
      const retryable = status === 403 || status === 429 || status >= 500 || status === 0;
      if (!retryable || attempt === maxAttempts) return null;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  return null;
}

type GeoSearchResult = {
  pageid: number;
  title: string;
  lat?: number;
  lon?: number;
  dist?: number;
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

async function fetchSitelinksByQid(qids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniqueQids = Array.from(new Set(qids.filter((qid) => /^Q\d+$/.test(qid))));
  for (const batch of chunk(uniqueQids, 50)) {
    const response = await wikidataApiRequest<any>({
      url: 'https://www.wikidata.org/w/api.php',
      method: 'GET',
      headers: WEB_HEADERS,
      params: {
        action: 'wbgetentities',
        format: 'json',
        ids: batch.join('|'),
        props: 'sitelinks',
      },
    });
    const entities = response?.entities ?? {};
    for (const qid of batch) {
      const sitelinks = entities?.[qid]?.sitelinks;
      const count = sitelinks && typeof sitelinks === 'object' ? Object.keys(sitelinks).length : 0;
      out.set(qid, count);
    }
  }
  return out;
}

async function fetchTopAttractionsFromWikipediaGeosearch(
  destinationContext: DestinationContext | null,
  limit: number
): Promise<AttractionCandidate[]> {
  if (!destinationContext?.coordinates) return [];
  const { lat, lon } = destinationContext.coordinates;
  const geoData = await wikiApiGet({
    action: 'query',
    format: 'json',
    list: 'geosearch',
    gscoord: `${lat}|${lon}`,
    gsradius: 10000,
    gslimit: Math.min(Math.max(limit * 4, 350), 500),
  });
  const geoRows = Array.isArray(geoData?.query?.geosearch) ? (geoData.query.geosearch as GeoSearchResult[]) : [];
  if (!geoRows.length) return [];

  const pageIds = Array.from(new Set(geoRows.map((row) => Number(row.pageid)).filter((id) => Number.isFinite(id) && id > 0)));
  const detailsByPageId = new Map<number, { title: string; fullurl?: string; qid?: string; coordinates?: { lat: number; lon: number } }>();

  for (const batch of chunk(pageIds, 50)) {
    const detailData = await wikiApiGet({
      action: 'query',
      format: 'json',
      pageids: batch.join('|'),
      prop: 'pageprops|coordinates|info',
      ppprop: 'wikibase_item',
      inprop: 'url',
      coprop: 'type|name|dim|country|region',
    });
    const pages = detailData?.query?.pages ?? {};
    for (const key of Object.keys(pages)) {
      const page = pages[key];
      const pageId = Number(page?.pageid);
      if (!Number.isFinite(pageId) || pageId <= 0) continue;
      const qid = typeof page?.pageprops?.wikibase_item === 'string' ? page.pageprops.wikibase_item : undefined;
      const fullurl = typeof page?.fullurl === 'string' ? page.fullurl : undefined;
      const title = typeof page?.title === 'string' ? page.title : '';
      const coord = Array.isArray(page?.coordinates) ? page.coordinates[0] : null;
      const coordinates =
        coord && Number.isFinite(Number(coord.lat)) && Number.isFinite(Number(coord.lon))
          ? { lat: Number(coord.lat), lon: Number(coord.lon) }
          : undefined;
      detailsByPageId.set(pageId, { title, fullurl, qid, coordinates });
    }
  }

  const qids = Array.from(detailsByPageId.values()).map((detail) => detail.qid).filter(Boolean) as string[];
  const sitelinksByQid = await fetchSitelinksByQid(qids);

  const candidates: AttractionCandidate[] = [];
  for (const geo of geoRows) {
    const detail = detailsByPageId.get(Number(geo.pageid));
    if (!detail) continue;
    const qid = String(detail.qid ?? '').trim();
    if (!/^Q\d+$/.test(qid)) continue;
    const url = String(detail.fullurl ?? '').trim();
    if (!url || !url.includes('en.wikipedia.org/wiki/')) continue;
    const name = String(detail.title ?? '').trim();
    if (!name) continue;
    candidates.push({
      name,
      snippet: '',
      url,
      distanceMeters: Number(geo.dist) || 0,
      // Geosearch supplement can still be valid when sitelinks lookups are rate-limited.
      // Use a conservative floor so quality gates can still evaluate high-pageview landmarks.
      sitelinks: Number(sitelinksByQid.get(qid) ?? 3),
      qid,
      coordinates: detail.coordinates,
      source: 'geosearch',
    });
  }
  return candidates;
}

function normalizeAttractionsSourceCount(lines: string[]): string[] {
  if (!lines.length) return lines;
  const headerCols = parseCsvLine(lines[0]);
  const sourceCountIndex = headerCols.indexOf('source_count');
  if (sourceCountIndex === -1) return lines;
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length !== headerCols.length) {
      out.push(lines[i]);
      continue;
    }
    const current = Number(cols[sourceCountIndex] ?? 0);
    if (!Number.isFinite(current) || current < 2) {
      cols[sourceCountIndex] = '2';
      out.push(cols.map((value) => escapeCsv(value)).join(','));
    } else {
      out.push(lines[i]);
    }
  }
  return out;
}

function loadDestinationSources(filePath: string): Map<string, string[]> {
    if (!fs.existsSync(filePath)) return new Map();
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content) as DestinationSource[];
    const map = new Map<string, string[]>();
    for (const entry of data) {
        map.set(`${entry.country}::${entry.destination}`, entry.sources || []);
    }
    return map;
}

async function buildGenerationContext(): Promise<GenerationContext> {
    const metricsByCountry = new Map<string, CountryMetrics>();
    const tourismByIso3 = new Map<string, number>();
    let maxArea = 0;
    let maxPopulation = 0;
    let maxTourism = 0;

    try {
        const restUrl = 'https://restcountries.com/v3.1/all?fields=name,cca3,area,population';
        const { data } = await axios.get<any[]>(restUrl, { timeout: 30000 });
        for (const row of data) {
            const common = normalizeKey(row?.name?.common ?? '');
            const official = normalizeKey(row?.name?.official ?? '');
            const iso3 = String(row?.cca3 ?? '').toUpperCase();
            const areaKm2 = Number(row?.area) > 0 ? Number(row.area) : 0;
            const population = Number(row?.population) > 0 ? Number(row.population) : 0;
            if (!iso3 || (!common && !official)) continue;

            const metrics: CountryMetrics = { iso3, areaKm2, population };
            if (common) metricsByCountry.set(COUNTRY_ALIASES[common] ?? common, metrics);
            if (official) metricsByCountry.set(COUNTRY_ALIASES[official] ?? official, metrics);
            maxArea = Math.max(maxArea, areaKm2);
            maxPopulation = Math.max(maxPopulation, population);
        }
    } catch (_error) {
        // Keep defaults.
    }

    try {
        const wbUrl = 'https://api.worldbank.org/v2/country/all/indicator/ST.INT.ARVL?format=json&per_page=20000';
        const { data } = await axios.get(wbUrl, { timeout: 30000 });
        const rows = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
        const latestYearByIso3 = new Map<string, number>();

        for (const row of rows) {
            const iso3 = typeof row?.countryiso3code === 'string' ? row.countryiso3code.toUpperCase() : '';
            const value = typeof row?.value === 'number' ? row.value : null;
            const year = Number.isFinite(Number(row?.date)) ? Number(row?.date) : 0;
            if (!iso3 || value === null || value <= 0) continue;

            const currentYear = latestYearByIso3.get(iso3) ?? 0;
            if (year >= currentYear) {
                latestYearByIso3.set(iso3, year);
                tourismByIso3.set(iso3, value);
                maxTourism = Math.max(maxTourism, value);
            }
        }
    } catch (_error) {
        // Keep defaults.
    }

    return { metricsByCountry, tourismByIso3, maxArea, maxPopulation, maxTourism };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDestinationsFile(): string {
    const canonical = path.resolve(__dirname, '../data/destinations.csv');
    if (!fs.existsSync(canonical)) {
        throw new Error(`Missing destinations file: ${canonical}. Run "npm run destinations:generate" first.`);
    }
    return canonical;
}

function escapeCsv(value: string): string {
    const str = String(value ?? '');
    if (str.includes(',') || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function verifyAttractions(filePath: string): void {
  const csvData = fs.readFileSync(filePath, 'utf8');
  validateAttractionsCsv(csvData);
}

async function main() {
    const now = new Date().toISOString();
    const todayYmd = toYmd(new Date());
    const refreshMinDays = 45;
    const destinationsFile = resolveDestinationsFile();
    const sourcesFile = path.resolve(__dirname, '../../scripts/destination_sources.json');
    const outputFile = path.resolve(__dirname, '../data/attractions_catalog.csv');
    const qidCacheFile = path.resolve(__dirname, '../../scripts/destination_qid_cache.json');
    const pageviewCacheFile = path.resolve(__dirname, '../../scripts/wikipedia_pageviews_cache.json');

    const destinationsRawBefore = fs.readFileSync(destinationsFile, 'utf8');
    const sourceMap = loadDestinationSources(sourcesFile);
    const destinationsDoc = parseDestinationsCsv(destinationsFile);
    if (!destinationsDoc.headers.length) {
      throw new Error(`Destinations CSV is empty: ${destinationsFile}`);
    }
    const destinationsChangedByBackfill = ensureAttractionsUpdatedColumnAndBackfill(destinationsDoc, todayYmd);
    if (destinationsChangedByBackfill) {
      fs.writeFileSync(destinationsFile, serializeDestinationsCsv(destinationsDoc), 'utf8');
      console.log(`Backfilled "${DESTINATIONS_ATTRACTIONS_UPDATED_HEADER}" for destinations.csv with ${todayYmd}`);
    }
    const destinations = destinationsDoc.rows;
    const context = await buildGenerationContext();
    const qidCache = loadQidCache(qidCacheFile);
    const pageviewCache = loadPageviewCache(pageviewCacheFile);
    const maxDestinations = Number(process.env.ATTR_DEST_LIMIT ?? '0');
    const forcedDestinations = new Set(
      String(process.env.ATTR_FORCE_DESTINATIONS ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    );
    const activeDestinations =
        Number.isFinite(maxDestinations) && maxDestinations > 0 ? destinations.slice(0, maxDestinations) : destinations;

    const existingAttractions = loadExistingAttractionsRowsByDestination(outputFile);
    const generatedByDestination = new Map<string, string[]>();
    const touchedDestinationDates = new Set<number>();

    for (const destinationRow of activeDestinations) {
        const destination = destinationRow.data;
        const destinationName = destination['Destination English Name'];
        const destinationKey = slugify(destinationName);
        const destinationNameKey = destinationName.trim().toLowerCase();
        if (forcedDestinations.size > 0 && !forcedDestinations.has(destinationNameKey)) {
          continue;
        }
        const lastUpdated = String(destination[DESTINATIONS_ATTRACTIONS_UPDATED_HEADER as keyof Destination] ?? '').trim();
        if (forcedDestinations.size === 0 && !shouldRefreshDestinationAttractions(lastUpdated, todayYmd, refreshMinDays)) {
            console.log(`Skipping destination (updated ${lastUpdated}): ${destinationName}`);
            continue;
        }
        console.log(`Processing destination: ${destinationName}`);

        const destinationQid = await getDestinationQid(destinationName, destination.Country, qidCache);
        if (!destinationQid) {
            console.warn(`Could not find Wikidata QID for ${destinationName}. Skipping.`);
            continue;
        }

        const sourceKey = `${destination.Country}::${destinationName}`;
        const sources = sourceMap.get(sourceKey) ?? [];
        const destinationContext = await getDestinationContext(destinationQid);
        const destinationPageviews =
          destinationContext?.wikipediaTitle ? await fetchWikipediaPageviews(destinationContext.wikipediaTitle, pageviewCache) : 0;
        const targetCount = getAttractionTarget(destination, context, destinationPageviews);
        const candidateFetchLimit = Math.min(420, Math.max(targetCount * 4, 80));

        const rawCandidates = await fetchTopAttractionsFromWikidata(destinationQid, candidateFetchLimit);
        const geoCandidates = await fetchTopAttractionsFromWikipediaGeosearch(destinationContext, candidateFetchLimit);
        const combinedCandidates = [...rawCandidates, ...geoCandidates];
        if (combinedCandidates.length === 0) {
            console.warn(`No attractions found for ${destinationName} (QID: ${destinationQid})`);
            continue;
        }

        const uniqueCandidates = new Map<string, AttractionCandidate>();
        for (const candidate of combinedCandidates) {
            if (!passAttractionQualityGates(candidate, destinationContext)) continue;
            if (candidate.source === 'geosearch' && isLikelyNonAttractionGeoPage(candidate.name, destinationName)) continue;
            const key = normalizeKey(candidate.name);
            const existing = uniqueCandidates.get(key);
            if (!existing || candidate.sitelinks > existing.sitelinks || (existing.source !== 'wikidata' && candidate.source === 'wikidata')) {
                uniqueCandidates.set(key, candidate);
            }
        }
        // Secondary de-dupe by entity ID to avoid multi-name duplicates from subclass joins.
        const byQid = new Map<string, AttractionCandidate>();
        for (const candidate of uniqueCandidates.values()) {
          const existing = byQid.get(candidate.qid);
          if (!existing || candidate.sitelinks > existing.sitelinks) {
            byQid.set(candidate.qid, candidate);
          }
        }

        const enriched = [] as Array<AttractionCandidate & { pageviews: number; score: number }>;
        const sortedBySitelinks = Array.from(byQid.values()).sort((a, b) =>
          b.sitelinks !== a.sitelinks ? b.sitelinks - a.sitelinks : a.name.localeCompare(b.name)
        );
        const sitelinkPool = sortedBySitelinks.slice(0, Math.min(Math.max(targetCount * 3, 120), 420));
        const geoProximityPool = Array.from(byQid.values())
          .filter((candidate) => candidate.source === 'geosearch')
          .sort((a, b) => (a.distanceMeters !== b.distanceMeters ? a.distanceMeters - b.distanceMeters : a.name.localeCompare(b.name)))
          .slice(0, 100);
        const dedupedCandidates = Array.from(
          new Map([...sitelinkPool, ...geoProximityPool].map((candidate) => [candidate.qid, candidate])).values()
        );
        let maxSitelinks = 1;
        let maxPageviews = 1;
        const pageviewsByQid = new Map<string, number>();

        for (const candidate of dedupedCandidates) {
            maxSitelinks = Math.max(maxSitelinks, candidate.sitelinks);
            const articleTitle = wikipediaArticleFromUrl(candidate.url) ?? candidate.name;
            const pageviews = await fetchWikipediaPageviews(articleTitle, pageviewCache);
            pageviewsByQid.set(candidate.qid, pageviews);
            maxPageviews = Math.max(maxPageviews, pageviews);
        }

        for (const candidate of dedupedCandidates) {
            const pageviews = pageviewsByQid.get(candidate.qid) ?? 0;
            const sitelinkScore = Math.log10(candidate.sitelinks + 1) / Math.log10(maxSitelinks + 1);
            const pageviewScore = Math.log10(pageviews + 1) / Math.log10(maxPageviews + 1);
            const sourceBoost = candidate.source === 'wikidata' ? 0.03 : 0;
            const score = 0.55 * sitelinkScore + 0.45 * pageviewScore + sourceBoost;
            enriched.push({ ...candidate, pageviews, score });
        }

        const selected = enriched
            .sort((a, b) => (b.score !== a.score ? b.score - a.score : b.sitelinks - a.sitelinks))
            .slice(0, targetCount);
        const mustHaveGeosearch = enriched
          .filter((candidate) => candidate.source === 'geosearch')
          .sort((a, b) => (b.sitelinks !== a.sitelinks ? b.sitelinks - a.sitelinks : b.pageviews - a.pageviews))
          .slice(0, Math.min(6, targetCount));
        const selectedByQid = new Set(selected.map((candidate) => candidate.qid));
        const prioritized = [...mustHaveGeosearch.filter((candidate) => !selectedByQid.has(candidate.qid)), ...selected];
        const finalSelection = Array.from(new Map(prioritized.map((candidate) => [candidate.qid, candidate])).values()).slice(
          0,
          targetCount
        );

        const generatedRows: string[] = [];
        finalSelection.forEach((candidate, index) => {
            const rank = index + 1;
            const activityType = inferActivityType(candidate.name, candidate.snippet);
            const tags = inferTags(candidate.name, candidate.snippet).join('|');
            const budget = inferBudgetTier(candidate.name, candidate.snippet);
            const id = `attr:${destinationKey}:${slugify(candidate.name)}`;
            const sourceCount = Math.max(2, 2 + (sources.length > 0 ? 1 : 0));
            
            const row = [
                id,
                destinationKey,
                escapeCsv(destinationName),
                escapeCsv(destination.Country ?? ''),
                escapeCsv(destination['State/Provence'] ?? ''),
                escapeCsv(candidate.name),
                rank,
                activityType,
                tags,
                candidate.url,
                candidate.source === 'wikidata' ? 'wikidata+wikipedia' : 'wikipedia-geosearch+wikipedia',
                escapeCsv(candidate.snippet),
                sourceCount,
                budget,
                now,
                candidate.sitelinks,
                candidate.qid,
                candidate.coordinates?.lat ?? '',
                candidate.coordinates?.lon ?? '',
            ].join(',');
            generatedRows.push(row);
        });

        if (generatedRows.length > 0) {
          generatedByDestination.set(destinationName, generatedRows);
          destination[DESTINATIONS_ATTRACTIONS_UPDATED_HEADER as keyof Destination] = todayYmd;
          destinationsDoc.lines[destinationRow.lineIndex] = destinationRowToCsv(destinationsDoc.headers, destination);
          touchedDestinationDates.add(destinationRow.lineIndex);
        }
    }

    // Merge generated rows with existing rows so destinations skipped by freshness keep their prior attractions.
    const lines: string[] = [existingAttractions.header];
    const seenDestinations = new Set<string>();
    for (const destinationRow of destinationsDoc.rows) {
      const name = destinationRow.data['Destination English Name'];
      seenDestinations.add(name);
      const generated = generatedByDestination.get(name);
      if (generated && generated.length) {
        lines.push(...generated);
        continue;
      }
      const existing = existingAttractions.rowsByDestination.get(name);
      if (existing && existing.length) {
        lines.push(...existing);
      }
    }
    for (const [name, existingRows] of existingAttractions.rowsByDestination.entries()) {
      if (!seenDestinations.has(name)) {
        lines.push(...existingRows);
      }
    }

    // Write only changed destination lines in-place when possible.
    writeDestinationsCsvLineUpdates(
      destinationsFile,
      destinationsRawBefore,
      destinationsDoc.eol,
      destinationsDoc,
      touchedDestinationDates
    );

    const normalizedLines = normalizeAttractionsSourceCount(lines);
    fs.writeFileSync(qidCacheFile, JSON.stringify(qidCache, null, 2), 'utf8');
    fs.writeFileSync(pageviewCacheFile, JSON.stringify(pageviewCache, null, 2), 'utf8');
    fs.writeFileSync(outputFile, `${normalizedLines.join('\n')}\n`, 'utf8');
    verifyAttractions(outputFile);
    console.log(`Wrote ${normalizedLines.length - 1} source-backed attraction rows to ${outputFile}`);
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;
if (isDirectRun) {
    main().catch((error) => {
        console.error('Failed to generate curated attractions:', error);
        process.exit(1);
    });
}
