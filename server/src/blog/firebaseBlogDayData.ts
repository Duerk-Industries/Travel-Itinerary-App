import { getDb } from '../db.firebase';
import { BlogAudience } from './types';

// Shared Firestore data-access primitives for the trip-blog "read/derive" services
// (blogDayFactsService, blogDayStarterService, blogMediaGroupingService, blogEngagementService,
// blogBackgroundWorker) — these previously called `queryBlog` from db.postgres.ts unconditionally,
// which throws when DATABASE_URL isn't set (the firebase-provider deployment's normal state).
// This file mirrors the collection/field conventions already established in
// blog/firebaseRepository.ts, blog/firebaseEngagementRepository.ts and blog/firebaseMediaRepository.ts
// (camelCase fields, blog_media_assets carrying blogItemId/dayDate directly rather than through a
// junction table) rather than inventing a new shape.

const nowIso = (): string => new Date().toISOString();

export type FirebaseBlogDayRow = { id: string; headline: string | null; summary: string | null; localDate: string };

export const getBlogDayByDate = async (tripId: string, dayDate: string): Promise<FirebaseBlogDayRow | null> => {
  const snap = await getDb().collection('blog_days').where('tripId', '==', tripId).where('localDate', '==', dayDate).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data() as any;
  return { id: doc.id, headline: data.headline ?? null, summary: data.summary ?? null, localDate: dayDate };
};

export const getBlogDayById = async (dayId: string): Promise<{ id: string; tripId: string } | null> => {
  const doc = await getDb().collection('blog_days').doc(dayId).get();
  if (!doc.exists) return null;
  const data = doc.data() as any;
  return { id: doc.id, tripId: String(data.tripId) };
};

export const listBlogDayDates = async (tripId: string): Promise<string[]> => {
  const snap = await getDb().collection('blog_days').where('tripId', '==', tripId).get();
  return snap.docs.map((doc) => String((doc.data() as any).localDate)).sort((a, b) => a.localeCompare(b));
};

export const getTripName = async (tripId: string): Promise<string | null> => {
  const snap = await getDb().collection('trips').doc(tripId).get();
  if (!snap.exists) return null;
  const name = String((snap.data() as any)?.name ?? '');
  return name || null;
};

// Shaped like the Postgres MediaRow query result (blogDayFactsService.ts) so callers can reuse the
// same downstream computation regardless of provider.
export type FirebaseMediaRow = { id: string; captured_at: Date | null; captured_lat: number | null; captured_lng: number | null; media_kind_key: string };

const chunk = <T>(items: T[], size = 10): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

// Mirrors the Postgres join `blog_media_assets a JOIN blog_item_assets ia JOIN blog_items i`:
// Firestore assets carry `blogItemId` directly (no junction collection — see
// firebaseMediaRepository.ts), so this resolves the day's visible, non-deleted items first, then
// reads only the assets that belong to them.
//
// Keyed on `localDate`, not the blog_days doc id: firebaseMediaRepository.initUpload writes media
// blog_items with `blogDayId = <date string>` while text items use `blogDayId = <doc id>` — the
// one field every blog_items doc sets consistently is `localDate`.
export const getVisibleMediaForDay = async (dayDate: string, visibleAudiences: BlogAudience[]): Promise<FirebaseMediaRow[]> => {
  const db = getDb();
  const itemSnap = await db.collection('blog_items').where('localDate', '==', dayDate).get();
  const itemIds = itemSnap.docs
    .filter((doc) => {
      const data = doc.data() as any;
      return data.deletedAt == null && visibleAudiences.includes((data.audience ?? 'public') as BlogAudience);
    })
    .map((doc) => doc.id);
  if (!itemIds.length) return [];
  const rows: FirebaseMediaRow[] = [];
  for (const ids of chunk(itemIds)) {
    // `state` is filtered in memory rather than as a second `where` — an `in` + `==` pair would
    // otherwise want a composite index this collection doesn't have.
    const assetSnap = await db.collection('blog_media_assets').where('blogItemId', 'in', ids).get();
    assetSnap.docs.forEach((doc) => {
      const data = doc.data() as any;
      if (String(data.state) !== 'ready') return;
      rows.push({
        id: doc.id,
        captured_at: data.capturedAt ? new Date(data.capturedAt) : null,
        captured_lat: data.capturedLat == null ? null : Number(data.capturedLat),
        captured_lng: data.capturedLng == null ? null : Number(data.capturedLng),
        media_kind_key: String(data.mediaKind ?? 'photo'),
      });
    });
  }
  return rows;
};

const ALL_AUDIENCES: BlogAudience[] = ['travelers', 'followers', 'public'];

