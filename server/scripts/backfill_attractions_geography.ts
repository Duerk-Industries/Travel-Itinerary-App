import fs from 'fs';
import path from 'path';
import { loadEnv } from '../src/env_loader';
import { initDb, closePool, upsertAttractionCatalogEntry } from '../src/db';
import { parseDestinationsCsv } from '../src/services/destinationsAttractionsCsv';
import {
  normalizeDestinationKey,
  parseAttractionCatalogCsv,
  stringifyAttractionCatalogCsv,
} from '../src/services/attractionsCatalogService';

loadEnv();

type DestinationGeo = {
  country: string;
  stateProvince: string;
};

const resolveDestinationsPath = (): string => path.resolve(__dirname, '../data/destinations.csv');
const resolveAttractionsPath = (): string => path.resolve(__dirname, '../data/attractions_catalog.csv');

const normalizeText = (value: unknown): string => String(value ?? '').trim();

const buildDestinationGeoMap = (destinationsPath: string): Map<string, DestinationGeo> => {
  const parsed = parseDestinationsCsv(destinationsPath);
  const map = new Map<string, DestinationGeo>();
  for (const row of parsed.rows) {
    const data = row.data;
    const name = normalizeText(data['Destination English Name']);
    if (!name) continue;
    const key = normalizeDestinationKey(name);
    const country = normalizeText(data.Country);
    const stateProvince = normalizeText(data['State/Provence']);
    if (!key) continue;
    map.set(key, { country, stateProvince });
  }
  return map;
};

const pickGeo = (
  row: { destinationKey: string; destinationDisplayName: string; country?: string | null; stateProvince?: string | null },
  geoByDestinationKey: Map<string, DestinationGeo>
): { country: string | null; stateProvince: string | null } => {
  const existingCountry = normalizeText(row.country);
  const existingState = normalizeText(row.stateProvince);
  if (existingCountry || existingState) {
    const fallbackCountry = existingCountry || null;
    return {
      country: fallbackCountry,
      stateProvince: existingState || fallbackCountry,
    };
  }
  const byKey = geoByDestinationKey.get(normalizeDestinationKey(row.destinationKey));
  if (byKey) {
    const fallbackCountry = normalizeText(byKey.country) || null;
    return {
      country: fallbackCountry,
      stateProvince: normalizeText(byKey.stateProvince) || fallbackCountry,
    };
  }
  const byDisplay = geoByDestinationKey.get(normalizeDestinationKey(row.destinationDisplayName));
  if (byDisplay) {
    const fallbackCountry = normalizeText(byDisplay.country) || null;
    return {
      country: fallbackCountry,
      stateProvince: normalizeText(byDisplay.stateProvince) || fallbackCountry,
    };
  }
  return {
    country: null,
    stateProvince: null,
  };
};

const main = async () => {
  const destinationsPath = resolveDestinationsPath();
  const attractionsPath = resolveAttractionsPath();
  if (!fs.existsSync(destinationsPath)) {
    throw new Error(`Missing destinations CSV: ${destinationsPath}`);
  }
  if (!fs.existsSync(attractionsPath)) {
    throw new Error(`Missing attractions CSV: ${attractionsPath}`);
  }

  const geoByDestinationKey = buildDestinationGeoMap(destinationsPath);
  const rawAttractions = fs.readFileSync(attractionsPath, 'utf8');
  const rows = parseAttractionCatalogCsv(rawAttractions);
  if (!rows.length) {
    console.log('No attractions rows found; nothing to backfill.');
    return;
  }

  let changed = 0;
  const nextRows = rows.map((row) => {
    const geo = pickGeo(row, geoByDestinationKey);
    const previousCountry = normalizeText(row.country);
    const previousState = normalizeText(row.stateProvince);
    const nextCountry = normalizeText(geo.country);
    const nextState = normalizeText(geo.stateProvince);
    if (previousCountry !== nextCountry || previousState !== nextState) changed += 1;
    return {
      ...row,
      country: nextCountry || null,
      stateProvince: nextState || null,
    };
  });

  if (changed > 0) {
    fs.writeFileSync(attractionsPath, stringifyAttractionCatalogCsv(nextRows), 'utf8');
    console.log(`Backfilled country/state for ${changed} attraction rows in ${attractionsPath}`);
  } else {
    console.log('Attractions CSV already has country/state for all rows.');
  }

  try {
    await initDb();
    let upserted = 0;
    for (const row of nextRows) {
      await upsertAttractionCatalogEntry(row);
      upserted += 1;
    }
    console.log(`Updated attraction cache entries: ${upserted}`);
  } catch (err) {
    console.warn('Unable to update DB attraction cache; CSV backfill still completed.', err);
  } finally {
    await closePool().catch(() => undefined);
  }
};

main().catch((err) => {
  console.error('Failed to backfill attraction geography', err);
  process.exit(1);
});
