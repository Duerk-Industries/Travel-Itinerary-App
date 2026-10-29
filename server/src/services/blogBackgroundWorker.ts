import { queryBlog, withBlogTransaction } from '../db.postgres';
import { getDb } from '../db.firebase';
import { getCurrentDbProvider } from '../db';
import { notify } from './notificationService';
import { logError, logInfo } from '../logger';
import { randomUUID } from 'crypto';
import { isFeatureEnabled } from './entitlementService';
import { autoPublishBlogIfEligible } from '../routes/blogPublicationRoutes';
import { getBlogDayByDate, getVisibleMediaForDay, getGroupMemberUserIdsForTrip } from '../blog/firebaseBlogDayData';

const LEASE_SECONDS = 300;
const WORKER_ID = `blog-worker-${randomUUID()}`;

export const runBlogBackgroundJobs = async () => {
  if (getCurrentDbProvider() === 'firebase') {
    await runGoLiveJobFirebase();
    await runMemoryLaneJobFirebase();
    await runGroupPromptsJobFirebase();
    await runDayPhotoReminderJobFirebase();
    return;
  }
  await runGoLiveJob();
  await runMemoryLaneJob();
  await runGroupPromptsJob();
  await runDayPhotoReminderJob();
};

// End-of-day reminder gate: this worker has no per-trip timezone to compute a real local
// end-of-day against (trips carry no timezone column — see blogDayFactsService.ts's own
// "straight-line only" caveat for the same kind of honest approximation), so "end of day" is
// approximated as a fixed UTC evening window rather than pretending to a precision the data
// doesn't support. Runs hourly like the rest of this file; the window keeps it from firing at
// 2pm UTC for someone on the other side of the world.
const isEndOfDayWindow = (): boolean => {
  const hour = new Date().getUTCHours();
  return hour >= 20 || hour < 2;
};

// --- Go live at trip start ---------------------------------------------------------------------
// A blog is public from the day its trip starts, whether or not anyone has opened it by then.
// autoPublishBlogIfEligible does the real gating (start date, opt-out, ages, profile defaults,
// alt text) and does nothing once a publication decision exists, so this only has to offer it
// every trip that is under way. Trips are in progress from one day before start_date (see
// utils/blogGoLive.ts) until end_date.
const goLive = async (trips: Array<{ id: string; userIds: string[] }>): Promise<number> => {
  let published = 0;
  for (const trip of trips) {
    for (const userId of trip.userIds) {
      try {
        if (await autoPublishBlogIfEligible(trip.id, userId)) published += 1;
        break; // the first member decides: eligibility is a property of the whole trip
      } catch (error) {
        logError('[blog] go-live check failed', error);
      }
    }
  }
  return published;
};

const runGoLiveJob = async () => {
  if (!(await isFeatureEnabled('trip_blog_public_sharing'))) return;
  const jobKey = 'blog:go_live';
  if (!await claimLease(jobKey)) return;
  let success = false;
  try {
    const trips = await queryBlog<{ id: string; user_id: string }>(
      `SELECT t.id, gm.user_id FROM trips t
       JOIN group_members gm ON gm.group_id = t.group_id
       WHERE t.start_date <= $2::date AND t.end_date >= $1::date
         AND gm.removed_at IS NULL AND gm.user_id IS NOT NULL`,
      [new Date().toISOString().slice(0, 10), new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)]
    );
    const byTrip = new Map<string, string[]>();
    for (const row of trips.rows) byTrip.set(String(row.id), [...(byTrip.get(String(row.id)) ?? []), String(row.user_id)]);
    const published = await goLive([...byTrip].map(([id, userIds]) => ({ id, userIds })));
    if (published) logInfo(`[blog] went live at trip start: ${published}`);
    success = true;
  } catch (error) {
    logError('[blog] go-live job failed', error);
  } finally {
    await releaseLease(jobKey, success);
  }
};

const runGoLiveJobFirebase = async () => {
  if (!(await isFeatureEnabled('trip_blog_public_sharing'))) return;
  const jobKey = 'blog:go_live';
  if (!await claimLeaseFirebase(jobKey)) return;
  let success = false;
  try {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const snap = await db.collection('trips').where('startDate', '<=', tomorrow).get();
    const active = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) })).filter((t) => t.endDate && t.endDate >= today);
    const trips: Array<{ id: string; userIds: string[] }> = [];
    for (const trip of active) trips.push({ id: trip.id, userIds: await getGroupMemberUserIdsForTrip(trip.id) });
    const published = await goLive(trips);
    if (published) logInfo(`[blog] went live at trip start: ${published}`);
    success = true;
  } catch (error) {
    logError('[blog] go-live job failed', error);
  } finally {
    await releaseLeaseFirebase(jobKey, success);
  }
};

