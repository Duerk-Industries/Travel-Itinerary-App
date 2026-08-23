import { createHash, randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getDb, ensureUserCanReadTrip, ensureUserInTrip } from '../db.firebase';
import { fetchOverviewWeather } from '../apis/openMeteoWeatherApi';
import { BlogAudience, BlogCapabilities, BlogDocument, BlogDay, BlogTextInput, BlogTextItem, BlogTextPatch, BlogActivity, BlogGalleryItem } from './types';
import { getCanonicalPublicPathFirebase } from './firebasePublicationRepository';
import { buildNarrativeBlogBody } from './narrative';
import { logError } from '../logger';
import { markSynced, shouldSkipSync } from './syncCoordination';

const nowIso = () => new Date().toISOString();
const dateString = (value: unknown): string => new Date(String(value)).toISOString().slice(0, 10);
const idForMutation = (userId: string, key?: string | null): string => {
  if (!key) return randomUUID();
  const hex = createHash('sha256').update(`blog-text:${userId}:${key}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const ensureBlog = async (tripId: string): Promise<any> => {
  const db = getDb();
  const ref = db.collection('trip_blogs').doc(tripId);
  const snapshot = await ref.get();
  if (snapshot.exists) return { id: ref.id, ...(snapshot.data() as any) };
  const trip = await db.collection('trips').doc(tripId).get();
  if (!trip.exists) throw new Error('Trip not found');
  const data = { tripId, title: String((trip.data() as any)?.name ?? 'Trip Blog'), subtitle: null, introduction: null, contentRevision: 0, visibilityState: 'private', visibilityEpoch: 0, createdAt: nowIso(), updatedAt: nowIso() };
  await ref.set(data);
  return { id: ref.id, ...data };
};

const ensureDays = async (tripId: string): Promise<void> => {
  const db = getDb();
  const trip = await db.collection('trips').doc(tripId).get();
  if (!trip.exists) throw new Error('Trip not found');
  const data = trip.data() as any;
  let start = data.startDate ? dateString(data.startDate) : '';
  let end = data.endDate ? dateString(data.endDate) : '';
  if (!start || !end) {
    const activitySnap = await db.collection('tours').where('tripId', '==', tripId).get();
    const dates = activitySnap.docs.map((doc) => (doc.data() as any).date ? dateString((doc.data() as any).date) : '').filter(Boolean).sort();
    if (!start && dates.length) start = dates[0];
    if (!end && dates.length) end = dates[dates.length - 1];
  }
  start = start || dateString(new Date());
  end = end || start;
  const existing = await db.collection('blog_days').where('tripId', '==', tripId).get();
  const known = new Set(existing.docs.map((doc) => String((doc.data() as any).localDate)));
  for (let cursor = new Date(`${start}T00:00:00.000Z`); cursor <= new Date(`${end}T00:00:00.000Z`); cursor = new Date(cursor.getTime() + 86_400_000)) {
    const localDate = cursor.toISOString().slice(0, 10);
    if (known.has(localDate)) continue;
    await db.collection('blog_days').add({ tripId, localDate, headline: null, summary: null, updateVersion: 1, createdAt: nowIso(), updatedAt: nowIso() });
  }
};

const mapItem = (doc: any): BlogTextItem => {
  const data = doc.data ? doc.data() : doc;
  return { id: String(doc.id ?? data.id), tripId: String(data.tripId), blogDayId: String(data.blogDayId), localDate: String(data.localDate), kindKey: 'core.text', schemaVersion: Number(data.schemaVersion ?? 1), audience: data.audience ?? 'public', sortKey: String(data.sortKey), authorUserId: String(data.authorUserId), lastEditorUserId: String(data.lastEditorUserId), version: Number(data.version ?? 1), body: String(data.body ?? ''), languageTag: data.languageTag ?? null, createdAt: String(data.createdAt), updatedAt: String(data.updatedAt), sourceType: data.sourceType ?? null, sourceId: data.sourceId ?? null, sourceDetached: Boolean(data.sourceDetached) };
};

const linkedSourceBody = (data: any): string => buildNarrativeBlogBody({
  activity: data.activity,
  kind: data.kind,
  noteBody: data.noteBody,
});

// Processes one itinerary_details doc's blog link independently of every other one, so
// the caller runs these concurrently via Promise.all instead of one Firestore round-trip
// at a time. contentRevision now uses FieldValue.increment (atomic on Firestore's side)
// instead of the previous read-current-value-then-add-1 — that pattern is a real lost-update
// race under concurrent writers (two parallel bumps can both read the same starting value),
// and increment also removes a read (the old code re-ran ensureBlog for every changed item
// just to get the current count; getBlog already calls ensureBlog once before sync runs, so
// the trip_blogs doc is guaranteed to already exist here).
const syncOneItineraryDetail = async (
  detail: FirebaseFirestore.QueryDocumentSnapshot,
  tripId: string,
  userId: string,
  days: Array<{ id: string; localDate: string }>,
  sourceIds: Set<string>
): Promise<void> => {
  const db = getDb();
  const data = detail.data() as any;
  if (data.kind !== 'note' && data.kind !== 'place') return;
  sourceIds.add(detail.id);
  const body = linkedSourceBody(data);
  if (!body.trim()) return;
  const day = days[Math.max(0, Number(data.day ?? 1) - 1)] ?? days[0];
  if (!day) return;
  const snapshot = { body, day: Number(data.day ?? 1), activity: String(data.activity ?? ''), kind: String(data.kind), placeId: data.placeId ?? null, noteBody: data.noteBody ?? null };
  const linkRef = db.collection('blog_item_source_links').doc(`itinerary_detail_${detail.id}`);
  const link = await linkRef.get();
  if (!link.exists) {
    const itemId = randomUUID();
    const now = nowIso();
    const item = { id: itemId, tripId, blogDayId: day.id, localDate: String(day.localDate), kindKey: 'core.text', schemaVersion: 1, audience: 'public', sortKey: `${Date.now().toString().padStart(16, '0')}-${itemId}`, authorUserId: userId, lastEditorUserId: userId, version: 1, body, languageTag: null, sourceType: 'itinerary_detail', sourceId: detail.id, sourceDetached: false, createdAt: now, updatedAt: now, deletedAt: null };
    await Promise.all([
      db.collection('blog_items').doc(itemId).set(item),
      linkRef.set({ itemId, sourceType: 'itinerary_detail', sourceId: detail.id, sourceSnapshot: snapshot, detached: false, createdAt: now, updatedAt: now }),
      db.collection('trip_blogs').doc(tripId).set({ contentRevision: FieldValue.increment(1), updatedAt: now }, { merge: true }),
    ]);
    return;
  }
  const linkData = link.data() as any;
  if (linkData.detached) return;
  if (JSON.stringify(linkData.sourceSnapshot ?? {}) === JSON.stringify(snapshot)) return;
  const itemRef = db.collection('blog_items').doc(String(linkData.itemId));
  const itemSnap = await itemRef.get();
  if (!itemSnap.exists) return;
  const current = itemSnap.data() as any;
  const now = nowIso();
  await Promise.all([
    itemRef.set({ body, blogDayId: day.id, localDate: String(day.localDate), version: Number(current.version ?? 1) + 1, lastEditorUserId: userId, updatedAt: now }, { merge: true }),
    linkRef.set({ sourceSnapshot: snapshot, updatedAt: now }, { merge: true }),
    db.collection('trip_blogs').doc(tripId).set({ contentRevision: FieldValue.increment(1), updatedAt: now }, { merge: true }),
  ]);
};

const syncLinkedItineraryItems = async (tripId: string, userId: string): Promise<void> => {
  const db = getDb();
  const [itinerarySnap, daySnap] = await Promise.all([
    db.collection('itineraries').where('tripId', '==', tripId).get(),
    db.collection('blog_days').where('tripId', '==', tripId).get(),
  ]);
  const days = daySnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) })).sort((a, b) => String(a.localDate).localeCompare(String(b.localDate)));
  const sourceIds = new Set<string>();

  const detailSnapsByItinerary = await Promise.all(
    itinerarySnap.docs.map((itinerary) => db.collection('itinerary_details').where('itineraryId', '==', itinerary.id).get())
  );
  await Promise.all(
    detailSnapsByItinerary.flatMap((detailSnap) =>
      detailSnap.docs.map((detail) => syncOneItineraryDetail(detail, tripId, userId, days, sourceIds))
    )
  );

  const linkedItems = await db.collection('blog_items').where('tripId', '==', tripId).where('sourceType', '==', 'itinerary_detail').get();
  await Promise.all(
    linkedItems.docs.map(async (item) => {
      const data = item.data() as any;
      if (data.sourceId && !sourceIds.has(String(data.sourceId)) && !data.sourceDetached) {
        const linkRef = db.collection('blog_item_source_links').doc(`itinerary_detail_${data.sourceId}`);
        await Promise.all([
          item.ref.set({ sourceDetached: true, updatedAt: nowIso() }, { merge: true }),
          linkRef.set({ detached: true, updatedAt: nowIso() }, { merge: true }),
        ]);
      }
    })
  );
  markSynced(tripId);
};

// Public entry point for the write-path trigger (itineraryDataRoutes.ts,
// itineraryAsyncService.ts) — see the matching export in postgresRepository.ts
// for the full rationale.
export const syncItineraryToBlog = async (tripId: string, userId: string): Promise<void> => {
  try {
    // Unlike getBlog, this can be the *first* thing that ever touches this trip's blog
    // (e.g. AI itinerary generation firing this immediately after trip creation, before
    // the traveler has ever opened the Trip Blog tab) — so trip_blogs/blog_days can't be
    // assumed to exist yet the way getBlog's caller-already-visited-the-tab assumption
    // gets to. Without this, syncOneItineraryDetail's `days[...]` lookup finds nothing,
    // every row hits its `if (!day) return`, and the sync silently links zero items —
    // not an error, just quietly does nothing.
    await ensureBlog(tripId);
    await ensureDays(tripId);
    await syncLinkedItineraryItems(tripId, userId);
  } catch (err) {
    logError(`[blog] background itinerary sync failed for trip ${tripId}`, err);
  }
};

export const getBlog = async (userId: string, tripId: string, options: { date?: string; cursor?: string; limit?: number } = {}): Promise<BlogDocument> => {
  const access = await ensureUserCanReadTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to view this trip');
  const db = getDb();
  const blog = await ensureBlog(tripId);
  await ensureDays(tripId);
  // The write-path trigger (see syncItineraryToBlog) is the primary sync mechanism now;
  // this stays as a defensive fallback for any mutation path that isn't hooked into it,
  // so the read path doesn't need to re-run a full sync on every single GET — skip if one
  // completed recently (see syncCoordination.ts for why this is always safe to skip, never
  // stale: mutations invalidate the debounce window synchronously before returning).
  if (!shouldSkipSync(tripId) && (await ensureUserInTrip(tripId, userId))) {
    await syncLinkedItineraryItems(tripId, userId);
  }

  let query = db.collection('blog_days').where('tripId', '==', tripId);
  if (options.date) {
    query = query.where('localDate', '==', options.date);
  } else if (options.cursor) {
    query = query.where('localDate', '>', options.cursor);
  }
  const limit = Math.min(100, Math.max(1, options.limit ?? 7));
  const daySnap = await query.orderBy('localDate', 'asc').limit(limit).get();

  const itemSnap = await db.collection('blog_items').where('tripId', '==', tripId).get();
  const items = itemSnap.docs
    .filter((doc) => {
      const data = doc.data() as any;
      return data.deletedAt == null && data.kindKey === 'core.text';
    })
    .map(mapItem)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const activitySnap = await db.collection('tours').where('tripId', '==', tripId).get();
  const activitiesByDate = new Map<string, BlogActivity[]>();
  activitySnap.docs.forEach((doc) => {
    const data = doc.data() as any;
    if (!data.date) return;
    const date = dateString(data.date);
    const activity: BlogActivity = { id: doc.id, name: String(data.name ?? 'Activity'), activityType: String(data.activityType ?? 'Tour'), date, startTime: data.startTime == null ? null : String(data.startTime), duration: data.duration == null ? null : String(data.duration), status: data.status == null ? null : String(data.status), startLocation: data.startLocation == null ? null : String(data.startLocation), notes: data.notes == null ? null : String(data.notes) };
    activitiesByDate.set(date, [...(activitiesByDate.get(date) ?? []), activity]);
  });

  // Weather Badge Integration
  const weatherRequests = daySnap.docs.map(doc => {
    const data = doc.data() as any;
    return {
      date: String(data.localDate),
      location: data.headline || data.summary || 'Destination'
    };
  }).filter(r => r.location !== 'Destination');

  if (weatherRequests.length < daySnap.docs.length) {
    const tripSnap = await db.collection('trips').doc(tripId).get();
    const fallbackLocation = String((tripSnap.data() as any)?.name ?? 'Destination');
    daySnap.docs.forEach(doc => {
      const date = String((doc.data() as any).localDate);
      if (!weatherRequests.find(w => w.date === date)) {
        weatherRequests.push({ date, location: fallbackLocation });
      }
    });
  }

  const { weather } = await fetchOverviewWeather(weatherRequests).catch(() => ({ weather: [] }));
  const weatherByDate = new Map(weather.map(w => [w.date, w]));

  const days: BlogDay[] = daySnap.docs.map((doc) => {
    const data = doc.data() as any;
    const date = String(data.localDate);
    const dayWeather = weatherByDate.get(date);
    return {
      id: doc.id,
      tripId,
      localDate: date,
      headline: data.headline ?? null,
      summary: data.summary ?? null,
      coverAssetId: data.coverAssetId ?? null,
      // Existing docs written before this column existed have no `updateVersion` field at all;
      // treat that as version 1, same starting point as a freshly created day (see ensureDays).
      updateVersion: Number(data.updateVersion ?? 1),
      items: items.filter((item) => item.blogDayId === doc.id),
      activities: activitiesByDate.get(date) ?? [],
      weather: dayWeather ? {
        icon: dayWeather.icon,
        description: dayWeather.description,
        temperatureHighC: dayWeather.temperatureHighC
      } : undefined
    };
  }).sort((a, b) => a.localDate.localeCompare(b.localDate));

  return { id: blog.id, tripId, title: blog.title ?? '', subtitle: blog.subtitle ?? null, introduction: blog.introduction ?? null, contentRevision: Number(blog.contentRevision ?? 0), visibilityState: blog.visibilityState ?? 'private', visibilityEpoch: Number(blog.visibilityEpoch ?? 0), photoLocationEnabled: Boolean(blog.photoLocationEnabled), days };
};

export const getBlogCapabilities = async (userId: string, tripId: string, capabilities: BlogCapabilities): Promise<BlogCapabilities> => {
  const access = await ensureUserCanReadTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to view this trip');
  return capabilities;
};

const getDay = async (tripId: string, dayDate: string): Promise<{ id: string; localDate: string }> => {
  await ensureDays(tripId);
  const snap = await getDb().collection('blog_days').where('tripId', '==', tripId).where('localDate', '==', dayDate).limit(1).get();
  if (snap.empty) throw new Error('The selected day is outside the trip range');
  return { id: snap.docs[0].id, localDate: dayDate };
};

export const createBlogTextItem = async (userId: string, tripId: string, input: BlogTextInput): Promise<BlogTextItem> => {
  const access = await ensureUserInTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  if (String(input.body ?? '').length > 100_000) throw new Error('Text block is too large');
  const day = await getDay(tripId, input.dayDate);
  const id = idForMutation(userId, input.idempotencyKey);
  if (input.idempotencyKey) {
    const replay = await getDb().collection('blog_items').doc(id).get();
    if (replay.exists) {
      const data = replay.data() as any;
      if (String(data.tripId) !== tripId || String(data.authorUserId) !== userId) throw new Error('Idempotency key conflict');
      return mapItem(replay);
    }
  }
  const data = { id, tripId, blogDayId: day.id, localDate: day.localDate, kindKey: 'core.text', schemaVersion: 1, audience: input.audience ?? 'public', sortKey: `${Date.now().toString().padStart(16, '0')}-${id}`, authorUserId: userId, lastEditorUserId: userId, version: 1, body: String(input.body ?? ''), languageTag: input.languageTag ?? null, sourceType: input.sourceType ?? null, createdAt: nowIso(), updatedAt: nowIso(), deletedAt: null };
  await getDb().collection('blog_items').doc(id).set(data);
  await getDb().collection('trip_blogs').doc(tripId).set({ contentRevision: (await ensureBlog(tripId)).contentRevision + 1, updatedAt: nowIso() }, { merge: true });
  return mapItem({ id, data: () => data });
};

export const createGalleryItem = async (userId: string, tripId: string, input: { dayDate: string; caption?: string | null; audience?: BlogAudience }): Promise<BlogGalleryItem> => {
  const access = await ensureUserInTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  const day = await getDay(tripId, input.dayDate);
  const id = randomUUID();
  const now = nowIso();
  const data = { id, tripId, blogDayId: day.id, localDate: day.localDate, kindKey: 'core.gallery', schemaVersion: 1, audience: input.audience ?? 'public', sortKey: `${Date.now().toString().padStart(16, '0')}-${id}`, authorUserId: userId, lastEditorUserId: userId, version: 1, caption: input.caption ?? null, createdAt: now, updatedAt: now, deletedAt: null };
  await getDb().collection('blog_items').doc(id).set(data);
  await getDb().collection('trip_blogs').doc(tripId).set({ contentRevision: (await ensureBlog(tripId)).contentRevision + 1, updatedAt: now }, { merge: true });
  return { id, tripId, blogDayId: day.id, localDate: day.localDate, kindKey: 'core.gallery', schemaVersion: 1, audience: data.audience as BlogAudience, sortKey: data.sortKey, authorUserId: userId, lastEditorUserId: userId, version: 1, caption: input.caption ?? null, createdAt: now, updatedAt: now, assets: [] };
};

export const getGalleryItemsMeta = async (tripId: string, itemIds: string[]): Promise<Record<string, { blogDayId: string; sortKey: string; audience: BlogAudience; authorUserId: string; lastEditorUserId: string; version: number; caption: string | null; createdAt: string; updatedAt: string }>> => {
  if (!itemIds.length) return {};
  const docs = await Promise.all(itemIds.map((itemId) => getDb().collection('blog_items').doc(itemId).get()));
  const out: Record<string, any> = {};
  for (const doc of docs) {
    if (!doc.exists) continue;
    const data = doc.data() as any;
    if (String(data.tripId) !== tripId || data.kindKey !== 'core.gallery' || data.deletedAt != null) continue;
    out[doc.id] = { blogDayId: String(data.blogDayId), sortKey: String(data.sortKey), audience: data.audience ?? 'public', authorUserId: String(data.authorUserId), lastEditorUserId: String(data.lastEditorUserId), version: Number(data.version ?? 1), caption: data.caption ?? null, createdAt: String(data.createdAt), updatedAt: String(data.updatedAt) };
  }
  return out;
};

export const updateBlogTextItem = async (userId: string, itemId: string, patch: BlogTextPatch): Promise<BlogTextItem | { conflict: true; latest: BlogTextItem | null } | null> => {
  const ref = getDb().collection('blog_items').doc(itemId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const row = snapshot.data() as any;
  const access = await ensureUserInTrip(String(row.tripId), userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  if (Number(row.version ?? 1) !== patch.version) {
    // See the matching comment in postgresRepository.ts: architecture §5.5 requires the latest
    // authorized state on a conflict, not a bare rejection.
    return { conflict: true, latest: mapItem({ id: itemId, data: () => row }) };
  }
  const update = { body: patch.body === undefined ? row.body : String(patch.body), languageTag: patch.languageTag === undefined ? row.languageTag ?? null : patch.languageTag, audience: patch.audience ?? row.audience ?? 'public', version: Number(row.version ?? 1) + 1, lastEditorUserId: userId, updatedAt: nowIso() };
  await ref.set(update, { merge: true });
  await getDb().collection('blog_item_source_links').where('itemId', '==', itemId).get().then((snap) => Promise.all(snap.docs.map((doc) => doc.ref.set({ detached: true, updatedAt: nowIso() }, { merge: true }))));
  await getDb().collection('trip_blogs').doc(String(row.tripId)).set({ contentRevision: (await ensureBlog(String(row.tripId))).contentRevision + 1, updatedAt: nowIso() }, { merge: true });
  return mapItem({ id: itemId, data: () => ({ ...row, ...update }) });
};

export const deleteBlogItem = async (userId: string, itemId: string, version?: number): Promise<boolean> => {
  const ref = getDb().collection('blog_items').doc(itemId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return false;
  const row = snapshot.data() as any;
  const access = await ensureUserInTrip(String(row.tripId), userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  if (version !== undefined && Number(row.version ?? 1) !== version) return false;
  await ref.set({ deletedAt: nowIso(), version: Number(row.version ?? 1) + 1, lastEditorUserId: userId, updatedAt: nowIso() }, { merge: true });
  await getDb().collection('blog_item_source_links').where('itemId', '==', itemId).get().then((snap) => Promise.all(snap.docs.map((doc) => doc.ref.set({ detached: true, updatedAt: nowIso() }, { merge: true }))));
  return true;
};

export const setDayCover = async (userId: string, tripId: string, dayDate: string, assetId: string | null): Promise<void> => {
  const access = await ensureUserInTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  const day = await getDay(tripId, dayDate);
  if (assetId) {
    // Unlike Postgres, a Firestore blog_media_assets doc already carries its own tripId/dayDate
    // (see blogItemId/dayDate on the doc written by initUpload in firebaseMediaRepository.ts), so
    // this is a direct doc check rather than a join through blog_item_assets/blog_items.
    const snapshot = await getDb().collection('blog_media_assets').doc(assetId).get();
    const data = snapshot.exists ? (snapshot.data() as any) : null;
    if (!data || String(data.tripId) !== tripId || String(data.dayDate) !== dayDate || data.state !== 'ready') {
      throw new Error('That photo or video must belong to this day and be ready before it can be set as the cover');
    }
  }
  await getDb().collection('blog_days').doc(day.id).set({ coverAssetId: assetId, coverSetByUserId: userId, coverSetAt: nowIso(), updatedAt: nowIso() }, { merge: true });
  await getDb().collection('trip_blogs').doc(tripId).set({ contentRevision: (await ensureBlog(tripId)).contentRevision + 1, updatedAt: nowIso() }, { merge: true });
};

// Firestore equivalent of Postgres's conditional cover claim. Reading the day inside the
// transaction prevents simultaneous uploads from both becoming the automatic cover.
export const setDayCoverIfUnset = async (userId: string, tripId: string, dayDate: string, assetId: string): Promise<boolean> => {
  const db = getDb();
  const day = await getDay(tripId, dayDate);
  const assetSnapshot = await db.collection('blog_media_assets').doc(assetId).get();
  const asset = assetSnapshot.exists ? (assetSnapshot.data() as any) : null;
  if (!asset
    || String(asset.uploaderUserId) !== userId
    || String(asset.tripId) !== tripId
    || String(asset.dayDate) !== dayDate
    || asset.mediaKind !== 'photo'
    || asset.state !== 'ready') return false;

  await ensureBlog(tripId);
  const dayRef = db.collection('blog_days').doc(day.id);
  const blogRef = db.collection('trip_blogs').doc(tripId);
  return db.runTransaction(async (transaction) => {
    const daySnapshot = await transaction.get(dayRef);
    if (!daySnapshot.exists) return false;
    const currentDay = daySnapshot.data() as any;
    if (currentDay?.coverAssetId != null || currentDay?.coverSetAt != null) return false;
    const now = nowIso();
    transaction.set(dayRef, { coverAssetId: assetId, coverSetByUserId: userId, coverSetAt: now, updatedAt: now }, { merge: true });
    transaction.set(blogRef, { contentRevision: FieldValue.increment(1), updatedAt: now }, { merge: true });
    return true;
  });
};

// Mirrors mapDayMeta in postgresRepository.ts — a minimal BlogDay projection for the day-meta
// update path, not the full getBlog joins.
const mapDayMeta = (id: string, data: any): BlogDay => ({
  id,
  tripId: String(data.tripId),
  localDate: String(data.localDate),
  headline: data.headline ?? null,
  summary: data.summary ?? null,
  items: [],
  updateVersion: Number(data.updateVersion ?? 1),
});

const MAX_DAY_HEADLINE_LENGTH = 120;
const MAX_DAY_SUMMARY_LENGTH = 500;

export const updateBlogDayMeta = async (
  userId: string,
  tripId: string,
  dayDate: string,
  patch: { headline?: string | null; summary?: string | null; updateVersion: number }
): Promise<BlogDay | { conflict: true; latest: BlogDay | null } | null> => {
  const access = await ensureUserInTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  if (patch.headline != null && patch.headline.length > MAX_DAY_HEADLINE_LENGTH) {
    throw new Error(`Headline must be ${MAX_DAY_HEADLINE_LENGTH} characters or fewer`);
  }
  if (patch.summary != null && patch.summary.length > MAX_DAY_SUMMARY_LENGTH) {
    throw new Error(`Summary must be ${MAX_DAY_SUMMARY_LENGTH} characters or fewer`);
  }
  const day = await getDay(tripId, dayDate);
  const db = getDb();
  const dayRef = db.collection('blog_days').doc(day.id);
  const blogRef = db.collection('trip_blogs').doc(tripId);
  // A transaction, unlike updateBlogTextItem's plain read-then-write above, because Firestore
  // has no SQL-style conditional `WHERE update_version = $n` — the check-and-set has to be done
  // by hand, and only a transaction makes that atomic against a concurrent editor.
  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(dayRef);
    if (!snapshot.exists) return null;
    const current = snapshot.data() as any;
    if (Number(current.updateVersion ?? 1) !== patch.updateVersion) {
      return { conflict: true as const, latest: mapDayMeta(day.id, current) };
    }
    const now = nowIso();
    const next = {
      ...current,
      headline: patch.headline !== undefined ? patch.headline : current.headline ?? null,
      summary: patch.summary !== undefined ? patch.summary : current.summary ?? null,
      updateVersion: Number(current.updateVersion ?? 1) + 1,
      updatedAt: now,
    };
    transaction.set(dayRef, next, { merge: true });
    transaction.set(blogRef, { contentRevision: FieldValue.increment(1), updatedAt: now }, { merge: true });
    return mapDayMeta(day.id, next);
  });
  return result;
};

const MAX_BLOG_TITLE_LENGTH = 200;
const MAX_BLOG_SUBTITLE_LENGTH = 300;
const MAX_BLOG_INTRODUCTION_LENGTH = 5000;

export const updateBlogMeta = async (
  userId: string,
  tripId: string,
  patch: { title?: string; subtitle?: string | null; introduction?: string | null; photoLocationEnabled?: boolean }
): Promise<BlogDocument> => {
  const access = await ensureUserInTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  if (patch.title != null && patch.title.length > MAX_BLOG_TITLE_LENGTH) {
    throw new Error(`Title must be ${MAX_BLOG_TITLE_LENGTH} characters or fewer`);
  }
  if (patch.subtitle != null && patch.subtitle.length > MAX_BLOG_SUBTITLE_LENGTH) {
    throw new Error(`Subtitle must be ${MAX_BLOG_SUBTITLE_LENGTH} characters or fewer`);
  }
  if (patch.introduction != null && patch.introduction.length > MAX_BLOG_INTRODUCTION_LENGTH) {
    throw new Error(`Introduction must be ${MAX_BLOG_INTRODUCTION_LENGTH} characters or fewer`);
  }
  const blog = await ensureBlog(tripId);
  const update: Record<string, unknown> = { updatedAt: nowIso() };
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.subtitle !== undefined) update.subtitle = patch.subtitle ?? null;
  if (patch.introduction !== undefined) update.introduction = patch.introduction ?? null;
  if (patch.photoLocationEnabled !== undefined) update.photoLocationEnabled = Boolean(patch.photoLocationEnabled);
  await getDb().collection('trip_blogs').doc(tripId).set(update, { merge: true });
  return {
    id: blog.id,
    tripId,
    title: String(update.title ?? blog.title ?? ''),
    subtitle: (update.subtitle !== undefined ? update.subtitle : blog.subtitle ?? null) as string | null,
    introduction: (update.introduction !== undefined ? update.introduction : blog.introduction ?? null) as string | null,
    contentRevision: Number(blog.contentRevision ?? 0),
    visibilityState: blog.visibilityState ?? 'private',
    visibilityEpoch: Number(blog.visibilityEpoch ?? 0),
    photoLocationEnabled: Boolean(update.photoLocationEnabled !== undefined ? update.photoLocationEnabled : (blog as any).photoLocationEnabled),
    days: [],
  };
};

export const reorderBlogItems = async (userId: string, tripId: string, itemIds: string[]): Promise<void> => {
  const access = await ensureUserInTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  const batch = getDb().batch();
  itemIds.forEach((itemId, index) => batch.update(getDb().collection('blog_items').doc(itemId), { sortKey: String(index).padStart(12, '0'), lastEditorUserId: userId, updatedAt: nowIso() }));
  await batch.commit();
};

// Mirrors postgresRepository.ts's getContributorsForDays. Firestore has no per-day FK on
// blog_media_assets (assets carry `dayDate`, not a `blogDayId` — see the note on setDayCover
// above), so this resolves each requested day's `localDate` first, then queries assets by that
// date and maps back to the caller's day IDs.
const displayNameFromUserDoc = (data: any): string => {
  const combined = `${data?.firstName ?? ''} ${data?.lastName ?? ''}`.trim();
  if (combined) return combined;
  if (data?.email) return String(data.email);
  return 'A traveler';
};

export const getContributorsForDays = async (dayIds: string[]): Promise<Record<string, { userId: string; displayName: string; itemCount: number; assetCount: number }[]>> => {
  const result: Record<string, Record<string, { itemCount: number; assetCount: number }>> = {};
  if (!dayIds.length) return {};
  const db = getDb();
  const dayDocs = await Promise.all(dayIds.map((id) => db.collection('blog_days').doc(id).get()));
  const dateToDayId = new Map<string, string>();
  dayIds.forEach((id, i) => {
    result[id] = {};
    const data = dayDocs[i].data() as any;
    if (data?.localDate) dateToDayId.set(String(data.localDate), id);
  });

  const itemSnap = await db.collection('blog_items').where('kindKey', '==', 'core.text').get();
  for (const doc of itemSnap.docs) {
    const data = doc.data() as any;
    if (data.deletedAt || !dayIds.includes(data.blogDayId)) continue;
    const bucket = result[data.blogDayId];
    const entry = bucket[data.authorUserId] ?? { itemCount: 0, assetCount: 0 };
    entry.itemCount += 1;
    bucket[data.authorUserId] = entry;
  }

  const assetSnap = await db.collection('blog_media_assets').where('state', '==', 'ready').get();
  for (const doc of assetSnap.docs) {
    const data = doc.data() as any;
    const dayId = dateToDayId.get(String(data.dayDate));
    if (!dayId) continue;
    const bucket = result[dayId];
    const entry = bucket[data.uploaderUserId] ?? { itemCount: 0, assetCount: 0 };
    entry.assetCount += 1;
    bucket[data.uploaderUserId] = entry;
  }

  const userIds = new Set<string>();
  for (const bucket of Object.values(result)) Object.keys(bucket).forEach((id) => userIds.add(id));
  const userDocs = await Promise.all(Array.from(userIds).map(async (id) => [id, await db.collection('users').doc(id).get()] as const));
  const displayNames = new Map(userDocs.map(([id, snap]) => [id, snap.exists ? displayNameFromUserDoc(snap.data()) : 'A traveler']));

  const final: Record<string, { userId: string; displayName: string; itemCount: number; assetCount: number }[]> = {};
  for (const [dayId, bucket] of Object.entries(result)) {
    final[dayId] = Object.entries(bucket)
      .map(([userId, counts]) => ({ userId, displayName: displayNames.get(userId) ?? 'A traveler', ...counts }))
      .sort((a, b) => (b.itemCount + b.assetCount) - (a.itemCount + a.assetCount));
  }
  return final;
};

export const getPublicPath = async (tripId: string): Promise<string | null> => {
  return getCanonicalPublicPathFirebase(tripId);
};

export const isBlogPublic = async (tripId: string): Promise<boolean> => {
  const snapshots = await getDb().collection('blog_publication_epochs').where('tripId', '==', tripId).get();
  return snapshots.docs.some((doc) => (doc.data() as any).state === 'public');
};

export const createModalityItem = async (
  userId: string,
  tripId: string,
  kindKey: string,
  schemaVersion: number,
  audience: string,
  payload: any,
  dayDate: string
): Promise<{ itemId: string; payload: any }> => {
  const day = await getDay(tripId, dayDate);
  const itemId = randomUUID();
  const cleanPayload = payload && typeof payload === 'object' ? payload : {};
  const data = {
    id: itemId,
    tripId,
    blogDayId: day.id,
    localDate: day.localDate,
    kindKey,
    schemaVersion,
    audience: audience || 'public',
    sortKey: `${Date.now()}-${itemId}`,
    authorUserId: userId,
    lastEditorUserId: userId,
    version: 1,
    payload: cleanPayload,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deletedAt: null,
  };
  await getDb().collection('blog_items').doc(itemId).set(data);
  return { itemId, payload: cleanPayload };
};

export const searchBlog = async (
  tripId: string,
  query: string,
  audiences: string[],
  options: { cursor?: string | null; limit?: number; scanLimit?: number } = {}
): Promise<any[]> => {
  const q = query.toLowerCase();
  const limit = Math.min(50, Math.max(1, Number(options.limit ?? 20)));
  const cursor = String(options.cursor ?? '');
  const scanLimit = Math.min(2000, Math.max(limit + 1, Number(options.scanLimit ?? 500)));
  const snapshots = await getDb().collection('blog_items').where('tripId', '==', tripId).limit(scanLimit).get();
  // Firestore has no contains/full-text operator. This bounded fallback preserves adapter parity
  // for today's trip-size ceiling; a managed search index can replace it when that ceiling grows.
  return snapshots.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
    .filter((item) => {
      if (item.deletedAt != null || item.kindKey !== 'core.text' || !audiences.includes(String(item.audience))) return false;
      return String(item.body ?? '').toLowerCase().includes(q);
    })
    .sort((a, b) => `${a.localDate}|${a.id}`.localeCompare(`${b.localDate}|${b.id}`))
    .filter((item) => !cursor || `${item.localDate}|${item.id}` > cursor)
    .map((item) => ({ id: item.id, localDate: item.localDate, snippet: String(item.body ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240) }))
    .slice(0, limit + 1);
};
