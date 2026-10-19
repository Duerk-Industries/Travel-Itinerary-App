import { getCurrentDbProvider } from '../db';
import { getDb } from '../db.firebase';
import { queryBlog } from '../db.postgres';
import type { Itinerary } from '../types';
import { PlanningError } from './planningOperations';

const CAP = 5000;
/** Bound the child graph before materializing it. Unchanged bundles never
 * reach this path. The same revision fence covers this inventory and reads. */
export const planningBundleInventory = async (tripId: string, groupId: string): Promise<Itinerary | null> => {
  let total = 0;
  const add = (count: number) => { total += count; if (total > CAP) throw new PlanningError('BUNDLE_TOO_LARGE', 413, 'This trip is too large for a saved bundle'); };
  if (getCurrentDbProvider() === 'firebase') {
    const db = getDb();
    for (const [collection, field, value] of [
      ['flights', 'tripId', tripId], ['lodgings', 'trip_id', tripId], ['tours', 'tripId', tripId], ['car_rentals', 'tripId', tripId],
      ['expenses', 'tripId', tripId], ['trip_payments', 'tripId', tripId], ['group_members', 'groupId', groupId], ['group_invites', 'groupId', groupId],
    ]) add((await db.collection(collection).where(field, '==', value).limit(CAP + 1).count().get()).data().count);
    const latestDoc = (await db.collection('itineraries').where('tripId', '==', tripId).orderBy('createdAt', 'desc').orderBy('__name__', 'desc').limit(1).get()).docs[0];
    if (!latestDoc) return null;
    const latest = { ...latestDoc.data(), id: latestDoc.id } as Itinerary;
    const details = await db.collection('itinerary_details').where('itineraryId', '==', latest.id).select().limit(CAP + 1).get();
    add(details.size);
    for (let index = 0; index < details.docs.length; index += 10) add((await db.collection('itinerary_checklist_items').where('detailId', 'in', details.docs.slice(index, index + 10).map(doc => doc.id)).limit(CAP + 1).count().get()).data().count);
    return latest;
  }
  // Table/column names below are compile-time constants, never request SQL.
  for (const table of ['flights', 'lodgings', 'tours', 'car_rentals', 'expenses', 'trip_payments']) add(Number((await queryBlog(`SELECT COUNT(*) as count FROM ${table} WHERE trip_id=$1`, [tripId])).rows[0].count));
  for (const table of ['group_members', 'group_invites']) add(Number((await queryBlog(`SELECT COUNT(*) as count FROM ${table} WHERE group_id=$1`, [groupId])).rows[0].count));
  const latest = (await queryBlog('SELECT id,trip_id as "tripId",destination,days,budget,plan_markdown as "planMarkdown",created_at as "createdAt" FROM itineraries WHERE trip_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [tripId])).rows[0] as Itinerary | undefined;
  if (!latest) return null;
  add(Number((await queryBlog('SELECT COUNT(*) as count FROM itinerary_details WHERE itinerary_id=$1', [latest.id])).rows[0].count));
  add(Number((await queryBlog('SELECT COUNT(*) as count FROM itinerary_checklist_items c JOIN itinerary_details d ON d.id=c.detail_id WHERE d.itinerary_id=$1', [latest.id])).rows[0].count));
  return latest;
};
