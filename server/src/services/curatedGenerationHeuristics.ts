export interface DestinationLike {
  'Destination English Name': string;
  Country: string;
}

export interface GenerationContextLike {
  metricsByCountry: Map<string, { iso3: string; areaKm2: number; population: number }>;
  tourismByIso3: Map<string, number>;
  maxArea: number;
  maxPopulation: number;
  maxTourism: number;
}

export interface AttractionCandidateLike {
  name: string;
  url: string;
  sitelinks: number;
  qid: string;
  coordinates?: { lat: number; lon: number };
}

export interface DestinationContextLike {
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

const normalizeKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeByMax = (value: number, maxValue: number): number => {
  if (value <= 0 || maxValue <= 0) return 0;
  return Math.min(1, Math.sqrt(value / maxValue));
};

const haversineKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

export const isLikelySyntheticAttractionName = (name: string): boolean => {
  const value = name.trim();
  if (!value) return true;
  if (/^list of /i.test(value)) return true;
  if (/\bdisambiguation\b/i.test(value)) return true;
  if (/^(city-state|capital city|district)$/i.test(value)) return true;
  if (/^(attraction|place|landmark)\s+\d+$/i.test(value)) return true;
  if (/\s(trail|route|circuit|hub|cluster|district)\s+\d+$/i.test(value)) return true;
  if (/^administrative zone\b/i.test(value)) return true;
  return false;
};

export const passAttractionQualityGates = (
  candidate: AttractionCandidateLike,
  destinationContext: DestinationContextLike | null
): boolean => {
  if (isLikelySyntheticAttractionName(candidate.name)) return false;
  if (!/^Q\d+$/.test(candidate.qid)) return false;
  if (!candidate.url || !candidate.url.includes('en.wikipedia.org/wiki/')) return false;
  if (!Number.isFinite(candidate.sitelinks) || candidate.sitelinks < 3) return false;

  if (destinationContext?.coordinates && candidate.coordinates) {
    const distanceKm = haversineKm(destinationContext.coordinates, candidate.coordinates);
    if (distanceKm > 450) return false;
  }
  return true;
};

export const getAttractionTarget = (
  destination: DestinationLike,
  ctx: GenerationContextLike,
  destinationPageviews: number
): number => {
  const countryKey = COUNTRY_ALIASES[normalizeKey(destination.Country)] ?? normalizeKey(destination.Country);
  const metrics = ctx.metricsByCountry.get(countryKey);
  if (!metrics) return 18;

  const areaScore = normalizeByMax(metrics.areaKm2, ctx.maxArea);
  const populationScore = normalizeByMax(metrics.population, ctx.maxPopulation);
  const tourismScore = normalizeByMax(ctx.tourismByIso3.get(metrics.iso3) ?? 0, ctx.maxTourism);
  const destinationPopularityScore = Math.min(1, Math.log10(Math.max(1, destinationPageviews) + 1) / 7);
  const natureBoost = /(park|mount|falls|reef|canyon|valley|lake|beach)/i.test(destination['Destination English Name']) ? 8 : 0;
  const metroBoost =
    /(london|paris|new york city|tokyo|rome|barcelona|bangkok|istanbul|dubai|singapore|los angeles)/i.test(
      destination['Destination English Name']
    )
      ? 20
      : 0;
  const combinedScore = 0.35 * tourismScore + 0.25 * populationScore + 0.15 * areaScore + 0.25 * destinationPopularityScore;
  const target = 14 + Math.round(combinedScore * 90) + natureBoost + metroBoost;
  return Math.max(12, Math.min(180, target));
};

const parseCsvLine = (line: string): string[] => {
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
};

export const validateAttractionsCsv = (rawCsv: string): void => {
  const lines = String(rawCsv ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error('Attractions catalog is empty.');

  const headers = parseCsvLine(lines[0]);
  const nameIndex = headers.indexOf('name');
  const sourceCountIndex = headers.indexOf('source_count');
  if (nameIndex === -1) throw new Error('Missing required "name" column in attractions catalog.');
  if (sourceCountIndex === -1) throw new Error('Missing required "source_count" column in attractions catalog.');

  let syntheticCount = 0;
  let lowSourceCount = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    if (values.length !== headers.length) continue;
    const name = values[nameIndex];
    const sourceCount = Number(values[sourceCountIndex] ?? 0);
    if (isLikelySyntheticAttractionName(name)) syntheticCount += 1;
    if (!Number.isFinite(sourceCount) || sourceCount < 2) lowSourceCount += 1;
  }

  if (syntheticCount > 5) throw new Error(`Synthetic-looking attractions detected: ${syntheticCount}`);
  if (lowSourceCount > 0) throw new Error(`Attractions below minimum source_count=2: ${lowSourceCount}`);
};
