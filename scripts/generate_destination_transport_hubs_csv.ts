import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import * as airportCatalogModule from '../server/src/services/airportCatalog';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const {
  downloadNormalizedAirportDataset,
} = ((airportCatalogModule as any).default ?? airportCatalogModule) as typeof import('../server/src/services/airportCatalog');
type AirportCatalogRecord = import('../server/src/services/airportCatalog').AirportCatalogRecord;

type DestinationRow = {
  destination: string;
  country: string;
};

type Coordinate = {
  lat: number;
  lng: number;
};

type AirportCandidate = {
  iata_code: string;
  name: string;
  city: string;
  country: string;
  label: string;
  lat: number;
  lng: number;
  is_international: boolean;
  sourceUrl: string;
};

type TrainStationCandidate = {
  name: string;
  label: string;
  lat: number;
  lng: number;
  sourceUrl: string | null;
};

type ProvenanceRow = {
  destination: string;
  country: string;
  airport: string;
  airportIataCode: string;
  airportName: string;
  airportSource: string;
  airportDistanceMiles: number | null;
  trainStation: string;
  trainStationSource: string | null;
  trainStationDistanceMiles: number | null;
};

type DestinationTransportHubRow = ProvenanceRow;

const DESTINATIONS_CSV_PATH = path.resolve(__dirname, '../server/data/destinations.csv');
const ATTRACTIONS_CSV_PATH = path.resolve(__dirname, '../server/data/attractions_catalog.csv');
const DESTINATION_QID_CACHE_PATH = path.resolve(__dirname, './destination_qid_cache.json');
const DESTINATION_COORDINATE_CACHE_PATH = path.resolve(__dirname, './destination_coordinate_cache.json');
const OUTPUT_CSV_PATH = path.resolve(__dirname, '../server/data/destination_transport_hubs.csv');
const OUTPUT_JSON_PATH = path.resolve(__dirname, '../server/data/destination_transport_hubs.json');
const AIRPORT_CODES_CSV_PATH = path.resolve(__dirname, '../server/data/airport_codes.csv');
const AIRPORT_CODES_JSON_PATH = path.resolve(__dirname, '../server/data/airport_codes.json');
const OUTPUT_PROVENANCE_PATH = path.resolve(__dirname, './destination_transport_hubs_sources.json');
const WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php';
const TRAIN_STATION_MAX_MILES = 50;
const WIKIDATA_BATCH_SIZE = 50;

const normalizeKey = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const quoteCsv = (value: string): string => {
  const safe = String(value ?? '');
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
};

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const haversineMiles = (a: Coordinate, b: Coordinate): number => {
  const earthRadiusMiles = 3958.7613;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const arc =
    (sinLat * sinLat)
    + (Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng);
  return 2 * earthRadiusMiles * Math.asin(Math.min(1, Math.sqrt(arc)));
};

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentValue += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = '';
      continue;
    }

    currentValue += char;
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  return rows;
};

const parseDestinationRows = (): DestinationRow[] => {
  const text = fs.readFileSync(DESTINATIONS_CSV_PATH, 'utf8');
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  const destinationIndex = header.indexOf('Destination English Name');
  const countryIndex = header.indexOf('Country');

  if (destinationIndex < 0 || countryIndex < 0) {
    throw new Error('destinations.csv is missing expected columns.');
  }

  return rows
    .slice(1)
    .map((row) => ({
      destination: String(row[destinationIndex] ?? '').trim(),
      country: String(row[countryIndex] ?? '').trim(),
    }))
    .filter((row) => row.destination && row.country);
};

const loadDestinationQids = (): Map<string, string> => {
  const raw = JSON.parse(fs.readFileSync(DESTINATION_QID_CACHE_PATH, 'utf8')) as Record<string, string>;
  return new Map(
    Object.entries(raw)
      .filter(([, qid]) => /^Q\d+$/i.test(String(qid)))
      .map(([key, qid]) => [key, String(qid).toUpperCase()])
  );
};

const loadDestinationCoordinateCache = (): Map<string, Coordinate> => {
  if (!fs.existsSync(DESTINATION_COORDINATE_CACHE_PATH)) return new Map();
  const raw = JSON.parse(fs.readFileSync(DESTINATION_COORDINATE_CACHE_PATH, 'utf8')) as Record<string, Coordinate>;
  return new Map(
    Object.entries(raw)
      .filter(([, value]) => Number.isFinite(value?.lat) && Number.isFinite(value?.lng))
      .map(([key, value]) => [key, { lat: Number(value.lat), lng: Number(value.lng) }])
  );
};

