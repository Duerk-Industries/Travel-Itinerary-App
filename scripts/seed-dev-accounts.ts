import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import * as env from '../server/src/env.ts';
import { runCreateTestAccounts } from './create-test-accounts.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envApi = ((env as any).default ?? env) as any;

const loadLocalEnvFlag = () => {
  const rootEnv = path.resolve(__dirname, '../.env');
  const serverEnv = path.resolve(__dirname, '../server/.env');
  const rootSecrets = path.resolve(__dirname, '../.secrets');
  const serverSecrets = path.resolve(__dirname, '../server/.secrets');
  const rootLocalEnv = path.resolve(__dirname, '../.local_env');
  const serverLocalEnv = path.resolve(__dirname, '../server/.local_env');

  for (const envPath of [rootEnv, serverEnv, rootSecrets, serverSecrets]) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  }

  if (fs.existsSync(rootLocalEnv)) {
    dotenv.config({ path: rootLocalEnv, override: true });
  }
  if (fs.existsSync(serverLocalEnv)) {
    dotenv.config({ path: serverLocalEnv, override: true });
  }
};

const shouldAutoSeed = (): boolean => {
  loadLocalEnvFlag();

  if (process.env.ALLOW_TEST_ACCOUNT_SEED !== '1') {
    console.log('[dev] Skipping account seed; set ALLOW_TEST_ACCOUNT_SEED=1 in .local_env to enable it.');
    return false;
  }

  if (!envApi.isLocalEnv() || process.env.K_SERVICE || process.env.CLOUD_RUN_JOB) {
    console.log('[dev] Skipping account seed outside the local environment.');
    return false;
  }

  return true;
};

const main = async () => {
  if (!shouldAutoSeed()) return;
  console.log('[dev] Seeding local test accounts...');
  await runCreateTestAccounts();
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
