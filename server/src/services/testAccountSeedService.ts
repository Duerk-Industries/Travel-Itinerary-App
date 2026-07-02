import fs from 'fs';
import path from 'path';
import { createWebUser, markUserEmailVerified } from '../db';
import { getEnvValue, isLocalEnv } from '../env';
import { logError, logInfo } from '../logger';

type AccountInput = {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
};

const loadAccounts = (filePath: string): AccountInput[] => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error('Accounts file must be a JSON array.');
  }
  return data.map((entry: Partial<AccountInput>, idx: number) => {
    if (!entry.firstName || !entry.lastName || !entry.username || !entry.email || !entry.password) {
      throw new Error(`Account at index ${idx} is missing required fields.`);
    }
    return {
      firstName: String(entry.firstName).trim(),
      lastName: String(entry.lastName).trim(),
      username: String(entry.username).trim().toLowerCase(),
      email: String(entry.email).trim().toLowerCase(),
      password: String(entry.password),
    };
  });
};

// Local-dev safety net: re-creates the fixture accounts in test_inputs/default_accounts.json
// on every startup when ALLOW_TEST_ACCOUNT_SEED=1. The local Firestore emulator's data only
// persists via --export-on-exit, which never fires on an ungraceful shutdown (crash, killed
// process, closed terminal) — so these accounts can silently disappear on emulator restart.
// This makes that loss self-healing instead of requiring a manual `npm run accounts:seed`.
// Already-existing accounts hit USER_EXISTS and are left untouched (no password reset).
export const seedDefaultTestAccountsIfEnabled = async (): Promise<void> => {
  if (getEnvValue('ALLOW_TEST_ACCOUNT_SEED') !== '1') return;
  if (!isLocalEnv() || process.env.K_SERVICE || process.env.CLOUD_RUN_JOB) return;

  const accountsPath = path.resolve(__dirname, '../../../test_inputs/default_accounts.json');
  if (!fs.existsSync(accountsPath)) return;

  let accounts: AccountInput[];
  try {
    accounts = loadAccounts(accountsPath);
  } catch (err) {
    logError('[startup] test account seed: failed to read default_accounts.json', err);
    return;
  }

  let created = 0;
  let skipped = 0;
  let errors = 0;
  for (const account of accounts) {
    try {
      const user = await createWebUser(account.firstName, account.lastName, account.email, account.password, account.username);
      await markUserEmailVerified(user.id);
      created += 1;
    } catch (err: any) {
      if (err?.code === 'USER_EXISTS') {
        skipped += 1;
        continue;
      }
      errors += 1;
      logError(`[startup] test account seed: failed to create ${account.email}`, err);
    }
  }
  if (created > 0 || errors > 0) {
    logInfo(`[startup] test account seed: created=${created} skipped=${skipped} errors=${errors}`);
  }
};
