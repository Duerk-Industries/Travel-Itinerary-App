import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

type DestinationRow = Record<string, string>;

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const SOURCE_PAGE = 'Lists_of_national_parks';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const DESTINATIONS_FILE = path.resolve(scriptDir, '../server/data/destinations.csv');
const ATTR_UPDATED_DATE = '2025-12-01';

const USER_AGENT = 'TravelItineraryAppBot/1.0 (national parks importer; contact: local-dev)';
const WIKI_REQUEST_TIMEOUT_MS = 45000;
const WIKI_RETRY_ATTEMPTS = 3;

const REQUIRED_HEADERS = [
  'Destination English Name',
  'Country',
  'State/Provence',
  'Nearest City',
  'Destination Official Name',
  'Attractions Updated',
] as const;

const parseCsvLine = (line: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  values.push(current);
  return values;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const escapeCsv = (value: string): string => {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
};

const normalizeKey = (value: string): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const NON_COUNTRY_ENTITIES = new Set(
  [
    'africa',
    'antarctica',
    'asia',
    'europe',
    'north america',
    'south america',
    'central america',
    'the caribbean',
    'caribbean',
    'oceania',
    'the alps',
    'the baltics',
    'the balkans',
  ].map((name) => normalizeKey(name))
);

const titleToCountry = (title: string): string | null => {
  const match = title.match(/^List of national parks (?:of|in) (.+)$/i);
  if (!match) return null;
  return match[1].replace(/\s+/g, ' ').trim();
};

const countryToPageCandidates = (subpageTitle: string): string[] => {
  const country = titleToCountry(subpageTitle);
  if (!country) return [subpageTitle];
  const candidates = [
    subpageTitle,
    `List of national parks in ${country}`,
    `National parks of ${country}`,
    `National parks in ${country}`,
  ];
  return Array.from(new Set(candidates));
};

const isCountryEntity = (name: string): boolean => {
  const normalized = normalizeKey(name);
  if (!normalized) return false;
  return !NON_COUNTRY_ENTITIES.has(normalized);
};

const cleanParkName = (title: string): string => {
  return title
    .replace(/\s+\(.*?\)\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const isNationalParkTitle = (title: string): boolean => {
  const normalized = normalizeKey(title);
  if (!normalized) return false;
  if (normalized.startsWith('list of ')) return false;
  if (normalized.includes(' national park service')) return false;
  if (normalized.includes(' national parks and')) return false;
  if (normalized.includes(' category')) return false;
  return (
    /\bnational park\b/i.test(title) ||
    /\bnational parks\b/i.test(title) ||
    /\bparque nacional\b/i.test(title) ||
    /\bparc national\b/i.test(title) ||
    /\bnationalpark\b/i.test(title)
  );
};

const fetchLinksForPage = async (pageTitle: string): Promise<string[]> => {
  const out = new Set<string>();
  let cont: string | undefined;
  while (true) {
    let response: any;
    let lastError: unknown;
    for (let attempt = 1; attempt <= WIKI_RETRY_ATTEMPTS; attempt += 1) {
      try {
        response = await axios.get(WIKI_API, {
          timeout: WIKI_REQUEST_TIMEOUT_MS,
          headers: { 'User-Agent': USER_AGENT },
          params: {
            action: 'query',
            format: 'json',
            titles: pageTitle,
            prop: 'links',
            pllimit: 'max',
            plnamespace: 0,
            plcontinue: cont,
          },
        });
        break;
      } catch (error) {
        lastError = error;
        if (attempt < WIKI_RETRY_ATTEMPTS) {
          await sleep(250 * attempt);
          continue;
        }
      }
    }
    if (!response) {
      throw lastError instanceof Error ? lastError : new Error(`Failed Wikipedia request for ${pageTitle}`);
    }
    const pages = response.data?.query?.pages ?? {};
    const page = pages[Object.keys(pages)[0]];
    if (page?.missing !== undefined) {
      throw new Error(`Missing Wikipedia page: ${pageTitle}`);
    }
    const links = Array.isArray(page?.links) ? page.links : [];
    links.forEach((item: any) => {
      const title = String(item?.title ?? '').trim();
      if (title) out.add(title);
    });
    cont = typeof response.data?.continue?.plcontinue === 'string' ? response.data.continue.plcontinue : undefined;
    if (!cont) break;
  }
  return Array.from(out);
};

const fetchLinksForBestAvailablePage = async (subpageTitle: string): Promise<{ links: string[]; pageTitle: string }> => {
  const candidates = countryToPageCandidates(subpageTitle);
  for (const pageTitle of candidates) {
    try {
      const links = await fetchLinksForPage(pageTitle);
      return { links, pageTitle };
    } catch {
      // Try the next candidate title for this country.
    }
  }
  throw new Error(`No matching Wikipedia page found for ${subpageTitle}`);
};

const parseDestinationsCsv = (filePath: string): { headers: string[]; rows: DestinationRow[]; eol: '\n' | '\r\n' } => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const eol: '\n' | '\r\n' = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return { headers: [...REQUIRED_HEADERS], rows: [], eol };
  const headers = parseCsvLine(lines[0]);
  REQUIRED_HEADERS.forEach((header) => {
    if (!headers.includes(header)) headers.push(header);
  });
  const rows: DestinationRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row: DestinationRow = {};
    headers.forEach((header, idx) => {
      row[header] = String(values[idx] ?? '');
    });
    rows.push(row);
  }
  return { headers, rows, eol };
};

const serializeDestinationsCsv = (headers: string[], rows: DestinationRow[], eol: '\n' | '\r\n'): string => {
  const lines = [headers.map(escapeCsv).join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((header) => escapeCsv(String(row[header] ?? ''))).join(','));
  });
  return `${lines.join(eol)}${eol}`;
};

