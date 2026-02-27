import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import * as db from '../server/src/db.ts';
import * as env from '../server/src/env.ts';

type AccountInput = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbApi = ((db as any).default ?? db) as any;
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

const requireLocalSeedAllowed = () => {
  loadLocalEnvFlag();
  if (process.env.ALLOW_TEST_ACCOUNT_SEED !== '1') {
    throw new Error('ALLOW_TEST_ACCOUNT_SEED must be set to 1 in .local_env to run this script.');
  }
  if (!envApi.isLocalEnv() || process.env.K_SERVICE || process.env.CLOUD_RUN_JOB) {
    throw new Error('Test account seeding is only allowed on localhost/local environment.');
  }
};

const loadAccounts = (filePath: string): AccountInput[] => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Accounts file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${filePath}: ${(err as Error).message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error('Accounts file must be a JSON array.');
  }
  return data.map((entry, idx) => {
    const row = entry as Partial<AccountInput>;
    if (!row.firstName || !row.lastName || !row.email || !row.password) {
      throw new Error(`Account at index ${idx} is missing required fields.`);
    }
    return {
      firstName: String(row.firstName).trim(),
      lastName: String(row.lastName).trim(),
      email: String(row.email).trim().toLowerCase(),
      password: String(row.password),
    };
  });
};

const main = async () => {
  requireLocalSeedAllowed();
  const accountsPath = path.resolve(__dirname, '../test_inputs/default_accounts.json');
  const accounts = loadAccounts(accountsPath);

  await dbApi.initDb();

  const results = {
    created: 0,
    skipped: 0,
    errors: 0,
  };

  for (const account of accounts) {
    try {
      const user = await dbApi.createWebUser(account.firstName, account.lastName, account.email, account.password);
      await dbApi.markUserEmailVerified(user.id);
      results.created += 1;
      console.log(`Created + confirmed: ${account.email}`);
    } catch (err: any) {
      if (err?.code === 'USER_EXISTS') {
        results.skipped += 1;
        console.log(`Skipped existing: ${account.email}`);
        continue;
      }
      results.errors += 1;
      console.error(`Failed to create ${account.email}: ${(err as Error).message}`);
    }
  }

  console.log(`Done. Created=${results.created} Skipped=${results.skipped} Errors=${results.errors}`);
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
