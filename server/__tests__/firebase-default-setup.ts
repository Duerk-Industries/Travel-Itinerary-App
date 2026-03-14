import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Default server test bootstrap: prefer the Firebase adapter unless a test opts into
// a different provider explicitly.

const envPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.secrets'),
  path.resolve(__dirname, '../../.secrets'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

jest.setTimeout(30000);

if (process.env.SHOW_TEST_LOGS !== '1') {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
}

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.DB_PROVIDER = process.env.DB_PROVIDER ?? 'firebase';
process.env.GCLOUD_PROJECT_ID = process.env.GCLOUD_PROJECT_ID ?? 'jest-firebase-test-project';

if (!process.env.DB_PROVIDER || process.env.DB_PROVIDER === 'firebase') {
  process.env.E2E_MODE = process.env.E2E_MODE ?? '1';
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
  delete process.env.USE_IN_MEMORY_DB;
} else if (process.env.DB_PROVIDER === 'postgres') {
  delete process.env.USE_IN_MEMORY_DB;
  delete process.env.E2E_MODE;
  delete process.env.FIRESTORE_EMULATOR_HOST;
}
