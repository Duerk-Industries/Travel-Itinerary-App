import { SecretProvider } from '@wanderbunnies/plaid-transactions/src/ports/SecretProvider';
import { EncryptionProvider } from '@wanderbunnies/plaid-transactions/src/ports/EncryptionProvider';
import { IdentityPolicy } from '@wanderbunnies/plaid-transactions/src/ports/IdentityPolicy';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';

// Firebase Functions secrets
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecretSandbox = defineSecret('PLAID_SECRET_SANDBOX');
const plaidSecretDevelopment = defineSecret('PLAID_SECRET_DEVELOPMENT');
const plaidSecretProduction = defineSecret('PLAID_SECRET_PRODUCTION');
const plaidEncryptionSecret = defineSecret('PLAID_ENCRYPTION_SECRET');

export class WanderBunniesSecretProvider implements SecretProvider {
  async getSecret(name: string): Promise<string> {
    switch (name) {
      case 'PLAID_CLIENT_ID': return plaidClientId.value();
      case 'PLAID_ENV': return process.env.PLAID_ENV || 'sandbox';
      case 'PLAID_SECRET_SANDBOX': return plaidSecretSandbox.value();
      case 'PLAID_SECRET_DEVELOPMENT': return plaidSecretDevelopment.value();
      case 'PLAID_SECRET_PRODUCTION': return plaidSecretProduction.value();
      default:
        // Fallback to process.env if not a strictly defined secret
        return process.env[name] || '';
    }
  }
}

/**
 * Simple AES-256-GCM encryption provider for v1.
 * Uses a secret from Secret Manager as the master key.
 */
export class WanderBunniesEncryptionProvider implements EncryptionProvider {
  private async getKey(): Promise<Buffer> {
    const secret = plaidEncryptionSecret.value();
    return createHash('sha256').update(secret).digest();
  }

  async encrypt(plaintext: string): Promise<{ ciphertext: string; keyVersion: string }> {
    const iv = randomBytes(12);
    const key = await this.getKey();
    const cipher = createCipheriv('aes-256-gcm', key, iv);

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    // Store as IV + Tag + Ciphertext
    const combined = Buffer.concat([iv, tag, ciphertext]);

    return {
      ciphertext: combined.toString('base64'),
      keyVersion: 'v1',
    };
  }

  async decrypt(ciphertext: string, keyVersion: string): Promise<string> {
    if (keyVersion !== 'v1') throw new Error('Unsupported key version');

    const combined = Buffer.from(ciphertext, 'base64');
    const iv = combined.subarray(0, 12);
    const tag = combined.subarray(12, 28);
    const data = combined.subarray(28);

    const key = await this.getKey();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(data),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}

export class WanderBunniesIdentityPolicy implements IdentityPolicy {
  async authorize(uid: string): Promise<boolean> {
    // In a real app, check if user exists and has correct tier.
    // For now, allow any authenticated Firebase user.
    // Gating by tier is handled in the integration layer (Express).
    const db = getFirestore();
    const userDoc = await db.collection('users').doc(uid).get();
    return userDoc.exists;
  }
}
