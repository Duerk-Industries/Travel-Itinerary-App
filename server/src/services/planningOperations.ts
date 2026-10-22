import { createHash, randomUUID } from 'crypto';
import type { Activity, AttractionCatalogEntry, CatalogActivityCreate, CatalogActivityResult } from '../types';
import * as postgres from '../db.postgres';
import { getDb } from '../db.firebase';
import { estimateAttractionDurationMinutes } from './attractionDurationEstimationService';

export class PlanningError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export const canonicalOperationHash = (value: unknown): string => {
  const canonical = (input: unknown): unknown => Array.isArray(input) ? input.map(canonical)
    : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : input;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
};
export const reusableCatalogPlace = (entry: AttractionCatalogEntry): boolean => {
  if (typeof entry.lat !== 'number' || typeof entry.lon !== 'number' || !Number.isFinite(entry.lat) || !Number.isFinite(entry.lon)
    || Math.abs(entry.lat) > 90 || Math.abs(entry.lon) > 180) return false;
  try {
    const url = new URL(entry.sourceUrl || '');
    return url.protocol === 'https:' && /(^|\.)(wikipedia\.org|wikidata\.org|wikivoyage\.org|openstreetmap\.org)$/.test(url.hostname);
  } catch { return false; }
};
export const catalogRecord = (row: { id: string; name: string; payload?: unknown; updatedAt?: string }): AttractionCatalogEntry => ({
  ...(row.payload as AttractionCatalogEntry), id: row.id, name: row.name, updatedAt: row.updatedAt || '',
});
export const assertDay = (date: string, trip: { startDate?: string | null; endDate?: string | null }): void => {
  if (!Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
    || (trip.startDate && date < new Date(trip.startDate).toISOString().slice(0, 10)) || (trip.endDate && date > new Date(trip.endDate).toISOString().slice(0, 10))) {
    throw new PlanningError('INVALID_DAY', 422, 'Choose a day within this trip.');
  }
};
export const activityFor = (userId: string, request: CatalogActivityCreate, place: AttractionCatalogEntry): Omit<Activity, 'id' | 'createdAt'> => ({
  userId, tripId: request.tripId, date: request.date, status: 'Proposed', name: place.name,
  activityType: place.activityType, startLocation: place.name, startTime: '',
  duration: `${estimateAttractionDurationMinutes(place.name, place.activityType)} min`, cost: 0,
  bookedOn: '', reference: '', notes: [place.snippet || '', place.sourceUrl || ''].filter(Boolean).join('\n'),
  paidBy: [], travelerIds: [], lat: place.lat, lng: place.lon, coordinateSource: 'catalog',
  geoCity: place.destinationDisplayName, catalogId: place.id,
});
type StoredOperation = { activity: Activity; undone?: boolean };
export const replay = (hash: string, storedHash: string, result: StoredOperation): CatalogActivityResult => {
  if (hash !== storedHash) throw new PlanningError('IDEMPOTENCY_CONFLICT', 409, 'This request was already used for a different activity.');
  if (result.undone) throw new PlanningError('OPERATION_UNDONE', 409, 'This addition was undone. Add it again with a new request.');
  return { activity: result.activity, replayed: true };
};
const projection = (activity: Activity): unknown => ({
  id: activity.id, tripId: activity.tripId, name: activity.name, date: activity.date,
  status: activity.status, startLocation: activity.startLocation, startTime: activity.startTime,
  cost: Number(activity.cost), duration: activity.duration, notes: activity.notes || '',
  paidBy: activity.paidBy || [], travelerIds: activity.travelerIds || [], reference: activity.reference,
  lat: activity.lat ?? null, lng: activity.lng ?? null, coordinateSource: activity.coordinateSource ?? null, catalogId: activity.catalogId ?? null, dayPosition: activity.dayPosition ?? null, dayOrderPinned: activity.dayOrderPinned ?? false,
  activityType: activity.activityType, bookedOn: activity.bookedOn, freeCancelBy: activity.freeCancelBy || null,
});

