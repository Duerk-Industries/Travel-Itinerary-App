import { getDb } from '../db.firebase';
import type { BlogRecapAudienceClass, BlogRecapPayload, BlogRecapRevision, BlogRecapSnapshot, BlogRecapSource } from './recapTypes';
import { routeDistanceKm } from './recapDistance';

const nowIso = (): string => new Date().toISOString();
const snapshotId = (revision: BlogRecapRevision, audience: BlogRecapAudienceClass): string =>
  `${revision.tripId}:${revision.contentRevision}:${revision.engagementRevision}:${audience}`;
const visibleAudiences = (audience: BlogRecapAudienceClass): string[] =>
  audience === 'travelers' ? ['travelers', 'followers', 'public'] : ['followers', 'public'];

export const getRecapRevision = async (tripId: string): Promise<BlogRecapRevision | null> => {
  const snap = await getDb().collection('trip_blogs').doc(tripId).get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  return { tripId, title: String(data.title ?? 'Trip recap'), contentRevision: Number(data.contentRevision ?? 0), engagementRevision: Number(data.engagementRevision ?? 0) };
};

export const getRecapSnapshot = async (revision: BlogRecapRevision, audienceClass: BlogRecapAudienceClass): Promise<BlogRecapSnapshot | null> => {
  const snap = await getDb().collection('blog_recap_snapshots').doc(snapshotId(revision, audienceClass)).get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  return { ...revision, audienceClass, state: data.state, payload: data.payload ?? null, leaseOwner: data.leaseOwner ?? null, leaseExpiresAt: data.leaseExpiresAt ?? null, updatedAt: String(data.updatedAt ?? nowIso()) };
};

export const claimRecapSnapshot = async (revision: BlogRecapRevision, audienceClass: BlogRecapAudienceClass, leaseOwner: string, leaseSeconds: number): Promise<boolean> => {
  const ref = getDb().collection('blog_recap_snapshots').doc(snapshotId(revision, audienceClass));
  return getDb().runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const data = current.exists ? current.data() as any : null;
    const expired = !data?.leaseExpiresAt || new Date(data.leaseExpiresAt).getTime() < Date.now();
    if (data?.state === 'ready' || (data?.state === 'pending' && !expired)) return false;
    tx.set(ref, { tripId: revision.tripId, contentRevision: revision.contentRevision, engagementRevision: revision.engagementRevision, audienceClass, state: 'pending', payload: null, leaseOwner, leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000).toISOString(), failureCode: null, createdAt: data?.createdAt ?? nowIso(), updatedAt: nowIso() }, { merge: true });
    return true;
  });
};

export const completeRecapSnapshot = async (revision: BlogRecapRevision, audienceClass: BlogRecapAudienceClass, leaseOwner: string, payload: BlogRecapPayload): Promise<void> => {
  const ref = getDb().collection('blog_recap_snapshots').doc(snapshotId(revision, audienceClass));
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || (snap.data() as any)?.leaseOwner !== leaseOwner) return;
    tx.set(ref, { state: 'ready', payload, leaseOwner: null, leaseExpiresAt: null, failureCode: null, updatedAt: nowIso() }, { merge: true });
  });
};

export const failRecapSnapshot = async (revision: BlogRecapRevision, audienceClass: BlogRecapAudienceClass, leaseOwner: string, failureCode: string): Promise<void> => {
  const ref = getDb().collection('blog_recap_snapshots').doc(snapshotId(revision, audienceClass));
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || (snap.data() as any)?.leaseOwner !== leaseOwner) return;
    tx.set(ref, { state: 'failed', leaseOwner: null, leaseExpiresAt: null, failureCode: failureCode.slice(0, 100), updatedAt: nowIso() }, { merge: true });
  });
};

export const pruneRecapSnapshots = async (tripId: string, retain: number): Promise<Array<{ contentRevision: number; engagementRevision: number; audienceClass: BlogRecapAudienceClass }>> => {
  const snap = await getDb().collection('blog_recap_snapshots').where('tripId', '==', tripId).get();
  const stale = snap.docs.sort((a, b) => String((b.data() as any).updatedAt).localeCompare(String((a.data() as any).updatedAt))).slice(Math.max(0, retain));
  await Promise.all(stale.map((doc) => doc.ref.delete()));
  return stale.map((doc) => { const data = doc.data() as any; return { contentRevision: Number(data.contentRevision), engagementRevision: Number(data.engagementRevision), audienceClass: data.audienceClass }; });
};

