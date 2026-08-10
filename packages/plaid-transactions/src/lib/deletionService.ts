import { PlaidApi } from 'plaid';
import { Firestore } from 'firebase-admin/firestore';
import { plaidItemDoc, plaidTransactionsCollection } from './firestoreSchema';

export const removePlaidItem = async (
  db: Firestore,
  plaidClient: PlaidApi,
  uid: string,
  itemId: string,
  accessToken: string
): Promise<{ success: boolean; error?: string }> => {
  const itemRef = plaidItemDoc(db, uid, itemId);

  try {
    // 1. Mark as deleting in Firestore
    await itemRef.update({ status: 'deleting' });

    // 2. Call Plaid to remove the Item
    await plaidClient.itemRemove({ access_token: accessToken });

    // 3. Delete unconfirmed transactions
    const transactionsSnap = await plaidTransactionsCollection(db, uid)
      .where('itemId', '==', itemId)
      .where('consumerLink', '==', null)
      .get();

    const batch = db.batch();
    transactionsSnap.docs.forEach((doc) => batch.delete(doc.ref));

    // 4. Delete the Item record itself
    batch.delete(itemRef);

    await batch.commit();
    return { success: true };
  } catch (error: any) {
    console.error('[plaid-transactions] Failed to remove item:', error);
    // If Plaid removal failed, we might still want to retry or keep the status as deleting
    await itemRef.update({ status: 'error', lastSyncError: `Removal failed: ${error.message}` });
    return { success: false, error: error.message };
  }
};
