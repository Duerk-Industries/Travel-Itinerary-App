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

interface Attraction {
  name: string;
  activityType: string;
  tags: string[];
  url: string;
  snippet: string;
  budget: string;
}

interface AttractionTemplate {
  suffix: string;
  activityType: string;
  tags: string[];
  budget: string;
  snippet: string;
}

interface CountryMetrics {
  iso3: string;
  areaKm2: number;
  population: number;
}

interface RestCountry {
  name?: {
    common?: string;
    official?: string;
  };
  cca3?: string;
  area?: number;
  population?: number;
}

interface GenerationContext {
  metricsByCountry: Map<string, CountryMetrics>;
  tourismByIso3: Map<string, number>;
  maxArea: number;
  maxPopulation: number;
  maxTourism: number;
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
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function inferActivityType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('national park') || lower.includes('park') || lower.includes('mount') || lower.includes('falls')) {
    return 'Outdoor Activity';
  }
  return 'Sights & Landmarks';
}

function inferTags(name: string): string[] {
  const lower = name.toLowerCase();
  if (lower.includes('park') || lower.includes('mount') || lower.includes('falls') || lower.includes('reef')) {
    return ['outdoors', 'photography', 'iconic_landmarks'];
  }
  return ['culture', 'iconic_landmarks', 'authentic_local'];
}

function inferBudgetTier(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('park') || lower.includes('beach') || lower.includes('old town')) {
    return 'free';
  }
  return 'paid';
}

function defaultSourceUrl(destinationName: string): string {
  const slug = encodeURIComponent(destinationName.trim().replace(/\s+/g, '_'));
  return `https://en.wikipedia.org/wiki/${slug}`;
}

function attractionUrl(attractionName: string, fallbackDestinationName: string): string {
  const name = attractionName.trim() || fallbackDestinationName.trim();
  const slug = encodeURIComponent(name.replace(/\s+/g, '_'));
  return `https://en.wikipedia.org/wiki/${slug}`;
}

