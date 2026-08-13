import { PlaidApi, TransactionsSyncRequest } from 'plaid';
import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { plaidItemDoc, plaidTransactionsCollection, PlaidItemDoc } from './firestoreSchema';
import { reserveUsage } from './usageLimiter';

export interface SyncOptions {
  limit?: number;
  maxContinuations?: number;
}

export const syncTransactionsForItem = async (
  db: Firestore,
  plaidClient: PlaidApi,
  uid: string,
  itemId: string,
  accessToken: string,
  options: SyncOptions = {}
): Promise<{ success: boolean; error?: string; count?: number }> => {
  const itemRef = plaidItemDoc(db, uid, itemId);
  const maxContinuations = options.maxContinuations ?? 3;
  let continuations = 0;
  let totalCount = 0;

  // 1. Acquire lease
  const leaseResult = await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(itemRef);
    if (!doc.exists) return { error: 'Item not found' };
    const data = doc.data() as PlaidItemDoc;
    const now = Date.now();
    if (data.syncLeaseUntil && data.syncLeaseUntil.toMillis() > now) {
      return { error: 'Sync already in progress' };
    }

    const leaseUntil = new Date(now + 60 * 1000); // 1 minute lease
    transaction.update(itemRef, { syncLeaseUntil: leaseUntil });
    return { data };
  });

  if ('error' in leaseResult) return { success: false, error: leaseResult.error };
  const itemData = leaseResult.data!;

  try {
    let cursor = itemData.cursor;
    let hasMore = true;

    while (hasMore && continuations < maxContinuations) {
      // 2. Reserve usage
      const windowKey = new Date().toISOString().slice(0, 10);
      const reservation = await reserveUsage(db, uid, 'PLAID', 'PLAID_TRANSACTIONS_SYNC', 2500, windowKey);
      if (!reservation.allowed) break;

      // 3. Call Plaid
      const request: TransactionsSyncRequest = {
        access_token: accessToken,
        cursor: cursor ?? undefined,
        count: 500,
      };

      const response = await plaidClient.transactionsSync(request);
      const { added, modified, removed, next_cursor, has_more } = response.data;

      const batch = db.batch();
      const transactionsColl = plaidTransactionsCollection(db, uid);

      for (const t of added) {
        batch.set(transactionsColl.doc(t.transaction_id), {
          itemId,
          accountId: t.account_id,
          amount: t.amount,
          isoCurrencyCode: t.iso_currency_code ?? 'USD',
          date: t.date,
          merchantName: t.merchant_name ?? t.name,
          personalFinanceCategory: t.personal_finance_category?.primary ?? null,
          pending: t.pending,
          removed: false,
          consumerLink: null,
          createdAt: FieldValue.serverTimestamp() as any,
          updatedAt: FieldValue.serverTimestamp() as any,
        });
        totalCount++;
      }

      for (const t of modified) {
        batch.update(transactionsColl.doc(t.transaction_id), {
          amount: t.amount,
          pending: t.pending,
          merchantName: t.merchant_name ?? t.name,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      for (const t of removed) {
        batch.update(transactionsColl.doc(t.transaction_id || ''), {
          removed: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      await batch.commit();

      cursor = next_cursor;
      hasMore = has_more;
      continuations++;
    }

    // 4. Update cursor and release lease
    await itemRef.update({
      cursor,
      lastSyncedAt: FieldValue.serverTimestamp(),
      syncLeaseUntil: null,
      syncContinuationCount: continuations,
    });

    return { success: true, count: totalCount };
  } catch (error: any) {
    await itemRef.update({
      syncLeaseUntil: null,
      lastSyncError: error.message,
    });
    return { success: false, error: error.message };
  }
};
