import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import type { Transaction } from 'firebase-admin/firestore';
import * as pg from '../db.postgres';
import { getDb } from '../db.firebase';
import type { Activity, CatalogActivityResult, PublicActivityCopy, PublicTripInspiration, SharedActivityTemplate, Trip } from '../types';
import { assertDay, canonicalOperationHash, catalogRecord, PlanningError, replay, reusableCatalogPlace } from './planningOperations';
import { estimateAttractionDurationMinutes } from './attractionDurationEstimationService';

type Source = { trip: Pick<Trip, 'destination' | 'locationIds'>; shared: boolean; public: boolean; inspiration: PublicTripInspiration };
const unavailable = () => new PlanningError('SOURCE_UNAVAILABLE', 409, 'This trip is no longer sharing activities. Refresh Trips like this.');
const forbidden = () => new PlanningError('TRIP_FORBIDDEN', 403, 'You no longer have access to this trip.');
const sourcePath = (username: string, tripSlug: string) => `/${encodeURIComponent(username)}/${encodeURIComponent(tripSlug)}`;
const sameDestination = (a: Source['trip'], b: Source['trip']) => {
  const normalize = (value: string | null | undefined) => (value ?? '').trim().toLocaleLowerCase();
  const ids = new Set(a.locationIds ?? []);
  return Boolean(normalize(a.destination) && normalize(a.destination) === normalize(b.destination))
    || (b.locationIds ?? []).some(id => ids.has(id));
};
function template(id: string, row: { id: string; name: string; payload?: unknown }): SharedActivityTemplate | null {
  const place = catalogRecord(row);
  if (!reusableCatalogPlace(place)) return null;
  // Names, category and coordinates come from the approved public catalog, never a private edit/address.
  return { id, catalogId: place.id, name: place.name, activityType: place.activityType,
    duration: `${estimateAttractionDurationMinutes(place.name, place.activityType)} min`, lat: place.lat!, lng: place.lon!, sourceUrl: place.sourceUrl! };
}

async function loadPg(client: PoolClient, tripId: string, publicOnly = false, target?: Source['trip']): Promise<Source | null> {
  const blog = (await client.query('SELECT * FROM trip_blogs WHERE trip_id=$1 FOR SHARE', [tripId])).rows[0];
  if (!blog) return null;
  const [tripResult, epochResult, aliasResult] = await Promise.all([
    client.query('SELECT destination,location_ids AS "locationIds" FROM trips WHERE id=$1 FOR SHARE', [tripId]),
    client.query('SELECT state FROM blog_publication_epochs WHERE trip_id=$1 AND epoch=$2 FOR SHARE', [tripId, Number(blog.visibility_epoch)]),
    client.query('SELECT username_slug,trip_slug FROM blog_public_aliases WHERE trip_id=$1 AND canonical=TRUE LIMIT 1 FOR SHARE', [tripId]),
  ]);
  const alias = aliasResult.rows[0];
  const isPublic = blog.visibility_state === 'public' && epochResult.rows[0]?.state === 'public' && blog.indexing_enabled === true && Boolean(alias);
  if (publicOnly && (!isPublic || blog.activity_sharing_enabled !== true || (target && !sameDestination(target, tripResult.rows[0] ?? {})))) return null;
  const activityResult = await client.query('SELECT id,catalog_id FROM tours WHERE trip_id=$1 ORDER BY id LIMIT 100 FOR SHARE', [tripId]);
  const activities: SharedActivityTemplate[] = [];
  for (const activity of activityResult.rows) {
    if (!activity.catalog_id) continue;
    const row = (await client.query("SELECT id,name,payload FROM locations WHERE id=$1 AND source_type='attraction' FOR SHARE", [activity.catalog_id])).rows[0];
    const item = row && template(activity.id, row);
    if (item) activities.push(item);
  }
  return { trip: tripResult.rows[0] ?? {}, shared: blog.activity_sharing_enabled === true,
    public: blog.visibility_state === 'public' && epochResult.rows[0]?.state === 'public' && blog.indexing_enabled === true && Boolean(alias),
    inspiration: { username: alias?.username_slug ?? '', tripSlug: alias?.trip_slug ?? '', title: String(blog.title || 'Shared trip'),
      sourcePath: alias ? sourcePath(alias.username_slug, alias.trip_slug) : '', activities } };
}

