import { getApps, initializeApp } from 'firebase-admin/app';
import { getEnvValue } from '../env';

/**
 * Shared Firebase Storage bucket resolution, used by every service that
 * loads pre-processed location/attraction data from Cloud Storage
 * (locationServices.ts, attractionsCatalogService.ts,
 * destinationAttractionAutocompleteService.ts). Centralized here so the
 * bucket-name/app-init logic doesn't drift between them.
 */
export const normalizeBucketName = (value?: string): string | undefined => {
  if (!value) return undefined;
  let normalized = value.trim();
  if (!normalized) return undefined;
  normalized = normalized.replace(/^gs:\/\//i, '');
  normalized = normalized.replace(/^https?:\/\/storage.googleapis.com\//i, '');
  normalized = normalized.split('?')[0].split('#')[0];
  normalized = normalized.replace(/\/+$/, '');
  if (normalized.includes('/')) {
    normalized = normalized.split('/')[0];
  }
  return normalized || undefined;
};

export const resolveLocationBucketName = (): string | null => {
  const explicit = normalizeBucketName(getEnvValue('LOCATION_BUCKET') || getEnvValue('FIREBASE_STORAGE_BUCKET'));
  if (explicit) return explicit;
  const projectId =
    getEnvValue('GCLOUD_PROJECT_ID') || getEnvValue('GOOGLE_CLOUD_PROJECT') || getEnvValue('FIREBASE_PROJECT_ID');
  return projectId ? `${projectId}.appspot.com` : null;
};

export const ensureFirebaseStorageApp = (bucketName: string): void => {
  if (getApps().length > 0) return;
  const projectId = getEnvValue('GCLOUD_PROJECT_ID') || getEnvValue('GOOGLE_CLOUD_PROJECT');
  initializeApp({ projectId, storageBucket: bucketName });
};
