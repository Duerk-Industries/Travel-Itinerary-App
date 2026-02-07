import fs from 'fs';
import path from 'path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

const rootDir = path.resolve(__dirname, '..');
const rawPrefix = (process.env.LOCATION_RAW_CSV_PREFIX ?? 'raw-csv/').replace(/^\/+/, '');

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
const files = ['countries_and_regions.csv', 'cities.csv'];

const run = async () => {
  for (const fileName of files) {
    const localPath = path.join(rootDir, 'data', fileName);
    if (!fs.existsSync(localPath)) {
      throw new Error(`Missing input file: ${localPath}`);
    }
    const destination = `${rawPrefix}${fileName}`;
    await bucket.upload(localPath, {
      destination,
      contentType: 'text/csv',
      resumable: false,
      metadata: {
        cacheControl: 'no-cache',
      },
    });
    // eslint-disable-next-line no-console
    console.log(`Uploaded ${fileName} -> gs://${bucketName}/${destination}`);
  }
};

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
