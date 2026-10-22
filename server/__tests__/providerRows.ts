import { getCurrentDbProvider } from '../src/db';

// Fixtures and assertions that need to look at stored rows, on whichever adapter is active.
// pg-mem is the default; the Firestore emulator is used with JEST_DB_PROVIDER=firebase. Tests
// should prefer the public API and db facade, and use these only where a stored shape (for
// example, that a secret is encrypted) is the thing being checked.

export const isFirebase = (): boolean => getCurrentDbProvider() === 'firebase';

export const firestore = () => (require('../src/db.firebase') as typeof import('../src/db.firebase')).getDb();

export const sql = <T = any>(text: string, params: unknown[] = []) =>
  (require('../src/db.postgres') as typeof import('../src/db.postgres')).queryBlog<T>(text, params);

export const docs = async (collection: string, filters: Array<[string, unknown]> = []): Promise<Array<Record<string, any> & { _id: string }>> => {
  let query: FirebaseFirestore.Query = firestore().collection(collection);
  for (const [field, value] of filters) query = query.where(field, '==', value);
  return (await query.get()).docs.map(doc => ({ ...(doc.data() as Record<string, any>), _id: doc.id }));
};

// ---- Blog fixtures --------------------------------------------------------------------------
// Direct writes that stand in for things the API does not expose (adding a member without an
// invite, following a trip, reading a stored visibility). Each works on pg-mem and on Firestore.

import { randomUUID } from 'crypto';

export const groupIdForTrip = async (tripId: string): Promise<string> =>
  isFirebase()
    ? String((await firestore().collection('trips').doc(tripId).get()).data()?.groupId)
    : String((await sql<{ group_id: string }>('SELECT group_id FROM trips WHERE id = $1', [tripId])).rows[0].group_id);

// Direct writes skip the API's access projections, which Firestore membership checks read.
const rebuildAccess = async (groupId: string, tripId?: string) => {
  if (!isFirebase()) return;
  const fb = require('../src/db.firebase') as typeof import('../src/db.firebase');
  await fb.rebuildGroupAccessForGroup(groupId);
  if (tripId) await fb.rebuildTripAccessForTrip(tripId);
};

/** Makes an existing account a full traveler on the trip's group, without the invite flow. */
export const addTripMember = async (tripId: string, userId: string): Promise<string> => {
  const groupId = await groupIdForTrip(tripId);
  if (isFirebase()) {
    await firestore().collection('group_members').doc(randomUUID()).set({ groupId, userId, addedBy: userId, createdAt: new Date().toISOString(), removedAt: null });
    await rebuildAccess(groupId, tripId);
  } else {
    await sql('INSERT INTO group_members (id, group_id, user_id, added_by) VALUES ($1, $2, $3, $3)', [randomUUID(), groupId, userId]);
  }
  return groupId;
};

/** Adds guests (travelers without an account) to the trip's group, added by the group's owner. */
export const addTripGuests = async (tripId: string, count: number): Promise<void> => {
  const groupId = await groupIdForTrip(tripId);
  const addedBy = isFirebase()
    ? String((await firestore().collection('groups').doc(groupId).get()).data()?.ownerId)
    : String((await sql<{ owner_id: string }>('SELECT owner_id FROM groups WHERE id = $1', [groupId])).rows[0].owner_id);
  for (let i = 0; i < count; i += 1) {
    if (isFirebase()) await firestore().collection('group_members').doc(randomUUID()).set({ groupId, guestName: `Guest ${i}`, addedBy, createdAt: new Date().toISOString(), removedAt: null });
    else await sql('INSERT INTO group_members (id, group_id, guest_name, added_by) VALUES ($1, $2, $3, $4)', [randomUUID(), groupId, `Guest ${i}`, addedBy]);
  }
  await rebuildAccess(groupId, tripId);
};

export const followTripAs = async (tripId: string, followerUserId: string): Promise<void> => {
  if (isFirebase()) {
    await firestore().collection('trip_followers').doc(randomUUID()).set({ tripId, followerUserId, role: 'follower', createdAt: new Date().toISOString() });
    await (require('../src/db.firebase') as typeof import('../src/db.firebase')).rebuildTripAccessForTrip(tripId);
  } else await sql('INSERT INTO trip_followers (id, trip_id, follower_user_id) VALUES ($1, $2, $3)', [randomUUID(), tripId, followerUserId]);
};

export const blogDayIdFor = async (tripId: string, localDate: string): Promise<string> =>
  isFirebase()
    ? (await firestore().collection('blog_days').where('tripId', '==', tripId).where('localDate', '==', localDate).limit(1).get()).docs[0].id
    : String((await sql<{ id: string }>('SELECT id FROM blog_days WHERE trip_id = $1 AND local_date = $2::date', [tripId, localDate])).rows[0].id);

