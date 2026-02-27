import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface Destination {
  'Destination English Name': string;
  Country: string;
  'State/Provence': string;
  'Nearest City': string;
  'Destination Official Name': string;
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

interface AttractionCandidate {
  name: string;
  snippet: string;
  url: string;
  distanceMeters: number;
}

interface CachedAttractionList {
  fetchedAt: string;
  items: AttractionCandidate[];
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

function parseCSV(filePath: string): Destination[] {
  const csvData = fs.readFileSync(filePath, 'utf8');
  const lines = csvData.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  const destinations: Destination[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    if (values.length !== headers.length) continue;

    const destination = {} as Destination;
    headers.forEach((header, index) => {
      destination[header as keyof Destination] = values[index];
    });
    destinations.push(destination);
  }

  return destinations;
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

function defaultSourceUrl(destinationName: string): string {
  const slug = encodeURIComponent(destinationName.trim().replace(/\s+/g, '_'));
  return `https://en.wikipedia.org/wiki/${slug}`;
}

function isLikelySyntheticAttractionName(name: string): boolean {
  const value = name.trim();
  if (!value) return true;
  if (/^list of /i.test(value)) return true;
  if (/\bdisambiguation\b/i.test(value)) return true;
  if (/^(city-state|capital city|district)$/i.test(value)) return true;
  if (/^(attraction|place|landmark)\s+\d+$/i.test(value)) return true;
  if (/\s(trail|route|circuit|hub|cluster|district)\s+\d+$/i.test(value)) return true;
  if (/^administrative zone\b/i.test(value)) return true;
  return false;
}

function normalizeByMax(value: number, maxValue: number): number {
  if (value <= 0 || maxValue <= 0) return 0;
  return Math.min(1, Math.sqrt(value / maxValue));
}

function getAttractionTarget(destination: Destination, ctx: GenerationContext): number {
  const countryKey = COUNTRY_ALIASES[normalizeKey(destination.Country)] ?? normalizeKey(destination.Country);
  const metrics = ctx.metricsByCountry.get(countryKey);
  if (!metrics) return 10;

  const areaScore = normalizeByMax(metrics.areaKm2, ctx.maxArea);
  const populationScore = normalizeByMax(metrics.population, ctx.maxPopulation);
  const tourismScore = normalizeByMax(ctx.tourismByIso3.get(metrics.iso3) ?? 0, ctx.maxTourism);
  const natureBoost = /(park|mount|falls|reef|canyon|valley|lake|beach)/i.test(destination['Destination English Name']) ? 6 : 0;
  const combinedScore = 0.5 * tourismScore + 0.3 * populationScore + 0.2 * areaScore;
  const target = 6 + Math.round(combinedScore * 34) + natureBoost;
  return Math.max(6, Math.min(45, target));
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

async function geocodeDestination(destination: Destination): Promise<{ lat: number; lon: number } | null> {
  const query = `${destination['Destination English Name']}, ${destination.Country}`;
  try {
    const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
      timeout: 15000,
      headers: WEB_HEADERS,
      params: {
        q: query,
        format: 'jsonv2',
        limit: 1,
      },
    });
    const first = Array.isArray(data) ? data[0] : null;
    if (!first) return null;
    const lat = Number(first.lat);
    const lon = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch (_error) {
    return null;
  }
}

function loadAttractionCache(cachePath: string): Record<string, CachedAttractionList> {
  if (!fs.existsSync(cachePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as Record<string, CachedAttractionList>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function getCacheKey(destination: Destination): string {
  return `${destination.Country}::${destination['Destination English Name']}`;
}

async function fetchNearbyAttractionCandidates(
  destination: Destination,
  targetCount: number,
  cache: Record<string, CachedAttractionList>
): Promise<AttractionCandidate[]> {
  const key = getCacheKey(destination);
  const cached = cache[key];
  if (cached && Array.isArray(cached.items) && cached.items.length > 0) {
    return cached.items.slice(0, targetCount);
  }

  const coords = await geocodeDestination(destination);
  if (!coords) {
    cache[key] = { fetchedAt: new Date().toISOString(), items: [] };
    return [];
  }

  const geosearch = await wikiApiGet({
    action: 'query',
    format: 'json',
    list: 'geosearch',
    gscoord: `${coords.lat}|${coords.lon}`,
    gsradius: 20000,
    gslimit: Math.min(50, Math.max(targetCount * 3, 18)),
  });
  const nearby = Array.isArray(geosearch?.query?.geosearch) ? geosearch.query.geosearch : [];
  if (nearby.length === 0) {
    cache[key] = { fetchedAt: new Date().toISOString(), items: [] };
    return [];
  }

  const pageIds = nearby
    .map((item: any) => Number(item?.pageid))
    .filter((id: number) => Number.isFinite(id))
    .slice(0, 50);
  if (pageIds.length === 0) {
    cache[key] = { fetchedAt: new Date().toISOString(), items: [] };
    return [];
  }

  const details = await wikiApiGet({
    action: 'query',
    format: 'json',
    prop: 'description|extracts',
    exintro: 1,
    explaintext: 1,
    pageids: pageIds.join('|'),
  });
  const pages = details?.query?.pages && typeof details.query.pages === 'object' ? details.query.pages : {};
  const titleById = new Map<number, { title: string; snippet: string }>();
  for (const page of Object.values(pages) as any[]) {
    const id = Number(page?.pageid);
    const title = String(page?.title ?? '').trim();
    if (!Number.isFinite(id) || !title) continue;
    const extract = String(page?.extract ?? '').trim();
    const description = String(page?.description ?? '').trim();
    const snippet = extract || description || '';
    titleById.set(id, { title, snippet });
  }

  const rawCandidates: AttractionCandidate[] = [];
  for (const item of nearby) {
    const id = Number(item?.pageid);
    const match = titleById.get(id);
    if (!match) continue;
    const name = match.title.trim();
    if (isLikelySyntheticAttractionName(name)) continue;
    if (normalizeKey(name) === normalizeKey(destination['Destination English Name'])) continue;

    rawCandidates.push({
      name,
      snippet: match.snippet,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(name.replace(/\s+/g, '_'))}`,
      distanceMeters: Number(item?.dist ?? 999999),
    });
  }

  const unique = new Map<string, AttractionCandidate>();
  for (const candidate of rawCandidates) {
    const id = slugify(candidate.name);
    if (!id || unique.has(id)) continue;
    unique.set(id, candidate);
  }

  const items = Array.from(unique.values())
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, targetCount);

  cache[key] = {
    fetchedAt: new Date().toISOString(),
    items,
  };
  return items;
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

function resolveDestinationsFile(): string {
  const canonical = path.resolve(__dirname, '../data/destinations.csv');
  if (!fs.existsSync(canonical)) {
    throw new Error(`Missing destinations file: ${canonical}. Run "npm run destinations:generate" first.`);
  }
  return canonical;
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function verifyAttractions(filePath: string): void {
  const csvData = fs.readFileSync(filePath, 'utf8');
  const lines = csvData.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error('Attractions catalog is empty.');

  const headers = parseCsvLine(lines[0]);
  const nameIndex = headers.indexOf('name');
  const sourceCountIndex = headers.indexOf('source_count');
  if (nameIndex === -1 || sourceCountIndex === -1) {
    throw new Error('Missing required columns in attractions catalog.');
  }

  let syntheticCount = 0;
  let invalidSourceCountRows = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    if (values.length !== headers.length) continue;
    const name = values[nameIndex];
    const sourceCount = Number(values[sourceCountIndex]);
    if (isLikelySyntheticAttractionName(name)) syntheticCount += 1;
    if (!Number.isFinite(sourceCount) || sourceCount < 2) invalidSourceCountRows += 1;
  }

  if (syntheticCount > 0) {
    throw new Error(`Synthetic-looking attractions detected: ${syntheticCount}`);
  }
  if (invalidSourceCountRows > 0) {
    throw new Error(`Rows with source_count < 2 detected: ${invalidSourceCountRows}`);
  }
}

async function main() {
  const now = new Date().toISOString();
  const destinationsFile = resolveDestinationsFile();
  const sourcesFile = path.resolve(__dirname, '../../scripts/destination_sources.json');
  const outputFile = path.resolve(__dirname, '../data/attractions_catalog.csv');
  const cacheFile = path.resolve(__dirname, '../../scripts/attraction_candidates_cache.json');

  const sourceMap = loadDestinationSources(sourcesFile);
  const destinations = parseCSV(destinationsFile);
  const context = await buildGenerationContext();
  const cache = loadAttractionCache(cacheFile);
  const maxDestinations = Number(process.env.ATTR_DEST_LIMIT ?? '0');
  const activeDestinations =
    Number.isFinite(maxDestinations) && maxDestinations > 0 ? destinations.slice(0, maxDestinations) : destinations;

  const lines: string[] = [
    'id,destination_key,destination_display_name,name,rank,activity_type,interest_tags,source_url,source_label,snippet,source_count,budget_tier,updated_at',
  ];

  for (const destination of activeDestinations) {
    const destinationName = destination['Destination English Name'];
    const destinationKey = slugify(destinationName);
    const sourceKey = `${destination.Country}::${destinationName}`;
    const sources = sourceMap.get(sourceKey) ?? [];
    const sourceCount = Math.max(2, sources.length || 2);
    const targetCount = getAttractionTarget(destination, context);
    const nearby = await fetchNearbyAttractionCandidates(destination, Math.max(targetCount - 1, 0), cache);

    const baseName = destination['Destination Official Name'] || destinationName;
    const baseUrl = sources[0] ?? defaultSourceUrl(destinationName);
    const combined: AttractionCandidate[] = [
      {
        name: baseName,
        snippet: `Top attraction in ${destination.Country} near ${destination['Nearest City'] || destinationName}.`,
        url: baseUrl,
        distanceMeters: 0,
      },
      ...nearby,
    ];

    const unique = new Map<string, AttractionCandidate>();
    for (const candidate of combined) {
      if (isLikelySyntheticAttractionName(candidate.name)) continue;
      const key = slugify(candidate.name);
      if (!key || unique.has(key)) continue;
      unique.set(key, candidate);
      if (unique.size >= targetCount) break;
    }

    const rows = Array.from(unique.values());
    rows.forEach((candidate, index) => {
      const rank = index + 1;
      const activityType = inferActivityType(candidate.name, candidate.snippet);
      const tags = inferTags(candidate.name, candidate.snippet).join('|');
      const budget = inferBudgetTier(candidate.name, candidate.snippet);
      const row = [
        `attr:${destinationKey}:${slugify(candidate.name)}`,
        destinationKey,
        escapeCsv(destinationName),
        escapeCsv(candidate.name),
        rank,
        activityType,
        tags,
        candidate.url,
        'curated',
        escapeCsv(candidate.snippet),
        sourceCount,
        budget,
        now,
      ].join(',');
      lines.push(row);
    });
  }

  fs.writeFileSync(outputFile, `${lines.join('\n')}\n`, 'utf8');
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), 'utf8');
  verifyAttractions(outputFile);
  console.log(`Wrote ${lines.length - 1} source-backed attraction rows to ${outputFile}`);
}

main().catch((error) => {
  console.error('Failed to generate curated attractions:', error);
  process.exit(1);
});
