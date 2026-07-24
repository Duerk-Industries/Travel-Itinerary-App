import { randomUUID } from 'crypto';
import { getDb, ensureUserCanReadTrip, ensureUserInTrip } from '../db.firebase';
import { fetchOverviewWeather } from '../apis/openMeteoWeatherApi';
import { BlogCapabilities, BlogDocument, BlogDay, BlogTextInput, BlogTextItem, BlogTextPatch, BlogActivity } from './types';

const nowIso = () => new Date().toISOString();
const dateString = (value: unknown): string => new Date(String(value)).toISOString().slice(0, 10);

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
    await db.collection('blog_days').add({ tripId, localDate, headline: null, summary: null, createdAt: nowIso(), updatedAt: nowIso() });
  }
};

const mapItem = (doc: any): BlogTextItem => {
  const data = doc.data ? doc.data() : doc;
  return { id: String(doc.id ?? data.id), tripId: String(data.tripId), blogDayId: String(data.blogDayId), localDate: String(data.localDate), kindKey: 'core.text', schemaVersion: Number(data.schemaVersion ?? 1), audience: data.audience ?? 'public', sortKey: String(data.sortKey), authorUserId: String(data.authorUserId), lastEditorUserId: String(data.lastEditorUserId), version: Number(data.version ?? 1), body: String(data.body ?? ''), languageTag: data.languageTag ?? null, createdAt: String(data.createdAt), updatedAt: String(data.updatedAt), sourceType: data.sourceType ?? null, sourceId: data.sourceId ?? null, sourceDetached: Boolean(data.sourceDetached) };
};

const linkedSourceBody = (data: any): string => data.kind === 'note'
  ? String(data.noteBody ?? data.activity ?? '')
  : `Location: ${String(data.activity ?? 'Location')}${data.noteBody ? `\n${String(data.noteBody)}` : ''}`;

const syncLinkedItineraryItems = async (tripId: string, userId: string): Promise<void> => {
  const db = getDb();
  const itinerarySnap = await db.collection('itineraries').where('tripId', '==', tripId).get();
  const daySnap = await db.collection('blog_days').where('tripId', '==', tripId).get();
  const days = daySnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) })).sort((a, b) => String(a.localDate).localeCompare(String(b.localDate)));
  for (const itinerary of itinerarySnap.docs) {
    const detailSnap = await db.collection('itinerary_details').where('itineraryId', '==', itinerary.id).get();
    for (const detail of detailSnap.docs) {
      const data = detail.data() as any;
      if (data.kind !== 'note' && data.kind !== 'place') continue;
      const body = linkedSourceBody(data); if (!body.trim()) continue;
      const day = days[Math.max(0, Number(data.day ?? 1) - 1)] ?? days[0]; if (!day) continue;
      const snapshot = { body, day: Number(data.day ?? 1), activity: String(data.activity ?? ''), kind: String(data.kind), placeId: data.placeId ?? null, noteBody: data.noteBody ?? null };
      const linkRef = db.collection('blog_item_source_links').doc(`itinerary_detail_${detail.id}`);
      const link = await linkRef.get();
      if (!link.exists) {
        const itemId = randomUUID(); const now = nowIso();
        const item = { id: itemId, tripId, blogDayId: day.id, localDate: String(day.localDate), kindKey: 'core.text', schemaVersion: 1, audience: 'public', sortKey: `${Date.now().toString().padStart(16, '0')}-${itemId}`, authorUserId: userId, lastEditorUserId: userId, version: 1, body, languageTag: null, sourceType: 'itinerary_detail', sourceId: detail.id, sourceDetached: false, createdAt: now, updatedAt: now, deletedAt: null };
        await db.collection('blog_items').doc(itemId).set(item);
        await linkRef.set({ itemId, sourceType: 'itinerary_detail', sourceId: detail.id, sourceSnapshot: snapshot, detached: false, createdAt: now, updatedAt: now });
        await db.collection('trip_blogs').doc(tripId).set({ contentRevision: (await ensureBlog(tripId)).contentRevision + 1, updatedAt: now }, { merge: true });
        continue;
      }
      const linkData = link.data() as any; if (linkData.detached) continue;
      if (JSON.stringify(linkData.sourceSnapshot ?? {}) === JSON.stringify(snapshot)) continue;
      const itemRef = db.collection('blog_items').doc(String(linkData.itemId)); const itemSnap = await itemRef.get(); if (!itemSnap.exists) continue;
      const current = itemSnap.data() as any; const now = nowIso();
      await itemRef.set({ body, blogDayId: day.id, localDate: String(day.localDate), version: Number(current.version ?? 1) + 1, lastEditorUserId: userId, updatedAt: now }, { merge: true });
      await linkRef.set({ sourceSnapshot: snapshot, updatedAt: now }, { merge: true });
      await db.collection('trip_blogs').doc(tripId).set({ contentRevision: (await ensureBlog(tripId)).contentRevision + 1, updatedAt: now }, { merge: true });
    }
  }
};

export const getBlog = async (userId: string, tripId: string, options: { date?: string; cursor?: string; limit?: number } = {}): Promise<BlogDocument> => {
  const access = await ensureUserCanReadTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to view this trip');
  const db = getDb();
  const blog = await ensureBlog(tripId);
  await ensureDays(tripId);
  if (await ensureUserInTrip(tripId, userId)) await syncLinkedItineraryItems(tripId, userId);

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
      items: items.filter((item) => item.blogDayId === doc.id),
      activities: activitiesByDate.get(date) ?? [],
      weather: dayWeather ? {
        icon: dayWeather.icon,
        description: dayWeather.description,
        temperatureHighC: dayWeather.temperatureHighC
      } : undefined
    };
  }).sort((a, b) => a.localDate.localeCompare(b.localDate));

  return { id: blog.id, tripId, title: blog.title ?? '', subtitle: blog.subtitle ?? null, introduction: blog.introduction ?? null, contentRevision: Number(blog.contentRevision ?? 0), visibilityState: blog.visibilityState ?? 'private', visibilityEpoch: Number(blog.visibilityEpoch ?? 0), days };
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
  const id = randomUUID();
  const data = { id, tripId, blogDayId: day.id, localDate: day.localDate, kindKey: 'core.text', schemaVersion: 1, audience: input.audience ?? 'public', sortKey: `${Date.now().toString().padStart(16, '0')}-${id}`, authorUserId: userId, lastEditorUserId: userId, version: 1, body: String(input.body ?? ''), languageTag: input.languageTag ?? null, createdAt: nowIso(), updatedAt: nowIso(), deletedAt: null };
  await getDb().collection('blog_items').doc(id).set(data);
  await getDb().collection('trip_blogs').doc(tripId).set({ contentRevision: (await ensureBlog(tripId)).contentRevision + 1, updatedAt: nowIso() }, { merge: true });
  return mapItem({ id, data: () => data });
};

export const updateBlogTextItem = async (userId: string, itemId: string, patch: BlogTextPatch): Promise<BlogTextItem | null> => {
  const ref = getDb().collection('blog_items').doc(itemId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  const row = snapshot.data() as any;
  const access = await ensureUserInTrip(String(row.tripId), userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  if (Number(row.version ?? 1) !== patch.version) return null;
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

export const reorderBlogItems = async (userId: string, tripId: string, itemIds: string[]): Promise<void> => {
  const access = await ensureUserInTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  const batch = getDb().batch();
  itemIds.forEach((itemId, index) => batch.update(getDb().collection('blog_items').doc(itemId), { sortKey: String(index).padStart(12, '0'), lastEditorUserId: userId, updatedAt: nowIso() }));
  await batch.commit();
};