export const createCatalogActivityPostgres = async (userId: string, request: CatalogActivityCreate): Promise<CatalogActivityResult> => postgres.withPlanningTransaction(async client => {
  // Per-user lock serializes identical keys and ensures permission is rechecked
  // before returning a replay. Domain write and response receipt share commit.
  await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
  await client.query('SELECT id FROM trips WHERE id=$1 FOR SHARE', [request.tripId]);
  await client.query('SELECT gm.id FROM group_members gm JOIN trips t ON t.group_id=gm.group_id WHERE t.id=$1 AND gm.user_id=$2 AND gm.removed_at IS NULL FOR SHARE', [request.tripId,userId]);
  if (!(await postgres.ensureUserInTrip(request.tripId, userId))) throw new PlanningError('TRIP_FORBIDDEN', 403, 'You no longer have access to this trip.');
  const hash = canonicalOperationHash({ tripId: request.tripId, date: request.date, catalogId: request.catalogId });
  const old = await client.query<{ request_hash: string; response_body: StoredOperation }>('SELECT request_hash,response_body FROM operation_receipts WHERE user_id=$1 AND operation_key=$2', [userId, request.operationKey]);
  if (old.rows[0]) return replay(hash, old.rows[0].request_hash, old.rows[0].response_body);
  const trip = await postgres.getTripById(request.tripId);
  if (!trip) throw new PlanningError('TRIP_FORBIDDEN', 403, 'Trip unavailable.');
  assertDay(request.date, trip);
  const { rows } = await client.query('SELECT id,name,payload FROM locations WHERE id=$1 AND source_type=\'attraction\' FOR SHARE', [request.catalogId]);
  const place = rows[0] ? catalogRecord(rows[0]) : null;
  if (!place || !reusableCatalogPlace(place)) throw new PlanningError('PLACE_UNAVAILABLE', 409, 'This place is no longer available. Refresh Nearby.');
  const base = activityFor(userId, request, place);
  const created = await postgres.insertActivity(base);
  await client.query('UPDATE tours SET lat=$2,lng=$3,geo_city=$4,coordinate_source=$5,catalog_id=$6 WHERE id=$1', [created.id, base.lat, base.lng, base.geoCity, base.coordinateSource, base.catalogId]);
  const activity = { ...created, ...base };
  await client.query(`INSERT INTO operation_receipts (user_id,operation_key,kind,request_hash,response_body,expires_at)
    VALUES ($1,$2,'activity.create',$3,$4,$5)`, [userId, request.operationKey, hash, JSON.stringify({ activity }), new Date(Date.now() + 30 * 86400_000)]);
  return { activity, replayed: false };
});

export const undoCatalogActivityPostgres = async (userId: string, activityId: string, key: string): Promise<boolean> => postgres.withPlanningTransaction(async client => {
  const { rows } = await client.query<{ response_body: StoredOperation }>('SELECT response_body FROM operation_receipts WHERE user_id=$1 AND operation_key=$2 FOR UPDATE', [userId, key]);
  const saved = rows[0]?.response_body;
  if (!saved || saved.activity.id !== activityId) throw new PlanningError('OPERATION_NOT_FOUND', 404, 'Addition not found.');
  if (!(await postgres.ensureUserInTrip(saved.activity.tripId, userId))) throw new PlanningError('TRIP_FORBIDDEN', 403, 'You no longer have access to this trip.');
  if (saved.undone) return true;
  await client.query('SELECT id FROM tours WHERE id=$1 FOR UPDATE', [activityId]);
  const current = await postgres.getActivityById(activityId);
  if (!current || canonicalOperationHash(projection(current)) !== canonicalOperationHash(projection(saved.activity))) throw new PlanningError('ACTIVITY_CHANGED', 409, 'This activity has changed. Open it to review before deleting.');
  if ((await client.query('SELECT id FROM expenses WHERE source_id=$1 LIMIT 1', [activityId])).rows.length || (await client.query('SELECT id FROM item_votes WHERE item_id=$1 LIMIT 1', [activityId])).rows.length) throw new PlanningError('ACTIVITY_CHANGED', 409, 'This activity has shared changes. Open it to review before deleting.');
  await client.query('DELETE FROM tours WHERE id=$1', [activityId]);
  await client.query('UPDATE operation_receipts SET response_body=$3 WHERE user_id=$1 AND operation_key=$2', [userId, key, JSON.stringify({ ...saved, undone: true })]);
  return true;
});