const saveDestinationCoordinateCache = (cache: Map<string, Coordinate>): void => {
  const serialized = Object.fromEntries(
    Array.from(cache.entries()).sort(([left], [right]) => left.localeCompare(right))
  );
  fs.writeFileSync(DESTINATION_COORDINATE_CACHE_PATH, `${JSON.stringify(serialized, null, 2)}\n`, 'utf8');
};

const parseWikidataCoordinate = (value: unknown): Coordinate | null => {
  const latitude = Number((value as any)?.latitude);
  const longitude = Number((value as any)?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { lat: latitude, lng: longitude };
};

const fetchDestinationCoordinates = async (
  rows: DestinationRow[],
  qidsByDestinationKey: Map<string, string>,
  coordinateCache: Map<string, Coordinate>
): Promise<Map<string, Coordinate>> => {
  const keyByQid = new Map<string, string>();
  for (const row of rows) {
    const key = `${row.destination}::${row.country}`;
    if (coordinateCache.has(key)) continue;
    const qid = qidsByDestinationKey.get(key);
    if (!qid) continue;
    keyByQid.set(qid, key);
  }

  const qids = Array.from(keyByQid.keys());
  for (let index = 0; index < qids.length; index += WIKIDATA_BATCH_SIZE) {
    const batch = qids.slice(index, index + WIKIDATA_BATCH_SIZE);
    const { data } = await axios.get(WIKIDATA_API_URL, {
      timeout: 30000,
      params: {
        action: 'wbgetentities',
        format: 'json',
        ids: batch.join('|'),
        props: 'claims',
      },
      headers: {
        'User-Agent': 'Travel-Itinerary-App/1.0 (destination transport hubs generator)',
      },
    });

    const entities = data?.entities ?? {};
    for (const qid of batch) {
      const claims = entities?.[qid]?.claims?.P625;
      const coordinate = parseWikidataCoordinate(claims?.[0]?.mainsnak?.datavalue?.value);
      const key = keyByQid.get(qid);
      if (coordinate && key) {
        coordinateCache.set(key, coordinate);
      }
    }

    if ((index / WIKIDATA_BATCH_SIZE) % 10 === 0) {
      console.log(`Resolved destination coordinates for ${Math.min(index + batch.length, qids.length)}/${qids.length} uncached destinations...`);
    }
  }

  saveDestinationCoordinateCache(coordinateCache);
  return coordinateCache;
};

const fetchAirportCandidates = async (): Promise<AirportCandidate[]> => {
  const airports = await downloadNormalizedAirportDataset();
  return airports
    .filter((airport) => Number.isFinite(airport.lat) && Number.isFinite(airport.lng))
    .map((airport) => ({
      ...airport,
      lat: Number(airport.lat),
      lng: Number(airport.lng),
      sourceUrl: airport.source_url,
    }));
};

const writeAirportCatalogOutputs = (airports: AirportCatalogRecord[]): void => {
  const csvRows = [
    ['iata_code', 'name', 'city', 'country', 'lat', 'lng', 'is_international', 'label', 'source_url'].join(','),
    ...airports.map((airport) => [
      quoteCsv(airport.iata_code),
      quoteCsv(airport.name),
      quoteCsv(airport.city),
      quoteCsv(airport.country),
      quoteCsv(airport.lat == null ? '' : String(airport.lat)),
      quoteCsv(airport.lng == null ? '' : String(airport.lng)),
      quoteCsv(airport.is_international ? 'true' : 'false'),
      quoteCsv(airport.label),
      quoteCsv(airport.source_url),
    ].join(',')),
  ];

  fs.writeFileSync(AIRPORT_CODES_CSV_PATH, `${csvRows.join('\n')}\n`, 'utf8');
  fs.writeFileSync(AIRPORT_CODES_JSON_PATH, `${JSON.stringify(airports, null, 2)}\n`, 'utf8');
};

const isTrainStationName = (name: string): boolean => {
  const lower = name.toLowerCase();
  if (!/(railway station|train station|rail station|central railway station|central train station)/i.test(name)) {
    return false;
  }
  if (/(power station|generating station|fire station|bus station|service station|police station|metro station|subway station|tram stop)/i.test(lower)) {
    return false;
  }
  return true;
};

const parseTrainStationCandidates = (): TrainStationCandidate[] => {
  const text = fs.readFileSync(ATTRACTIONS_CSV_PATH, 'utf8');
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  const nameIndex = header.indexOf('name');
  const sourceUrlIndex = header.indexOf('source_url');
  const latIndex = header.indexOf('lat');
  const lngIndex = header.indexOf('lon');
  if (nameIndex < 0 || latIndex < 0 || lngIndex < 0) {
    throw new Error('attractions_catalog.csv is missing expected columns.');
  }

  const deduped = new Map<string, TrainStationCandidate>();
  for (const row of rows.slice(1)) {
    const name = String(row[nameIndex] ?? '').trim();
    const lat = Number(row[latIndex]);
    const lng = Number(row[lngIndex]);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || !isTrainStationName(name)) continue;
    const sourceUrl = sourceUrlIndex >= 0 ? String(row[sourceUrlIndex] ?? '').trim() || null : null;
    const key = normalizeKey(name);
    if (!deduped.has(key)) {
      deduped.set(key, {
        name,
        label: name,
        lat,
        lng,
        sourceUrl,
      });
    }
  }

  return Array.from(deduped.values());
};