// --- Firebase lease primitive -----------------------------------------------------------------
// A Firestore-transaction equivalent of the claimLease/releaseLease pair below, keyed on the
// `blog_worker_leases` doc with id `jobKey` rather than a Postgres row keyed on job_key alone
// (this worker has no windowed schedule the way blogCounterReconciliationService.ts's hourly job
// does — it just wants "not already running elsewhere right now", so one doc per job is enough).
const claimLeaseFirebase = async (jobKey: string): Promise<boolean> => {
  const db = getDb();
  const ref = db.collection('blog_worker_leases').doc(jobKey);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_SECONDS * 1000);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists ? (snapshot.data() as any) : null;
    const currentExpiry = data?.leaseExpiresAt ? new Date(data.leaseExpiresAt) : null;
    if (currentExpiry && currentExpiry >= now) return false;
    transaction.set(ref, {
      leaseOwner: WORKER_ID,
      leaseExpiresAt: expiresAt.toISOString(),
      lastRunAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }, { merge: true });
    return true;
  });
};

const releaseLeaseFirebase = async (jobKey: string, success: boolean): Promise<void> => {
  const db = getDb();
  const ref = db.collection('blog_worker_leases').doc(jobKey);
  const now = new Date().toISOString();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists ? (snapshot.data() as any) : null;
    if (!data || data.leaseOwner !== WORKER_ID) return;
    const update: Record<string, unknown> = { leaseOwner: null, leaseExpiresAt: null, updatedAt: now };
    if (success) update.lastSuccessAt = now;
    transaction.set(ref, update, { merge: true });
  });
};

const claimLease = async (jobKey: string): Promise<boolean> => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_SECONDS * 1000);

  const result = await queryBlog(
    `UPDATE blog_worker_leases
     SET lease_owner = $2,
         lease_expires_at = $3,
         last_run_at = $1,
         updated_at = $1
     WHERE job_key = $4
       AND (lease_expires_at IS NULL OR lease_expires_at < $1)
     RETURNING 1`,
    [now, WORKER_ID, expiresAt, jobKey]
  );
  return result.rowCount > 0;
};

const releaseLease = async (jobKey: string, success: boolean) => {
  const now = new Date();
  await queryBlog(
    `UPDATE blog_worker_leases
     SET lease_owner = NULL,
         lease_expires_at = NULL,
         last_success_at = CASE WHEN $2 THEN $1 ELSE last_success_at END,
         updated_at = $1
     WHERE job_key = $3 AND lease_owner = $4`,
    [now, success, jobKey, WORKER_ID]
  );
};

const runMemoryLaneJob = async () => {
  const jobKey = 'blog:memory_lane';
  if (!await claimLease(jobKey)) return;

  let success = false;
  try {
    // Find trips that ended on this month/day in any previous year.
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();

    const trips = await queryBlog<{ id: string; name: string; end_date: string }>(
      `SELECT id, name, end_date
       FROM trips
       WHERE EXTRACT(MONTH FROM end_date) = $1
         AND EXTRACT(DAY FROM end_date) = $2
         AND end_date < $3::date
         AND end_date > $3::date - INTERVAL '20 years'`,
      [month, day, today.toISOString().slice(0, 10)]
    );

    for (const trip of trips.rows) {
      const years = today.getFullYear() - new Date(trip.end_date).getFullYear();
      const travelers = await queryBlog<{ user_id: string }>(
        `SELECT user_id FROM group_members gm
         JOIN trips t ON t.group_id = gm.group_id
         WHERE t.id = $1 AND gm.user_id IS NOT NULL AND gm.removed_at IS NULL`,
        [trip.id]
      );

      const userIds = travelers.rows.map(t => t.user_id);
      if (userIds.length > 0) {
        await notify({
          userIds,
          category: 'blog_memory_lane',
          tripId: trip.id,
          title: `Memory Lane: ${trip.name}`,
          body: `It's been ${years} year${years === 1 ? '' : 's'} since your trip ended! Revisit your blog to see the memories.`,
          deepLink: `/trips/${trip.id}/blog`,
          dedupeKey: `memory_lane:${trip.id}:${years}`
        });
      }
    }
    success = true;
    logInfo(`[blog-worker] Memory Lane job finished, processed ${trips.rows.length} trips`);
  } catch (err) {
    logError(`[blog-worker] Memory Lane job failed`, err);
  } finally {
    await releaseLease(jobKey, success);
  }
};