export const createCatalogActivityFirebase = async (userId: string, request: CatalogActivityCreate): Promise<CatalogActivityResult> => {
  const db = getDb(); const hash = canonicalOperationHash({ tripId: request.tripId, date: request.date, catalogId: request.catalogId });
  const receipt = db.collection('operation_receipts').doc(canonicalOperationHash([userId, request.operationKey]));
  return db.runTransaction(async tx => {
    const [access, tripDoc, old, placeDoc] = await Promise.all([
      tx.get(db.collection('trip_access').doc(`${request.tripId}_${userId}`)), tx.get(db.collection('trips').doc(request.tripId)),
      tx.get(receipt), tx.get(db.collection('locations').doc(request.catalogId)),
    ]);
    if (access.data()?.status !== 'active' || access.data()?.canWrite !== true || !tripDoc.exists) throw new PlanningError('TRIP_FORBIDDEN', 403, 'You no longer have access to this trip.');
    if (old.exists) return replay(hash, String(old.data()!.requestHash), old.data()!.response as StoredOperation);
    assertDay(request.date, tripDoc.data()!);
    const data = placeDoc.data();
    const place = data?.sourceType === 'attraction' ? catalogRecord({ id: placeDoc.id, name: data.name, payload: data.payload }) : null;
    if (!place || !reusableCatalogPlace(place)) throw new PlanningError('PLACE_UNAVAILABLE', 409, 'This place is no longer available. Refresh Nearby.');
    const activity: Activity = { ...activityFor(userId, request, place), id: randomUUID(), createdAt: new Date().toISOString() };
    tx.create(db.collection('tours').doc(activity.id), activity);
    tx.create(db.collection('trip_activity').doc(randomUUID()), {
      tripId: request.tripId, actorUserId: userId, type: 'TOUR_ADDED', title: 'Activity added', summary: activity.name,
      metadata: { activityId: activity.id }, createdAt: activity.createdAt,
    });
    tx.create(receipt, { userId, operationKey: request.operationKey, kind: 'activity.create', requestHash: hash,
      response: { activity }, createdAt: activity.createdAt, expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() });
    return { activity, replayed: false };
  });
};
export const undoCatalogActivityFirebase = async (userId: string, activityId: string, key: string): Promise<boolean> => {
  const db = getDb(); const ref = db.collection('operation_receipts').doc(canonicalOperationHash([userId, key]));
  return db.runTransaction(async tx => {
    const old = await tx.get(ref); const saved = old.data()?.response as StoredOperation | undefined;
    if (!saved || saved.activity.id !== activityId) throw new PlanningError('OPERATION_NOT_FOUND', 404, 'Addition not found.');
    const [access, current] = await Promise.all([tx.get(db.collection('trip_access').doc(`${saved.activity.tripId}_${userId}`)), tx.get(db.collection('tours').doc(activityId))]);
    if (access.data()?.status !== 'active' || access.data()?.canWrite !== true) throw new PlanningError('TRIP_FORBIDDEN', 403, 'You no longer have access to this trip.');
    if (saved.undone) return true;
    if (!current.exists || canonicalOperationHash(projection(current.data() as Activity)) !== canonicalOperationHash(projection(saved.activity))) throw new PlanningError('ACTIVITY_CHANGED', 409, 'This activity has changed. Open it to review before deleting.');
    const linked = await tx.get(db.collection('expenses').where('sourceId', '==', activityId).limit(1));
    const votes = await tx.get(db.collection('item_votes').where('itemId', '==', activityId).limit(1));
    if (!linked.empty || !votes.empty) throw new PlanningError('ACTIVITY_CHANGED', 409, 'This activity has shared changes. Open it to review before deleting.');
    tx.delete(current.ref); tx.update(ref, { response: { ...saved, undone: true } }); return true;
  });
};