const findNearest = <T extends { lat: number; lng: number }>(
  origin: Coordinate,
  candidates: T[],
  maxMiles?: number
): { candidate: T | null; distanceMiles: number | null } => {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distanceMiles = haversineMiles(origin, candidate);
    if (distanceMiles < bestDistance) {
      best = candidate;
      bestDistance = distanceMiles;
    }
  }

  if (!best || !Number.isFinite(bestDistance)) {
    return { candidate: null, distanceMiles: null };
  }
  if (typeof maxMiles === 'number' && bestDistance > maxMiles) {
    return { candidate: null, distanceMiles: null };
  }
  return { candidate: best, distanceMiles: bestDistance };
};

const main = async (): Promise<void> => {
  const destinations = parseDestinationRows();
  const qidsByDestinationKey = loadDestinationQids();
  const coordinateCache = loadDestinationCoordinateCache();
  const destinationCoordinates = await fetchDestinationCoordinates(destinations, qidsByDestinationKey, coordinateCache);
  const airportCandidates = await fetchAirportCandidates();
  writeAirportCatalogOutputs(airportCandidates);
  const trainStationCandidates = parseTrainStationCandidates();

  const outputRows: string[] = [
    ['Destination', 'Airport', 'Train Station'].join(','),
  ];
  const mergedRows: DestinationTransportHubRow[] = [];

  let missingCoordinates = 0;
  for (const row of destinations) {
    const key = `${row.destination}::${row.country}`;
    const coordinate = destinationCoordinates.get(key);
    if (!coordinate) {
      missingCoordinates += 1;
      outputRows.push([quoteCsv(row.destination), '', ''].join(','));
      mergedRows.push({
        destination: row.destination,
        country: row.country,
        airport: '',
        airportIataCode: '',
        airportName: '',
        airportSource: '',
        airportDistanceMiles: null,
        trainStation: '',
        trainStationSource: null,
        trainStationDistanceMiles: null,
      });
      continue;
    }

    const nearestAirport = findNearest(coordinate, airportCandidates);
    const nearestStation = findNearest(coordinate, trainStationCandidates, TRAIN_STATION_MAX_MILES);

    const airportLabel = nearestAirport.candidate?.label ?? '';
    const trainStationLabel = nearestStation.candidate?.label ?? '';

    outputRows.push([
      quoteCsv(row.destination),
      quoteCsv(airportLabel),
      quoteCsv(trainStationLabel),
    ].join(','));

    mergedRows.push({
      destination: row.destination,
      country: row.country,
      airport: airportLabel,
      airportIataCode: nearestAirport.candidate?.iata_code ?? '',
      airportName: nearestAirport.candidate?.name ?? '',
      airportSource: nearestAirport.candidate?.sourceUrl ?? '',
      airportDistanceMiles: nearestAirport.distanceMiles == null ? null : Number(nearestAirport.distanceMiles.toFixed(2)),
      trainStation: trainStationLabel,
      trainStationSource: nearestStation.candidate?.sourceUrl ?? null,
      trainStationDistanceMiles: nearestStation.distanceMiles == null ? null : Number(nearestStation.distanceMiles.toFixed(2)),
    });
  }

  fs.writeFileSync(OUTPUT_CSV_PATH, `${outputRows.join('\n')}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_JSON_PATH, `${JSON.stringify(mergedRows, null, 2)}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_PROVENANCE_PATH, `${JSON.stringify(mergedRows, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${destinations.length} rows to ${OUTPUT_CSV_PATH}`);
  console.log(`Wrote merged JSON to ${OUTPUT_JSON_PATH}`);
  console.log(`Wrote airport catalog CSV to ${AIRPORT_CODES_CSV_PATH}`);
  console.log(`Wrote airport catalog JSON to ${AIRPORT_CODES_JSON_PATH}`);
  console.log(`Wrote provenance to ${OUTPUT_PROVENANCE_PATH}`);
  console.log(`Missing destination coordinates: ${missingCoordinates}`);
  console.log('Destination coordinate source: https://www.wikidata.org/w/api.php?action=help&modules=wbgetentities');
};

main().catch((error) => {
  console.error('Failed to generate destination transport hubs CSV:', error);
  process.exitCode = 1;
});
