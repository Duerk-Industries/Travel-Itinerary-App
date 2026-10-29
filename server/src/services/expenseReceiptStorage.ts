import { Storage } from '@google-cloud/storage';
import { getBlogBucketName } from './blogStorageClient';

// Receipt images share the app's existing media bucket, under their own prefix. Reads are signed,
// short-lived URLs; the object key never leaves the server.
const READ_URL_TTL_MS = 10 * 60_000;

let storage: Storage | null = null;
const bucket = () => (storage ??= new Storage()).bucket(getBlogBucketName());

const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export const receiptObjectKey = (tripId: string, expenseId: string, contentType: string, nonce: string): string =>
  `expense-receipts/${tripId}/${expenseId}/${nonce}.${EXTENSION[contentType] ?? 'jpg'}`;

export const putReceiptObject = async (objectKey: string, bytes: Buffer, contentType: string): Promise<void> => {
  await bucket().file(objectKey).save(bytes, { contentType, resumable: false });
};

export const createReceiptReadUrl = async (objectKey: string): Promise<string | null> => {
  const file = bucket().file(objectKey);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + READ_URL_TTL_MS });
  return url;
};

export const deleteReceiptObject = async (objectKey: string): Promise<void> => {
  await bucket().file(objectKey).delete({ ignoreNotFound: true });
};
