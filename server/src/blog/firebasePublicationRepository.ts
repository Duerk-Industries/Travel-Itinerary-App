import { randomUUID } from 'crypto';
import { getDb, ensureUserInTrip } from '../db.firebase';

type PublicationState = 'pending_consent' | 'public' | 'revoked' | 'expired';

const nowIso = () => new Date().toISOString();
const slug = (value: unknown): string => String(value ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'trip';
const asIso = (value: any): string | null => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

const setBlogVisibility = async (tripId: string, epoch: number, state: PublicationState): Promise<void> => {
  const db = getDb();
  const ref = db.collection('trip_blogs').doc(tripId);
  const existing = await ref.get();
  if (existing.exists) {
    await ref.set({ visibilityState: state === 'public' ? 'public' : state === 'pending_consent' ? 'pending_consent' : 'private', visibilityEpoch: epoch, updatedAt: nowIso() }, { merge: true });
    return;
  }
  const trip = await db.collection('trips').doc(tripId).get();
  await ref.set({ tripId, title: String((trip.data() as any)?.name ?? 'Trip Blog'), subtitle: null, introduction: null, contentRevision: 0, visibilityState: state === 'public' ? 'public' : state === 'pending_consent' ? 'pending_consent' : 'private', visibilityEpoch: epoch, createdAt: nowIso(), updatedAt: nowIso() });
};

const eligibleAdults = async (tripId: string): Promise<{ adults: string[]; missingBirthDate: number }> => {
  const db = getDb();
  const trip = await db.collection('trips').doc(tripId).get();
  if (!trip.exists) throw new Error('Trip not found');
  const groupId = String((trip.data() as any)?.groupId ?? '');
  const members = await db.collection('group_members').where('groupId', '==', groupId).get();
  const activeIds = members.docs
    .map((doc) => doc.data() as any)
    .filter((member) => member.removedAt == null && member.userId)
    .map((member) => String(member.userId));
  const users = await Promise.all(activeIds.map(async (id) => ({ id, snapshot: await db.collection('users').doc(id).get() })));
  const adults: string[] = [];
  let missingBirthDate = 0;
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 16);
  for (const user of users) {
    const data = user.snapshot.data() as any;
    const rawDob = data?.dateOfBirth ?? data?.date_of_birth ?? null;
    if (!rawDob) { missingBirthDate += 1; continue; }
    const dob = new Date(rawDob?.toDate ? rawDob.toDate() : rawDob);
    if (!Number.isNaN(dob.getTime()) && dob <= cutoff) adults.push(user.id);
  }
  return { adults, missingBirthDate };
};

const findEpoch = async (tripId: string, epochNumber?: number): Promise<{ id: string; data: any } | null> => {
  const snapshots = await getDb().collection('blog_publication_epochs').where('tripId', '==', tripId).get();
  const rows = snapshots.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as any }))
    .filter((row) => epochNumber == null || Number(row.data.epoch) === epochNumber)
    .sort((a, b) => Number(b.data.epoch ?? 0) - Number(a.data.epoch ?? 0));
  return rows[0] ?? null;
};

const upsertAlias = async (tripId: string, userId: string, usernameSlug: string, tripSlug: string, canonical: boolean, insertOnly = false): Promise<void> => {
  const db = getDb();
  const existing = await db.collection('blog_public_aliases').where('usernameSlug', '==', usernameSlug).get();
  const matching = existing.docs.find((doc) => String((doc.data() as any).tripSlug) === tripSlug);
  if (matching) {
    if (!insertOnly) await matching.ref.set({ canonical, updatedAt: nowIso() }, { merge: true });
    return;
  }
  await db.collection('blog_public_aliases').doc(randomUUID()).set({ tripId, userId, usernameSlug, tripSlug, canonical, redirectUntil: null, createdAt: nowIso(), updatedAt: nowIso() });
};

export const getPublicationStatusFirebase = async (tripId: string, userId: string): Promise<any> => {
  if (!(await ensureUserInTrip(tripId, userId))) throw new Error('Not authorized');
  const epoch = await findEpoch(tripId);
  if (!epoch) return { epoch: null, state: 'private', userDecision: null, pendingCount: 0 };
  const consents = await getDb().collection('blog_publication_consents').where('epochId', '==', epoch.id).get();
  const userConsent = consents.docs.find((doc) => String((doc.data() as any).userId) === userId);
  return { epoch: Number(epoch.data.epoch), state: epoch.data.state, requestedBy: String(epoch.data.requestedBy ?? ''), expiresAt: asIso(epoch.data.expiresAt), userDecision: userConsent ? (userConsent.data() as any).decision : null, pendingCount: consents.docs.filter((doc) => (doc.data() as any).decision === 'pending').length };
};