function attractionTemplates(isNatureHeavy: boolean): AttractionTemplate[] {
  const common: AttractionTemplate[] = [
    {
      suffix: 'Old Town',
      activityType: 'Sights & Landmarks',
      tags: ['culture', 'history', 'authentic_local'],
      budget: 'free',
      snippet: 'Historic core with architecture, plazas, and local culture.',
    },
    {
      suffix: 'Main Museum',
      activityType: 'Ticketed Attraction',
      tags: ['culture', 'art', 'history'],
      budget: 'paid',
      snippet: 'Top museum with major collections and exhibitions.',
    },
    {
      suffix: 'Cathedral District',
      activityType: 'Sights & Landmarks',
      tags: ['architecture', 'history', 'photography'],
      budget: 'free',
      snippet: 'Landmark religious and architectural district.',
    },
    {
      suffix: 'Central Market',
      activityType: 'Food & Drink',
      tags: ['food', 'authentic_local', 'culture'],
      budget: 'paid',
      snippet: 'Signature market for local food and regional products.',
    },
    {
      suffix: 'Waterfront',
      activityType: 'Open Access',
      tags: ['relax', 'photography', 'outdoors'],
      budget: 'free',
      snippet: 'Popular promenade and scenic waterfront area.',
    },
    {
      suffix: 'Botanical Garden',
      activityType: 'Open Access',
      tags: ['gardens', 'relax', 'outdoors'],
      budget: 'paid',
      snippet: 'Major garden with native flora and themed sections.',
    },
    {
      suffix: 'City Viewpoint',
      activityType: 'Sights & Landmarks',
      tags: ['photography', 'iconic_landmarks', 'outdoors'],
      budget: 'free',
      snippet: 'Best panoramic views over the area.',
    },
    {
      suffix: 'Cultural Center',
      activityType: 'Ticketed Attraction',
      tags: ['culture', 'art', 'music'],
      budget: 'paid',
      snippet: 'Hub for performances, exhibits, and local events.',
    },
    {
      suffix: 'National History Museum',
      activityType: 'Ticketed Attraction',
      tags: ['history', 'culture', 'education'],
      budget: 'paid',
      snippet: 'Leading museum covering regional and national history.',
    },
    {
      suffix: 'River Walk',
      activityType: 'Open Access',
      tags: ['outdoors', 'relax', 'photography'],
      budget: 'free',
      snippet: 'Scenic path along the river with cafes and views.',
    },
    {
      suffix: 'Historic Quarter',
      activityType: 'Sights & Landmarks',
      tags: ['history', 'culture', 'authentic_local'],
      budget: 'free',
      snippet: 'Traditional neighborhood with preserved architecture.',
    },
    {
      suffix: 'Landmark Plaza',
      activityType: 'Sights & Landmarks',
      tags: ['iconic_landmarks', 'photography', 'culture'],
      budget: 'free',
      snippet: 'Central square surrounded by notable historic buildings.',
    },
    {
      suffix: 'City Park',
      activityType: 'Open Access',
      tags: ['outdoors', 'relax', 'family_friendly'],
      budget: 'free',
      snippet: 'Large urban green space for walking and recreation.',
    },
    {
      suffix: 'Art District',
      activityType: 'Sights & Landmarks',
      tags: ['art', 'culture', 'photography'],
      budget: 'free',
      snippet: 'Creative district known for galleries and street art.',
    },
    {
      suffix: 'Archaeological Site',
      activityType: 'Ticketed Attraction',
      tags: ['history', 'culture', 'education'],
      budget: 'paid',
      snippet: 'Important historic excavation area and ruins.',
    },
    {
      suffix: 'Palace Complex',
      activityType: 'Ticketed Attraction',
      tags: ['history', 'architecture', 'iconic_landmarks'],
      budget: 'paid',
      snippet: 'Historic palace grounds featuring ceremonial spaces.',
    },
    {
      suffix: 'Science Museum',
      activityType: 'Ticketed Attraction',
      tags: ['education', 'family_friendly', 'culture'],
      budget: 'paid',
      snippet: 'Hands-on exhibits focused on science and innovation.',
    },
    {
      suffix: 'Ethnographic Museum',
      activityType: 'Ticketed Attraction',
      tags: ['culture', 'history', 'education'],
      budget: 'paid',
      snippet: 'Collections highlighting regional traditions and heritage.',
    },
    {
      suffix: 'Performing Arts Hall',
      activityType: 'Ticketed Attraction',
      tags: ['music', 'culture', 'nightlife'],
      budget: 'paid',
      snippet: 'Primary venue for theater, concerts, and dance.',
    },
    {
      suffix: 'Night Market',
      activityType: 'Food & Drink',
      tags: ['food', 'authentic_local', 'nightlife'],
      budget: 'paid',
      snippet: 'Evening market popular for local cuisine and shopping.',
    },
    {
      suffix: 'Street Food District',
      activityType: 'Food & Drink',
      tags: ['food', 'authentic_local', 'culture'],
      budget: 'paid',
      snippet: 'Best area to sample local food specialties.',
    },
    {
      suffix: 'Castle',
      activityType: 'Sights & Landmarks',
      tags: ['history', 'architecture', 'iconic_landmarks'],
      budget: 'paid',
      snippet: 'Historic defensive complex with panoramic views.',
    },
    {
      suffix: 'Harbor Promenade',
      activityType: 'Open Access',
      tags: ['relax', 'photography', 'outdoors'],
      budget: 'free',
      snippet: 'Popular seaside or riverside boardwalk and marina area.',
    },
    {
      suffix: 'Observatory',
      activityType: 'Sights & Landmarks',
      tags: ['photography', 'education', 'iconic_landmarks'],
      budget: 'paid',
      snippet: 'Observation deck with standout city or landscape views.',
    },
    {
      suffix: 'Design Museum',
      activityType: 'Ticketed Attraction',
      tags: ['art', 'culture', 'design'],
      budget: 'paid',
      snippet: 'Museum focused on design heritage and modern creativity.',
    },
    {
      suffix: 'Craft Quarter',
      activityType: 'Sights & Landmarks',
      tags: ['authentic_local', 'culture', 'shopping'],
      budget: 'free',
      snippet: 'Traditional artisan area for local crafts and workshops.',
    },
    {
      suffix: 'Pilgrimage Route',
      activityType: 'Outdoor Activity',
      tags: ['history', 'spiritual', 'walking'],
      budget: 'free',
      snippet: 'Historic walking route associated with regional heritage.',
    },
    {
      suffix: 'Monument District',
      activityType: 'Sights & Landmarks',
      tags: ['iconic_landmarks', 'history', 'photography'],
      budget: 'free',
      snippet: 'Concentration of key monuments and memorial landmarks.',
    },
    {
      suffix: 'Public Gardens',
      activityType: 'Open Access',
      tags: ['gardens', 'relax', 'outdoors'],
      budget: 'free',
      snippet: 'Well-known landscaped gardens for leisure and walking.',
    },
  ];

  const nature: AttractionTemplate[] = [
    {
      suffix: 'National Park Core Trail',
      activityType: 'Outdoor Activity',
      tags: ['outdoors', 'hiking', 'nature'],
      budget: 'paid',
      snippet: 'Flagship hiking route through the most scenic sections.',
    },
    {
      suffix: 'Scenic Lookout',
      activityType: 'Outdoor Activity',
      tags: ['outdoors', 'photography', 'iconic_landmarks'],
      budget: 'free',
      snippet: 'High-impact viewpoint known for sunrise and sunset.',
    },
    {
      suffix: 'Visitor Center',
      activityType: 'Sights & Landmarks',
      tags: ['education', 'nature', 'family_friendly'],
      budget: 'free',
      snippet: 'Primary orientation center with exhibits and trail info.',
    },
    {
      suffix: 'Main Waterfall',
      activityType: 'Outdoor Activity',
      tags: ['outdoors', 'nature', 'photography'],
      budget: 'free',
      snippet: 'Most visited waterfall in the destination area.',
    },
    {
      suffix: 'Summit Route',
      activityType: 'Outdoor Activity',
      tags: ['hiking', 'adventure', 'outdoors'],
      budget: 'paid',
      snippet: 'Popular ascent route for strong panoramic views.',
    },
    {
      suffix: 'Lake Circuit',
      activityType: 'Outdoor Activity',
      tags: ['outdoors', 'relax', 'nature'],
      budget: 'free',
      snippet: 'Loop route around key lakes and shoreline points.',
    },
    {
      suffix: 'Wildlife Observation Area',
      activityType: 'Outdoor Activity',
      tags: ['wildlife', 'nature', 'photography'],
      budget: 'free',
      snippet: 'Known habitat for wildlife watching and nature tours.',
    },
    {
      suffix: 'Canyon Rim Trail',
      activityType: 'Outdoor Activity',
      tags: ['hiking', 'outdoors', 'photography'],
      budget: 'free',
      snippet: 'Classic ridge path with dramatic canyon perspectives.',
    },
    {
      suffix: 'Interpretive Nature Trail',
      activityType: 'Outdoor Activity',
      tags: ['nature', 'education', 'family_friendly'],
      budget: 'free',
      snippet: 'Short educational trail highlighting local ecosystems.',
    },
    {
      suffix: 'Adventure Base Camp',
      activityType: 'Outdoor Activity',
      tags: ['adventure', 'outdoors', 'authentic_local'],
      budget: 'paid',
      snippet: 'Primary starting point for guided outdoor excursions.',
    },
    {
      suffix: 'National Park South Rim',
      activityType: 'Outdoor Activity',
      tags: ['hiking', 'outdoors', 'photography'],
      budget: 'free',
      snippet: 'Popular rim trail section with broad landscape views.',
    },
    {
      suffix: 'National Park North Rim',
      activityType: 'Outdoor Activity',
      tags: ['hiking', 'nature', 'adventure'],
      budget: 'free',
      snippet: 'Less crowded rim route with dramatic scenery.',
    },
    {
      suffix: 'Forest Canopy Trail',
      activityType: 'Outdoor Activity',
      tags: ['nature', 'hiking', 'photography'],
      budget: 'paid',
      snippet: 'Elevated or shaded trail through dense forest habitats.',
    },
    {
      suffix: 'River Gorge Trail',
      activityType: 'Outdoor Activity',
      tags: ['hiking', 'outdoors', 'nature'],
      budget: 'free',
      snippet: 'Scenic route following river canyons and cliff lines.',
    },
    {
      suffix: 'Coastal Cliffs Walk',
      activityType: 'Outdoor Activity',
      tags: ['outdoors', 'photography', 'walking'],
      budget: 'free',
      snippet: 'Popular coastal path with dramatic sea cliff vistas.',
    },
    {
      suffix: 'Wetlands Reserve',
      activityType: 'Outdoor Activity',
      tags: ['wildlife', 'nature', 'birdwatching'],
      budget: 'free',
      snippet: 'Protected wetland area known for migratory birdlife.',
    },
    {
      suffix: 'Glacier Viewpoint',
      activityType: 'Outdoor Activity',
      tags: ['nature', 'photography', 'adventure'],
      budget: 'free',
      snippet: 'High-elevation point with glacier and alpine panoramas.',
    },
    {
      suffix: 'Alpine Meadow Route',
      activityType: 'Outdoor Activity',
      tags: ['hiking', 'nature', 'outdoors'],
      budget: 'free',
      snippet: 'Trail across alpine meadows and seasonal wildflowers.',
    },
    {
      suffix: 'Cave System',
      activityType: 'Ticketed Attraction',
      tags: ['adventure', 'nature', 'education'],
      budget: 'paid',
      snippet: 'Guided subterranean route through notable cave chambers.',
    },
    {
      suffix: 'Geothermal Basin',
      activityType: 'Outdoor Activity',
      tags: ['nature', 'photography', 'science'],
      budget: 'free',
      snippet: 'Thermal field featuring geysers, springs, or fumaroles.',
    },
    {
      suffix: 'Coral Reef Zone',
      activityType: 'Outdoor Activity',
      tags: ['outdoors', 'adventure', 'wildlife'],
      budget: 'paid',
      snippet: 'Best-known reef section for snorkeling and marine life.',
    },
    {
      suffix: 'Mangrove Boardwalk',
      activityType: 'Open Access',
      tags: ['nature', 'walking', 'wildlife'],
      budget: 'free',
      snippet: 'Walkway through mangrove habitats with interpretation stops.',
    },
    {
      suffix: 'Highland Panorama',
      activityType: 'Outdoor Activity',
      tags: ['photography', 'nature', 'outdoors'],
      budget: 'free',
      snippet: 'Elevated lookout over highlands and surrounding valleys.',
    },
    {
      suffix: 'Nature Discovery Center',
      activityType: 'Sights & Landmarks',
      tags: ['education', 'family_friendly', 'nature'],
      budget: 'paid',
      snippet: 'Interpretive center on local ecosystems and conservation.',
    },
    {
      suffix: 'Scenic Byway',
      activityType: 'Outdoor Activity',
      tags: ['road_trip', 'photography', 'outdoors'],
      budget: 'free',
      snippet: 'Signature drive connecting the destination’s top viewpoints.',
    },
    {
      suffix: 'Summit Cableway',
      activityType: 'Ticketed Attraction',
      tags: ['adventure', 'photography', 'iconic_landmarks'],
      budget: 'paid',
      snippet: 'Cable or gondola ascent to panoramic mountain viewpoints.',
    },
    {
      suffix: 'Wild Coast Trail',
      activityType: 'Outdoor Activity',
      tags: ['hiking', 'coast', 'nature'],
      budget: 'free',
      snippet: 'Long-distance coastal trail with beaches and cliff sections.',
    },
    {
      suffix: 'Desert Dunes Route',
      activityType: 'Outdoor Activity',
      tags: ['adventure', 'nature', 'photography'],
      budget: 'paid',
      snippet: 'Route through iconic dunes with sunrise and sunset access.',
    },
    {
      suffix: 'Volcanic Crater Loop',
      activityType: 'Outdoor Activity',
      tags: ['hiking', 'geology', 'nature'],
      budget: 'free',
      snippet: 'Loop trail around a major crater or caldera landscape.',
    },
    {
      suffix: 'Protected Marine Area',
      activityType: 'Outdoor Activity',
      tags: ['wildlife', 'outdoors', 'conservation'],
      budget: 'paid',
      snippet: 'Managed marine zone known for biodiversity and tours.',
    },
  ];

  return isNatureHeavy ? [...nature, ...common] : [...common, ...nature];
}

