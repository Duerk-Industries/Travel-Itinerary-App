#!/usr/bin/env node
// Loads firestore.rules into a running Firestore emulator and runs the rules test against it.
//   npm run test:firestore-rules
//
// Needs the Firestore (default 127.0.0.1:8080) and Auth (default 127.0.0.1:9099) emulators running,
// for example `firebase emulators:start`. Rules are loaded for a throwaway project id
// (default "demo-rules-test"), and the test writes under that same id, so your dev project's data
// and rules in the emulator are not touched. Override with TEST_RULES_PROJECT, FIRESTORE_EMULATOR_HOST
// and FIREBASE_AUTH_EMULATOR_HOST.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = process.env.TEST_RULES_PROJECT || 'demo-rules-test';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const rules = readFileSync(path.resolve(here, '../../firestore.rules'), 'utf8');

const response = await fetch(`http://${firestoreHost}/emulator/v1/projects/${project}:securityRules`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: rules }] } }),
}).catch((error) => { console.error(`Could not reach the Firestore emulator at ${firestoreHost}: ${error.message}`); process.exit(1); });
if (!response.ok) { console.error(`The emulator rejected the rules (${response.status}): ${await response.text()}`); process.exit(1); }
console.log(`Loaded firestore.rules for project ${project} on ${firestoreHost}`);

const jest = path.resolve(here, '../../node_modules/jest/bin/jest.js');
const result = spawnSync(process.execPath, ['--experimental-vm-modules', jest, '--config', 'jest.projects.js', '--runInBand', '--runTestsByPath', '__tests__/firestore.rules.test.ts'], {
  cwd: path.resolve(here, '..'),
  stdio: 'inherit',
  env: { ...process.env, JEST_DB_PROVIDER: 'firebase', FIRESTORE_EMULATOR_HOST: firestoreHost, FIREBASE_AUTH_EMULATOR_HOST: authHost, GCLOUD_PROJECT: project, GCLOUD_PROJECT_ID: project },
});
process.exit(result.status ?? 1);