async function loadFs(tx: Transaction, tripId: string, publicOnly = false, target?: Source['trip']): Promise<Source | null> {
  const db = getDb();
  const blogDoc = await tx.get(db.collection('trip_blogs').doc(tripId));
  const blog = blogDoc.data(); if (!blog) return null;
  const [trip, epochs, aliases] = await Promise.all([
    tx.get(db.collection('trips').doc(tripId)),
    tx.get(db.collection('blog_publication_epochs').where('tripId', '==', tripId).where('epoch', '==', Number(blog.visibilityEpoch ?? 0)).limit(1)),
    tx.get(db.collection('blog_public_aliases').where('tripId', '==', tripId).where('canonical', '==', true).limit(1)),
  ]);
  const isPublic = trip.exists && blog.visibilityState === 'public' && epochs.docs[0]?.data().state === 'public' && blog.indexingEnabled === true && !aliases.empty;
  if (publicOnly && (!isPublic || blog.activitySharingEnabled !== true || (target && !sameDestination(target, trip.data() ?? {})))) return null;
  const activities = await tx.get(db.collection('tours').where('tripId', '==', tripId).orderBy('__name__').limit(100));
  const alias = aliases.docs[0]?.data(); const templates: SharedActivityTemplate[] = [];
  for (const activity of activities.docs) {
    const catalogId: unknown = activity.data().catalogId;
    if (typeof catalogId !== 'string' || !catalogId || catalogId.includes('/')) continue;
    const place = await tx.get(db.collection('locations').doc(catalogId));
    const data = place.data();
    const item = data?.sourceType === 'attraction' ? template(activity.id, { id: place.id, name: String(data.name), payload: data.payload }) : null;
    if (item) templates.push(item);
  }
  return { trip: trip.data() ?? {}, shared: blog.activitySharingEnabled === true,
    public: trip.exists && blog.visibilityState === 'public' && epochs.docs[0]?.data().state === 'public' && blog.indexingEnabled === true && Boolean(alias),
    inspiration: { username: alias?.usernameSlug ?? '', tripSlug: alias?.tripSlug ?? '', title: String(blog.title || 'Shared trip'),
      sourcePath: alias ? sourcePath(alias.usernameSlug, alias.tripSlug) : '', activities: templates } };
}

export const getActivitySharingPostgres = async (userId: string, tripId: string) => pg.withPlanningTransaction(async client => {
  if (!await pg.ensureUserInTrip(tripId, userId)) throw forbidden();
  const source = await loadPg(client, tripId);
  return { enabled: source?.shared ?? false, activities: source?.inspiration.activities ?? [] };
});
export const getActivitySharingFirebase = async (userId: string, tripId: string) => getDb().runTransaction(async tx => {
  const access = await tx.get(getDb().collection('trip_access').doc(`${tripId}_${userId}`));
  if (access.data()?.status !== 'active' || access.data()?.canWrite !== true) throw forbidden();
  const source = await loadFs(tx, tripId);
  return { enabled: source?.shared ?? false, activities: source?.inspiration.activities ?? [] };
});
export const setActivitySharingPostgres = async (userId: string, tripId: string, enabled: boolean) => pg.withPlanningTransaction(async client => {
  await client.query('SELECT id FROM trips WHERE id=$1 FOR SHARE', [tripId]);
  await client.query('SELECT gm.id FROM group_members gm JOIN trips t ON t.group_id=gm.group_id WHERE t.id=$1 AND gm.user_id=$2 AND gm.removed_at IS NULL FOR SHARE', [tripId, userId]);
  if (!await pg.ensureUserInTrip(tripId, userId)) throw forbidden();
  const result = await client.query('UPDATE trip_blogs SET activity_sharing_enabled=$2 WHERE trip_id=$1 RETURNING trip_id', [tripId, enabled]);
  if (!result.rows.length) throw unavailable();
  return { enabled };
});
export const setActivitySharingFirebase = async (userId: string, tripId: string, enabled: boolean) => getDb().runTransaction(async tx => {
  const db = getDb();
  const [access, blog] = await Promise.all([tx.get(db.collection('trip_access').doc(`${tripId}_${userId}`)), tx.get(db.collection('trip_blogs').doc(tripId))]);
  if (access.data()?.status !== 'active' || access.data()?.canWrite !== true) throw forbidden();
  if (!blog.exists) throw unavailable();
  tx.update(blog.ref, { activitySharingEnabled: enabled }); return { enabled };
});