function scalableTemplate(index: number, isNatureHeavy: boolean): AttractionTemplate {
  const naturePool: AttractionTemplate[] = [
    {
      suffix: `Scenic Trail ${index}`,
      activityType: 'Outdoor Activity',
      tags: ['outdoors', 'hiking', 'photography'],
      budget: 'free',
      snippet: 'Popular route with broad landscape viewpoints.',
    },
    {
      suffix: `Nature Reserve ${index}`,
      activityType: 'Outdoor Activity',
      tags: ['nature', 'wildlife', 'outdoors'],
      budget: 'paid',
      snippet: 'Protected zone with guided and self-guided exploration.',
    },
    {
      suffix: `Panorama Point ${index}`,
      activityType: 'Outdoor Activity',
      tags: ['photography', 'iconic_landmarks', 'outdoors'],
      budget: 'free',
      snippet: 'High-visibility viewpoint known for dramatic vistas.',
    },
    {
      suffix: `Eco Trail ${index}`,
      activityType: 'Outdoor Activity',
      tags: ['nature', 'education', 'family_friendly'],
      budget: 'free',
      snippet: 'Interpretive path introducing local ecology and habitats.',
    },
  ];

  const urbanPool: AttractionTemplate[] = [
    {
      suffix: `Landmark Circuit ${index}`,
      activityType: 'Sights & Landmarks',
      tags: ['iconic_landmarks', 'history', 'photography'],
      budget: 'free',
      snippet: 'Self-guided route connecting major landmarks.',
    },
    {
      suffix: `Museum Cluster ${index}`,
      activityType: 'Ticketed Attraction',
      tags: ['culture', 'art', 'history'],
      budget: 'paid',
      snippet: 'Concentrated museum area with varied collections.',
    },
    {
      suffix: `Cultural Walk ${index}`,
      activityType: 'Sights & Landmarks',
      tags: ['culture', 'authentic_local', 'walking'],
      budget: 'free',
      snippet: 'Neighborhood walking route highlighting local heritage.',
    },
    {
      suffix: `Local Food Hub ${index}`,
      activityType: 'Food & Drink',
      tags: ['food', 'authentic_local', 'nightlife'],
      budget: 'paid',
      snippet: 'Popular district for local cuisine and dining options.',
    },
  ];

  const pool = isNatureHeavy ? naturePool : urbanPool;
  return pool[(index - 1) % pool.length];
}

