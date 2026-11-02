import { randomUUID } from 'crypto';
import { queryBlog, withBlogTransaction } from '../db.postgres';
import { blogDateOnly, blogDestinationCoordinates, type BlogPrivacyChoice, type BlogVisibilityContext, type BlogVisibilityResult } from './visibilityTypes';

export const loadBlogVisibilityContext = async (tripId: string): Promise<BlogVisibilityContext | null> => {
  const trip = (await queryBlog<{ start_date: unknown; timezone: string | null; created_by: string | null; location_ids: string[] | null }>('SELECT start_date,timezone,created_by,location_ids FROM trips WHERE id=$1', [tripId])).rows[0];
  if (!trip) return null;
  const [blog, members, destination, preference] = await Promise.all([
    queryBlog<{ early_release: boolean }>('SELECT early_release FROM trip_blogs WHERE trip_id=$1', [tripId]),
    queryBlog<{ user_id: string; first_name: string | null; date_of_birth: unknown; blog_default_public: boolean; opt_out: boolean; opt_in: boolean }>(
      `SELECT DISTINCT u.id AS user_id,u.first_name,u.date_of_birth,u.blog_default_public,c.opt_out,c.opt_in
       FROM trips t JOIN group_members gm ON gm.group_id=t.group_id JOIN users u ON u.id=gm.user_id
       LEFT JOIN trip_blog_privacy_choices c ON c.trip_id=t.id AND c.user_id=u.id
       LEFT JOIN trip_removals removed ON removed.trip_id=t.id AND removed.user_id=u.id
       WHERE t.id=$1 AND gm.removed_at IS NULL AND removed.user_id IS NULL`, [tripId]),
    trip.location_ids?.[0] ? queryBlog<{ payload: unknown }>('SELECT payload FROM locations WHERE id=$1', [trip.location_ids[0]]) : Promise.resolve({ rows: [] }),
    queryBlog<{ digest_timing: { timezone?: string } | null; quiet_timing: { timezone?: string } | null }>('SELECT digest_timing,quiet_timing FROM notification_preferences WHERE user_id=$1 LIMIT 1', [trip.created_by]),
  ]);
  return { tripId, startDate: blogDateOnly(trip.start_date), timezone: trip.timezone,
    organizerTimezone: preference.rows[0]?.digest_timing?.timezone ?? preference.rows[0]?.quiet_timing?.timezone ?? null,
    destination: blogDestinationCoordinates(destination.rows[0]?.payload), earlyRelease: blog.rows[0]?.early_release === true,
    members: members.rows.map(m => ({ userId: String(m.user_id), firstName: m.first_name ?? 'Traveler', dateOfBirth: blogDateOnly(m.date_of_birth), publicByDefault: m.blog_default_public !== false, optOut: m.opt_out === true, optIn: m.opt_in === true })) };
};

export const writeBlogPrivacyChoice = async (tripId: string, userId: string, choice: BlogPrivacyChoice): Promise<void> => {
  await queryBlog(`INSERT INTO trip_blog_privacy_choices(trip_id,user_id,opt_out,opt_in) VALUES($1,$2,$3,$4)
    ON CONFLICT(trip_id,user_id) DO UPDATE SET opt_out=COALESCE($5,trip_blog_privacy_choices.opt_out),opt_in=COALESCE($6,trip_blog_privacy_choices.opt_in),updated_at=NOW()`,
  [tripId, userId, choice.optOut ?? false, choice.optIn ?? false, choice.optOut ?? null, choice.optIn ?? null]);
};

const slug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'trip';

export const persistBlogVisibility = async (tripId: string, evaluation: BlogVisibilityResult, actorUserId: string, now: string): Promise<boolean> => withBlogTransaction(async client => {
  const trip = (await client.query('SELECT name FROM trips WHERE id=$1 FOR UPDATE', [tripId])).rows[0];
  if (!trip) return false;
  let blog = (await client.query('SELECT * FROM trip_blogs WHERE trip_id=$1', [tripId])).rows[0];
  if (!blog) blog = (await client.query('INSERT INTO trip_blogs(id,trip_id,title) VALUES($1,$2,$3) RETURNING *', [randomUUID(), tripId, trip.name || 'Trip Blog'])).rows[0];
  const state = evaluation.isPublic ? 'public' : 'private';
  const previous = blog.r1_visibility_public;
  const changed = typeof previous === 'boolean' ? previous !== evaluation.isPublic : blog.visibility_state !== state;
  const epoch = Math.max(1, Number(blog.visibility_epoch || 0) + (changed ? 1 : 0));
  if (changed || previous == null) {
    await client.query('INSERT INTO blog_visibility_transitions(id,trip_id,is_public,reasons,occurred_at) VALUES($1,$2,$3,$4,$5)', [randomUUID(), tripId, evaluation.isPublic, JSON.stringify(evaluation.reasons), now]);
  }
  await client.query('UPDATE trip_blogs SET visibility_state=$2,visibility_epoch=$3,updated_at=$4,r1_visibility_public=$5 WHERE trip_id=$1', [tripId, state, epoch, now, evaluation.isPublic]);
  // Epochs remain a compatibility projection for discovery/indexing, never the public-read gate.
  await client.query("UPDATE blog_publication_epochs SET state='revoked' WHERE trip_id=$1 AND state IN ('public','pending_consent')", [tripId]);
  if (evaluation.isPublic) {
    const existing = (await client.query('SELECT id FROM blog_publication_epochs WHERE trip_id=$1 AND epoch=$2', [tripId, epoch])).rows[0];
    if (existing) await client.query("UPDATE blog_publication_epochs SET state='public' WHERE id=$1", [existing.id]);
    else await client.query("INSERT INTO blog_publication_epochs(id,trip_id,epoch,state,requested_by) VALUES($1,$2,$3,'public',$4)", [randomUUID(), tripId, epoch, actorUserId]);
  }
  const alias = (await client.query('SELECT id FROM blog_public_aliases WHERE trip_id=$1 AND canonical=TRUE LIMIT 1', [tripId])).rows[0];
  if (!alias) {
    const user = (await client.query('SELECT username FROM users WHERE id=$1', [actorUserId])).rows[0];
    const username = slug(user?.username || actorUserId);
    let tripSlug = slug(trip.name || 'trip');
    const collision = (await client.query('SELECT trip_id FROM blog_public_aliases WHERE username_slug=$1 AND trip_slug=$2', [username, tripSlug])).rows[0];
    if (collision && String(collision.trip_id) !== tripId) tripSlug += `-${tripId.slice(0, 8)}`;
    await client.query('INSERT INTO blog_public_aliases(id,trip_id,user_id,username_slug,trip_slug,canonical) VALUES($1,$2,$3,$4,$5,TRUE)', [randomUUID(), tripId, actorUserId, username, tripSlug]);
  }
  return changed && evaluation.isPublic;
});

export const writeBlogEarlyRelease = async (tripId: string): Promise<void> => { await queryBlog('UPDATE trip_blogs SET early_release=TRUE WHERE trip_id=$1', [tripId]); };
export const listTripsForBlogVisibility = async (): Promise<string[]> => (await queryBlog<{ id: string }>('SELECT id FROM trips', [])).rows.map(t => String(t.id));
