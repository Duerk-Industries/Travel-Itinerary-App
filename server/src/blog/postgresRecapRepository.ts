import { queryBlog } from '../db.postgres';
import type { BlogRecapAudienceClass, BlogRecapPayload, BlogRecapRevision, BlogRecapSnapshot, BlogRecapSource } from './recapTypes';
import { routeDistanceKm } from './recapDistance';

const audiencesSql = (audience: BlogRecapAudienceClass): string =>
  audience === 'travelers' ? "'travelers','followers','public'" : "'followers','public'";

const mapSnapshot = (row: any): BlogRecapSnapshot => ({
  tripId: String(row.trip_id),
  title: String(row.title ?? 'Trip recap'),
  contentRevision: Number(row.content_revision),
  engagementRevision: Number(row.engagement_revision),
  audienceClass: row.audience_class,
  state: row.state,
  payload: row.payload ?? null,
  leaseOwner: row.lease_owner ?? null,
  leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null,
  updatedAt: new Date(row.updated_at).toISOString(),
});

export const getRecapRevision = async (tripId: string): Promise<BlogRecapRevision | null> => {
  const result = await queryBlog<any>(
    `SELECT b.trip_id, b.title, b.content_revision, b.engagement_revision
       FROM trip_blogs b WHERE b.trip_id = $1 LIMIT 1`,
    [tripId]
  );
  const row = result.rows[0];
  return row ? {
    tripId,
    title: String(row.title ?? 'Trip recap'),
    contentRevision: Number(row.content_revision ?? 0),
    engagementRevision: Number(row.engagement_revision ?? 0),
  } : null;
};

export const getRecapSnapshot = async (revision: BlogRecapRevision, audienceClass: BlogRecapAudienceClass): Promise<BlogRecapSnapshot | null> => {
  const result = await queryBlog<any>(
    `SELECT s.*, b.title FROM blog_recap_snapshots s JOIN trip_blogs b ON b.trip_id = s.trip_id
      WHERE s.trip_id = $1 AND s.content_revision = $2 AND s.engagement_revision = $3 AND s.audience_class = $4`,
    [revision.tripId, revision.contentRevision, revision.engagementRevision, audienceClass]
  );
  return result.rows[0] ? mapSnapshot(result.rows[0]) : null;
};

export const claimRecapSnapshot = async (revision: BlogRecapRevision, audienceClass: BlogRecapAudienceClass, leaseOwner: string, leaseSeconds: number): Promise<boolean> => {
  const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000);
  const inserted = await queryBlog<any>(
    `INSERT INTO blog_recap_snapshots
       (trip_id, content_revision, engagement_revision, audience_class, state, lease_owner, lease_expires_at)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)
     ON CONFLICT (trip_id, content_revision, engagement_revision, audience_class) DO NOTHING
     RETURNING trip_id`,
    [revision.tripId, revision.contentRevision, revision.engagementRevision, audienceClass, leaseOwner, leaseExpiresAt]
  );
  if (inserted.rows[0]) {
    // Verify ownership instead of trusting RETURNING alone. Real Postgres returns no row for the
    // losing ON CONFLICT ... DO NOTHING writer; pg-mem can return the existing row under a
    // concurrent promise, and a durable lease must remain single-owner in both adapters.
    const owner = await queryBlog<{ lease_owner: string | null }>(
      `SELECT lease_owner FROM blog_recap_snapshots
        WHERE trip_id = $1 AND content_revision = $2 AND engagement_revision = $3 AND audience_class = $4`,
      [revision.tripId, revision.contentRevision, revision.engagementRevision, audienceClass]
    );
    if (owner.rows[0]?.lease_owner === leaseOwner) return true;
  }
  const reclaimed = await queryBlog<any>(
    `UPDATE blog_recap_snapshots
        SET state = 'pending', payload = NULL, lease_owner = $5,
            lease_expires_at = $6, failure_code = NULL, updated_at = NOW()
      WHERE trip_id = $1 AND content_revision = $2 AND engagement_revision = $3 AND audience_class = $4
        AND (state = 'failed' OR lease_expires_at IS NULL OR lease_expires_at < NOW()::timestamp)
      RETURNING trip_id`,
    [revision.tripId, revision.contentRevision, revision.engagementRevision, audienceClass, leaseOwner, leaseExpiresAt]
  );
  return Boolean(reclaimed.rows[0]);
};

