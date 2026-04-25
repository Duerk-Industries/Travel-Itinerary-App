import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const firebaseDb = require('../server/src/db.firebase') as typeof import('../server/src/db.firebase');

type Mode = 'preflight' | 'apply';
type Scope = 'all' | 'group' | 'trip';

const loadBackfillEnv = (): string => {
  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.secrets'),
    path.resolve(process.cwd(), 'server/.env'),
    path.resolve(process.cwd(), 'server/.secrets'),
  ];
  const loaded: string[] = [];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
      loaded.push(envPath);
    }
  }
  return loaded.length ? loaded.join(', ') : 'process.env/default';
};

const getArgValue = (flag: string): string | null => {
  const direct = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (direct) return direct.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  if (index >= 0 && index + 1 < process.argv.length) {
    return process.argv[index + 1] ?? null;
  }
  return null;
};

const hasFlag = (flag: string): boolean => process.argv.includes(flag) || process.argv.some((arg) => arg.startsWith(`${flag}=`));

const getMode = (): Mode => {
  const raw = (getArgValue('--mode') ?? 'preflight').trim().toLowerCase();
  if (raw === 'preflight' || raw === 'apply') return raw;
  throw new Error(`Unsupported --mode value: ${raw}`);
};

const getScope = (): Scope => {
  const raw = (getArgValue('--scope') ?? 'all').trim().toLowerCase();
  if (raw === 'all' || raw === 'group' || raw === 'trip') return raw;
  throw new Error(`Unsupported --scope value: ${raw}`);
};

const getProjectId = (): string =>
  process.env.GCLOUD_PROJECT_ID ||
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  '';

const logTargetSummary = (loadedFrom: string, mode: Mode, scope: Scope): void => {
  const projectId = getProjectId();
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '';
  const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
  console.log(`[acl-backfill] mode=${mode} scope=${scope}`);
  console.log(`[acl-backfill] env loaded from ${loadedFrom}`);
  console.log(`[acl-backfill] projectId=${projectId || '(missing)'}`);
  console.log(`[acl-backfill] databaseId=${databaseId}`);
  console.log(
    `[acl-backfill] target=${emulatorHost ? `emulator:${emulatorHost}` : 'remote-firestore'}`
  );
};

const runPreflight = async (): Promise<void> => {
  const db = firebaseDb.getDb();
  const [groupsSnap, tripsSnap, groupAccessSnap, tripAccessSnap] = await Promise.all([
    db.collection('groups').get(),
    db.collection('trips').get(),
    db.collection('group_access').get(),
    db.collection('trip_access').get(),
  ]);
  console.log(`[acl-backfill] groups=${groupsSnap.size}`);
  console.log(`[acl-backfill] trips=${tripsSnap.size}`);
  console.log(`[acl-backfill] group_access_docs=${groupAccessSnap.size}`);
  console.log(`[acl-backfill] trip_access_docs=${tripAccessSnap.size}`);
};

const assertApplyIsSafe = (): void => {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return;
  }
  const projectId = getProjectId();
  if (!projectId) {
    throw new Error('Refusing remote apply without GCLOUD_PROJECT_ID/FIREBASE_PROJECT_ID/GOOGLE_CLOUD_PROJECT');
  }
  if (!hasFlag('--allow-remote')) {
    throw new Error('Refusing remote apply without --allow-remote');
  }
  const confirmedProjectId = (getArgValue('--confirm-project-id') ?? '').trim();
  if (!confirmedProjectId) {
    throw new Error('Refusing remote apply without --confirm-project-id=<project-id>');
  }
  if (confirmedProjectId !== projectId) {
    throw new Error(`Refusing remote apply because confirmed project "${confirmedProjectId}" does not match resolved project "${projectId}"`);
  }
};

const runApply = async (scope: Scope): Promise<void> => {
  assertApplyIsSafe();
  if (scope === 'all' || scope === 'group') {
    const groupResult = await firebaseDb.rebuildGroupAccessForAllGroups();
    console.log(`[acl-backfill] rebuilt group_access for ${groupResult.groupCount} group(s)`);
  }
  if (scope === 'all' || scope === 'trip') {
    const tripResult = await firebaseDb.rebuildTripAccessForAllTrips();
    console.log(`[acl-backfill] rebuilt trip_access for ${tripResult.tripCount} trip(s)`);
  }
};

const run = async () => {
  const loadedFrom = loadBackfillEnv();
  const mode = getMode();
  const scope = getScope();
  logTargetSummary(loadedFrom, mode, scope);
  await runPreflight();
  if (mode === 'apply') {
    await runApply(scope);
  }
};

run().catch((err) => {
  console.error('[acl-backfill] failed', err);
  process.exit(1);
});
