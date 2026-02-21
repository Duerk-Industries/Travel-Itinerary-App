import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import fs from 'fs';
import path from 'path';
import { isLocalEnv, getEnvValue } from './env';

const secretsFilePath = path.resolve(__dirname, '../../.secrets');

async function getSecretFromLocalFile(secretName: string): Promise<string | undefined> {
  if (!fs.existsSync(secretsFilePath)) {
    return undefined;
  }

  const fileContent = fs.readFileSync(secretsFilePath, 'utf8');
  const lines = fileContent.split('
');
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