export const completeRecapSnapshot = async (revision: BlogRecapRevision, audienceClass: BlogRecapAudienceClass, leaseOwner: string, payload: BlogRecapPayload): Promise<void> => {
  await queryBlog(
    `UPDATE blog_recap_snapshots SET state = 'ready', payload = $6::jsonb, lease_owner = NULL,
       lease_expires_at = NULL, failure_code = NULL, updated_at = NOW()
     WHERE trip_id = $1 AND content_revision = $2 AND engagement_revision = $3
       AND audience_class = $4 AND lease_owner = $5`,
    [revision.tripId, revision.contentRevision, revision.engagementRevision, audienceClass, leaseOwner, JSON.stringify(payload)]
  );
};

export const failRecapSnapshot = async (revision: BlogRecapRevision, audienceClass: BlogRecapAudienceClass, leaseOwner: string, failureCode: string): Promise<void> => {
  await queryBlog(
    `UPDATE blog_recap_snapshots SET state = 'failed', lease_owner = NULL, lease_expires_at = NULL,
       failure_code = $6, updated_at = NOW()
     WHERE trip_id = $1 AND content_revision = $2 AND engagement_revision = $3
       AND audience_class = $4 AND lease_owner = $5`,
    [revision.tripId, revision.contentRevision, revision.engagementRevision, audienceClass, leaseOwner, failureCode.slice(0, 1000)]
  );
};

export const pruneRecapSnapshots = async (tripId: string, retain: number): Promise<Array<{ contentRevision: number; engagementRevision: number; audienceClass: BlogRecapAudienceClass }>> => {
  const rows = await queryBlog<any>(
    `SELECT content_revision, engagement_revision, audience_class FROM blog_recap_snapshots
      WHERE trip_id = $1 ORDER BY updated_at DESC`,
    [tripId]
  );
  const stale = rows.rows.slice(Math.max(0, retain));
  for (const row of stale) {
    await queryBlog(
      `DELETE FROM blog_recap_snapshots WHERE trip_id = $1 AND content_revision = $2
        AND engagement_revision = $3 AND audience_class = $4`,
      [tripId, row.content_revision, row.engagement_revision, row.audience_class]
    );
  }
  return stale.map((row) => ({ contentRevision: Number(row.content_revision), engagementRevision: Number(row.engagement_revision), audienceClass: row.audience_class }));
};