const runGroupPromptsJob = async () => {
  const jobKey = 'blog:group_prompts';
  if (!await claimLease(jobKey)) return;

  let success = false;
  try {
    // A12 Group Prompts: nudge members of active trips who haven't contributed in 2 days.
    const today = new Date();
    const cutoff = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);

    const activeTrips = await queryBlog<{ id: string; name: string }>(
      `SELECT id, name FROM trips
       WHERE start_date <= $1::date AND end_date >= $1::date`,
      [today.toISOString().slice(0, 10)]
    );

    for (const trip of activeTrips.rows) {
      const slackers = await queryBlog<{ user_id: string }>(
        `SELECT gm.user_id FROM group_members gm
         JOIN trips t ON t.group_id = gm.group_id
         WHERE t.id = $1 AND gm.user_id IS NOT NULL AND gm.removed_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM blog_items i
             WHERE i.trip_id = $1 AND i.author_user_id = gm.user_id
               AND i.created_at > $2
           )`,
        [trip.id, cutoff]
      );

      const userIds = slackers.rows.map(s => s.user_id);
      if (userIds.length > 0) {
        await notify({
          userIds,
          category: 'blog_nudge',
          tripId: trip.id,
          title: `Your group is waiting!`,
          body: `Everyone else is sharing memories from ${trip.name}. Add a photo or note to the blog today!`,
          deepLink: `/trips/${trip.id}/blog`,
          dedupeKey: `group_prompt:${trip.id}:${today.toISOString().slice(0, 10)}`
        });
      }
    }

    success = true;
    logInfo(`[blog-worker] Group Prompts job finished, processed ${activeTrips.rows.length} trips`);
  } catch (err) {
    logError(`[blog-worker] Group Prompts job failed`, err);
  } finally {
    await releaseLease(jobKey, success);
  }
};

const runDayPhotoReminderJob = async () => {
  // Reuses trip_blog_nudges — B6's "bounded contribution nudges" flag — rather than adding a new
  // one; a personal "you haven't added a photo today" reminder is exactly that category. Listed in
  // entitlementService.ts's FAIL_CLOSED_FLAGS, so a missing/unseeded row defaults this off.
  if (!(await isFeatureEnabled('trip_blog_nudges'))) return;
  if (!isEndOfDayWindow()) return;

  const jobKey = 'blog:day_photo_reminder';
  if (!await claimLease(jobKey)) return;

  let success = false;
  try {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    // Trip-level opt-in, on top of each traveler's own notification preference (see
    // notificationService.ts's DEFAULT_PREFERENCES) — a JOIN rather than a WHERE EXISTS
    // subquery (the same pg-mem NOT EXISTS caution as the media/travelers queries below applies
    // here too), which also naturally excludes any trip whose trip_blogs row doesn't exist yet
    // (a trip nobody has touched the blog for at all), matching the "off by default" intent.
    const activeTrips = await queryBlog<{ id: string; name: string }>(
      `SELECT t.id, t.name FROM trips t
       JOIN trip_blogs tb ON tb.trip_id = t.id
       WHERE t.start_date <= $1::date AND t.end_date >= $1::date
         AND tb.day_photo_reminders_enabled = true`,
      [todayStr]
    );

    let notifiedCount = 0;
    for (const trip of activeTrips.rows) {
      // Everyone in the trip's group minus whoever has already added a ready photo today —
      // deliberately photo-only (not "any contribution", unlike runGroupPromptsJob's 2-day
      // slacker check above) since the ask is specifically about pictures. Split into two plain
      // queries and diffed in JS rather than one NOT EXISTS / derived-table join — pg-mem (the
      // in-memory adapter the test suite runs against) throws on NOT EXISTS subqueries, and
      // silently returns zero rows for a join filtered by `gm.user_id IS NOT NULL` on the joined
      // side (a pg-mem query-planning bug, not anything about the data — real Postgres handles
      // both fine). `user_id IS NOT NULL` is filtered client-side below for the same reason.
      const travelers = await queryBlog<{ user_id: string | null }>(
        `SELECT gm.user_id FROM group_members gm
         JOIN trips t ON t.group_id = gm.group_id
         WHERE t.id = $1 AND gm.removed_at IS NULL`,
        [trip.id]
      );
      const travelerIds = travelers.rows.map((r) => r.user_id).filter((id): id is string => id != null);
      if (!travelerIds.length) continue;

      const photographedToday = await queryBlog<{ author_user_id: string }>(
        `SELECT DISTINCT i.author_user_id
         FROM blog_items i
         JOIN blog_days d ON d.id = i.blog_day_id
         JOIN blog_item_assets ia ON ia.item_id = i.id
         JOIN blog_media_assets a ON a.id = ia.asset_id
         WHERE i.trip_id = $1 AND i.deleted_at IS NULL
           AND d.local_date = $2::date
           AND a.media_kind_key = 'photo' AND a.state = 'ready'`,
        [trip.id, todayStr]
      );
      const alreadyPhotographed = new Set(photographedToday.rows.map((r) => r.author_user_id));
      const noPhotoYet = travelerIds.filter((id) => !alreadyPhotographed.has(id));

      for (const userId of noPhotoYet) {
        await notify({
          userIds: [userId],
          category: 'blog_day_photo_reminder',
          tripId: trip.id,
          title: `Add a photo from today?`,
          body: `The day's almost over — add a picture to ${trip.name}'s blog before it slips away.`,
          deepLink: `/trips/${trip.id}/blog?date=${todayStr}`,
          dedupeKey: `day_photo_reminder:${trip.id}:${userId}:${todayStr}`
        });
        notifiedCount += 1;
      }
    }

    success = true;
    logInfo(`[blog-worker] Day Photo Reminder job finished, notified ${notifiedCount} travelers across ${activeTrips.rows.length} trips`);
  } catch (err) {
    logError(`[blog-worker] Day Photo Reminder job failed`, err);
  } finally {
    await releaseLease(jobKey, success);
  }
};