export type StoredBlog = { visibilityState: string | null; visibilityEpoch: number; followerCommentsEnabled: boolean | null };
export const storedBlog = async (tripId: string): Promise<StoredBlog | null> => {
  if (isFirebase()) {
    const snap = await firestore().collection('trip_blogs').doc(tripId).get();
    if (!snap.exists) return null;
    const d = snap.data() as any;
    return { visibilityState: d.visibilityState ?? null, visibilityEpoch: Number(d.visibilityEpoch ?? 0), followerCommentsEnabled: d.followerCommentsEnabled ?? null };
  }
  const row = (await sql('SELECT visibility_state, visibility_epoch, follower_comments_enabled FROM trip_blogs WHERE trip_id = $1', [tripId])).rows[0];
  return row ? { visibilityState: row.visibility_state, visibilityEpoch: Number(row.visibility_epoch ?? 0), followerCommentsEnabled: row.follower_comments_enabled } : null;
};
export const setFollowerComments = async (tripId: string, enabled: boolean): Promise<void> => {
  if (isFirebase()) await firestore().collection('trip_blogs').doc(tripId).set({ followerCommentsEnabled: enabled }, { merge: true });
  else await sql('UPDATE trip_blogs SET follower_comments_enabled = $2 WHERE trip_id = $1', [tripId, enabled]);
};

export const setDateOfBirth = async (userId: string, dateOfBirth: string | null): Promise<void> => {
  if (isFirebase()) await firestore().collection('users').doc(userId).update({ dateOfBirth });
  else await sql('UPDATE users SET date_of_birth = $2::date WHERE id = $1', [userId, dateOfBirth]);
};

