import https from 'https';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

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

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credentialsPath && !path.isAbsolute(credentialsPath)) {
  const trimmed = credentialsPath.trim();
  const normalized = path.normalize(trimmed);
  const fromServerEnv = trimmed.startsWith('./') || trimmed.startsWith('.\\');
  process.env.GOOGLE_APPLICATION_CREDENTIALS = fromServerEnv
    ? path.resolve(serverDir, normalized.replace(/^\.([/\\])/, ''))
    : path.resolve(rootDir, normalized);
}

const rawPrefix = (process.env.LOCATION_RAW_CSV_PREFIX ?? 'locations/').replace(/^\/+/, '');

const projectId =
  process.env.GCLOUD_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID;
const bucketName =
  process.env.LOCATION_BUCKET ||
  process.env.FIREBASE_STORAGE_BUCKET ||
  (projectId ? `${projectId}.appspot.com` : '');

if (!bucketName) {
  throw new Error('Set LOCATION_BUCKET or FIREBASE_STORAGE_BUCKET (or GCLOUD_PROJECT_ID) before running this script.');
}

if (!getApps().length) {
  initializeApp({ projectId, storageBucket: bucketName });
}

const bucket = getStorage().bucket(bucketName);

const baseUrl = 'https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/master/json';
const files = [
  { remote: 'countries.json', destination: 'countries.json', compressed: false },
  { remote: 'states.json', destination: 'states.json', compressed: false },
  { remote: 'cities.json', destination: 'cities.json', compressed: false },
  { remote: 'cities.json.gz', destination: 'cities.json', compressed: true },
  { remote: 'regions.json', destination: 'regions.json', compressed: false },
  { remote: 'subregions.json', destination: 'subregions.json', compressed: false },
];

const download = (url: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });

const gunzip = (buffer: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    zlib.gunzip(buffer, (err, decoded) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(decoded);
    });
  });

const ensureJson = (buffer: Buffer, label: string) => {
  const text = buffer.toString('utf8');
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error('Expected JSON array');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON for ${label}: ${message}`);
  }
};

const run = async () => {
  const uploaded = new Set<string>();
  for (const entry of files) {
    if (uploaded.has(entry.destination)) continue;
    const url = `${baseUrl}/${entry.remote}`;
    let buffer: Buffer;
    try {
      buffer = await download(url);
    } catch (err) {
      if (entry.destination === 'cities.json' && entry.remote.endsWith('.json')) {
        continue;
      }
      if (entry.remote.endsWith('.json')) {
        throw err;
      }
      continue;
    }
    const payload = entry.compressed ? await gunzip(buffer) : buffer;
    ensureJson(payload, entry.remote);
    const destination = `${rawPrefix}${entry.destination}`;
    await bucket.file(destination).save(payload, {
      contentType: 'application/json',
      resumable: false,
      metadata: {
        cacheControl: 'no-cache',
      },
    });
    uploaded.add(entry.destination);
    // eslint-disable-next-line no-console
    console.log(`Uploaded ${entry.destination} -> gs://${bucketName}/${destination}`);
  }
  return uploaded;
};

run()
  .then((uploaded) => {
    // eslint-disable-next-line no-console
    console.log(`Completed uploads: ${uploaded.size}`);
    process.exit(0);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
