import { Firestore, CollectionReference, DocumentReference } from 'firebase-admin/firestore';

export interface PlaidItemDoc {
  itemId: string; // Stored as field for collection group queries
  institutionName: string;
  institutionId: string;
  status: 'active' | 'sync_pending' | 'error' | 'pending_disconnect' | 'pending_expiration' | 'revoked' | 'deleting';
  accessTokenEncrypted: string;
  accessTokenKeyVersion: string;
  cursor: string | null;
  syncLeaseUntil: FirebaseFirestore.Timestamp | null;
  syncContinuationCount: number;
  lastSyncedAt: FirebaseFirestore.Timestamp | null;
  lastSyncError: string | null;
  createdAt: FirebaseFirestore.Timestamp;
  consentGrantedAt: FirebaseFirestore.Timestamp;
  webhookUrl: string;
}

export interface PlaidTransactionDoc {
  itemId: string;
  accountId: string;
  amount: number;
  isoCurrencyCode: string;
  date: string;
  merchantName: string | null;
  personalFinanceCategory: string | null;
  pending: boolean;
  removed: boolean;
  consumerLink: {
    consumerType: string;
    consumerRecordId: string;
    linkedAt: FirebaseFirestore.Timestamp;
  } | null;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface PlaidUsageCounterDoc {
  count: number;
  limit: number;
}

export const plaidItemsCollection = (db: Firestore, uid: string): CollectionReference<PlaidItemDoc> =>
  db.collection(`users/${uid}/plaidItems`) as CollectionReference<PlaidItemDoc>;

export const plaidItemDoc = (db: Firestore, uid: string, itemId: string): DocumentReference<PlaidItemDoc> =>
  plaidItemsCollection(db, uid).doc(itemId);

export const plaidTransactionsCollection = (db: Firestore, uid: string): CollectionReference<PlaidTransactionDoc> =>
  db.collection(`users/${uid}/plaidTransactions`) as CollectionReference<PlaidTransactionDoc>;

export const plaidTransactionDoc = (db: Firestore, uid: string, transactionId: string): DocumentReference<PlaidTransactionDoc> =>
  plaidTransactionsCollection(db, uid).doc(transactionId);

export const plaidUsageCountersCollection = (db: Firestore, uid: string): CollectionReference<PlaidUsageCounterDoc> =>
  db.collection(`users/${uid}/plaidUsageCounters`) as CollectionReference<PlaidUsageCounterDoc>;

export const plaidUsageCounterDoc = (db: Firestore, uid: string, windowKey: string): DocumentReference<PlaidUsageCounterDoc> =>
  plaidUsageCountersCollection(db, uid).doc(windowKey);
