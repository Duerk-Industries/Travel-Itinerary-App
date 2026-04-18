export interface DestinationCsvRow {
  'Destination English Name': string;
  Country: string;
  'State/Provence': string;
  'Nearest City': string;
  'Destination Official Name': string;
}

const normalizeKey = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const toWikiSlug = (value: string): string => encodeURIComponent(value.trim().replace(/\s+/g, '_'));

const buildSources = (destinationName: string): string[] => {
  const wikiSlug = toWikiSlug(destinationName);
  return [
    `https://en.wikipedia.org/wiki/${wikiSlug}`,
    `https://en.wikivoyage.org/wiki/${wikiSlug}`,
  ];
};

const buildDestinationIdentityKey = (country: string, name: string): string => normalizeKey(`${country}|${name}`);

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

const parseCsvRows = (raw: string): Array<Record<string, string>> => {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = String(values[index] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
};

export function reconcileDestinationsWithAttractions(
  destinations: DestinationCsvRow[],
  attractionsCsvRaw: string
): { rows: DestinationCsvRow[]; sourceOverrides: Map<string, string[]>; added: DestinationCsvRow[] } {
  const rows = [...destinations];
  const added: DestinationCsvRow[] = [];
  const sourceOverrides = new Map<string, string[]>();
  const existingKeys = new Set(rows.map((row) => buildDestinationIdentityKey(row.Country, row['Destination English Name'])));
  const parsedRows = parseCsvRows(attractionsCsvRaw);
  const pending = new Map<
    string,
    {
      row: DestinationCsvRow;
      sources: Set<string>;
    }
  >();

  for (const attraction of parsedRows) {
    const name = String(attraction.destination_display_name ?? '').trim();
    const country = String(attraction.country ?? '').trim();
    const state = String(attraction.state_province ?? '').trim();
    const sourceUrl = String(attraction.source_url ?? '').trim();
    if (!name || !country) continue;

    const key = buildDestinationIdentityKey(country, name);
    if (existingKeys.has(key)) continue;

    const next = pending.get(key) ?? {
      row: {
        'Destination English Name': name,
        Country: country,
        'State/Provence': state,
        'Nearest City': name,
        'Destination Official Name': name,
      },
      sources: new Set<string>(buildSources(name)),
    };

    if (!next.row['State/Provence'] && state) {
      next.row['State/Provence'] = state;
    }
    if (sourceUrl) {
      next.sources.add(sourceUrl);
    }
    pending.set(key, next);
  }

  const sortedPending = Array.from(pending.values()).sort((a, b) => {
    const countryCompare = a.row.Country.localeCompare(b.row.Country);
    if (countryCompare !== 0) return countryCompare;
    return a.row['Destination English Name'].localeCompare(b.row['Destination English Name']);
  });

  for (const entry of sortedPending) {
    rows.push(entry.row);
    added.push(entry.row);
    const key = buildDestinationIdentityKey(entry.row.Country, entry.row['Destination English Name']);
    existingKeys.add(key);
    sourceOverrides.set(key, Array.from(entry.sources));
  }

  return { rows, sourceOverrides, added };
}

export function getDestinationIdentityKey(country: string, name: string): string {
  return buildDestinationIdentityKey(country, name);
}