// Postgres's day-starter media count has no audience filter (`blogDayStarterService.ts`'s
// mediaCount query) — passing every audience reproduces that.
export const countAllReadyMediaForDay = async (dayDate: string): Promise<number> => (await getVisibleMediaForDay(dayDate, ALL_AUDIENCES)).length;

export const hasTextItemForDay = async (dayDate: string): Promise<boolean> => {
  const snap = await getDb().collection('blog_items').where('localDate', '==', dayDate).where('kindKey', '==', 'core.text').get();
  return snap.docs.some((doc) => (doc.data() as any).deletedAt == null);
};

export const getDayStarterDismissed = async (tripId: string, dayDate: string, userId: string): Promise<boolean> => {
  const snap = await getDb().collection('blog_day_starter_dismissals').doc(`${tripId}:${dayDate}:${userId}`).get();
  return snap.exists;
};

export const insertDayStarterDismissal = async (tripId: string, dayDate: string, userId: string): Promise<void> => {
  await getDb().collection('blog_day_starter_dismissals').doc(`${tripId}:${dayDate}:${userId}`).set(
    { tripId, localDate: dayDate, userId, createdAt: nowIso() },
    { merge: true }
  );
};

export const getDayMapArtifact = async (tripId: string, dayDate: string, pointsHash: string): Promise<{ gcs_path: string } | null> => {
  const doc = await getDb().collection('blog_day_map_artifacts').doc(`${tripId}:${dayDate}:${pointsHash}`).get();
  if (!doc.exists) return null;
  const data = doc.data() as any;
  return { gcs_path: String(data.gcsPath ?? '') };
};

export const upsertDayMapArtifact = async (tripId: string, dayDate: string, pointsHash: string, gcsPath: string): Promise<void> => {
  await getDb().collection('blog_day_map_artifacts').doc(`${tripId}:${dayDate}:${pointsHash}`).set(
    { tripId, dayDate, pointsHash, gcsPath, updatedAt: nowIso() },
    { merge: true }
  );
};

export const getFollowerCommentsEnabled = async (tripId: string): Promise<boolean> => {
  const doc = await getDb().collection('trip_blogs').doc(tripId).get();
  if (!doc.exists) return true;
  const data = doc.data() as any;
  // Fail-open, mirroring the Postgres `!== false` check in blogEngagementService.ts: a missing
  // field means "not yet configured," not "disabled."
  return data.followerCommentsEnabled !== false;
};

export const getGroupMemberUserIdsForTrip = async (tripId: string): Promise<string[]> => {
  const db = getDb();
  const tripSnap = await db.collection('trips').doc(tripId).get();
  const groupId = tripSnap.exists ? String((tripSnap.data() as any)?.groupId ?? '') : '';
  if (!groupId) return [];
  const memberSnap = await db.collection('group_members').where('groupId', '==', groupId).get();
  return memberSnap.docs
    .map((doc) => doc.data() as any)
    .filter((data) => data.userId && !data.removedAt)
    .map((data) => String(data.userId));
};

export type FirebaseEngagementTargetRow = { id: string; tripId: string; blogDayId: string; audience: BlogAudience };

export const getBlogItemTarget = async (itemId: string): Promise<FirebaseEngagementTargetRow | null> => {
  const doc = await getDb().collection('blog_items').doc(itemId).get();
  if (!doc.exists) return null;
  const data = doc.data() as any;
  if (data.deletedAt != null) return null;
  return { id: doc.id, tripId: String(data.tripId), blogDayId: String(data.blogDayId), audience: (data.audience ?? 'public') as BlogAudience };
};

// Mirrors resolveAssetTarget's Postgres join (blog_media_assets -> blog_item_assets -> blog_items):
// the Firestore asset already carries blogItemId, so the "join" is one extra doc read of the
// parent item rather than a junction-table lookup.
export const getBlogAssetTarget = async (assetId: string): Promise<FirebaseEngagementTargetRow | null> => {
  const db = getDb();
  const assetDoc = await db.collection('blog_media_assets').doc(assetId).get();
  if (!assetDoc.exists) return null;
  const assetData = assetDoc.data() as any;
  if (assetData.state !== 'ready') return null;
  const itemDoc = await db.collection('blog_items').doc(String(assetData.blogItemId)).get();
  if (!itemDoc.exists) return null;
  const itemData = itemDoc.data() as any;
  if (itemData.deletedAt != null) return null;
  return { id: assetId, tripId: String(assetData.tripId), blogDayId: String(itemData.blogDayId), audience: (itemData.audience ?? 'public') as BlogAudience };
};