export const listSimilarTripsPostgres = async (userId: string, tripId: string): Promise<PublicTripInspiration[]> => pg.withPlanningTransaction(async client => {
  if (!await pg.ensureUserInTrip(tripId, userId)) throw forbidden();
  const target = await pg.getTripById(tripId); if (!target) throw forbidden();
  const blogs = await client.query('SELECT trip_id FROM trip_blogs WHERE activity_sharing_enabled=TRUE ORDER BY updated_at DESC LIMIT 50');
  const result: PublicTripInspiration[] = [];
  for (const blog of blogs.rows) {
    if (blog.trip_id === tripId) continue;
    const source = await loadPg(client, blog.trip_id, true, target);
    if (source?.public && source.shared && sameDestination(target, source.trip) && source.inspiration.activities.length) result.push(source.inspiration);
    if (result.length === 6) break;
  }
  return result;
});
export const listSimilarTripsFirebase = async (userId: string, tripId: string): Promise<PublicTripInspiration[]> => getDb().runTransaction(async tx => {
  const db = getDb();
  const [access, target, blogs] = await Promise.all([tx.get(db.collection('trip_access').doc(`${tripId}_${userId}`)), tx.get(db.collection('trips').doc(tripId)),
    tx.get(db.collection('trip_blogs').where('activitySharingEnabled', '==', true).limit(50))]);
  if (access.data()?.status !== 'active' || access.data()?.canWrite !== true || !target.exists) throw forbidden();
  const result: PublicTripInspiration[] = [];
  for (const blog of blogs.docs) {
    const sourceId = String(blog.data().tripId || blog.id); if (sourceId === tripId) continue;
    const source = await loadFs(tx, sourceId, true, target.data()!);
    if (source?.public && source.shared && sameDestination(target.data()!, source.trip) && source.inspiration.activities.length) result.push(source.inspiration);
    if (result.length === 6) break;
  }
  return result;
});

