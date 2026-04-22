import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import fs from 'fs';
import path from 'path';
import { isLocalEnv, getEnvValue } from './env';

const secretsFilePath = path.resolve(__dirname, '../../.secrets');
const PUBLIC_ENV_PREFIXES = ['EXPO_PUBLIC_', 'REACT_APP_', 'VITE_', 'NEXT_PUBLIC_'] as const;
const BACKEND_ONLY_SECRET_KEYS = [
  'AUTH_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'OPENAI_API_KEY',
  'OPEN_API_KEY',
  'SMTP_PASS',
  'MAILGUN_WEBHOOK_SIGNING_KEY',
  'MAILGUN_HTTP_WEBHOOK_SIGNING_KEY',
  'INGESTION_WORKER_SHARED_SECRET',
  'INGESTION_ENCRYPTION_SECRET',
  'FIREBASE_PRIVATE_KEY',
] as const;

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
  const client = new SecretManagerServiceClient();
  const projectId = getEnvValue('GCLOUD_PROJECT_ID', { required: true });

  try {
    const [version] = await client.accessSecretVersion({
      name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
    });

    if (version.payload?.data) {
      return version.payload.data.toString();
    }
  } catch (error) {
    console.error(`Failed to access secret ${secretName} from Secret Manager:`, error);
    return undefined;
  }

  return undefined;
}

/**
 * Gets a secret value from the appropriate source based on the environment.
 * In a local environment, it reads from the `server/.secrets` file.
 * In a GCP environment, it fetches the secret from Google Secret Manager.
 *
 * @param secretName The name of the secret to retrieve.
 * @returns The secret value, or undefined if not found.
 */
export async function getSecret(secretName: string): Promise<string | undefined> {
  if (isLocalEnv()) {
    return getSecretFromLocalFile(secretName);
  } else {
    return getSecretFromGoogleSecretManager(secretName);
  }
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