export const getRecapSource = async (tripId: string, audienceClass: BlogRecapAudienceClass): Promise<BlogRecapSource> => {
  const visible = audiencesSql(audienceClass);
  const [days, media, contributors, travelers, followers, places, flightLegs, commentedDays] = await Promise.all([
    queryBlog<any>('SELECT COUNT(*)::int AS count FROM blog_days WHERE trip_id = $1', [tripId]),
    queryBlog<any>(
      `SELECT a.id AS asset_id, a.media_kind_key, a.caption, a.alt_text,
              COALESCE(SUM(c.reaction_total), 0)::int AS reaction_total
         FROM blog_media_assets a
         JOIN blog_item_assets ia ON ia.asset_id = a.id
         JOIN blog_items i ON i.id = ia.item_id
         LEFT JOIN blog_engagement_counters c ON c.target_kind = 'asset' AND c.target_id = a.id
            AND c.audience IN (${visible})
        WHERE a.trip_id = $1 AND a.state = 'ready' AND i.deleted_at IS NULL AND i.audience IN (${visible})
        GROUP BY a.id, a.media_kind_key, a.caption, a.alt_text`,
      [tripId]
    ),
    queryBlog<any>(
      `SELECT i.author_user_id AS user_id,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, wu.first_name, ''), ' ', COALESCE(u.last_name, wu.last_name, ''))), ''),
                       u.email, wu.email, 'A traveler') AS display_name,
              COUNT(*)::int AS contribution_count
         FROM blog_items i
         LEFT JOIN users u ON u.id = i.author_user_id
         LEFT JOIN web_users wu ON wu.id = i.author_user_id
        WHERE i.trip_id = $1 AND i.deleted_at IS NULL AND i.audience IN (${visible})
        GROUP BY i.author_user_id, u.first_name, u.last_name, u.email, wu.first_name, wu.last_name, wu.email
        ORDER BY contribution_count DESC, display_name ASC`,
      [tripId]
    ),
    queryBlog<any>(
      `SELECT COUNT(DISTINCT gm.user_id)::int AS count FROM trips t
        JOIN group_members gm ON gm.group_id = t.group_id AND gm.user_id IS NOT NULL AND gm.removed_at IS NULL
       WHERE t.id = $1`,
      [tripId]
    ),
    queryBlog<any>(
      `SELECT COUNT(DISTINCT r.user_id)::int AS count FROM blog_reactions r
        JOIN trip_followers f ON f.trip_id = r.trip_id AND f.follower_user_id = r.user_id
       WHERE r.trip_id = $1`,
      [tripId]
    ),
    queryBlog<any>(
      `SELECT COUNT(DISTINCT place_name)::int AS count FROM (
         SELECT NULLIF(TRIM(start_location), '') AS place_name FROM tours WHERE trip_id = $1 AND LOWER(COALESCE(status, '')) <> 'cancelled'
         UNION SELECT NULLIF(TRIM(address), '') FROM lodgings WHERE trip_id = $1 AND LOWER(COALESCE(status, '')) <> 'cancelled'
         UNION SELECT NULLIF(TRIM(pickup_location), '') FROM car_rentals WHERE trip_id = $1 AND LOWER(COALESCE(status, '')) <> 'cancelled'
       ) p WHERE place_name IS NOT NULL`,
      [tripId]
    ),
    queryBlog<any>(
      `SELECT DISTINCT f.departure_date, f.departure_time, f.flight_number,
              dep.lat AS departure_lat, dep.lng AS departure_lng,
              lay.lat AS layover_lat, lay.lng AS layover_lng,
              arr.lat AS arrival_lat, arr.lng AS arrival_lng
         FROM flights f
         LEFT JOIN airports dep ON dep.iata_code = UPPER(f.departure_airport_code)
         LEFT JOIN airports lay ON lay.iata_code = UPPER(f.layover_location_code)
         LEFT JOIN airports arr ON arr.iata_code = UPPER(f.arrival_airport_code)
        WHERE f.trip_id = $1 AND LOWER(COALESCE(f.status, '')) <> 'cancelled'`,
      [tripId]
    ),
    queryBlog<any>(
      `SELECT d.local_date, COALESCE(SUM(c.comment_count), 0)::int AS comment_count
         FROM blog_days d
         LEFT JOIN blog_engagement_counters c ON c.target_kind = 'day' AND c.target_id = d.id
          AND c.audience IN (${visible})
        WHERE d.trip_id = $1
        GROUP BY d.id, d.local_date
        ORDER BY comment_count DESC, d.local_date ASC LIMIT 1`,
      [tripId]
    ),
  ]);
  const distanceKm = Math.round(flightLegs.rows.reduce((sum, row) => sum + routeDistanceKm([
    row.departure_lat == null ? null : { lat: Number(row.departure_lat), lng: Number(row.departure_lng) },
    row.layover_lat == null ? null : { lat: Number(row.layover_lat), lng: Number(row.layover_lng) },
    row.arrival_lat == null ? null : { lat: Number(row.arrival_lat), lng: Number(row.arrival_lng) },
  ].filter(Boolean)), 0));
  const commented = commentedDays.rows[0];
  return {
    dayCount: Number(days.rows[0]?.count ?? 0),
    placeCount: Number(places.rows[0]?.count ?? 0),
    distanceKm,
    photoCount: media.rows.filter((row) => row.media_kind_key === 'photo').length,
    videoCount: media.rows.filter((row) => row.media_kind_key === 'video').length,
    travelerCount: Number(travelers.rows[0]?.count ?? 0),
    followerParticipantCount: Number(followers.rows[0]?.count ?? 0),
    media: media.rows.map((row) => ({ assetId: String(row.asset_id), caption: row.caption ?? null, altText: row.alt_text ?? null, reactionTotal: Number(row.reaction_total ?? 0) })),
    contributors: audienceClass === 'travelers' ? contributors.rows.map((row) => ({ userId: String(row.user_id), displayName: String(row.display_name), contributionCount: Number(row.contribution_count) })) : [],
    mostCommentedDay: commented && Number(commented.comment_count) > 0 ? { dayDate: new Date(commented.local_date).toISOString().slice(0, 10), commentCount: Number(commented.comment_count) } : null,
  };
};