const dedupeRows = (rows: DestinationRow[]): { rows: DestinationRow[]; duplicatesRemoved: number } => {
  const byKey = new Map<string, DestinationRow>();
  const passthrough: DestinationRow[] = [];
  let duplicatesRemoved = 0;
  rows.forEach((row) => {
    const destination = String(row['Destination English Name'] ?? '').trim();
    const country = String(row.Country ?? '').trim();
    if (!destination || !country) {
      passthrough.push(row);
      return;
    }
    const key = `${normalizeKey(country)}::${normalizeKey(destination)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      return;
    }
    duplicatesRemoved += 1;
    // Keep richer field values when deduplicating.
    REQUIRED_HEADERS.forEach((header) => {
      const current = String(existing[header] ?? '').trim();
      const candidate = String(row[header] ?? '').trim();
      if (!current && candidate) existing[header] = candidate;
    });
  });
  return { rows: [...passthrough, ...Array.from(byKey.values())], duplicatesRemoved };
};

const normalizeRequiredFields = (rows: DestinationRow[]): void => {
  rows.forEach((row) => {
    const destinationEnglish = String(row['Destination English Name'] ?? '').trim();
    const destinationOfficial = String(row['Destination Official Name'] ?? '').trim();
    const nearestCity = String(row['Nearest City'] ?? '').trim();
    const country = String(row.Country ?? '').trim();
    const state = String(row['State/Provence'] ?? '').trim();
    const attractionsUpdated = String(row['Attractions Updated'] ?? '').trim();

    const resolvedDestination = destinationEnglish || destinationOfficial || nearestCity || 'Unknown Destination';
    const resolvedCountry = country || state || 'Unknown Country';
    const resolvedState = state || resolvedCountry;
    const resolvedNearestCity = nearestCity || resolvedDestination;
    const resolvedOfficialName = destinationOfficial || resolvedDestination;
    const resolvedUpdatedDate = attractionsUpdated || ATTR_UPDATED_DATE;

    row['Destination English Name'] = resolvedDestination;
    row.Country = resolvedCountry;
    row['State/Provence'] = resolvedState;
    row['Nearest City'] = resolvedNearestCity;
    row['Destination Official Name'] = resolvedOfficialName;
    row['Attractions Updated'] = resolvedUpdatedDate;
  });
};

const main = async (): Promise<void> => {
  if (!fs.existsSync(DESTINATIONS_FILE)) {
    throw new Error(`Missing destinations file: ${DESTINATIONS_FILE}`);
  }

  const sourceLinks = await fetchLinksForPage(SOURCE_PAGE);
  const subpages = sourceLinks
    .filter((title) => /^List of national parks (?:of|in) /i.test(title))
    .sort((a, b) => a.localeCompare(b));

  const parksByCountry = new Map<string, Set<string>>();

  for (const subpage of subpages) {
    const country = titleToCountry(subpage);
    if (!country) continue;
    if (!isCountryEntity(country)) continue;
    try {
      const { links } = await fetchLinksForBestAvailablePage(subpage);
      const parks = links
        .filter(isNationalParkTitle)
        .map(cleanParkName)
        .filter(Boolean);
      if (!parks.length) continue;
      const set = parksByCountry.get(country) ?? new Set<string>();
      parks.forEach((park) => set.add(park));
      parksByCountry.set(country, set);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Skipping subpage due to fetch/parse error: ${subpage} (${message})`);
    }
  }

  const parsed = parseDestinationsCsv(DESTINATIONS_FILE);
  const rows = parsed.rows.filter((row) => {
    const country = String(row.Country ?? '').trim();
    const updated = String(row['Attractions Updated'] ?? '').trim();
    if (updated !== ATTR_UPDATED_DATE) return true;
    return isCountryEntity(country);
  });
  const existingKeys = new Set(
    rows
      .map((row) => `${normalizeKey(String(row.Country ?? ''))}::${normalizeKey(String(row['Destination English Name'] ?? ''))}`)
      .filter((key) => !key.endsWith('::'))
  );

  let added = 0;
  for (const [country, parks] of parksByCountry.entries()) {
    for (const parkName of parks) {
      const key = `${normalizeKey(country)}::${normalizeKey(parkName)}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      rows.push({
        'Destination English Name': parkName,
        Country: country,
        'State/Provence': country,
        'Nearest City': parkName,
        'Destination Official Name': parkName,
        'Attractions Updated': ATTR_UPDATED_DATE,
      });
      added += 1;
    }
  }

  normalizeRequiredFields(rows);
  const deduped = dedupeRows(rows);
  const csv = serializeDestinationsCsv(parsed.headers, deduped.rows, parsed.eol);
  fs.writeFileSync(DESTINATIONS_FILE, csv, 'utf8');

  const totalParks = Array.from(parksByCountry.values()).reduce((sum, set) => sum + set.size, 0);
  console.log(`source_subpages=${subpages.length}`);
  console.log(`source_parks_detected=${totalParks}`);
  console.log(`rows_added=${added}`);
  console.log(`duplicates_removed=${deduped.duplicatesRemoved}`);
  console.log(`final_rows=${deduped.rows.length}`);
  console.log(`updated_file=${DESTINATIONS_FILE}`);
};

main().catch((err) => {
  console.error('Failed to import national parks from Wikipedia', err);
  process.exit(1);
});
