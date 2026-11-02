import { evaluateBlogVisibility } from '../services/blogVisibilityService';
import { getDb, ensureUserInTrip } from '../db.firebase';
const nowIso = () => new Date().toISOString();
const asIso = (value: unknown): string | null => {
  if (!value) return null;
  const timestamp = value as { toDate?: () => Date };
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

export const getCanonicalPublicPathFirebase = async (tripId: string): Promise<string | null> => {
  const blog = await getDb().collection('trip_blogs').doc(tripId).get();
  if (!blog.exists || !(await evaluateBlogVisibility(tripId)).isPublic) return null;
  const aliases = await getDb().collection('blog_public_aliases').where('tripId', '==', tripId).get();
  const alias = aliases.docs.filter((doc) => (doc.data() as any).canonical === true).sort((a, b) => String((b.data() as any).createdAt ?? '').localeCompare(String((a.data() as any).createdAt ?? '')))[0];
  return alias ? `/${(alias.data() as any).usernameSlug}/${(alias.data() as any).tripSlug}` : null;
};

// Phase 4 of docs/trip-blog-social-implementation-plan.md — resolves an alias to a trip id and its
// day list without pulling the full public blog document (items/media), the way getPublicBlogFirebase
// below does. publicBlogRoutes.ts's engagement endpoint (architecture §5.1/§14.7) only ever needs
// (tripId, dayId, localDate) to join against the engagement counters/comments — the doubled read of
// items/media in getPublicBlogFirebase would be wasted work on every engagement-only request.
export const resolvePublicTripIdFirebase = async (
  usernameSlug: string,
  tripSlug: string
): Promise<{ tripId: string; days: Array<{ id: string; localDate: string }> } | null> => {
  const db = getDb();
  const aliases = await db.collection('blog_public_aliases').where('usernameSlug', '==', usernameSlug.toLowerCase()).get();
  const alias = aliases.docs.filter((doc) => String((doc.data() as any).tripSlug).toLowerCase() === tripSlug.toLowerCase()).sort((a, b) => Number((b.data() as any).canonical === true) - Number((a.data() as any).canonical === true))[0];
  if (!alias) return null;
  const aliasData = alias.data() as any;
  if (aliasData.redirectUntil && new Date(aliasData.redirectUntil).getTime() <= Date.now()) return null;
  if (!(await evaluateBlogVisibility(String(aliasData.tripId))).isPublic) return null;
  const tripId = String(aliasData.tripId);
  const daysSnap = await db.collection('blog_days').where('tripId', '==', tripId).get();
  const days = daysSnap.docs.map((doc) => ({ id: doc.id, localDate: String((doc.data() as any).localDate) })).sort((a, b) => a.localDate.localeCompare(b.localDate));
  return { tripId, days };
};

export const resolveBlogAliasTripIdFirebase = async (usernameSlug: string, tripSlug: string): Promise<string | null> => {
  const aliases = await getDb().collection('blog_public_aliases').where('usernameSlug', '==', usernameSlug.toLowerCase()).get();
  const alias = aliases.docs.filter(d => String(d.data().tripSlug).toLowerCase() === tripSlug.toLowerCase())
    .sort((a, b) => Number(b.data().canonical === true) - Number(a.data().canonical === true))[0]?.data();
  if (!alias || (alias.redirectUntil && new Date(alias.redirectUntil).getTime() <= Date.now())) return null;
  return String(alias.tripId);
};

export const getPublicBlogFirebase = async (usernameSlug: string, tripSlug: string): Promise<any | null> => {
  const db = getDb();
  const aliases = await db.collection('blog_public_aliases').where('usernameSlug', '==', usernameSlug.toLowerCase()).get();
  const alias = aliases.docs.filter((doc) => String((doc.data() as any).tripSlug).toLowerCase() === tripSlug.toLowerCase()).sort((a, b) => Number((b.data() as any).canonical === true) - Number((a.data() as any).canonical === true))[0];
  if (!alias) return null;
  const aliasData = alias.data() as any;
  if (aliasData.redirectUntil && new Date(aliasData.redirectUntil).getTime() <= Date.now()) return null;
  if (!(await evaluateBlogVisibility(String(aliasData.tripId))).isPublic) return null;
  return loadPublicBlogDocumentFirebase(String(aliasData.tripId));
};

/**
 * The public projection of a trip's blog (audience 'public' only), without checking that it has been
 * published. getPublicBlogFirebase calls it after confirming publication; the traveler-only preview
 * calls it directly so a blog can be seen exactly as the public would before it goes live.
 */
export const loadPublicBlogDocumentFirebase = async (tripId: string): Promise<any | null> => {
  const db = getDb();
  const blog = await db.collection('trip_blogs').doc(tripId).get();
  const tripDoc = blog.exists ? null : await db.collection('trips').doc(tripId).get();
  if (!blog.exists && !tripDoc?.exists) return null;
  const blogData = (blog.exists ? blog.data() : { title: (tripDoc?.data() as any)?.name ?? 'Trip Blog' }) as any;
  const aliasData = { tripId };
  const [daysSnap, itemsSnap, mediaSnap] = await Promise.all([
    db.collection('blog_days').where('tripId', '==', String(aliasData.tripId)).get(),
    db.collection('blog_items').where('tripId', '==', String(aliasData.tripId)).get(),
    db.collection('blog_media_assets').where('tripId', '==', String(aliasData.tripId)).get(),
  ]);
  const mediaByItem = new Map<string, any>(mediaSnap.docs.map((doc) => [String((doc.data() as any).blogItemId), { ...doc.data(), assetId: doc.id }]));
  const itemsByDay = new Map<string, any[]>();
  itemsSnap.docs.forEach((doc) => {
    const item = doc.data() as any;
    if (item.deletedAt != null || item.audience !== 'public') return;
    const base = { id: doc.id, kindKey: item.kindKey, schemaVersion: Number(item.schemaVersion ?? 1), audience: item.audience, sortKey: item.sortKey };
    const isMedia = String(item.kindKey ?? '').startsWith('media.');
    const media = isMedia ? mediaByItem.get(doc.id) : null;
    if (isMedia && media?.state !== 'ready') return;
    const output = media ? { ...base, assetId: media.assetId, mediaKind: media.mediaKind, caption: media.caption ?? null, altText: media.altText ?? null, objectKey: media.objectKey ?? null, uploaderUserId: media.uploaderUserId ?? null } : { ...base, body: String(item.body ?? ''), languageTag: item.languageTag ?? null };
    // Text items use the blog day document id; Firebase media items use the day date. These are
    // two different keys into the same map — a day with both kinds of item needs entries under
    // both to be found below, not an either/or fallback (that silently dropped every media item
    // on any day that also had a text item, since the id-keyed lookup always won first).
    const key = media ? String(media.dayDate ?? item.blogDayId) : String(item.blogDayId);
    itemsByDay.set(key, [...(itemsByDay.get(key) ?? []), output]);
  });
  const days = daysSnap.docs.map((doc) => {
    const day = doc.data() as any;
    const items = [...(itemsByDay.get(doc.id) ?? []), ...(itemsByDay.get(String(day.localDate)) ?? [])]
      .sort((a, b) => String(a.sortKey ?? '').localeCompare(String(b.sortKey ?? '')));
    return { localDate: String(day.localDate), headline: day.headline ?? null, summary: day.summary ?? null, items };
  }).sort((a, b) => a.localDate.localeCompare(b.localDate));
  const tripPhotos = (itemsByDay.get('') ?? []).filter((item) => item.mediaKind === 'photo').sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)));
  return { tripPhotos, title: blogData.title ?? '', subtitle: blogData.subtitle ?? null, introduction: blogData.introduction ?? null, contentRevision: Number(blogData.contentRevision ?? 0), visibilityEpoch: Number(blogData.visibilityEpoch ?? 0), indexingEnabled: blogData.indexingEnabled !== false, days };
};

export const listPublicBlogSitemapFirebase = async (): Promise<Array<{ username_slug: string; trip_slug: string; updated_at: string }>> => {
  const aliases = await getDb().collection('blog_public_aliases').where('canonical', '==', true).get();
  const rows: Array<{ username_slug: string; trip_slug: string; updated_at: string }> = [];
  for (const alias of aliases.docs) {
    const data = alias.data() as any;
    const blog = await getDb().collection('trip_blogs').doc(String(data.tripId)).get();
    if (!blog.exists || (blog.data() as any)?.indexingEnabled === false || !(await evaluateBlogVisibility(String(data.tripId))).isPublic) continue;
    rows.push({ username_slug: String(data.usernameSlug), trip_slug: String(data.tripSlug), updated_at: asIso((blog.data() as any)?.updatedAt) ?? nowIso() });
  }
  return rows;
};

export const setBlogIndexingFirebase = async (tripId: string, userId: string, enabled: boolean): Promise<void> => {
  if (!(await ensureUserInTrip(tripId, userId))) throw new Error('Not authorized');
  await getDb().collection('trip_blogs').doc(tripId).set({ indexingEnabled: enabled, updatedAt: nowIso() }, { merge: true });
};
