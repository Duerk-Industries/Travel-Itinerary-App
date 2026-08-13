import * as functions from 'firebase-functions';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onRequest } from 'firebase-functions/v2/https';
import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { buildPlaidClient } from './lib/plaidClient';
import { SecretProvider } from './ports/SecretProvider';
import { AuditSink } from './ports/AuditSink';
import { IdentityPolicy } from './ports/IdentityPolicy';
import { EncryptionProvider } from './ports/EncryptionProvider';
import { syncTransactionsForItem } from './lib/syncCoordinator';
import { removePlaidItem } from './lib/deletionService';
import { verifyPlaidWebhook } from './lib/webhookVerification';
import {
  plaidItemDoc,
  plaidItemsCollection,
  plaidTransactionsCollection,
  PlaidItemDoc
} from './lib/firestoreSchema';
import { reserveUsage } from './lib/usageLimiter';
import { CountryCode, Products } from 'plaid';

export interface PlaidTransactionsModuleConfig {
  db: Firestore;
  secretProvider: SecretProvider;
  encryptionProvider: EncryptionProvider;
  auditSink?: AuditSink;
  identityPolicy: IdentityPolicy;
  webhookUrl: string;
}

export const createPlaidTransactionsModule = (config: PlaidTransactionsModuleConfig) => {
  const { db, secretProvider, encryptionProvider, identityPolicy, webhookUrl } = config;

  // --- Callables ---

  const createLinkToken = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated');
    const uid = request.auth.uid;

    if (!(await identityPolicy.authorize(uid))) {
      throw new HttpsError('permission-denied', 'Unauthorized access');
    }

    // Usage limiting
    const windowKey = new Date().toISOString().slice(0, 10);
    const reservation = await reserveUsage(db, uid, 'PLAID', 'PLAID_LINK_TOKEN_CREATE', 400, windowKey);
    if (!reservation.allowed) throw new HttpsError('resource-exhausted', 'Usage limit reached');

    const plaidClient = await buildPlaidClient(secretProvider);
    try {
      const response = await plaidClient.linkTokenCreate({
        user: { client_user_id: uid },
        client_name: 'WanderBunnies', // Should probably be configurable
        products: [Products.Transactions],
        country_codes: [CountryCode.Us, CountryCode.Ca],
        language: 'en',
        webhook: webhookUrl,
        transactions: {
          days_requested: 90,
        },
      });
      return { linkToken: response.data.link_token };
    } catch (error: any) {
      console.error('[plaid-transactions] Failed to create link token:', error);
      throw new HttpsError('internal', 'Internal error during Plaid Link initialization');
    }
  });

  const exchangePublicToken = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated');
    const uid = request.auth.uid;
    const { publicToken, institutionId, institutionName } = (request.data as any) || {};

    if (!publicToken || !institutionId || !institutionName) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    if (!(await identityPolicy.authorize(uid))) {
      throw new HttpsError('permission-denied', 'Unauthorized access');
    }

    const windowKey = new Date().toISOString().slice(0, 10);
    const reservation = await reserveUsage(db, uid, 'PLAID', 'PLAID_PUBLIC_TOKEN_EXCHANGE', 200, windowKey);
    if (!reservation.allowed) throw new HttpsError('resource-exhausted', 'Usage limit reached');

    const plaidClient = await buildPlaidClient(secretProvider);
    try {
      const response = await plaidClient.itemPublicTokenExchange({ public_token: publicToken });
      const { access_token, item_id } = response.data;

      const { ciphertext, keyVersion } = await encryptionProvider.encrypt(access_token);

      const itemRef = plaidItemDoc(db, uid, item_id);
      await itemRef.set({
        itemId: item_id,
        institutionName,
        institutionId,
        status: 'sync_pending',
        accessTokenEncrypted: ciphertext,
        accessTokenKeyVersion: keyVersion,
        cursor: null,
        syncLeaseUntil: null,
        syncContinuationCount: 0,
        lastSyncedAt: null,
        lastSyncError: null,
        createdAt: FieldValue.serverTimestamp() as any,
        consentGrantedAt: FieldValue.serverTimestamp() as any,
        webhookUrl,
      });

      // Trigger initial sync
      void syncTransactionsForItem(db, plaidClient, uid, item_id, access_token);

      return { itemId: item_id };
    } catch (error: any) {
      console.error('[plaid-transactions] Failed to exchange public token:', error);
      throw new HttpsError('internal', 'Failed to connect bank account');
    }
  });

  const removeItem = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated');
    const uid = request.auth.uid;
    const { itemId } = (request.data as any) || {};

    if (!itemId) throw new HttpsError('invalid-argument', 'Missing itemId');

    const itemRef = plaidItemDoc(db, uid, itemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) throw new HttpsError('not-found', 'Item not found');
    const itemData = itemSnap.data() as PlaidItemDoc;

    const access_token = await encryptionProvider.decrypt(itemData.accessTokenEncrypted, itemData.accessTokenKeyVersion);

    const plaidClient = await buildPlaidClient(secretProvider);
    const result = await removePlaidItem(db, plaidClient, uid, itemId, access_token);
    if (!result.success) throw new HttpsError('internal', result.error || 'Failed to remove item');

    return { success: true };
  });

  const syncNow = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated');
    const uid = request.auth.uid;
    const { itemId } = (request.data as any) || {};

    if (!itemId) throw new HttpsError('invalid-argument', 'Missing itemId');

    const itemRef = plaidItemDoc(db, uid, itemId);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) throw new HttpsError('not-found', 'Item not found');
    const itemData = itemSnap.data() as PlaidItemDoc;

    const access_token = await encryptionProvider.decrypt(itemData.accessTokenEncrypted, itemData.accessTokenKeyVersion);
    const plaidClient = await buildPlaidClient(secretProvider);

    const result = await syncTransactionsForItem(db, plaidClient, uid, itemId, access_token);
    if (!result.success) throw new HttpsError('internal', result.error || 'Sync failed');

    return { success: true, count: result.count };
  });

  // --- Webhook ---

  const plaidWebhook = onRequest(async (req, res) => {
    const plaidClient = await buildPlaidClient(secretProvider);
    const header = req.header('Plaid-Verification');

    if (!header || !(await verifyPlaidWebhook(plaidClient, header, JSON.stringify(req.body)))) {
      console.warn('[plaid-transactions] Invalid webhook signature');
      res.status(403).send('Invalid signature');
      return;
    }

    const { webhook_type, webhook_code, item_id } = req.body;

    // Find the user for this item_id
    // This is a bit tricky with user-isolated collections.
    // In a real reusable module, we might need a global item_id -> uid mapping or search across users.
    // For per-user isolation, a collection group query on 'plaidItems' is needed.
    const itemsSnap = await db.collectionGroup('plaidItems').where('itemId', '==', item_id).limit(1).get();
    if (itemsSnap.empty) {
      console.warn('[plaid-transactions] Webhook for unknown item_id:', item_id);
      res.status(200).send('Unknown item');
      return;
    }

    const itemDoc = itemsSnap.docs[0];
    const uid = itemDoc.ref.parent.parent!.id; // doc is users/{uid}/plaidItems/{itemId}
    const itemData = itemDoc.data() as PlaidItemDoc;

    if (webhook_type === 'TRANSACTIONS' && webhook_code === 'SYNC_UPDATES_AVAILABLE') {
      const access_token = await encryptionProvider.decrypt(itemData.accessTokenEncrypted, itemData.accessTokenKeyVersion);
      void syncTransactionsForItem(db, plaidClient, uid, item_id, access_token);
    } else if (webhook_type === 'ITEM' && (webhook_code === 'USER_PERMISSION_REVOKED' || webhook_code === 'USER_ACCOUNT_REVOKED')) {
      const access_token = await encryptionProvider.decrypt(itemData.accessTokenEncrypted, itemData.accessTokenKeyVersion);
      void removePlaidItem(db, plaidClient, uid, item_id, access_token);
    } else if (webhook_type === 'ITEM' && webhook_code === 'ERROR') {
      await itemDoc.ref.update({ status: 'error', lastSyncError: req.body.error?.error_message || 'Plaid item error' });
    }

    res.status(200).send('OK');
  });

  return {
    createLinkToken,
    exchangePublicToken,
    removeItem,
    syncNow,
    plaidWebhook,
  };
};
