import { getDb } from '../db.firebase';
import type { TripMoneyMetadata } from '../types';

export const getTripMoneyMetadata = async (kind: TripMoneyMetadata['recordType'], ids: string[]): Promise<TripMoneyMetadata[]> => {
  const rows: TripMoneyMetadata[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const docs = await getDb().getAll(...ids.slice(i, i + 200).map(id => getDb().collection('trip_money_metadata').doc(`${kind}_${id}`)));
    for (const doc of docs) if (doc.exists) rows.push(doc.data() as TripMoneyMetadata);
  }
  return rows;
};
export const saveTripMoneyMetadata = async (rows: TripMoneyMetadata[]): Promise<void> => {
  for (let i = 0; i < rows.length; i += 200) {
    const batch = getDb().batch();
    for (const row of rows.slice(i, i + 200)) batch.set(getDb().collection('trip_money_metadata').doc(`${row.recordType}_${row.recordId}`), row);
    await batch.commit();
  }
};
export const getLastExpenseCurrency = async (userId: string, tripId: string): Promise<string | null> => (await getDb().collection('trip_expense_preferences').doc(`${tripId}_${userId}`).get()).data()?.currency ?? null;
export const setLastExpenseCurrency = async (userId: string, tripId: string, currency: string): Promise<void> => { await getDb().collection('trip_expense_preferences').doc(`${tripId}_${userId}`).set({ userId, tripId, currency }); };
