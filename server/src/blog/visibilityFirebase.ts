import { randomUUID } from 'crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { getDb } from '../db.firebase';
import { blogDateOnly, blogDestinationCoordinates, type BlogPrivacyChoice, type BlogVisibilityContext, type BlogVisibilityResult } from './visibilityTypes';

/** Restart-safe one-time opt-in of the existing test accounts, authorized for the R1 rollout. */
export const migrateBlogVisibilityTestUsers = async (): Promise<void> => {
  const db = getDb(), marker = db.collection('schema_migrations').doc('r1_blog_visibility');
  if ((await marker.get()).exists) return;
  for (const collection of ['users', 'trip_blogs']) {
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (;;) {
      let query = db.collection(collection).orderBy(FieldPath.documentId()).limit(200);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      for (const doc of page.docs) await db.runTransaction(async tx => {
        const latest = await tx.get(doc.ref);
        if (!latest.exists || latest.data()?.blogVisibilityV1Migrated === true) return;
        tx.update(doc.ref, { ...(collection === 'users' ? { blogDefaultPublic: true } : { publicOptOut: false }), blogVisibilityV1Migrated: true });
      });
      cursor = page.docs[page.docs.length - 1];
    }
  }
  await marker.set({ completedAt: new Date().toISOString() });
};

export const loadBlogVisibilityContext = async (tripId: string): Promise<BlogVisibilityContext | null> => {
  const db = getDb(), trip = await db.collection('trips').doc(tripId).get();
  const t = trip.data(); if (!t) return null;
  const [blog, members, choices, destination, preferences, removals] = await Promise.all([
    db.collection('trip_blogs').doc(tripId).get(),
    db.collection('group_members').where('groupId', '==', t.groupId).get(),
    db.collection('trip_blog_privacy_choices').where('tripId', '==', tripId).get(),
    t.locationIds?.[0] ? db.collection('locations').doc(String(t.locationIds[0])).get() : Promise.resolve(null),
    t.createdBy ? db.collection('notification_preferences').where('userId', '==', t.createdBy).limit(1).get() : Promise.resolve(null),
    db.collection('trip_removals').where('tripId', '==', tripId).get(),
  ]);
  const removedIds = new Set(removals.docs.map(d => String(d.data().userId)));
  const ids = [...new Set(members.docs.map(d => d.data()).filter(m => m.removedAt == null && m.userId && !removedIds.has(String(m.userId))).map(m => String(m.userId)))];
  const users = ids.length ? await db.getAll(...ids.map(id => db.collection('users').doc(id))) : [];
  const byUser = new Map(choices.docs.map(d => [String(d.data().userId), d.data()]));
  const pref = preferences?.docs[0]?.data();
  return { tripId, startDate: blogDateOnly(t.startDate), timezone: t.timezone ?? null,
    organizerTimezone: pref?.digestTiming?.timezone ?? pref?.quietTiming?.timezone ?? null,
    destination: blogDestinationCoordinates(destination?.data()?.payload), earlyRelease: blog.data()?.earlyRelease === true,
    members: users.map(u => { const data = u.data(), choice = byUser.get(u.id); return { userId: u.id,
      firstName: data?.firstName ?? 'Traveler', dateOfBirth: blogDateOnly(data?.dateOfBirth ?? data?.date_of_birth),
      publicByDefault: data?.blogDefaultPublic !== false, optOut: choice?.optOut === true, optIn: choice?.optIn === true }; }) };
};

export const writeBlogPrivacyChoice = async (tripId: string, userId: string, choice: BlogPrivacyChoice): Promise<void> => {
  const fields: Record<string, unknown> = { tripId, userId, updatedAt: new Date().toISOString() };
  if (choice.optOut !== undefined) fields.optOut = choice.optOut;
  if (choice.optIn !== undefined) fields.optIn = choice.optIn;
  await getDb().collection('trip_blog_privacy_choices').doc(`${tripId}_${userId}`).set(fields, { merge: true });
};

const slug = (v: string) => v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'trip';
export const persistBlogVisibility = async (tripId: string, evaluation: BlogVisibilityResult, actorUserId: string, now: string): Promise<boolean> => {
  const db = getDb();
  return db.runTransaction(async tx => {
    const ref = db.collection('trip_blogs').doc(tripId);
    const [trip, blog, epochs, aliases, actor] = await Promise.all([
      tx.get(db.collection('trips').doc(tripId)), tx.get(ref),
      tx.get(db.collection('blog_publication_epochs').where('tripId', '==', tripId)),
      tx.get(db.collection('blog_public_aliases').where('tripId', '==', tripId)),
      tx.get(db.collection('users').doc(actorUserId)),
    ]);
    if (!trip.exists) return false;
    const b = blog.data(), state = evaluation.isPublic ? 'public' : 'private';
    const previous = b?.r1VisibilityPublic;
    const changed = typeof previous === 'boolean' ? previous !== evaluation.isPublic : (b?.visibilityState ?? 'private') !== state;
    const epoch = Math.max(1, Number(b?.visibilityEpoch ?? 0) + (changed ? 1 : 0));
    const username = slug(actor.data()?.username || actorUserId);
    let tripSlug = slug(trip.data()?.name || 'trip');
    const needsAlias = !aliases.docs.some(d => d.data().canonical === true);
    if (needsAlias) {
      const collisions = await tx.get(db.collection('blog_public_aliases').where('usernameSlug', '==', username).where('tripSlug', '==', tripSlug));
      if (collisions.docs.some(d => d.data().tripId !== tripId)) tripSlug += `-${tripId.slice(0, 8)}`;
    }
    tx.set(ref, { ...(!blog.exists ? { tripId, title: trip.data()?.name || 'Trip Blog', contentRevision: 0, createdAt: now } : {}),
      visibilityState: state, visibilityEpoch: epoch, r1VisibilityPublic: evaluation.isPublic, updatedAt: now }, { merge: true });
    if (changed || previous === undefined) tx.create(db.collection('blog_visibility_transitions').doc(randomUUID()), { tripId, isPublic: evaluation.isPublic, reasons: evaluation.reasons, occurredAt: now });
    for (const doc of epochs.docs) if (['public', 'pending_consent'].includes(doc.data().state)) tx.update(doc.ref, { state: 'revoked', updatedAt: now });
    if (evaluation.isPublic) {
      const existing = epochs.docs.find(d => Number(d.data().epoch) === epoch);
      tx.set(existing?.ref ?? db.collection('blog_publication_epochs').doc(randomUUID()), { tripId, epoch, state: 'public', requestedBy: actorUserId, updatedAt: now }, { merge: true });
    }
    if (needsAlias) tx.create(db.collection('blog_public_aliases').doc(randomUUID()), { tripId, userId: actorUserId, usernameSlug: username, tripSlug, canonical: true, createdAt: now });
    return changed && evaluation.isPublic;
  });
};

export const writeBlogEarlyRelease = async (tripId: string): Promise<void> => { await getDb().collection('trip_blogs').doc(tripId).set({ earlyRelease: true }, { merge: true }); };
export const listTripsForBlogVisibility = async (): Promise<string[]> => (await getDb().collection('trips').get()).docs.map(d => d.id);
