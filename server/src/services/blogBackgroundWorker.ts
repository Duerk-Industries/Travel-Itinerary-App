import { queryBlog, withBlogTransaction } from '../db.postgres';
import { getDb } from '../db.firebase';
import { getCurrentDbProvider } from '../db';
import { notify } from './notificationService';
import { logError, logInfo } from '../logger';
import { randomUUID, createHash } from 'crypto';
import axios from 'axios';
import { getStorage } from 'firebase-admin/storage';
import { resolveLocationBucketName } from '../utils/gcsBucket';
import { getEnvValue } from '../env';
import { isFeatureEnabled } from './entitlementService';
import { reserveApiUsageOrThrow, ApiLimitExceededError } from '../apis/usageLimiter';
import { recordProviderRequestCost } from '../apis/providerBudgeting';
import { getBlogDayByDate, getVisibleMediaForDay, getDayMapArtifact, upsertDayMapArtifact, getGroupMemberUserIdsForTrip } from '../blog/firebaseBlogDayData';

const LEASE_SECONDS = 300;
const WORKER_ID = `blog-worker-${randomUUID()}`;

export const runBlogBackgroundJobs = async () => {
  if (getCurrentDbProvider() === 'firebase') {
    await runMemoryLaneJobFirebase();
    await runGroupPromptsJobFirebase();
    await runDayMapRenderJobFirebase();
    return;
  }
  await runMemoryLaneJob();
  await runGroupPromptsJob();
  await runDayMapRenderJob();
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

const runDayMapRenderJob = async () => {
  // architecture §14.1/§9.1: trip_blog_day_map_render is fail-closed for exactly this reason —
  // this job is the *only* path in the whole feature set allowed to call Google Static Maps at
  // all, and it must not spend anything while the flag is off, regardless of what's backlogged.
  if (!(await isFeatureEnabled('trip_blog_day_map_render'))) return;

  const jobKey = 'blog:day_map_render';
  if (!await claimLease(jobKey)) return;

  let success = false;
  try {
    // Find (trip, day) pairs that have geotagged media but no current artifact.
    const daysWithMedia = await queryBlog<{ trip_id: string; local_date: string; blog_day_id: string }>(
      `SELECT DISTINCT i.trip_id, d.local_date, i.blog_day_id
       FROM blog_items i
       JOIN blog_days d ON d.id = i.blog_day_id
       JOIN blog_item_assets ia ON ia.item_id = i.id
       JOIN blog_media_assets a ON a.id = ia.asset_id
       WHERE a.captured_lat IS NOT NULL AND a.captured_lng IS NOT NULL
         AND i.deleted_at IS NULL AND a.state = 'ready'
       LIMIT 10`
    );

    for (const day of daysWithMedia.rows) {
      const points = await queryBlog<{ lat: number; lng: number }>(
        `SELECT DISTINCT a.captured_lat as lat, a.captured_lng as lng
         FROM blog_media_assets a
         JOIN blog_item_assets ia ON ia.asset_id = a.id
         JOIN blog_items i ON i.id = ia.item_id
         WHERE i.blog_day_id = $1 AND a.captured_lat IS NOT NULL AND a.state = 'ready'`,
        [day.blog_day_id]
      );

      if (points.rows.length === 0) continue;

      const pointsData = points.rows.map(p => `${p.lat},${p.lng}`).sort().join('|');
      const pointsHash = createHash('md5').update(pointsData).digest('hex');

      const existing = await queryBlog(
        `SELECT 1 FROM blog_day_map_artifacts WHERE trip_id = $1 AND day_date = $2 AND points_hash = $3`,
        [day.trip_id, day.local_date, pointsHash]
      );
      if (existing.rowCount > 0) continue;

      const apiKey = getEnvValue('GOOGLE_STATIC_MAPS_API_KEY') || getEnvValue('GOOGLE_MAPS_API_KEY');
      if (!apiKey) {
        logError('[blog-worker] Missing Google Maps API key, skipping day map render');
        break;
      }

      const markers = points.rows.map(p => `markers=color:red|${p.lat},${p.lng}`).join('&');
      const url = `https://maps.googleapis.com/maps/api/staticmap?size=600x300&scale=2&${markers}&key=${apiKey}`;

      // architecture §14.1: "No request path may reach Google Static Maps" without going through
      // the same admission/budget system every other provider call does — BLOG_DAY_MAP_RENDER's
      // 200/day cap (api-limits.yaml) exists specifically to bound this job, not as a decorative
      // config entry. A caught ApiLimitExceededError stops *this tick's* remaining renders rather
      // than crashing the whole job — the backlog just picks up again next hour, degrading
      // gracefully rather than erroring (Phase 5's own requirement for this exact case).
      try {
        await reserveApiUsageOrThrow({ provider: 'GOOGLE_STATIC_MAPS', caller: 'BLOG_DAY_MAP_RENDER', requireConfiguredLimit: true });
      } catch (limitErr) {
        if (limitErr instanceof ApiLimitExceededError) {
          logInfo('[blog-worker] Day Map Render job hit its budget cap for this window, stopping early');
          break;
        }
        throw limitErr;
      }
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      await recordProviderRequestCost({ provider: 'GOOGLE_STATIC_MAPS' });
      const bucketName = resolveLocationBucketName();
      if (!bucketName) throw new Error('No GCS bucket configured');

      const gcsPath = `blog-maps/${day.trip_id}/${day.local_date}/${pointsHash}.png`;
      const file = getStorage().bucket(bucketName).file(gcsPath);
      await file.save(Buffer.from(response.data), { contentType: 'image/png' });

      await queryBlog(
        `INSERT INTO blog_day_map_artifacts (trip_id, day_date, points_hash, gcs_path)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (trip_id, day_date, points_hash) DO UPDATE SET gcs_path = EXCLUDED.gcs_path`,
        [day.trip_id, day.local_date, pointsHash, gcsPath]
      );

      logInfo(`[blog-worker] Rendered day map for trip ${day.trip_id} day ${day.local_date}`);
    }

    success = true;
  } catch (err) {
    logError(`[blog-worker] Day Map Render job failed`, err);
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

const runDayMapRenderJobFirebase = async () => {
  // Same fail-closed gate as the Postgres job — see architecture §14.1/§9.1's note on runDayMapRenderJob.
  if (!(await isFeatureEnabled('trip_blog_day_map_render'))) return;

  const jobKey = 'blog:day_map_render';
  if (!await claimLeaseFirebase(jobKey)) return;

  let success = false;
  try {
    const db = getDb();
    // Find candidate (trip, day) pairs with geotagged, ready media. blog_media_assets docs carry
    // tripId/dayDate directly (see firebaseMediaRepository.ts), so a bounded scan over recent
    // ready assets, filtered in-memory for a geotag, stands in for the Postgres query's
    // `blog_items JOIN blog_item_assets JOIN blog_media_assets ... LIMIT 10` distinct-pairs scan.
    const assetSnap = await db.collection('blog_media_assets')
      .where('state', '==', 'ready')
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();
    const pairs = new Map<string, { tripId: string; dayDate: string }>();
    for (const doc of assetSnap.docs) {
      const data = doc.data() as any;
      if (data.capturedLat == null || data.capturedLng == null) continue;
      const key = `${data.tripId}:${data.dayDate}`;
      if (!pairs.has(key)) pairs.set(key, { tripId: String(data.tripId), dayDate: String(data.dayDate) });
      if (pairs.size >= 10) break;
    }

    let processed = 0;
    for (const { tripId, dayDate } of pairs.values()) {
      const day = await getBlogDayByDate(tripId, dayDate);
      if (!day) continue;

      const media = await getVisibleMediaForDay(day.id, ['travelers', 'followers', 'public']);
      const points = media
        .filter((m) => m.captured_lat != null && m.captured_lng != null)
        .map((m) => ({ lat: m.captured_lat as number, lng: m.captured_lng as number }));
      if (points.length === 0) continue;
      const uniquePoints = [...new Map(points.map((p) => [`${p.lat},${p.lng}`, p])).values()];

      const pointsData = uniquePoints.map((p) => `${p.lat},${p.lng}`).sort().join('|');
      const pointsHash = createHash('md5').update(pointsData).digest('hex');

      const existing = await getDayMapArtifact(tripId, dayDate, pointsHash);
      if (existing) continue;

      const apiKey = getEnvValue('GOOGLE_STATIC_MAPS_API_KEY') || getEnvValue('GOOGLE_MAPS_API_KEY');
      if (!apiKey) {
        logError('[blog-worker] Missing Google Maps API key, skipping day map render');
        break;
      }

      const markers = uniquePoints.map((p) => `markers=color:red|${p.lat},${p.lng}`).join('&');
      const url = `https://maps.googleapis.com/maps/api/staticmap?size=600x300&scale=2&${markers}&key=${apiKey}`;

      try {
        await reserveApiUsageOrThrow({ provider: 'GOOGLE_STATIC_MAPS', caller: 'BLOG_DAY_MAP_RENDER', requireConfiguredLimit: true });
      } catch (limitErr) {
        if (limitErr instanceof ApiLimitExceededError) {
          logInfo('[blog-worker] Day Map Render job hit its budget cap for this window, stopping early');
          break;
        }
        throw limitErr;
      }
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      await recordProviderRequestCost({ provider: 'GOOGLE_STATIC_MAPS' });
      const bucketName = resolveLocationBucketName();
      if (!bucketName) throw new Error('No GCS bucket configured');

      const gcsPath = `blog-maps/${tripId}/${dayDate}/${pointsHash}.png`;
      const file = getStorage().bucket(bucketName).file(gcsPath);
      await file.save(Buffer.from(response.data), { contentType: 'image/png' });

      await upsertDayMapArtifact(tripId, dayDate, pointsHash, gcsPath);

      logInfo(`[blog-worker] Rendered day map for trip ${tripId} day ${dayDate} (firebase)`);
      processed += 1;
    }

    success = true;
  } catch (err) {
    logError(`[blog-worker] Day Map Render job failed (firebase)`, err);
  } finally {
    await releaseLeaseFirebase(jobKey, success);
  }
};