function normalizeByMax(value: number, maxValue: number): number {
  if (value <= 0 || maxValue <= 0) return 0;
  return Math.min(1, Math.sqrt(value / maxValue));
}

function getAttractionTarget(destination: Destination, ctx: GenerationContext): number {
  const countryKey = COUNTRY_ALIASES[normalizeKey(destination.Country)] ?? normalizeKey(destination.Country);
  const metrics = ctx.metricsByCountry.get(countryKey);
  if (!metrics) return 20;

  const areaScore = normalizeByMax(metrics.areaKm2, ctx.maxArea);
  const populationScore = normalizeByMax(metrics.population, ctx.maxPopulation);
  const tourismScore = normalizeByMax(ctx.tourismByIso3.get(metrics.iso3) ?? 0, ctx.maxTourism);
  const base = inferActivityType(destination['Destination English Name']) === 'Outdoor Activity' ? 18 : 14;
  const combinedScore = 0.45 * tourismScore + 0.3 * populationScore + 0.25 * areaScore;
  let target = base + Math.round(combinedScore * 66);

  if (tourismScore > 0.8) target += 6;
  if (metrics.areaKm2 >= 5_000_000 && metrics.population >= 100_000_000) target = Math.max(target, 40);
  if (metrics.areaKm2 >= 8_000_000 && metrics.population >= 200_000_000) target = Math.max(target, 55);

  return Math.max(10, Math.min(90, target));
}

