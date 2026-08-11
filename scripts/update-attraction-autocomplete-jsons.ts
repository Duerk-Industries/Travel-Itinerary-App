/**
 * Pre-parses server/data/destinations.csv and server/data/attractions_catalog.csv
 * (~154k rows combined) into the same record shape
 * destinationAttractionAutocompleteService.ts builds at runtime, and uploads
 * the results as JSON to Cloud Storage.
 *
 * Why: without this, every server instance re-runs the hand-rolled CSV
 * parser against both files whenever its in-memory cache is cold (first
 * request after boot or after the hourly TTL lapses). That synchronous
 * parse was blocking the event loop long enough to time out unrelated
 * concurrent requests and, in production, crash the instance with an OOM
 * abort. Downloading pre-parsed JSON and JSON.parse-ing it is dramatically
 * cheaper than re-parsing raw CSV text, since it skips per-row string
 * splitting/quote handling and cross-referencing entirely.
 *
 * Run this whenever destinations.csv or attractions_catalog.csv changes:
 *   npm run autocomplete:update
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const serverDir = path.join(rootDir, 'server');

const loadEnvFileIfPresent = (filePath: string) => {
  if (fs.existsSync(filePath)) {
    dotenv.config({ path: filePath, override: false });
  }
};

loadEnvFileIfPresent(path.join(rootDir, '.env'));
loadEnvFileIfPresent(path.join(serverDir, '.env'));
loadEnvFileIfPresent(path.join(rootDir, '.secrets'));
loadEnvFileIfPresent(path.join(serverDir, '.secrets'));

// server/.env sets GOOGLE_APPLICATION_CREDENTIALS as a path relative to
// server/ (e.g. "./config/firebase-service-account-key.json"). This script
// runs from the repo root, so resolve it relative to serverDir instead of
// leaving it relative to cwd — otherwise auth silently looks in the wrong
// place (repo root) and fails with ENOENT.
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialsPath && !path.isAbsolute(credentialsPath)) {
  const trimmed = credentialsPath.trim();
  const normalized = path.normalize(trimmed);
  const fromServerEnv = trimmed.startsWith('./') || trimmed.startsWith('.\\');
  process.env.GOOGLE_APPLICATION_CREDENTIALS = fromServerEnv
    ? path.resolve(serverDir, normalized.replace(/^\.([/\\])/, ''))
    : path.resolve(rootDir, normalized);
}

const require = createRequire(import.meta.url);
// tsx patches Node's module resolution process-wide, so this resolves and
// compiles the TS source directly, same as scripts/backfill-group-access.ts.
const autocompleteService = require('../server/src/services/destinationAttractionAutocompleteService');

const rawPrefix = (process.env.LOCATION_RAW_CSV_PREFIX ?? 'locations/').replace(/^\/+/, '');
const prefix = rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`;
const destinationsJsonName = process.env.DESTINATIONS_AUTOCOMPLETE_JSON_NAME ?? 'destinations_autocomplete.json';
const attractionsJsonName = process.env.ATTRACTIONS_AUTOCOMPLETE_JSON_NAME ?? 'attractions_autocomplete.json';

const projectId =
  process.env.GCLOUD_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
const bucketName =
  process.env.LOCATION_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.appspot.com` : '');

if (!bucketName) {
  throw new Error('Set LOCATION_BUCKET or FIREBASE_STORAGE_BUCKET (or GCLOUD_PROJECT_ID) before running this script.');
}

if (!getApps().length) {
  initializeApp({ projectId, storageBucket: bucketName });
}

const bucket = getStorage().bucket(bucketName);

const uploadJson = async (destination: string, payload: unknown[]) => {
  const buffer = Buffer.from(JSON.stringify(payload), 'utf8');
  // Attractions JSON in particular runs well into the tens of MB (JSON repeats
  // full property names per row, unlike CSV columns), and `resumable: false`
  // (simple/multipart upload) is unreliable at that size with this SDK
  // version — it can throw "Cannot call write after a stream was destroyed"
  // partway through. Resumable uploads (the SDK default) handle large
  // payloads correctly.
  await bucket.file(destination).save(buffer, {
    contentType: 'application/json',
    resumable: true,
    metadata: { cacheControl: 'no-cache' },
  });
  console.log(`Uploaded ${payload.length} rows -> gs://${bucketName}/${destination}`);
};

const run = async () => {
  const destinationsPath = path.join(serverDir, 'data', 'destinations.csv');
  const attractionsPath = path.join(serverDir, 'data', 'attractions_catalog.csv');

  const destinationsRaw = fs.existsSync(destinationsPath) ? fs.readFileSync(destinationsPath, 'utf8') : '';
  const destinations = autocompleteService.parseDestinations(destinationsRaw);

  const destinationsByKey = new Map<string, unknown[]>();
  for (const record of destinations as Array<{ destinationKey: string }>) {
    autocompleteService.pushMapArray(destinationsByKey, record.destinationKey, record);
  }

  const attractionsRaw = fs.existsSync(attractionsPath) ? fs.readFileSync(attractionsPath, 'utf8') : '';
  const attractions = autocompleteService.parseAttractions(attractionsRaw, destinationsByKey);

  await uploadJson(`${prefix}${destinationsJsonName}`, destinations);
  await uploadJson(`${prefix}${attractionsJsonName}`, attractions);
};

run()
  .then(() => {
    console.log('Completed autocomplete JSON upload.');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
