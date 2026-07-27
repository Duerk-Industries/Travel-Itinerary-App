import { Storage } from '@google-cloud/storage';
import { getEnvValue } from '../env';
import { logError } from '../logger';

// Reuses the same bucket the rest of this app already has working credentials/access for
// (image-service.ts caches destination photos here) instead of the placeholder
// `trip-blog-quarantine`/`trip-blog-serving` bucket names this feature invented — those buckets
// were never actually created, so signing/uploading against them would just fail.
const BUCKET_NAME =
  getEnvValue('BLOG_MEDIA_BUCKET') ||
  getEnvValue('LOCATION_BUCKET') ||
  'duerk-travel-itinerary-app-location-data';

const UPLOAD_URL_TTL_MS = 15 * 60_000;
const READ_URL_TTL_MS = 60 * 60_000;

let storage: Storage | null = null;
const getStorage = (): Storage => {
  storage ??= new Storage();
  return storage;
};

export const getBlogBucketName = (): string => BUCKET_NAME;

/** Signed PUT URL the client uploads the original file bytes to directly (never proxied through the API server). */
export const createBlogUploadUrl = async (objectKey: string, contentType: string): Promise<string | null> => {
  try {
    const [url] = await getStorage()
      .bucket(BUCKET_NAME)
      .file(objectKey)
      .getSignedUrl({ version: 'v4', action: 'write', expires: Date.now() + UPLOAD_URL_TTL_MS, contentType });
    return url;
  } catch (err) {
    logError('[blog-storage] failed to create upload signed URL — falling back to the simulated upload path', err);
    return null;
  }
};

/** Signed GET URL for rendering a processed rendition. Returns null if the object doesn't exist yet (still processing) or signing fails. */
export const createBlogReadUrl = async (objectKey: string): Promise<string | null> => {
  try {
    const file = getStorage().bucket(BUCKET_NAME).file(objectKey);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + READ_URL_TTL_MS });
    return url;
  } catch (err) {
    logError('[blog-storage] failed to create read signed URL', err);
    return null;
  }
};

export const downloadBlogObject = async (objectKey: string, destinationPath: string): Promise<void> => {
  await getStorage().bucket(BUCKET_NAME).file(objectKey).download({ destination: destinationPath });
};

export const uploadBlogObject = async (objectKey: string, localPath: string, contentType: string): Promise<void> => {
  await getStorage().bucket(BUCKET_NAME).upload(localPath, { destination: objectKey, contentType });
};

export const objectExists = async (objectKey: string): Promise<boolean> => {
  try {
    const [exists] = await getStorage().bucket(BUCKET_NAME).file(objectKey).exists();
    return exists;
  } catch {
    return false;
  }
};

export const deleteBlogObject = async (objectKey: string): Promise<void> => {
  await getStorage().bucket(BUCKET_NAME).file(objectKey).delete().catch(() => undefined);
};

/**
 * Sets the CORS configuration for the blog bucket to allow direct uploads from the browser.
 * Equivalent to: gsutil cors set <file> gs://<bucket>
 */
export const setBucketCors = async (origins: string[] = ['*']): Promise<void> => {
  try {
    await getStorage().bucket(BUCKET_NAME).setCorsConfiguration([
      {
        maxAgeSeconds: 3600,
        method: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
        origin: origins,
        responseHeader: [
          'Content-Type',
          'Authorization',
          'Content-Length',
          'User-Agent',
          'x-goog-resumable',
          'Idempotency-Key',
        ],
      },
    ]);
    console.log(`[blog-storage] CORS configuration updated for bucket: ${BUCKET_NAME}`);
  } catch (err) {
    logError(`[blog-storage] failed to set CORS for bucket: ${BUCKET_NAME}`, err);
    throw err;
  }
};

/** Deterministic rendition key layout, shared by the processing worker and the read-URL lookups so the two never drift apart. */
export const blogRenditionKey = (uploaderUserId: string, assetId: string, rendition: 'primary.jpg' | 'thumb.jpg' | 'primary.mp4'): string =>
  `trip-blog/${uploaderUserId}/${assetId}/${rendition}`;
