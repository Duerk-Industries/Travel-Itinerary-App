import jwt from 'jsonwebtoken';
import { PlaidApi } from 'plaid';
import crypto from 'crypto';

/**
 * Verifies a Plaid webhook JWT signature.
 * Reference: https://plaid.com/docs/api/webhooks/webhook-verification/
 */
export const verifyPlaidWebhook = async (
  plaidClient: PlaidApi,
  header: string,
  body: string
): Promise<boolean> => {
  try {
    const decodedToken = jwt.decode(header, { complete: true });
    if (!decodedToken || typeof decodedToken !== 'object' || !decodedToken.header.kid) {
      return false;
    }

    const kid = decodedToken.header.kid;
    const { data: response } = await plaidClient.webhookVerificationKeyGet({
      webhook_verification_key_id: kid,
    });

    const key = response.key;
    const publicKey = crypto.createPublicKey({
      key: key as any,
      format: 'jwk',
    });

    // Body hash verification
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const verifiedClaims = jwt.verify(header, publicKey, {
      algorithms: ['ES256'],
      issuer: 'plaid', // Note: Plaid docs say issuer is 'plaid'
    }) as any;

    return verifiedClaims.request_body_sha256 === bodyHash;
  } catch (error) {
    console.error('[plaid-transactions] Webhook verification failed:', error);
    return false;
  }
};