export const getRecapSource = async (tripId: string, audienceClass: BlogRecapAudienceClass): Promise<BlogRecapSource> => {
  const db = getDb();
  const audiences = new Set(visibleAudiences(audienceClass));
  const [daySnap, itemSnap, mediaSnap, followerSnap, reactionSnap, tripSnap, tourSnap, lodgingSnap, rentalSnap, flightSnap] = await Promise.all([
    db.collection('blog_days').where('tripId', '==', tripId).limit(500).get(),
    db.collection('blog_items').where('tripId', '==', tripId).limit(5000).get(),
    db.collection('blog_media_assets').where('tripId', '==', tripId).limit(5000).get(),
    db.collection('trip_followers').where('tripId', '==', tripId).limit(5000).get(),
    db.collection('blog_reactions').where('tripId', '==', tripId).limit(10000).get(),
    db.collection('trips').doc(tripId).get(),
    db.collection('tours').where('tripId', '==', tripId).limit(1000).get(),
    db.collection('lodgings').where('trip_id', '==', tripId).limit(1000).get(),
    db.collection('car_rentals').where('tripId', '==', tripId).limit(1000).get(),
    db.collection('flights').where('tripId', '==', tripId).limit(500).get(),
  ]);
  const items = itemSnap.docs.filter((doc) => {
    const data = doc.data() as any;
    return data.deletedAt == null && audiences.has(String(data.audience ?? 'public'));
  });
  const visibleItemIds = new Set(items.map((doc) => doc.id));
  const counterSnap = await db.collection('blog_engagement_counters').where('tripId', '==', tripId).limit(10000).get();
  const reactionByAsset = new Map<string, number>();
  for (const doc of counterSnap.docs) {
    const data = doc.data() as any;
    if (data.targetKind !== 'asset' || !audiences.has(String(data.audience))) continue;
    reactionByAsset.set(String(data.targetId), (reactionByAsset.get(String(data.targetId)) ?? 0) + Number(data.reactionTotal ?? 0));
  }
  const media = mediaSnap.docs.filter((doc) => {
    const data = doc.data() as any;
    return data.state === 'ready' && visibleItemIds.has(String(data.blogItemId));
  });
  const countsByUser = new Map<string, number>();
  for (const item of items) {
    const userId = String((item.data() as any).authorUserId ?? '');
    if (userId) countsByUser.set(userId, (countsByUser.get(userId) ?? 0) + 1);
  }
  const rankedContributors = [...countsByUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const contributors = audienceClass === 'travelers' ? await Promise.all(rankedContributors.map(async ([userId, contributionCount]) => {
    const user = await db.collection('users').doc(userId).get();
    const data = user.exists ? user.data() as any : {};
    const displayName = `${data.firstName ?? data.first_name ?? ''} ${data.lastName ?? data.last_name ?? ''}`.trim() || String(data.email ?? 'A traveler');
    return { userId, displayName, contributionCount };
  })) : [];
  const photosByUser = new Map<string, number>();
  for (const asset of media) {
    const data = asset.data() as any;
    const userId = String(data.uploaderUserId ?? '');
    if (userId && data.mediaKind === 'photo') photosByUser.set(userId, (photosByUser.get(userId) ?? 0) + 1);
  }
  const topPhotoUser = [...photosByUser.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null;
  let topPhotoContributor: BlogRecapSource['topPhotoContributor'] = null;
  if (audienceClass === 'travelers' && topPhotoUser) {
    const user = await db.collection('users').doc(topPhotoUser[0]).get();
    const data = user.exists ? user.data() as any : {};
    topPhotoContributor = { userId: topPhotoUser[0], displayName: `${data.firstName ?? data.first_name ?? ''} ${data.lastName ?? data.last_name ?? ''}`.trim() || String(data.email ?? 'A traveler'), photoCount: topPhotoUser[1] };
  }
  const groupId = String((tripSnap.data() as any)?.groupId ?? '');
  const memberSnap = groupId ? await db.collection('group_members').where('groupId', '==', groupId).limit(5000).get() : null;
  const followerIds = new Set(followerSnap.docs.map((doc) => String((doc.data() as any).followerUserId ?? '')).filter(Boolean));
  const participatingFollowerIds = new Set(reactionSnap.docs.map((doc) => String((doc.data() as any).userId ?? '')).filter((userId) => followerIds.has(userId)));
  const places = new Set<string>();
  for (const doc of tourSnap.docs) {
    const value = String((doc.data() as any).startLocation ?? '').trim();
    if (value) places.add(value.toLowerCase());
  }
  for (const doc of lodgingSnap.docs) {
    const value = String((doc.data() as any).address ?? '').trim();
    if (value) places.add(value.toLowerCase());
  }
  for (const doc of rentalSnap.docs) {
    const value = String((doc.data() as any).pickupLocation ?? '').trim();
    if (value) places.add(value.toLowerCase());
  }
  const uniqueFlights = new Map<string, any>();
  for (const doc of flightSnap.docs) {
    const data = doc.data() as any;
    if (String(data.status ?? '').toLowerCase() === 'cancelled') continue;
    const key = [data.departureDate, data.departureTime, data.flightNumber, data.departureAirportCode, data.layoverLocationCode, data.arrivalAirportCode].join('|');
    uniqueFlights.set(key, data);
  }
  const airportCodes = [...new Set([...uniqueFlights.values()].flatMap((flight) => [flight.departureAirportCode, flight.layoverLocationCode, flight.arrivalAirportCode]).map((value) => String(value ?? '').trim().toUpperCase()).filter(Boolean))].slice(0, 1000);
  const airportDocs = airportCodes.length ? await db.getAll(...airportCodes.map((code) => db.collection('airports').doc(code))) : [];
  const airportByCode = new Map(airportDocs.filter((doc) => doc.exists).map((doc) => {
    const data = doc.data() as any;
    return [doc.id, { lat: data.lat == null ? null : Number(data.lat), lng: data.lng == null ? null : Number(data.lng) }];
  }));
  const distanceKm = Math.round([...uniqueFlights.values()].reduce((sum, flight) => sum + routeDistanceKm([
    airportByCode.get(String(flight.departureAirportCode ?? '').toUpperCase()) ?? null,
    airportByCode.get(String(flight.layoverLocationCode ?? '').toUpperCase()) ?? null,
    airportByCode.get(String(flight.arrivalAirportCode ?? '').toUpperCase()) ?? null,
  ].filter(Boolean)), 0));
  const dayDateById = new Map(daySnap.docs.map((doc) => [doc.id, String((doc.data() as any).localDate ?? '')]));
  const commentsByDay = new Map<string, number>();
  for (const doc of counterSnap.docs) {
    const data = doc.data() as any;
    if (data.targetKind !== 'day' || !audiences.has(String(data.audience))) continue;
    const dayDate = dayDateById.get(String(data.targetId));
    if (dayDate) commentsByDay.set(dayDate, (commentsByDay.get(dayDate) ?? 0) + Number(data.commentCount ?? 0));
  }
  const commented = [...commentsByDay.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null;
  return {
    dayCount: daySnap.size,
    placeCount: places.size,
    distanceKm,
    photoCount: media.filter((doc) => (doc.data() as any).mediaKind === 'photo').length,
    videoCount: media.filter((doc) => (doc.data() as any).mediaKind === 'video').length,
    travelerCount: memberSnap ? memberSnap.docs.filter((doc) => (doc.data() as any).userId && !(doc.data() as any).removedAt).length : 0,
    followerParticipantCount: participatingFollowerIds.size,
    media: media.map((doc) => ({ assetId: doc.id, caption: (doc.data() as any).caption ?? null, altText: (doc.data() as any).altText ?? null, reactionTotal: reactionByAsset.get(doc.id) ?? 0 })),
    contributors: contributors.sort((a, b) => b.contributionCount - a.contributionCount || a.displayName.localeCompare(b.displayName)),
    topPhotoContributor,
    mostCommentedDay: commented && commented[1] > 0 ? { dayDate: commented[0], commentCount: commented[1] } : null,
  };
};
