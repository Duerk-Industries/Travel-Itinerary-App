import { queryBlog, withBlogTransaction } from '../db.postgres';
import { notify } from './notificationService';
import { logError, logInfo } from '../logger';
import { randomUUID } from 'crypto';

const LEASE_SECONDS = 300;
const WORKER_ID = `blog-worker-${randomUUID()}`;

export const runBlogBackgroundJobs = async () => {
  await runMemoryLaneJob();
  await runGroupPromptsJob();
};

const claimLease = async (jobKey: string): Promise<boolean> => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_SECONDS * 1000);

  const result = await queryBlog(
    `UPDATE scheduled_job_leases
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
    `UPDATE scheduled_job_leases
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

      for (const traveler of travelers.rows) {
        await notify({
          userId: traveler.user_id,
          category: 'engagement',
          title: `Memory Lane: ${trip.name}`,
          body: `It's been ${years} year${years === 1 ? '' : 's'} since your trip ended! Revisit your blog to see the memories.`,
          link: `/trips/${trip.id}/blog`,
          dedupeKey: `memory_lane:${trip.id}:${years}:${traveler.user_id}`
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

      for (const slacker of slackers.rows) {
        await notify({
          userId: slacker.user_id,
          category: 'engagement',
          title: `Your group is waiting!`,
          body: `Everyone else is sharing memories from ${trip.name}. Add a photo or note to the blog today!`,
          link: `/trips/${trip.id}/blog`,
          dedupeKey: `group_prompt:${trip.id}:${today.toISOString().slice(0, 10)}:${slacker.user_id}`
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