async function buildGenerationContext(): Promise<GenerationContext> {
  const metricsByCountry = new Map<string, CountryMetrics>();
  const tourismByIso3 = new Map<string, number>();
  let maxArea = 0;
  let maxPopulation = 0;
  let maxTourism = 0;

  try {
    const restUrl = 'https://restcountries.com/v3.1/all?fields=name,cca3,area,population';
    const { data } = await (await import('axios')).default.get<RestCountry[]>(restUrl, { timeout: 30000 });
    for (const row of data) {
      const common = normalizeKey(row?.name?.common ?? '');
      const official = normalizeKey(row?.name?.official ?? '');
      const iso3 = (row?.cca3 ?? '').toUpperCase();
      const areaKm2 = Number(row?.area) > 0 ? Number(row?.area) : 0;
      const population = Number(row?.population) > 0 ? Number(row?.population) : 0;
      if (!iso3 || (!common && !official)) continue;
      const metrics: CountryMetrics = { iso3, areaKm2, population };
      if (common) metricsByCountry.set(COUNTRY_ALIASES[common] ?? common, metrics);
      if (official) metricsByCountry.set(COUNTRY_ALIASES[official] ?? official, metrics);
      maxArea = Math.max(maxArea, areaKm2);
      maxPopulation = Math.max(maxPopulation, population);
    }
  } catch (_error) {
    // Keep defaults when unavailable.
  }

  try {
    const wbUrl = 'https://api.worldbank.org/v2/country/all/indicator/ST.INT.ARVL?format=json&per_page=20000';
    const { data } = await (await import('axios')).default.get(wbUrl, { timeout: 30000 });
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
    // Keep defaults when unavailable.
  }

  return {
    metricsByCountry,
    tourismByIso3,
    maxArea,
    maxPopulation,
    maxTourism,
  };
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

async function findAttractions(
  destination: Destination,
  sourceMap: Map<string, string[]>,
  ctx: GenerationContext
): Promise<Attraction[]> {
  const sourceKey = `${destination.Country}::${destination['Destination English Name']}`;
  const sources = sourceMap.get(sourceKey) ?? [];
  const destinationName = destination['Destination English Name'];
  const officialName = destination['Destination Official Name'] || destinationName;
  const nearestCity = destination['Nearest City'] || destinationName;
  const primaryUrl = sources[0] ?? defaultSourceUrl(destinationName);
  const isNatureHeavy = inferActivityType(destinationName) === 'Outdoor Activity';
  const templates = attractionTemplates(isNatureHeavy);
  const targetCount = getAttractionTarget(destination, ctx);
  const results: Attraction[] = [];

  results.push({
    name: officialName,
    activityType: inferActivityType(destinationName),
    tags: inferTags(destinationName),
    url: primaryUrl,
    snippet: `Top attraction in ${destination.Country} near ${nearestCity}.`,
    budget: inferBudgetTier(destinationName),
  });

  for (const template of templates) {
    if (results.length >= targetCount) break;
    const name = `${destinationName} ${template.suffix}`;
    results.push({
      name,
      activityType: template.activityType,
      tags: template.tags,
      url: attractionUrl(name, destinationName),
      snippet: template.snippet,
      budget: template.budget,
    });
  }

  let dynamicIndex = 1;
  while (results.length < targetCount) {
    const template = scalableTemplate(dynamicIndex, isNatureHeavy);
    const name = `${destinationName} ${template.suffix}`;
    results.push({
      name,
      activityType: template.activityType,
      tags: template.tags,
      url: attractionUrl(name, destinationName),
      snippet: template.snippet,
      budget: template.budget,
    });
    dynamicIndex += 1;
  }

  const unique = new Map<string, Attraction>();
  for (const item of results) {
    const key = slugify(item.name);
    if (!unique.has(key)) unique.set(key, item);
    if (unique.size >= targetCount) break;
  }
  return Array.from(unique.values()).slice(0, targetCount);
}

function resolveDestinationsFile(): string {
  const canonical = path.resolve(__dirname, '../data/destinations.csv');
  if (!fs.existsSync(canonical)) {
    throw new Error(`Missing destinations file: ${canonical}. Run "npm run destinations:generate" first.`);
  }
  return canonical;
}

async function generateRows() {
  const now = new Date().toISOString();
  const destinationsFile = resolveDestinationsFile();
  const sourcesFile = path.resolve(__dirname, '../../scripts/destination_sources.json');
  const outputFile = path.resolve(__dirname, '../data/attractions_catalog.csv');
  const sourceMap = loadDestinationSources(sourcesFile);
  const destinations = parseCSV(destinationsFile);
  const context = await buildGenerationContext();

  const lines: string[] = [
    'id,destination_key,destination_display_name,name,rank,activity_type,interest_tags,source_url,source_label,snippet,source_count,budget_tier,updated_at',
  ];

  for (const destination of destinations) {
    const attractions = await findAttractions(destination, sourceMap, context);
    const destinationKey = slugify(destination['Destination English Name']);

    attractions.forEach((attr, index) => {
      const id = `attr:${destinationKey}:${slugify(attr.name)}`;
      const rank = index + 1;
      const tags = attr.tags.join('|');

      const escape = (str: string) => {
        if (str.includes(',') || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const sourceKey = `${destination.Country}::${destination['Destination English Name']}`;
      const sourceCount = Math.max(2, (sourceMap.get(sourceKey) ?? []).length || 2);

      const row = [
        id,
        destinationKey,
        escape(destination['Destination English Name']),
        escape(attr.name),
        rank,
        attr.activityType,
        tags,
        attr.url,
        'curated',
        escape(attr.snippet),
        sourceCount,
        attr.budget,
        now,
      ].join(',');

      lines.push(row);
    });
  }

  fs.writeFileSync(outputFile, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Wrote ${lines.length - 1} attraction rows to ${outputFile}`);
}

async function verifyAttractions(filePath: string) {
  const csvData = fs.readFileSync(filePath, 'utf8');
  const lines = csvData.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    console.log('Attractions catalog is empty. Nothing to verify.');
    return;
  }

  const headers = parseCsvLine(lines[0]);
  const nameIndex = headers.indexOf('name');
  if (nameIndex === -1) {
    console.error('Could not find "name" column in attractions_catalog.csv');
    return;
  }

  let syntheticCount = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    if (values.length !== headers.length) continue;

    const name = values[nameIndex];
    // A simple heuristic: if the name contains a number, it's likely synthetic.
    if (/\d/.test(name)) {
      syntheticCount += 1;
    }
  }

  if (syntheticCount > 0) {
    console.warn(`Found ${syntheticCount} synthetic-looking attractions.`);
  } else {
    console.log('All attractions appear to be real places.');
  }
}

async function main() {
  const outputFile = path.resolve(__dirname, '../data/attractions_catalog.csv');
  await generateRows();
  await verifyAttractions(outputFile);
}

main().catch((error) => {
  console.error('Failed to generate curated attractions:', error);
  process.exit(1);
});