export const requestPublicationFirebase = async (tripId: string, userId: string): Promise<any> => {
  if (!(await ensureUserInTrip(tripId, userId))) throw new Error('Not authorized');
  const eligibility = await eligibleAdults(tripId);
  if (eligibility.missingBirthDate > 0) {
    const error: any = new Error('Every account traveler must complete the date-of-birth profile before public consent can be requested');
    error.code = 'PROFILE_COMPLETION_REQUIRED';
    throw error;
  }
  const prior = await findEpoch(tripId);
  const epoch = Number(prior?.data?.epoch ?? 0) + 1;
  const epochId = randomUUID();
  const adults = eligibility.adults.filter((id) => id !== userId);
  const db = getDb();
  const batch = db.batch();
  batch.set(db.collection('blog_publication_epochs').doc(epochId), { tripId, epoch, state: adults.length ? 'pending_consent' : 'public', requestedBy: userId, expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(), createdAt: nowIso(), updatedAt: nowIso() });
  batch.set(db.collection('blog_publication_consents').doc(`${epochId}_${userId}`), { epochId, userId, decision: 'approved', decidedAt: nowIso() });
  adults.forEach((adult) => batch.set(db.collection('blog_publication_consents').doc(`${epochId}_${adult}`), { epochId, userId: adult, decision: 'pending', decidedAt: null }));
  await batch.commit();
  await setBlogVisibility(tripId, epoch, adults.length ? 'pending_consent' : 'public');
  const [user, trip] = await Promise.all([db.collection('users').doc(userId).get(), db.collection('trips').doc(tripId).get()]);
  const usernameSlug = slug((user.data() as any)?.username ?? userId);
  const tripSlug = slug((trip.data() as any)?.name ?? 'trip');
  await upsertAlias(tripId, userId, usernameSlug, tripSlug, true);
  return { epoch, state: adults.length ? 'pending_consent' : 'public', pendingCount: adults.length };
};

export const consentPublicationFirebase = async (tripId: string, epochNumber: number, userId: string, decision: 'approved' | 'declined'): Promise<void> => {
  if (!(await ensureUserInTrip(tripId, userId))) throw new Error('Not authorized');
  const epoch = await findEpoch(tripId, epochNumber);
  if (!epoch) throw new Error('Publication request not found');
  const db = getDb();
  const consentDocs = await db.collection('blog_publication_consents').where('epochId', '==', epoch.id).get();
  const consent = consentDocs.docs.find((doc) => String((doc.data() as any).userId) === userId);
  if (!consent) throw new Error('You are not an eligible consent participant');
  await consent.ref.set({ decision, decidedAt: nowIso() }, { merge: true });
  if (decision === 'declined') {
    await epochRef(epoch.id).set({ state: 'expired', updatedAt: nowIso() }, { merge: true });
    await setBlogVisibility(tripId, epochNumber, 'expired');
    return;
  }
  const user = await db.collection('users').doc(userId).get();
  const trip = await db.collection('trips').doc(tripId).get();
  await upsertAlias(tripId, userId, slug((user.data() as any)?.username ?? userId), slug((trip.data() as any)?.name ?? 'trip'), false, true);
  const consents = await db.collection('blog_publication_consents').where('epochId', '==', epoch.id).get();
  if (!consents.docs.some((doc) => (doc.data() as any).decision === 'pending')) {
    await epochRef(epoch.id).set({ state: 'public', updatedAt: nowIso() }, { merge: true });
    await setBlogVisibility(tripId, epochNumber, 'public');
  }
};

const epochRef = (id: string) => getDb().collection('blog_publication_epochs').doc(id);

export const revokePublicationFirebase = async (tripId: string, userId: string): Promise<void> => {
  if (!(await ensureUserInTrip(tripId, userId))) throw new Error('Not authorized');
  const epoch = await findEpoch(tripId);
  if (!epoch || epoch.data.state !== 'public') return;
  await epochRef(epoch.id).set({ state: 'revoked', revokedBy: userId, updatedAt: nowIso() }, { merge: true });
  await setBlogVisibility(tripId, Number(epoch.data.epoch), 'revoked');
};

