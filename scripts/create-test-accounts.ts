import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, scryptSync } from 'crypto';
import dotenv from 'dotenv';
import * as db from '../server/src/db.ts';
import * as env from '../server/src/env.ts';

type AccountInput = {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbApi = ((db as any).default ?? db) as any;
const envApi = ((env as any).default ?? env) as any;
const hashPassword = (password: string, salt: string): string => scryptSync(password, salt, 64).toString('hex');

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
    if (!row.firstName || !row.lastName || !row.username || !row.email || !row.password) {
      throw new Error(`Account at index ${idx} is missing required fields.`);
    }
    return {
      firstName: String(row.firstName).trim(),
      lastName: String(row.lastName).trim(),
      username: String(row.username).trim().toLowerCase(),
      email: String(row.email).trim().toLowerCase(),
      password: String(row.password),
    };
  });
};

const repairExistingAccount = async (account: AccountInput): Promise<void> => {
  const user = await dbApi.findUserByEmail(account.email);
  if (!user?.id) {
    throw new Error(`Could not repair account; user not found by email: ${account.email}`);
  }

  const provider = String(dbApi.getCurrentDbProvider?.() ?? process.env.DB_PROVIDER ?? '').toLowerCase();
  const salt = randomBytes(16).toString('hex');
  const passwordHash = hashPassword(account.password, salt);

  if (provider === 'firebase') {
    const firebaseDb = await import('../server/src/db.firebase.ts');
    const firestore = firebaseDb.getDb();
    await firestore.collection('users').doc(user.id).set(
      {
        email: account.email,
        provider: 'email',
        firstName: account.firstName,
        lastName: account.lastName,
        username: account.username,
        emailVerified: true,
        emailVerifiedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    await firestore.collection('web_users').doc(user.id).set(
      {
        email: account.email,
        firstName: account.firstName,
        lastName: account.lastName,
        passwordHash,
        salt,
        passwordSetupRequired: false,
      },
      { merge: true }
    );
  } else if (provider === 'postgres' || provider === 'memory') {
    const pool = dbApi.poolClient();
    await pool.query(
      `UPDATE users
       SET email = $2,
           username = $3,
           username_normalized = $3,
           first_name = $4,
           last_name = $5,
           email_verified = TRUE,
           email_verified_at = COALESCE(email_verified_at, NOW())
       WHERE id = $1`,
      [user.id, account.email, account.username, account.firstName, account.lastName]
    );
    await pool.query(
      `UPDATE web_users
       SET email = $2,
           first_name = $3,
           last_name = $4,
           password_hash = $5,
           salt = $6,
           password_setup_required = FALSE
       WHERE id = $1`,
      [user.id, account.email, account.firstName, account.lastName, passwordHash, salt]
    );
  } else {
    throw new Error(`Unsupported provider for repair flow: ${provider || 'unknown'}`);
  }

  await dbApi.markUserEmailVerified(user.id);
  await dbApi.ensureDefaultGroupForUser(user.id, account.email);

  const loginByEmail = await dbApi.verifyWebUserCredentials(account.email, account.password);
  const loginByUsername = await dbApi.verifyWebUserCredentials(account.username, account.password);
  if (!loginByEmail && !loginByUsername) {
    throw new Error(`Repaired ${account.email}, but credential verification still failed`);
  }
};

export const runCreateTestAccounts = async () => {
  requireLocalSeedAllowed();
  process.env.FIREBASE_INIT_BACKFILL_PACKING ??= '0';
  const accountsPath = path.resolve(__dirname, '../test_inputs/default_accounts.json');
  const accounts = loadAccounts(accountsPath);

  await dbApi.initDb();

  const results = {
    created: 0,
    repaired: 0,
    errors: 0,
  };

  for (const account of accounts) {
    try {
      const user = await dbApi.createWebUser(
        account.firstName,
        account.lastName,
        account.email,
        account.password,
        account.username
      );
      await dbApi.markUserEmailVerified(user.id);
      results.created += 1;
      console.log(`Created + confirmed: ${account.email} (${account.username})`);
    } catch (err: any) {
      if (err?.code === 'USER_EXISTS') {
        await repairExistingAccount(account);
        results.repaired += 1;
        console.log(`Repaired existing: ${account.email} (${account.username})`);
        continue;
      }
      results.errors += 1;
      console.error(`Failed to create ${account.email}: ${(err as Error).message}`);
    }
  }

  console.log(`Done. Created=${results.created} Repaired=${results.repaired} Errors=${results.errors}`);
};

const isDirectRun = (() => {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  try {
    return path.resolve(argvPath) === __filename;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runCreateTestAccounts().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