// ---- Publication state ----------------------------------------------------------------------
export const setStoredVisibility = async (tripId: string, state: 'public' | 'private'): Promise<void> => {
  if (isFirebase()) await firestore().collection('trip_blogs').doc(tripId).set({ visibilityState: state }, { merge: true });
  else await sql('UPDATE trip_blogs SET visibility_state = $2 WHERE trip_id = $1', [tripId, state]);
};
export const insertPublicEpoch = async (tripId: string, requestedBy: string, epoch = 1): Promise<void> => {
  if (isFirebase()) await firestore().collection('blog_publication_epochs').doc(randomUUID()).set({ tripId, epoch, state: 'public', requestedBy, expiresAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  else await sql("INSERT INTO blog_publication_epochs (id, trip_id, epoch, state, requested_by) VALUES ($1, $2, $3, 'public', $4)", [randomUUID(), tripId, epoch, requestedBy]);
};
export const deleteEpochs = async (tripId: string): Promise<void> => {
  if (isFirebase()) await Promise.all((await firestore().collection('blog_publication_epochs').where('tripId', '==', tripId).get()).docs.map(d => d.ref.delete()));
  else await sql('DELETE FROM blog_publication_epochs WHERE trip_id = $1', [tripId]);
};
export const revokeEpochs = async (tripId: string): Promise<void> => {
  if (isFirebase()) await Promise.all((await firestore().collection('blog_publication_epochs').where('tripId', '==', tripId).get()).docs.map(d => d.ref.set({ state: 'revoked' }, { merge: true })));
  else await sql("UPDATE blog_publication_epochs SET state = 'revoked' WHERE trip_id = $1", [tripId]);
};
export const epochState = async (tripId: string, epoch: number): Promise<string | undefined> =>
  isFirebase()
    ? (await docs('blog_publication_epochs', [['tripId', tripId]])).find(d => Number(d.epoch) === epoch)?.state
    : (await sql('SELECT state FROM blog_publication_epochs WHERE trip_id = $1 AND epoch = $2', [tripId, epoch])).rows[0]?.state;
export const insertPublicAlias = async (tripId: string, userId: string, usernameSlug: string, tripSlug: string): Promise<void> => {
  if (isFirebase()) await firestore().collection('blog_public_aliases').doc(randomUUID()).set({ tripId, userId, usernameSlug, tripSlug, canonical: true, redirectUntil: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  else await sql('INSERT INTO blog_public_aliases (id, trip_id, user_id, username_slug, trip_slug, canonical) VALUES ($1, $2, $3, $4, $5, TRUE)', [randomUUID(), tripId, userId, usernameSlug, tripSlug]);
};
export const canonicalAlias = async (tripId: string): Promise<{ usernameSlug: string; tripSlug: string } | undefined> => {
  if (isFirebase()) {
    const row = (await docs('blog_public_aliases', [['tripId', tripId]])).find(d => d.canonical === true);
    return row ? { usernameSlug: row.usernameSlug, tripSlug: row.tripSlug } : undefined;
  }
  const row = (await sql('SELECT username_slug, trip_slug FROM blog_public_aliases WHERE trip_id = $1 AND canonical = TRUE', [tripId])).rows[0];
  return row ? { usernameSlug: row.username_slug, tripSlug: row.trip_slug } : undefined;
};

// ---- Stored items, assets, comments, reactions, counters (normalized to camelCase) ----------
export const authorOfBlogItem = async (itemId: string): Promise<string> =>
  isFirebase()
    ? String((await firestore().collection('blog_items').doc(itemId).get()).data()?.authorUserId)
    : String((await sql('SELECT author_user_id FROM blog_items WHERE id = $1', [itemId])).rows[0].author_user_id);
export const blogItemExists = async (itemId: string): Promise<number> =>
  isFirebase() ? ((await firestore().collection('blog_items').doc(itemId).get()).exists ? 1 : 0) : (await sql('SELECT id FROM blog_items WHERE id = $1', [itemId])).rows.length;
export const blogItemTags = async (itemId: string): Promise<string[]> =>
  isFirebase()
    ? ((await firestore().collection('blog_items').doc(itemId).get()).data()?.tags ?? [])
    : ((await sql('SELECT tags FROM blog_items WHERE id = $1', [itemId])).rows[0]?.tags ?? []);
export const mediaAssetRow = async (assetId: string): Promise<{ tags: string[]; state: string } | undefined> => {
  if (isFirebase()) {
    const snap = await firestore().collection('blog_media_assets').doc(assetId).get();
    return snap.exists ? { tags: (snap.data() as any).tags ?? [], state: (snap.data() as any).state } : undefined;
  }
  const row = (await sql('SELECT tags, state FROM blog_media_assets WHERE id = $1', [assetId])).rows[0];
  return row ? { tags: row.tags ?? [], state: row.state } : undefined;
};

const inList = (start: number, n: number) => Array.from({ length: n }, (_, i) => `$${start + i}`).join(',');
/** Reactions attached to any of these targets (item, day or asset ids). */
export const reactionRows = async (targetIds: string[]): Promise<Array<{ targetKind: string; targetId: string }>> => {
  if (isFirebase()) {
    const out: Array<{ targetKind: string; targetId: string }> = [];
    for (const id of targetIds) for (const d of await docs('blog_reactions', [['targetId', id]])) out.push({ targetKind: d.targetKind, targetId: d.targetId });
    return out;
  }
  const ph = inList(1, targetIds.length);
  const rows = (await sql(`SELECT target_kind, blog_day_id, blog_item_id, asset_id FROM blog_reactions WHERE blog_item_id IN (${ph}) OR blog_day_id IN (${ph}) OR asset_id IN (${ph})`, targetIds)).rows;
  return rows.map((r: any) => ({ targetKind: r.target_kind, targetId: r.blog_day_id ?? r.blog_item_id ?? r.asset_id }));
};
export const counterRows = async (targetIds: string[]): Promise<Array<{ targetKind: string; targetId: string; audience: string; reactionTotal: number; commentCount: number }>> => {
  if (isFirebase()) {
    const out = [];
    for (const id of targetIds) for (const d of await docs('blog_engagement_counters', [['targetId', id]])) out.push({ targetKind: d.targetKind, targetId: d.targetId, audience: d.audience, reactionTotal: Number(d.reactionTotal ?? 0), commentCount: Number(d.commentCount ?? 0) });
    return out;
  }
  const rows = (await sql(`SELECT target_kind, target_id, audience, reaction_total, comment_count FROM blog_engagement_counters WHERE target_id IN (${inList(1, targetIds.length)})`, targetIds)).rows;
  return rows.map((r: any) => ({ targetKind: r.target_kind, targetId: String(r.target_id), audience: r.audience, reactionTotal: Number(r.reaction_total ?? 0), commentCount: Number(r.comment_count ?? 0) }));
};
export const commentRow = async (id: string): Promise<{ body: string | null; authorUserId: string | null; deletedAt: unknown } | undefined> => {
  if (isFirebase()) {
    const snap = await firestore().collection('blog_comments').doc(id).get();
    if (!snap.exists) return undefined;
    const d = snap.data() as any;
    return { body: d.body ?? null, authorUserId: d.authorUserId ?? null, deletedAt: d.deletedAt ?? null };
  }
  const row = (await sql('SELECT body, author_user_id, deleted_at FROM blog_comments WHERE id = $1', [id])).rows[0];
  return row ? { body: row.body, authorUserId: row.author_user_id, deletedAt: row.deleted_at } : undefined;
};

// ---- Public engagement fixtures -------------------------------------------------------------
export const visitorReactionCount = async (visitorId: string): Promise<number> =>
  isFirebase()
    ? (await docs('blog_reactions', [['userId', `public-visitor:${visitorId}`]])).length
    : (await sql('SELECT id FROM blog_reactions WHERE visitor_id = $1', [visitorId])).rows.length;

/** Marks an uploaded photo ready and makes its blog item public, as processing would. */
export const publishUploadedAsset = async (assetId: string): Promise<void> => {
  if (isFirebase()) {
    const ref = firestore().collection('blog_media_assets').doc(assetId);
    await ref.set({ state: 'ready' }, { merge: true });
    await firestore().collection('blog_items').doc(String((await ref.get()).data()?.blogItemId)).set({ audience: 'public' }, { merge: true });
  } else {
    await sql("UPDATE blog_media_assets SET state = 'ready' WHERE id = $1", [assetId]);
    await sql("UPDATE blog_items SET audience = 'public' WHERE id IN (SELECT item_id FROM blog_item_assets WHERE asset_id = $1)", [assetId]);
  }
};
export const softDeleteItemOfAsset = async (assetId: string): Promise<void> => {
  if (isFirebase()) {
    const itemId = String((await firestore().collection('blog_media_assets').doc(assetId).get()).data()?.blogItemId);
    await firestore().collection('blog_items').doc(itemId).set({ deletedAt: new Date().toISOString() }, { merge: true });
  } else await sql('UPDATE blog_items SET deleted_at = NOW() WHERE id IN (SELECT item_id FROM blog_item_assets WHERE asset_id = $1)', [assetId]);
};

// ---- Recap fixtures -------------------------------------------------------------------------
export const seedAirports = async (airports: Array<{ code: string; name: string; city: string; country: string; lat: number; lng: number }>): Promise<void> => {
  for (const a of airports) {
    if (isFirebase()) await firestore().collection('airports').doc(a.code).set({ iataCode: a.code, name: a.name, city: a.city, country: a.country, lat: a.lat, lng: a.lng });
    else await sql('INSERT INTO airports (iata_code, name, city, country, lat, lng) VALUES ($1, $2, $3, $4, $5, $6)', [a.code, a.name, a.city, a.country, a.lat, a.lng]);
  }
};
export const seedDayCommentCount = async (tripId: string, dayDate: string, audience: string, commentCount: number): Promise<void> => {
  const dayId = await blogDayIdFor(tripId, dayDate);
  if (isFirebase()) await firestore().collection('blog_engagement_counters').doc(`day:${dayId}:${audience}`).set({ targetKind: 'day', targetId: dayId, tripId, audience, reactionCounts: {}, reactionTotal: 0, commentCount });
  else await sql("INSERT INTO blog_engagement_counters (target_kind, target_id, trip_id, audience, reaction_counts, reaction_total, comment_count) VALUES ('day', $1, $2, $3, '{}'::jsonb, 0, $4)", [dayId, tripId, audience, commentCount]);
};
export const bumpContentRevision = async (tripId: string): Promise<void> => {
  if (isFirebase()) {
    const { FieldValue } = require('firebase-admin/firestore') as typeof import('firebase-admin/firestore');
    await firestore().collection('trip_blogs').doc(tripId).set({ contentRevision: FieldValue.increment(1) }, { merge: true });
  } else await sql('UPDATE trip_blogs SET content_revision = content_revision + 1 WHERE trip_id = $1', [tripId]);
};
export const recapSnapshotStates = async (tripId: string): Promise<Array<{ state: string; failureCode: string | null }>> =>
  isFirebase()
    ? (await docs('blog_recap_snapshots', [['tripId', tripId]])).map(d => ({ state: d.state, failureCode: d.failureCode ?? null }))
    : (await sql('SELECT state, failure_code FROM blog_recap_snapshots WHERE trip_id = $1', [tripId])).rows.map((r: any) => ({ state: r.state, failureCode: r.failure_code }));
/** Makes a claimed snapshot look abandoned by a crashed worker. */
export const abandonRecapSnapshot = async (tripId: string, contentRevision: number): Promise<void> => {
  if (isFirebase()) {
    await Promise.all((await docs('blog_recap_snapshots', [['tripId', tripId]])).filter(d => Number(d.contentRevision) === contentRevision)
      .map(d => firestore().collection('blog_recap_snapshots').doc(d._id).set({ state: 'pending', leaseExpiresAt: '2000-01-01T00:00:00.000Z', leaseOwner: 'dead-worker' }, { merge: true })));
  } else await sql("UPDATE blog_recap_snapshots SET state = 'pending', lease_expires_at = '2000-01-01', lease_owner = 'dead-worker' WHERE trip_id = $1 AND content_revision = $2", [tripId, contentRevision]);
};