export const getCanonicalPublicPathFirebase = async (tripId: string): Promise<string | null> => {
  const blog = await getDb().collection('trip_blogs').doc(tripId).get();
  if (!blog.exists || (blog.data() as any)?.visibilityState !== 'public') return null;
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
  const epoch = await findEpoch(String(aliasData.tripId));
  if (!epoch || epoch.data.state !== 'public') return null;
  const tripId = String(aliasData.tripId);
  const daysSnap = await db.collection('blog_days').where('tripId', '==', tripId).get();
  const days = daysSnap.docs.map((doc) => ({ id: doc.id, localDate: String((doc.data() as any).localDate) })).sort((a, b) => a.localDate.localeCompare(b.localDate));
  return { tripId, days };
};

export const getPublicBlogFirebase = async (usernameSlug: string, tripSlug: string): Promise<any | null> => {
  const db = getDb();
  const aliases = await db.collection('blog_public_aliases').where('usernameSlug', '==', usernameSlug.toLowerCase()).get();
  const alias = aliases.docs.filter((doc) => String((doc.data() as any).tripSlug).toLowerCase() === tripSlug.toLowerCase()).sort((a, b) => Number((b.data() as any).canonical === true) - Number((a.data() as any).canonical === true))[0];
  if (!alias) return null;
  const aliasData = alias.data() as any;
  if (aliasData.redirectUntil && new Date(aliasData.redirectUntil).getTime() <= Date.now()) return null;
  const epoch = await findEpoch(String(aliasData.tripId));
  if (!epoch || epoch.data.state !== 'public') return null;
  const blog = await db.collection('trip_blogs').doc(String(aliasData.tripId)).get();
  if (!blog.exists) return null;
  const blogData = blog.data() as any;
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
    const media = String(item.kindKey ?? '').startsWith('media.') ? mediaByItem.get(doc.id) : null;
    const output = media ? { ...base, assetId: media.assetId, mediaKind: media.mediaKind, caption: media.caption ?? null, altText: media.altText ?? null, objectKey: media.objectKey ?? null } : { ...base, body: String(item.body ?? ''), languageTag: item.languageTag ?? null };
    // Text items use the blog day document id; Firebase media items use the day date.
    const key = media ? String(media.dayDate ?? item.blogDayId) : String(item.blogDayId);
    itemsByDay.set(key, [...(itemsByDay.get(key) ?? []), output]);
  });
  const days = daysSnap.docs.map((doc) => {
    const day = doc.data() as any;
    return { localDate: String(day.localDate), headline: day.headline ?? null, summary: day.summary ?? null, items: itemsByDay.get(doc.id) ?? itemsByDay.get(String(day.localDate)) ?? [] };
  }).sort((a, b) => a.localDate.localeCompare(b.localDate));
  return { title: blogData.title ?? '', subtitle: blogData.subtitle ?? null, introduction: blogData.introduction ?? null, contentRevision: Number(blogData.contentRevision ?? 0), visibilityEpoch: Number(blogData.visibilityEpoch ?? 0), indexingEnabled: blogData.indexingEnabled !== false, days };
};

export const listPublicBlogSitemapFirebase = async (): Promise<Array<{ username_slug: string; trip_slug: string; updated_at: string }>> => {
  const aliases = await getDb().collection('blog_public_aliases').where('canonical', '==', true).get();
  const rows: Array<{ username_slug: string; trip_slug: string; updated_at: string }> = [];
  for (const alias of aliases.docs) {
    const data = alias.data() as any;
    const blog = await getDb().collection('trip_blogs').doc(String(data.tripId)).get();
    if (!blog.exists || (blog.data() as any)?.visibilityState !== 'public' || (blog.data() as any)?.indexingEnabled === false) continue;
    rows.push({ username_slug: String(data.usernameSlug), trip_slug: String(data.tripSlug), updated_at: asIso((blog.data() as any)?.updatedAt) ?? nowIso() });
  }
  return rows;
};

export const setBlogIndexingFirebase = async (tripId: string, userId: string, enabled: boolean): Promise<void> => {
  if (!(await ensureUserInTrip(tripId, userId))) throw new Error('Not authorized');
  await getDb().collection('trip_blogs').doc(tripId).set({ indexingEnabled: enabled, updatedAt: nowIso() }, { merge: true });
};
