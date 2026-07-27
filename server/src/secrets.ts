import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import fs from 'fs';
import path from 'path';
import { isLocalEnv, getEnvValue } from './env';

const secretsFilePath = path.resolve(__dirname, '../../.secrets');
const PUBLIC_ENV_PREFIXES = ['EXPO_PUBLIC_', 'REACT_APP_', 'VITE_', 'NEXT_PUBLIC_'] as const;
const BACKEND_ONLY_SECRET_KEYS = [
  'AUTH_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'APPLE_PRIVATE_KEY',
  'OPENAI_API_KEY',
  'OPEN_API_KEY',
  'SMTP_PASS',
  'MAILGUN_WEBHOOK_SIGNING_KEY',
  'MAILGUN_HTTP_WEBHOOK_SIGNING_KEY',
  'INGESTION_WORKER_SHARED_SECRET',
  'INGESTION_ENCRYPTION_SECRET',
  'FIREBASE_PRIVATE_KEY',
] as const;

// Cache for secrets fetched via SDK to avoid redundant API calls and costs.
const secretCache = new Map<string, { value: string; expires: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Singleton client to avoid re-instantiation overhead.
let smClient: SecretManagerServiceClient | null = null;

async function getSecretFromLocalFile(secretName: string): Promise<string | undefined> {
  if (!fs.existsSync(secretsFilePath)) {
    return undefined;
  }

  const fileContent = fs.readFileSync(secretsFilePath, 'utf8');
  const lines = fileContent.split('\n');
  for (const line of lines) {
    const parts = line.split('=');
    if (parts.length === 2 && parts[0].trim() === secretName) {
      // Remove quotes if they exist
      return parts[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  return undefined;
}

async function getSecretFromGoogleSecretManager(secretName: string): Promise<string | undefined> {
  // Check in-memory cache first
  const cached = secretCache.get(secretName);
  if (cached && cached.expires > Date.now()) {
    return cached.value;
  }

  smClient ??= new SecretManagerServiceClient();
  const projectId = getEnvValue('GCLOUD_PROJECT_ID', { required: true });

  try {
    const [version] = await smClient.accessSecretVersion({
      name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
    });

    if (version.payload?.data) {
      const value = version.payload.data.toString();
      // Update cache
      secretCache.set(secretName, { value, expires: Date.now() + CACHE_TTL_MS });
      return value;
    }
  } catch (error) {
    console.error(`Failed to access secret ${secretName} from Secret Manager:`, error);
    return undefined;
  }

  return undefined;
}

/**
 * Gets a secret value from the appropriate source based on the environment.
 *
 * Order of operations:
 * 1. Read from process.env (mapped secrets in Cloud Run).
 * 2. Read from local .secrets file (dev mode).
 * 3. Fetch from Google Secret Manager with 1-hour caching.
 *
 * @param secretName The name of the secret to retrieve.
 * @returns The secret value, or undefined if not found.
 */
export async function getSecret(secretName: string): Promise<string | undefined> {
  // Priority 1: Mapped environment variables (Most cost-effective in Cloud Run)
  if (process.env[secretName]) {
    return process.env[secretName];
  }

  // Priority 2: Local development file
  if (isLocalEnv()) {
    return getSecretFromLocalFile(secretName);
  }

  // Priority 3: Remote Secret Manager (Fallback with caching)
  return getSecretFromGoogleSecretManager(secretName);
}

/**
 * A specific function to get the OPEN_API_KEY.
 * @returns The OPEN_API_KEY value, or undefined if not found.
 */
export async function getOpenApiKey(): Promise<string | undefined> {
  return getSecret('OPEN_API_KEY');
}

export const findPubliclyExposedServerSecretEnvVars = (): string[] => {
  const exposed: string[] = [];
  for (const prefix of PUBLIC_ENV_PREFIXES) {
    for (const key of BACKEND_ONLY_SECRET_KEYS) {
      const envKey = `${prefix}${key}`;
      if (String(process.env[envKey] ?? '').trim()) {
        exposed.push(envKey);
      }
    }
  }
  return exposed;
};

export const assertNoPubliclyExposedServerSecrets = (): void => {
  const exposed = findPubliclyExposedServerSecretEnvVars();
  if (!exposed.length) {
    return;
  }
  throw new Error(`Backend-only secrets must not use public env prefixes: ${exposed.join(', ')}`);
};
