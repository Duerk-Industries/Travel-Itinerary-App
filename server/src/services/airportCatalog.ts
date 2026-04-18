export const AIRPORT_DATASET_URL = 'https://raw.githubusercontent.com/algolia/datasets/master/airports/airports.json';

export type AirportCatalogRecord = {
  iata_code: string;
  name: string;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
  label: string;
  is_international: boolean;
  source_url: string;
};

const INTERNATIONAL_AIRPORT_REGEX =
  /\b(international|internacional|internationale|intl|uluslararasi|internasyonal)\b/i;

const normalizeText = (value: unknown): string => String(value ?? '').trim();

const normalizeCoordinate = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const buildAirportLabel = (airport: {
  iata_code?: string | null;
  city?: string | null;
  name?: string | null;
}): string => {
  const code = normalizeText(airport.iata_code).toUpperCase();
  const city = normalizeText(airport.city);
  const name = normalizeText(airport.name);
  const base = city || name || code;
  if (!base) return '';
  return code ? `${base} (${code})` : base;
};

export const isInternationalAirportName = (name: string): boolean =>
  INTERNATIONAL_AIRPORT_REGEX.test(normalizeText(name));

export const normalizeAirportDataset = (data: unknown): AirportCatalogRecord[] => {
  if (!Array.isArray(data)) return [];

  const deduped = new Map<string, AirportCatalogRecord>();
  for (const row of data) {
    const iata_code = normalizeText((row as any)?.iata_code).toUpperCase();
    const name = normalizeText((row as any)?.name);
    const city = normalizeText((row as any)?.city);
    const country = normalizeText((row as any)?.country);
    const lat = normalizeCoordinate((row as any)?._geoloc?.lat ?? (row as any)?.lat);
    const lng = normalizeCoordinate((row as any)?._geoloc?.lng ?? (row as any)?.lng);
    if (!iata_code || iata_code.length !== 3 || !name) continue;
    deduped.set(iata_code, {
      iata_code,
      name,
      city,
      country,
      lat,
      lng,
      label: buildAirportLabel({ iata_code, city, name }),
      is_international: isInternationalAirportName(name),
      source_url: AIRPORT_DATASET_URL,
    });
  }

  return Array.from(deduped.values()).sort((left, right) => left.iata_code.localeCompare(right.iata_code));
};

export const downloadNormalizedAirportDataset = async (url = AIRPORT_DATASET_URL): Promise<AirportCatalogRecord[]> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download airport dataset: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return normalizeAirportDataset(data);
};
