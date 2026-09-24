import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { getEnvValue } from '../env';

// Push tokens are opaque bearer values (whoever holds an Expo push token can send that device a
// notification), so they're encrypted at rest the same way the OAuth tokens in
// src/ingestion/shared/repository.ts are — AES-256-GCM with a key derived from an env secret,
// never the client. The client sends the raw token over HTTPS; the server encrypts it here before
// it ever reaches notification_devices.push_token_ciphertext, and decrypts it only at the moment
// of sending (notificationOutboxWorker.ts's deliverPush).

const encryptionKey = (): Buffer => {
  const secret = getEnvValue('PUSH_TOKEN_ENCRYPTION_SECRET', {
    defaultValue: getEnvValue('AUTH_SECRET', { defaultValue: 'development-secret' }) || 'development-secret',
  })!;
  return createHash('sha256').update(secret).digest();
};

export const encryptPushToken = (value: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
};

export const decryptPushToken = (value: string): string => {
  const buffer = Buffer.from(value, 'base64');
  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};

// Deterministic (unkeyed) hash used only for the notification_devices UNIQUE(user_id,
// push_token_hash) lookup/upsert key — the ciphertext above is randomized per encryption (fresh
// IV each time) so it can't serve that role itself.
export const hashPushToken = (value: string): string => createHash('sha256').update(value).digest('hex');
