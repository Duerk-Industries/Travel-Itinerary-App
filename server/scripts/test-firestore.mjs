#!/usr/bin/env node
// Runs the server tests against a Firestore emulator instead of pg-mem.
//   npm run test:firestore -- __tests__/expense-idempotency.test.ts
//
// Start an emulator first (for example `firebase emulators:start --only firestore`), then point this
// at it with FIRESTORE_EMULATOR_HOST (default 127.0.0.1:8080). Data is written under a throwaway
// project id (default "demo-server-tests"), so a dev project in the same emulator is not touched.
// Suites that seed rows with raw SQL are Postgres-only and are listed in docs/operations.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectId = process.env.TEST_FIRESTORE_PROJECT || 'demo-server-tests';
const env = {
  ...process.env,
  JEST_DB_PROVIDER: 'firebase',
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080',
  GCLOUD_PROJECT: projectId,
  GCLOUD_PROJECT_ID: projectId,
};
const jest = path.resolve(here, '../../node_modules/jest/bin/jest.js');
const args = ['--experimental-vm-modules', jest, '--config', 'jest.projects.js', '--runInBand', ...(process.argv.length > 2 ? ['--runTestsByPath', ...process.argv.slice(2)] : [])];
const result = spawnSync(process.execPath, args, { cwd: path.resolve(here, '..'), env, stdio: 'inherit' });
process.exit(result.status ?? 1);
