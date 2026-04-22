import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const firebaseDb = require('../server/src/db.firebase');

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

const run = async () => {
  const loadedFrom = loadBackfillEnv();
  console.log(`[group-access] env loaded from ${loadedFrom}`);
  const result = await firebaseDb.rebuildGroupAccessForAllGroups();
  console.log(`[group-access] rebuilt access projections for ${result.groupCount} group(s)`);
};

run().catch((err) => {
  console.error('[group-access] backfill failed', err);
  process.exit(1);
});