// --- Firebase job implementations -------------------------------------------------------------
// These are genuine business jobs (notifications, a rendered artifact), not disposable derived
// data recomputed from atomic Firestore counters — unlike blogCounterReconciliationService.ts
// (which early-returns on firebase because Firestore's FieldValue.increment counters never drift
// the way Postgres's read-then-write JSONB ones can), nothing about memory-lane nudges, group
// prompts, or day-map rendering is redundant with anything Firestore does automatically. So these
// get real implementations rather than a no-op guard.

const runMemoryLaneJobFirebase = async () => {
  const jobKey = 'blog:memory_lane';
  if (!await claimLeaseFirebase(jobKey)) return;

  let success = false;
  let processedCount = 0;
  try {
    const db = getDb();
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    const todayStr = today.toISOString().slice(0, 10);
    // 20-year ceiling matches the Postgres query's own `end_date > today - INTERVAL '20 years'`.
    const cutoffStr = new Date(today.getTime() - 20 * 365.25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    // Firestore has no EXTRACT(MONTH FROM ...) — a bounded range scan on endDate (same 20-year
    // ceiling the SQL enforces) followed by an in-memory month/day filter.
    const snap = await db.collection('trips').where('endDate', '<', todayStr).where('endDate', '>', cutoffStr).get();
    const trips = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
      .filter((t) => {
        if (!t.endDate) return false;
        const end = new Date(t.endDate);
        return end.getUTCMonth() + 1 === month && end.getUTCDate() === day;
      });

    for (const trip of trips) {
      const years = today.getFullYear() - new Date(trip.endDate).getFullYear();
      const userIds = await getGroupMemberUserIdsForTrip(trip.id);
      if (userIds.length > 0) {
        await notify({
          userIds,
          category: 'blog_memory_lane',
          tripId: trip.id,
          title: `Memory Lane: ${trip.name}`,
          body: `It's been ${years} year${years === 1 ? '' : 's'} since your trip ended! Revisit your blog to see the memories.`,
          deepLink: `/trips/${trip.id}/blog`,
          dedupeKey: `memory_lane:${trip.id}:${years}`
        });
      }
    }
    processedCount = trips.length;
    success = true;
    logInfo(`[blog-worker] Memory Lane job finished (firebase), processed ${processedCount} trips`);
  } catch (err) {
    logError(`[blog-worker] Memory Lane job failed (firebase)`, err);
  } finally {
    await releaseLeaseFirebase(jobKey, success);
  }
};

const runGroupPromptsJobFirebase = async () => {
  const jobKey = 'blog:group_prompts';
  if (!await claimLeaseFirebase(jobKey)) return;

  let success = false;
  let processedCount = 0;
  try {
    const db = getDb();
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const cutoff = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

    // Single-field range filter (startDate <= today) plus an in-memory endDate check — Firestore
    // can't range-filter two different fields in one query without a composite index this
    // deployment doesn't declare.
    const snap = await db.collection('trips').where('startDate', '<=', todayStr).get();
    const activeTrips = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
      .filter((t) => t.endDate && t.endDate >= todayStr);

    for (const trip of activeTrips) {
      const userIds = await getGroupMemberUserIdsForTrip(trip.id);
      if (!userIds.length) continue;
      // Mirrors the Postgres NOT EXISTS: everyone in the group minus whoever authored a blog_items
      // row for this trip since the cutoff.
      const itemSnap = await db.collection('blog_items').where('tripId', '==', trip.id).where('createdAt', '>', cutoff).get();
      const recentAuthors = new Set(itemSnap.docs.map((doc) => String((doc.data() as any).authorUserId ?? '')));
      const slackers = userIds.filter((id) => !recentAuthors.has(id));

      if (slackers.length > 0) {
        await notify({
          userIds: slackers,
          category: 'blog_nudge',
          tripId: trip.id,
          title: `Your group is waiting!`,
          body: `Everyone else is sharing memories from ${trip.name}. Add a photo or note to the blog today!`,
          deepLink: `/trips/${trip.id}/blog`,
          dedupeKey: `group_prompt:${trip.id}:${todayStr}`
        });
      }
    }

    processedCount = activeTrips.length;
    success = true;
    logInfo(`[blog-worker] Group Prompts job finished (firebase), processed ${processedCount} trips`);
  } catch (err) {
    logError(`[blog-worker] Group Prompts job failed (firebase)`, err);
  } finally {
    await releaseLeaseFirebase(jobKey, success);
  }
};

const runDayPhotoReminderJobFirebase = async () => {
  if (!(await isFeatureEnabled('trip_blog_nudges'))) return;
  if (!isEndOfDayWindow()) return;

  const jobKey = 'blog:day_photo_reminder';
  if (!await claimLeaseFirebase(jobKey)) return;

  let success = false;
  let notifiedCount = 0;
  try {
    const db = getDb();
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    const snap = await db.collection('trips').where('startDate', '<=', todayStr).get();
    const activeTrips = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
      .filter((t) => t.endDate && t.endDate >= todayStr);

    for (const trip of activeTrips) {
      // Trip-level opt-in, on top of each traveler's own notification preference (see
      // notificationService.ts's DEFAULT_PREFERENCES) — mirrors the Postgres job's JOIN against
      // trip_blogs.day_photo_reminders_enabled, including "no trip_blogs doc yet" reading as off.
      const blogDoc = await db.collection('trip_blogs').doc(trip.id).get();
      if (!blogDoc.exists || (blogDoc.data() as any)?.dayPhotoRemindersEnabled !== true) continue;

      const userIds = await getGroupMemberUserIdsForTrip(trip.id);
      if (!userIds.length) continue;

      // blog_media_assets carries dayDate/mediaKind/uploaderUserId directly (see
      // firebaseBlogDayData.ts's own note on this collection's shape), so no item/day join is
      // needed the way the Postgres query above needs one.
      const assetSnap = await db.collection('blog_media_assets')
        .where('tripId', '==', trip.id)
        .where('dayDate', '==', todayStr)
        .get();
      const photographedBy = new Set(
        assetSnap.docs
          .map((doc) => doc.data() as any)
          .filter((data) => data.state === 'ready' && (data.mediaKind ?? 'photo') === 'photo')
          .map((data) => String(data.uploaderUserId))
      );
      const noPhotoYet = userIds.filter((id) => !photographedBy.has(id));

      for (const userId of noPhotoYet) {
        await notify({
          userIds: [userId],
          category: 'blog_day_photo_reminder',
          tripId: trip.id,
          title: `Add a photo from today?`,
          body: `The day's almost over — add a picture to ${trip.name}'s blog before it slips away.`,
          deepLink: `/trips/${trip.id}/blog?date=${todayStr}`,
          dedupeKey: `day_photo_reminder:${trip.id}:${userId}:${todayStr}`
        });
        notifiedCount += 1;
      }
    }

    success = true;
    logInfo(`[blog-worker] Day Photo Reminder job finished (firebase), notified ${notifiedCount} travelers across ${activeTrips.length} trips`);
  } catch (err) {
    logError(`[blog-worker] Day Photo Reminder job failed (firebase)`, err);
  } finally {
    await releaseLeaseFirebase(jobKey, success);
  }
};

