import { Storage } from '@google-cloud/storage';
import { getEnvValue } from '../src/env';

async function setCors(bucketName: string) {
  const storage = new Storage();
  const origins = [
    'https://wander-bunnies.com',
    'http://localhost:8081',
    'http://127.0.0.1:8081'
  ];

  console.log(`Updating CORS for bucket: ${bucketName}...`);
  try {
    await storage.bucket(bucketName).setCorsConfiguration([
      {
        maxAgeSeconds: 3600,
        method: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
        origin: origins,
        responseHeader: [
          'Content-Type',
          'Authorization',
          'Content-Length',
          'User-Agent',
          'x-goog-resumable',
          'Idempotency-Key',
        ],
      },
    ]);
    console.log(`[blog-storage] CORS configuration updated for bucket: ${bucketName}`);
  } catch (err) {
    console.error(`[blog-storage] failed to set CORS for bucket: ${bucketName}`, err);
  }
}

async function run() {
  const buckets = [
    'duerk-travel-itinerary-app-location-data',
    'travel-itinerary-app-blog-quarantine-483623',
    'travel-itinerary-app-blog-serving-483623'
  ];

  for (const bucket of buckets) {
    await setCors(bucket);
  }
}

run();