function copiedActivity(userId: string, request: PublicActivityCopy, source: Source): Activity {
  const item = source.inspiration.activities.find(a => a.id === request.publicSource.activityId);
  if (!source.public || !source.shared || !item) throw unavailable();
  return { id: randomUUID(), userId, tripId: request.tripId, date: request.date, createdAt: new Date().toISOString(),
    name: item.name, activityType: item.activityType, duration: item.duration, lat: item.lat, lng: item.lng, coordinateSource: 'catalog', catalogId: item.catalogId,
    status: 'Proposed', startLocation: item.name, startTime: '', cost: 0, bookedOn: '', reference: '', paidBy: [], travelerIds: [],
    notes: `Inspired by ${source.inspiration.title}\n${source.inspiration.sourcePath}${item.sourceUrl ? `\nCatalog source: ${item.sourceUrl}` : ''}` };
}
const requestHash = (r: PublicActivityCopy) => canonicalOperationHash({ tripId: r.tripId, date: r.date, publicSource: r.publicSource });
export const copyPublicActivityPostgres = async (userId: string, request: PublicActivityCopy): Promise<CatalogActivityResult> => pg.withPlanningTransaction(async client => {
  await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
  await client.query('SELECT id FROM trips WHERE id=$1 FOR UPDATE', [request.tripId]);
  await client.query('SELECT gm.id FROM group_members gm JOIN trips t ON t.group_id=gm.group_id WHERE t.id=$1 AND gm.user_id=$2 AND gm.removed_at IS NULL FOR SHARE', [request.tripId, userId]);
  if (!await pg.ensureUserInTrip(request.tripId, userId)) throw forbidden();
  const alias = (await client.query('SELECT trip_id FROM blog_public_aliases WHERE username_slug=$1 AND trip_slug=$2 AND canonical=TRUE FOR SHARE', [request.publicSource.username, request.publicSource.tripSlug])).rows[0];
  const source = alias && await loadPg(client, alias.trip_id, true);
  if (!source) throw unavailable();
  const activity = copiedActivity(userId, request, source);
  const trip = await pg.getTripById(request.tripId); if (!trip) throw forbidden(); assertDay(request.date, trip);
  const old = (await client.query('SELECT request_hash,response_body FROM operation_receipts WHERE user_id=$1 AND operation_key=$2', [userId, request.operationKey])).rows[0];
  if (old) return replay(requestHash(request), old.request_hash, old.response_body);
  const existing = await client.query('SELECT id FROM tours WHERE trip_id=$1 AND date=$2::date AND catalog_id=$3 LIMIT 1', [request.tripId, request.date, activity.catalogId]);
  if (existing.rows.length) throw new PlanningError('ACTIVITY_EXISTS', 409, 'This activity is already on this day.');
  const created = await pg.insertActivity(activity);
  await client.query("UPDATE tours SET lat=$2,lng=$3,coordinate_source='catalog',catalog_id=$4 WHERE id=$1", [created.id, activity.lat, activity.lng, activity.catalogId]);
  const result = { activity: { ...created, ...activity, id: created.id }, replayed: false };
  await client.query("INSERT INTO operation_receipts(user_id,operation_key,kind,request_hash,response_body,expires_at) VALUES($1,$2,'activity.copy',$3,$4,$5)",
    [userId, request.operationKey, requestHash(request), JSON.stringify({ activity: result.activity }), new Date(Date.now() + 30 * 86400_000)]);
  return result;
});
export const copyPublicActivityFirebase = async (userId: string, request: PublicActivityCopy): Promise<CatalogActivityResult> => getDb().runTransaction(async tx => {
  const db = getDb(); const receipt = db.collection('operation_receipts').doc(canonicalOperationHash([userId, request.operationKey]));
  const [access, target, old, aliases] = await Promise.all([tx.get(db.collection('trip_access').doc(`${request.tripId}_${userId}`)), tx.get(db.collection('trips').doc(request.tripId)), tx.get(receipt),
    tx.get(db.collection('blog_public_aliases').where('usernameSlug', '==', request.publicSource.username).where('tripSlug', '==', request.publicSource.tripSlug).where('canonical', '==', true).limit(1))]);
  if (access.data()?.status !== 'active' || access.data()?.canWrite !== true || !target.exists) throw forbidden();
  const sourceId = aliases.docs[0]?.data().tripId;
  const source = sourceId ? await loadFs(tx, String(sourceId), true) : null; if (!source) throw unavailable();
  const activity = copiedActivity(userId, request, source); assertDay(request.date, target.data()!);
  if (old.exists) return replay(requestHash(request), old.data()!.requestHash, old.data()!.response);
  const existing = await tx.get(db.collection('tours').where('tripId', '==', request.tripId).where('date', '==', request.date).where('catalogId', '==', activity.catalogId).limit(1));
  if (!existing.empty) throw new PlanningError('ACTIVITY_EXISTS', 409, 'This activity is already on this day.');
  tx.create(db.collection('tours').doc(activity.id), activity);
  tx.create(db.collection('trip_activity').doc(randomUUID()), { tripId: request.tripId, actorUserId: userId, type: 'TOUR_ADDED', title: 'Activity copied', summary: activity.name, metadata: { activityId: activity.id }, createdAt: activity.createdAt });
  tx.create(receipt, { userId, operationKey: request.operationKey, kind: 'activity.copy', requestHash: requestHash(request), response: { activity }, createdAt: activity.createdAt, expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() });
  return { activity, replayed: false };
});
