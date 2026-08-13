import { Firestore } from 'firebase-admin/firestore';
import { plaidUsageCounterDoc } from './firestoreSchema';

export interface UsageLimitConfig {
  overall: number;
  // Per-caller limits
  callers: Record<string, number>;
}

export const reserveUsage = async (
  db: Firestore,
  uid: string,
  provider: string,
  caller: string,
  limit: number,
  windowKey: string
): Promise<{ allowed: boolean; current: number }> => {
  const docRef = plaidUsageCounterDoc(db, uid, `${provider}:${caller}:${windowKey}`);

  return db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    const data = doc.data();
    const current = data?.count ?? 0;

    if (current >= limit) {
      return { allowed: false, current };
    }

    const nextCount = current + 1;
    transaction.set(docRef, { count: nextCount, limit }, { merge: true });
    return { allowed: true, current: nextCount };
  });
};
